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
const { isRecoveryTurn, r13bTurnSpendGuard, r14TurnRentGuard, resolveConfig,
  recordRecoverySpend, loadRecoverySpend, recoveryWasteVerdict, recoveryCostNote,
  r21RecoveryCostGuard, noteClearAdvice, claimClearAdvice, loadClearAdvice } =
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

// --- R21: the recovery-cost meter (2026-08-12) ---------------------------------------------
//
// The exemption above made recovery turns invisible to every tripwire — deliberately. R21 is
// the ledger that keeps the habit honest: each recovery turn's spend is recorded at Stop, and
// once per 24h a note fires IF the trailing day crossed recoveryWasteTokens. Healthy days
// (under the line, or nothing to report) stay silent by contract.

const DAY = 86400000;

test('recovery spend round-trips through the store with rounded figures', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-r21-'));
  recordRecoverySpend(dir, 'sid-1', 120000, 1.5, 1000);
  recordRecoverySpend(dir, 'sid-2', 80000.4, 0.257, 2000);
  const store = loadRecoverySpend(dir);
  assert(store.samples.length === 2, 'two samples recorded');
  assert(store.samples[0].sid === 'sid-1' && store.samples[0].at === 1000,
    'a sample carries sid + timestamp');
  assert(store.samples[1].tok === 80000 && store.samples[1].usd === 0.26,
    'tok rounds to whole tokens, usd to cents');
});

test('verdict is null while healthy: empty day, under the line, stale spend, or already reported', () => {
  const now = 10 * DAY;
  const line = 2000000;
  assert(recoveryWasteVerdict({ samples: [], lastReportAt: 0 }, line, now) === null,
    'an empty store is silent');
  const under = { samples: [{ at: now - 1000, tok: 500000, usd: 1 }], lastReportAt: 0 };
  assert(recoveryWasteVerdict(under, line, now) === null, 'under the line is silent');
  const stale = { samples: [{ at: now - 2 * DAY, tok: 9000000, usd: 9 }], lastReportAt: 0 };
  assert(recoveryWasteVerdict(stale, line, now) === null, 'spend older than 24h is out of window');
  const reported = { samples: [{ at: now - 1000, tok: 3000000, usd: 3 }],
    lastReportAt: now - 3600000 };
  assert(recoveryWasteVerdict(reported, line, now) === null,
    'a report shipped within 24h holds the one-shot');
});

test('verdict totals ONLY the trailing day once the line is crossed', () => {
  const now = 10 * DAY;
  const store = { samples: [
    { at: now - 1000, tok: 1500000, usd: 2 },
    { at: now - 2000, tok: 900000, usd: 1.5 },
    { at: now - 2 * DAY, tok: 5000000, usd: 9 },   // out of window — must not count
  ], lastReportAt: 0 };
  const v = recoveryWasteVerdict(store, 2000000, now);
  assert(v && v.n === 2 && v.tok === 2400000,
    `two in-window samples totalling 2.4M — got ${JSON.stringify(v)}`);
  assert(Math.abs(v.usd - 3.5) < 1e-9, 'usd sums the same window');
});

test('the note names count, tokens, and the crossed line; $ only when usd$ is on', () => {
  const v = { n: 3, tok: 2400000, usd: 3.5 };
  const withUsd = recoveryCostNote(v, 2000000, true);
  assert(/3 self-initiated recoveries/.test(withUsd) && /2\.4M/.test(withUsd)
    && /2\.0M/.test(withUsd), 'count, total, and threshold all appear');
  assert(/\$3\.50/.test(withUsd), 'API billing carries the $ figure');
  const tokensOnly = recoveryCostNote(v, 2000000, false);
  assert(!/\$/.test(tokensOnly), 'subscription copy never carries a $ figure');
  assert(/1 self-initiated recovery /.test(
    recoveryCostNote({ n: 1, tok: 2400000, usd: 1 }, 2000000, false)),
  'a single recovery reads singular');
});

test('the guard fires once, stamps the store, and stays quiet for the next 24h', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-r21-'));
  recordRecoverySpend(dir, 's1', 3000000, 4, Date.now());
  const first = r21RecoveryCostGuard({ cfg: CFG, projectDir: dir, usd$: false });
  assert(first.notes.length === 1 && /recovery-cost/.test(first.notes[0]),
    `over the line -> one note — got ${JSON.stringify(first.notes)}`);
  const second = r21RecoveryCostGuard({ cfg: CFG, projectDir: dir, usd$: false });
  assert(second.notes.length === 0, 'the report is one-shot per 24h');
  assert(loadRecoverySpend(dir).lastReportAt > 0,
    'the stamp lives in the store, not session state — the habit spans sessions');
});

test('recoveryWasteTokens null disables the report end to end', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-r21-'));
  recordRecoverySpend(dir, 's1', 9000000, 9, Date.now());
  const off = r21RecoveryCostGuard({ cfg: resolveConfig({ recoveryWasteTokens: null }),
    projectDir: dir, usd$: false });
  assert(off.notes.length === 0, 'a null line must silence the report');
});

