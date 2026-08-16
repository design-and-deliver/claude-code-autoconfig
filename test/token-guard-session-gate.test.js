/**
 * R20 — the BLOCKING session-total gate (2026-08-09).
 *
 * The gap it closes was measured, not theorised: a session reached 12.8M tokens and met its
 * first blocking card only at a hand-armed `hardGateUSD` backstop. Both in-turn tripwires
 * baseline at TURN start (turnStartWorkTok / turnStartCr) and reset on every UserPromptSubmit,
 * so forty ordinary turns each under their own gates accumulate a 12.8M session with nothing
 * ever stopping — and the session-total ladder that DOES see it (sessionWarnTokens, 5M/10M)
 * only prints, so it scrolls away with the rest of the turn's output.
 *
 * Every firing case below returns null on the pre-R20 code, which had no session-scoped gate.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, assert, summary } = require('./_harness');
const { r20SessionTotalGuard, r13bTurnSpendGuard, r14TurnRentGuard, resolveConfig } =
  require('../.claude/hooks/token-guard');

const CFG = resolveConfig({});
const HOOK_SRC = fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'hooks', 'token-guard.js'), 'utf8');

// A meter shaped like meterSession's return. `tok` lands as unweighted processed tokens, which
// is exactly what sessionTokens() sums — the same figure the check-in ladder and the backstop
// copy already read, so the three can never disagree about how big the session is.
//
// liveContext defaults FAT (above the 150k default fat line) because since the 2026-08-16 silence
// guard a fat window is a precondition of R20 speaking at all — under the line its only remedy
// (/clear + /continue) sheds almost nothing, so the card stays quiet. Cases that care about the
// lean branch pass their own liveContext.
function meter({ tok = 0, turns = 40, liveContext = 180000 } = {}) {
  return {
    main: { perModel: { 'claude-opus-5': { inp: 0, out: 0, cr: tok, cw: 0, searches: 0, usd: 0 } },
      turns, firstContext: 0 },
    agents: { perModel: {} },
    liveContext, usd: 0,
  };
}

// Turn baselines armed at the CURRENT meter reading, so R13b and R14 both see a zero-delta turn.
// That is the whole point of the cross-check below: an ordinary turn inside a huge session.
function state(over = {}) {
  return Object.assign({
    turnStartWorkTok: 0, turnGateAt: null, turnGateFires: 0,
    turnStartCr: 0, turnStartReqs: 40, rentGateAt: null, rentGateFires: 0,
    sessionGateAt: null, sessionGateFires: 0,
    recoveryTurn: false,
  }, over);
}

function ctxFor(st, m, verdict) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-sessiongate-'));
  return { cfg: CFG, m, st, verdict, projectDir, sid: 'test-sid',
    data: { transcript_path: null } };
}

// --- the gate itself ------------------------------------------------------------------------

test('default config arms the session gate under the 10M check-in', () => {
  assert(CFG.sessionGateTokens === 6000000,
    `expected a 6M default gate, got ${CFG.sessionGateTokens}`);
  assert(CFG.sessionGateTokens < CFG.sessionWarnTokens[1],
    'the gate must sit under the 10M printed check-in, not talk over it');
});

test('a 6.5M session is stopped', () => {
  const st = state();
  const d = r20SessionTotalGuard(ctxFor(st, meter({ tok: 6500000 }), null));
  assert(d && d.kind === 'ask', `6.5M must trip the session gate, got: ${JSON.stringify(d)}`);
});

test('a session under the gate stays quiet', () => {
  const st = state();
  const d = r20SessionTotalGuard(ctxFor(st, meter({ tok: 3000000 }), null));
  assert(d === null, `3M is under the gate, got: ${JSON.stringify(d)}`);
  assert(st.sessionGateAt === null && !st.sessionGateFires,
    'a gate that never fired must arm nothing');
});

test('the in-turn gates are blind to the same session — the gap R20 exists for', () => {
  const m = meter({ tok: 12800000 });          // the measured 12.8M session…
  const ordinary = { turnStartWorkTok: 12800000, turnStartCr: 12800000, turnStartReqs: 40 };
  assert(r13bTurnSpendGuard(ctxFor(state(ordinary), m, null)) === null,
    'R13b measures a turn delta — an ordinary turn inside a huge session must not trip it');
  assert(r14TurnRentGuard(ctxFor(state(ordinary), m, { kind: 'deny' })) === null,
    'R14 measures a turn delta too — same blindness');
  assert(r20SessionTotalGuard(ctxFor(state(ordinary), m, null)) !== null,
    'R20 is the only guard on the session axis; if it is silent here, nothing ever blocks');
});

test('null sessionGateTokens disables the gate entirely', () => {
  const cfg = Object.assign({}, CFG, { sessionGateTokens: null });
  const ctx = ctxFor(state(), meter({ tok: 20000000 }), null);
  ctx.cfg = cfg;
  assert(r20SessionTotalGuard(ctx) === null, 'a null gate must be off, not defaulted');
});

test('a recovery turn is exempt — /clear + /continue IS this card\'s own remedy', () => {
  const st = state({ recoveryTurn: true });
  const d = r20SessionTotalGuard(ctxFor(st, meter({ tok: 9000000 }), null));
  assert(d === null, `mid-recovery the card would advise what is already running: ${JSON.stringify(d)}`);
  assert(st.sessionGateAt === null && !st.sessionGateFires,
    'an exempt turn must leave the gate exactly where it was');
});

test('a turn-ender defers the gate without re-arming', () => {
  const st = state();
  const d = r20SessionTotalGuard(ctxFor(st, meter({ tok: 7000000 }), { kind: 'skip' }));
  assert(d === null, `a turn-ender must not be gated, got: ${JSON.stringify(d)}`);
  assert(!st.sessionGateFires, 'a deferred check is not a fire');
});

// --- the status-quo silence (2026-08-16) -----------------------------------------------------
// R14 took this rule on 2026-07-31; R20 landed nine days later without it and shipped a blocking
// card whose own Choice bullet read `approve (recommended)` — a round trip spent to arrive at the
// user's default action. Every case here returns an ask on the pre-silence code.

test('a lean window silences the card — approve is the default action', () => {
  const st = state();
  const d = r20SessionTotalGuard(ctxFor(st, meter({ tok: 8300000, liveContext: 100000 }), null));
  assert(d === null,
    `under the 150k fat line clearing sheds little, so the card must not block: ${JSON.stringify(d)}`);
});

test('the silenced check does NOT re-arm — it rides until the window turns fat', () => {
  const st = state();
  r20SessionTotalGuard(ctxFor(st, meter({ tok: 8300000, liveContext: 100000 }), null));
  assert(st.sessionGateAt === null && !st.sessionGateFires,
    `a fire that never reached the reader is not a repeat, so the width must stay put: ${st.sessionGateAt}`);
  // Same session, same total, the window now past the line: the deferred check speaks at once
  // rather than sitting out a doubled width.
  const d = r20SessionTotalGuard(ctxFor(st, meter({ tok: 8300000, liveContext: 180000 }), null));
  assert(d && d.kind === 'ask',
    `the first call after the window crosses the fat line must speak: ${JSON.stringify(d)}`);
  assert(st.sessionGateFires === 1, 'that fire is the first, not the second');
});

test('a bomb CALL still speaks under the fat line — the losing option is live', () => {
  const st = state();
  const d = r20SessionTotalGuard(
    ctxFor(st, meter({ tok: 8300000, liveContext: 100000 }), { kind: 'deny', why: 'runs the whole test suite' }));
  assert(d && d.kind === 'ask', `a bomb outranks the lean-window silence: ${JSON.stringify(d)}`);
  assert(/deny \(recommended\)/.test(d.reason), `the bomb branch owns the verdict: ${d.reason}`);
});

test('an unmeasured window still speaks — the script does not suppress on no reading', () => {
  const st = state();
  const d = r20SessionTotalGuard(ctxFor(st, meter({ tok: 8300000, liveContext: 0 }), null));
  assert(d && d.kind === 'ask',
    `rv == null is an honest "no reading", not a reason to retire the session axis: ${JSON.stringify(d)}`);
});

test('every card that DOES speak recommends deny, never approve', () => {
  const st = state();
  const { reason } = r20SessionTotalGuard(ctxFor(st, meter({ tok: 8300000 }), null));
  assert(/deny \(recommended\)/.test(reason), `a fat window argues for clearing: ${reason}`);
  assert(!/approve \(recommended\)/.test(reason),
    `the branch that recommends the status quo must be silent, not printed: ${reason}`);
});

// --- re-arm: repeats get rarer instead of becoming wallpaper --------------------------------

test('each approval doubles the gap to the next check', () => {
  const st = state();
  r20SessionTotalGuard(ctxFor(st, meter({ tok: 6500000 }), null));
  assert(st.sessionGateFires === 1 && st.sessionGateAt === 6500000 + 6000000,
    `first re-arm must sit one base-width above what was observed, got ${st.sessionGateAt}`);
  r20SessionTotalGuard(ctxFor(st, meter({ tok: 13000000 }), null));
  assert(st.sessionGateFires === 2 && st.sessionGateAt === 13000000 + 12000000,
    `second re-arm must double the width, got ${st.sessionGateAt}`);
});

test('the re-arm holds across turns — the gate is session-scoped by construction', () => {
  // Source check, not behavioural: driving onUserPromptSubmit needs a real transcript on disk,
  // and the whole subtlety is an ABSENCE — the per-turn re-baseline must not touch these keys.
  const reset = HOOK_SRC.slice(HOOK_SRC.indexOf('st.turnStartWorkTok = workTokens(m);'),
    HOOK_SRC.indexOf('ctx.m = m;'));
  assert(reset.length > 0, 'the per-turn re-baseline block must still exist');
  assert(!/st\.sessionGate(At|Fires)\s*=/.test(reset),
    'the turn re-baseline clears the session gate — that recreates the blind spot R20 closes');
});

// --- copy ------------------------------------------------------------------------------------

test('the card speaks on the session axis, not the turn', () => {
  const st = state();
  const { reason } = r20SessionTotalGuard(ctxFor(st, meter({ tok: 6500000 }), null));
  assert(/this session has spent ~6\.5M tokens/.test(reason),
    `the lead must quote the measured session total: ${reason}`);
  assert(/Next check ≈ .* this session\./.test(reason),
    `the next-check tail must name the session, never "this turn": ${reason}`);
  assert(!/Next check ≈ [^\n]*this turn/.test(reason),
    `the re-arm is session-scoped, so its tail must not be turn-scoped: ${reason}`);
  assert(/only \/clear starts the count over/.test(reason),
    `the card must say landing the turn does not shrink a session total: ${reason}`);
});

test('no $ figure and no raw 7-figure count survive on the card', () => {
  const st = state();
  const { reason } = r20SessionTotalGuard(ctxFor(st, meter({ tok: 6500000 }), null));
  assert(!/\$/.test(reason), `subscription copy carries no $ figure: ${reason}`);
  assert(!/\d{7,}/.test(reason), `every token count must be fmtK'd: ${reason}`);
});

test('the context figure is the MEASURED window, never total ÷ requests', () => {
  const st = state();
  const { reason } = r20SessionTotalGuard(
    ctxFor(st, meter({ tok: 6500000, liveContext: 180000, turns: 40 }), null));
  assert(/~180k of context rides into every further request/.test(reason),
    `the card must quote m.liveContext: ${reason}`);
  assert(!/163k/.test(reason),
    'total ÷ requests is the 42:1 ratio the threshold work retired — it must not appear');
});

test('R13b and R14 keep their byte-identical "this turn" tail', () => {
  const st = state();
  const r13b = r13bTurnSpendGuard(ctxFor(state(), meter({ tok: 0 }), null));
  assert(r13b === null, 'sanity: a zero-delta turn does not trip R13b');
  const { reason } = r20SessionTotalGuard(ctxFor(st, meter({ tok: 6500000 }), null));
  assert(/ this session\./.test(reason), 'R20 overrides the default scope');
  assert(/const nextCheckClause = \(fires, nextAt, unit = '', scope = 'this turn'\)/
    .test(HOOK_SRC),
    'the scope parameter must stay DEFAULTED, or R13b/R14 copy silently changes');
});

// --- wiring ------------------------------------------------------------------------------------

test('the guard is wired into the spend chain and its config key can arm the meter', () => {
  assert(/r20SessionTotalGuard, sessionSpendGuard\]/.test(HOOK_SRC),
    'R20 must run before the hand-armed backstop and after the two turn-scoped gates');
  assert(/SPEND_ARM_KEYS = \[[^\]]*'sessionGateTokens'/.test(HOOK_SRC),
    'a config with only sessionGateTokens set must still meter, or the gate can never speak');
});

summary();
