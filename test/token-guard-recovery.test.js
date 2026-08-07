/**
 * R13b/R14 recovery-turn exemption (2026-08-07).
 *
 * The bug this pins was reported, not theorised. Two terminals in a row were told to
 * `/clear` + `/continue`, did exactly that, and were told the SAME thing again partway through
 * the recovery. `/clear` raises no assistant turn, so the pair lands as turn 1 of the fresh
 * session and `/continue` then runs alone for dozens of round trips re-reading the old thread —
 * 68 trips and ~6.5M of raw cache re-reads on the measured pair, six times R14's 1M gate. Both
 * in-turn tripwires fired, correctly and uselessly: the only remedy either card offers IS
 * `/clear + /continue`, so denying aborts the recovery and leaves the session holding neither
 * the old context nor the new.
 *
 * Every case below FAILS on the pre-fix code, which had no notion of a recovery turn: the two
 * guards returned an ask for any turn over the gate, whatever the prompt was.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, assert, summary } = require('./_harness');
const { isRecoveryTurn, r13bTurnSpendGuard, r14TurnRentGuard, resolveConfig } =
  require('../.claude/hooks/token-guard');

const CFG = resolveConfig({});
const HOOK_SRC = fs.readFileSync(
  path.join(__dirname, '..', '.claude', 'hooks', 'token-guard.js'), 'utf8');

// A meter shaped like meterSession's return, carrying only what the two guards read.
function meter({ inp = 0, cr = 0, turns = 20, liveContext = 60000 } = {}) {
  return {
    main: { perModel: { 'claude-opus-5': { inp, out: 0, cr, cw: 0, searches: 0, usd: 0 } },
      turns, firstContext: 0 },
    agents: { perModel: {} },
    liveContext, usd: 0,
  };
}

// A state object with the turn baselines already armed, so the guards reach their gate check
// instead of returning early to lazy-arm.
function state(over = {}) {
  return Object.assign({
    turnStartWorkTok: 0, turnGateAt: null, turnGateFires: 0,
    turnStartCr: 0, turnStartReqs: 5, rentGateAt: null, rentGateFires: 0,
    recoveryTurn: false,
  }, over);
}

function ctxFor(st, m, verdict) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-recovery-'));
  return { cfg: CFG, m, st, verdict, projectDir, sid: 'test-sid',
    data: { transcript_path: null } };
}

// --- what counts as a recovery turn -----------------------------------------------------

test('the three recovery commands are recognised, bare and tagged', () => {
  for (const c of ['continue', 'recover-context', 'migrate-new-session']) {
    assert(isRecoveryTurn(`/${c}`), `bare /${c} must read as a recovery turn`);
    assert(isRecoveryTurn(`<command-name>/${c}</command-name>\nsome expansion`),
      `expanded /${c} must read as a recovery turn`);
  }
  assert(isRecoveryTurn('/continue --show'), 'arguments must not defeat the match');
});

test('ordinary prompts and near-misses are NOT exempt', () => {
  assert(!isRecoveryTurn('fix the modal'), 'plain prose is not a recovery turn');
  assert(!isRecoveryTurn('/commit-and-push'), 'an unrelated command is not a recovery turn');
  assert(!isRecoveryTurn('/continue-the-plan'),
    'prefix matching would exempt any command starting with "continue"');
  assert(!isRecoveryTurn('please /continue where we left off'),
    'the command must LEAD the prompt — a mention of it mid-sentence is not the turn');
  assert(!isRecoveryTurn(''), 'an empty prompt is not a recovery turn');
  assert(!isRecoveryTurn(null), 'a missing prompt is not a recovery turn');
});

// --- R13b: one turn's work tokens ---------------------------------------------------------

test('R13b fires on a 1.5M-token turn when it is NOT a recovery', () => {
  const st = state();
  const d = r13bTurnSpendGuard(ctxFor(st, meter({ inp: 1500000 }), null));
  assert(d && d.kind === 'ask', `a 1.5M turn must still trip R13b, got: ${JSON.stringify(d)}`);
});

test('R13b sits out the same turn when it is the recovery turn', () => {
  const st = state({ recoveryTurn: true });
  const d = r13bTurnSpendGuard(ctxFor(st, meter({ inp: 1500000 }), null));
  assert(d === null, `the recovery turn must not be gated, got: ${JSON.stringify(d)}`);
});

test('R13b exempt path arms nothing — the next turn re-baselines clean', () => {
  const st = state({ recoveryTurn: true, turnStartWorkTok: null });
  r13bTurnSpendGuard(ctxFor(st, meter({ inp: 1500000 }), null));
  assert(st.turnStartWorkTok === null,
    'the exemption must return BEFORE the lazy-arm, or the recovery becomes the next turn baseline');
  assert(!st.turnGateFires, 'a turn that never fired must not count a fire');
});

// --- R14: one turn's cache re-reads --------------------------------------------------------

test('R14 fires on the measured 6.5M of re-reads when it is NOT a recovery', () => {
  const st = state();
  const d = r14TurnRentGuard(ctxFor(st, meter({ cr: 6500000 }), { kind: 'deny' }));
  assert(d && d.kind === 'ask', `6.5M of rent must still trip R14, got: ${JSON.stringify(d)}`);
});

test('R14 sits out the same turn when it is the recovery turn (the reported bug)', () => {
  const st = state({ recoveryTurn: true });
  const d = r14TurnRentGuard(ctxFor(st, meter({ cr: 6500000 }), { kind: 'deny' }));
  assert(d === null,
    `mid-/continue, the card's only advice is /clear + /continue — got: ${JSON.stringify(d)}`);
  assert(st.rentGateAt === null && !st.rentGateFires,
    'an exempt turn must leave the gate exactly where it was');
});

// --- the wiring that makes the flag reach the turn it exists for ---------------------------
//
// Source-order check rather than a behavioural one: driving it through onUserPromptSubmit means
// a real transcript on disk, and the ordering is the whole subtlety — a `/clear` + `/continue`
// pair takes the brand-new-session return, so a flag set after it never reaches the turn.

test('recoveryTurn is set BEFORE the brand-new-session return', () => {
  const setAt = HOOK_SRC.indexOf('st.recoveryTurn = isRecoveryTurn(');
  const returnAt = HOOK_SRC.indexOf('if (!m.main.turns) {');
  assert(setAt > 0, 'onUserPromptSubmit must set st.recoveryTurn from the prompt');
  assert(returnAt > 0, 'the brand-new-session early return must still exist');
  assert(setAt < returnAt,
    'the flag is set after the early return — a /clear + /continue pair would never carry it');
});

test('the brand-new-session return persists state so PreToolUse can read the flag', () => {
  const block = HOOK_SRC.slice(HOOK_SRC.indexOf('if (!m.main.turns) {'),
    HOOK_SRC.indexOf('if (!m.main.turns) {') + 220);
  assert(/saveState\(/.test(block),
    'turn 1 must save state on the way out, or the flag dies before the guards run');
});

summary();