test('Stop bills a recovery turn to the ledger (source-order check, like the flag wiring above)', () => {
  const stopBlock = HOOK_SRC.slice(HOOK_SRC.indexOf('function onStop('),
    HOOK_SRC.indexOf('// PreToolUse guards'));
  assert(/st\.recoveryTurn/.test(stopBlock) && /recordRecoverySpend\(/.test(stopBlock),
    'onStop must call recordRecoverySpend when st.recoveryTurn is set');
});

// --- R21 provenance: a clear WE asked for is not the user's habit (2026-08-17) ---------------
//
// Reported, not theorised: R21 relayed "21 session recoveries in the last 24h cost ~2.1M tokens;
// if any of those /clears were reflexive, letting sessions run longer is cheaper" into a repo
// where the guard itself had recommended the clears — at a plan boundary, and from the statusline
// nudge. The note contradicted the advice that produced it, which is worse than noise: it puts
// the earlier recommendation in doubt. Every case below FAILS on the pre-fix code, where a sample
// carried no provenance and recoveryWasteVerdict summed the day indiscriminately.

const HALF_HOUR = 1800000;

test('an advice stamp is claimable exactly once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-r21p-'));
  const t = 10 * DAY;
  assert(claimClearAdvice(dir, t) === null, 'no stamp -> nothing to claim');
  noteClearAdvice(dir, 'R14', t);
  assert(loadClearAdvice(dir).source === 'R14', 'the stamp records which surface advised');
  assert(claimClearAdvice(dir, t + 60000) === 'R14', 'the recovery that follows claims it');
  assert(claimClearAdvice(dir, t + 61000) === null,
    'one advice -> one prompted recovery; the second clear is the user\'s own');
});

test('a stamp older than the TTL cannot excuse today\'s clear', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-r21p-'));
  const t = 10 * DAY;
  noteClearAdvice(dir, 'R20', t);
  assert(claimClearAdvice(dir, t + HALF_HOUR + 1000) === null,
    'past CLEAR_ADVICE_TTL_MS the recommendation is stale, not standing');
});

test('repaints of one standing recommendation collapse; a consumed stamp re-arms', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-r21p-'));
  const t = 10 * DAY;
  noteClearAdvice(dir, 'statusline', t);
  noteClearAdvice(dir, 'statusline', t + 5000);
  assert(loadClearAdvice(dir).at === t,
    'a second stamp inside the throttle must not rewrite — the statusline repaints constantly');
  assert(claimClearAdvice(dir, t + 10000) === 'statusline', 'still claimable');
  noteClearAdvice(dir, 'statusline', t + 12000);
  assert(loadClearAdvice(dir).at === t + 12000 && !loadClearAdvice(dir).consumed,
    'once consumed, the throttle must not swallow the NEXT genuine recommendation');
});

test('a recovery following advice is billed prompted; an unprompted one is not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-r21p-'));
  const t = 10 * DAY;
  recordRecoverySpend(dir, 'own', 100000, 1, t);
  noteClearAdvice(dir, 'R17-plan-boundary', t + 1000);
  recordRecoverySpend(dir, 'ours', 100000, 1, t + 2000);
  const [own, ours] = loadRecoverySpend(dir).samples;
  assert(!own.prompted, 'a clear with no standing advice is the user\'s own');
  assert(ours.prompted === true && ours.source === 'R17-plan-boundary',
    `the advised clear carries its provenance — got ${JSON.stringify(ours)}`);
});

test('the line weighs ONLY self-initiated recoveries', () => {
  const now = 10 * DAY;
  const store = { samples: [
    { at: now - 1000, tok: 1800000, usd: 2, prompted: true, source: 'R17-plan-boundary' },
    { at: now - 2000, tok: 1500000, usd: 2, prompted: true, source: 'statusline' },
    { at: now - 3000, tok: 400000, usd: 0.5 },
  ], lastReportAt: 0 };
  assert(recoveryWasteVerdict(store, 2000000, now) === null,
    'a day the guard itself drove past the line must stay silent — 3.3M of it was our advice');
  store.samples.push({ at: now - 4000, tok: 1700000, usd: 2 });
  const v = recoveryWasteVerdict(store, 2000000, now);
  assert(v && v.n === 2 && v.tok === 2100000,
    `only the two self-initiated samples count — got ${JSON.stringify(v)}`);
  assert(v.prompted === 2 && v.promptedTok === 3300000,
    'the guard\'s own share rides out on the verdict so the note can name it');
});

test('samples written before provenance existed still read as self-initiated', () => {
  const now = 10 * DAY;
  const legacy = { samples: [{ at: now - 1000, tok: 2500000, usd: 3 }], lastReportAt: 0 };
  const v = recoveryWasteVerdict(legacy, 2000000, now);
  assert(v && v.n === 1 && v.prompted === 0,
    'an absent `prompted` field is not "unknown" — old stores keep behaving exactly as before');
});

test('the note names the guard\'s own share only when there is one', () => {
  const withPrompted = recoveryCostNote({ n: 2, tok: 2100000, usd: 3, prompted: 5 }, 2000000, false);
  assert(/5 more followed my own \/clear suggestion/.test(withPrompted),
    'the tail reconciles this figure against /cost-compare\'s total');
  const none = recoveryCostNote({ n: 2, tok: 2100000, usd: 3, prompted: 0 }, 2000000, false);
  assert(!/followed my own/.test(none), 'no prompted recoveries -> no tail');
  assert(/recoveries this guard itself recommended are excluded/.test(none),
    'the model-facing half states the exclusion so the relayed line is not overclaimed');
});

test('every surface that recommends clearing stamps it (source-order check)', () => {
  for (const src of ['R13b', 'R14', 'R20', 'R17-plan-boundary']) {
    assert(HOOK_SRC.includes(`noteClearAdvice(ctx.projectDir, '${src}'`),
      `${src} must stamp its clear recommendation, or R21 bills it back to the user`);
  }
  const statusline = fs.readFileSync(
    path.join(__dirname, '..', '.claude', 'hooks', 'statusline-cost.js'), 'utf8');
  assert(/noteClearAdvice\(projectDir, 'statusline'/.test(statusline),
    'the statusline nudge is a fourth surface — it must stamp too');
});

summary();
