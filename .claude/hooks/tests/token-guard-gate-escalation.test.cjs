// Same-turn escalation for the two in-turn tripwires (R13b work, R14 rent).
//
// WHY: both gates re-armed at a FLAT step (the next gate-width above the observed level), so a
// long turn met the same byte-identical modal over and over. Observed 2026-07-25, session
// c9ad7711: one 48-minute turn walked turnGateAt from 1M to 6M — five identical asks, approved
// every time. A gate you meet five times is a keystroke, not a decision.
//
// The fix has two halves and this suite pins both:
//   1. the re-arm WIDTH doubles on each same-turn fire (base, 2x, 4x…), so repeats get rarer;
//   2. the copy NAMES the repeat ("RENT · 2nd check"), so a repeat is legible as a repeat.
// A third half arrived 2026-08-08 (see the "two meters" test at the bottom): the ordinal is
// worthless without the METER beside it, because a turn that fires both gates otherwise renders
// one apparently-broken ladder instead of two correct ones.
// Every prompt resets the fire count — escalation is per-turn, never sticky across a turn
// boundary (a fresh prompt is a fresh decision).
//
// Run: node --test token-guard-gate-escalation.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');

// A plain assistant turn: new input + output, no cache re-read. Drives the R13b WORK meter.
const workLine = (id, inp) => JSON.stringify({ type: 'assistant',
  message: { id, model: 'claude-fable-5', usage: { input_tokens: inp, output_tokens: 10 } } }) + '\n';
// One round trip at a fat context: trivial work, whole context re-read. Drives the R14 RENT meter.
const roundTrip = (id, cr) => JSON.stringify({ type: 'assistant',
  message: { id, model: 'claude-fable-5',
    usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: cr } } }) + '\n';

// Park the gate we are NOT exercising so it can never pre-empt the one under test.
const PARKED = 100000000;

function mkFixture(guardCfg) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'tgesc-'));
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'cca.config.json'),
    JSON.stringify({ tokenGuard: guardCfg }));
  const tp = path.join(proj, 'main.jsonl');
  fs.writeFileSync(tp, workLine('m1', 1000));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tgesc-home-'));
  return { proj, home, tp };
}

function runHook(fix, payload) {
  const env = Object.assign({}, process.env, {
    CLAUDE_PROJECT_DIR: fix.proj, USERPROFILE: fix.home, HOME: fix.home,
    ANTHROPIC_API_KEY: 'sk-test', // API-billed on purpose: this copy stays token-denominated
  });
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(Object.assign({ session_id: 'sid-esc', transcript_path: fix.tp }, payload)),
    encoding: 'utf8', env, timeout: 20000,
  });
  return r.stdout || '';
}

const preToolUse = fix => runHook(fix, { hook_event_name: 'PreToolUse', tool_name: 'Bash' });
const promptSubmit = fix => runHook(fix, { hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
const gateOut = raw => (JSON.parse(raw || '{}').hookSpecificOutput || {});
const reason = fix => gateOut(preToolUse(fix)).permissionDecisionReason || '';

// ---------------------------------------------------------------- R14 (rent)

test('R14 first fire is tagged RENT · 1st check, clause stays forward-looking', () => {
  const fix = mkFixture({ turnGateTokens: PARKED, turnRentGateTokens: 100000 });
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, roundTrip('m2', 150000));   // rent 150k >= 100k gate
  const r = reason(fix);
  // Cache-WEIGHTED, and with no ' of re-reads' suffix: since 2026-07-30 the Cost line names the
  // unit six words earlier and renders every rent figure at the 10% cache rate, so the re-arm
  // point rides in the same unit (250k of raw re-arm = 25k billed). Raw here would re-mix units.
  assert.match(r, /^⚠️ RENT · 1st check — /);            // meter named before anything else
  assert.match(r, /Next check ≈ 25k this turn\./);
  assert.doesNotMatch(r, /check this turn —/);           // no repeat framing on the first ask
  assert.doesNotMatch(r, /Each approval doubles/);
});

test('R14 second same-turn fire names the repeat and DOUBLES the width', () => {
  const fix = mkFixture({ turnGateTokens: PARKED, turnRentGateTokens: 100000 });
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, roundTrip('m2', 150000));   // fire 1 @150k -> re-arm 250k
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, 'ask');
  fs.appendFileSync(fix.tp, roundTrip('m3', 150000));   // rent 300k >= 250k -> fire 2
  const r = reason(fix);
  // Half 2 — the repeat is legible as a repeat. Since 2026-08-08 the ordinal rides in the meter
  // tag, so "2nd check" is inseparable from WHICH meter counted to two.
  assert.match(r, /^⚠️ RENT · 2nd check — /);
  assert.match(r, /Each approval doubles the gap to the next/);
  // Half 1 — width doubled: 300k observed + (100k x 2) = 500k raw = 50k billed, NOT the flat
  // step's 400k/40k. The escalated branch parks the figure in a trailing parenthetical — "this
  // turn" already rode past in "the 2nd check this turn", so it does not repeat here.
  assert.match(r, /≈ 50k\)/);
  assert.doesNotMatch(r, /≈ 40k/);
});

test('R14 escalation makes repeats rarer — a level that WOULD have re-fired flat stays quiet', () => {
  const fix = mkFixture({ turnGateTokens: PARKED, turnRentGateTokens: 100000 });
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, roundTrip('m2', 150000));   // fire 1 @150k
  preToolUse(fix);
  fs.appendFileSync(fix.tp, roundTrip('m3', 150000));   // fire 2 @300k -> re-arm 500k (flat: 400k)
  preToolUse(fix);
  fs.appendFileSync(fix.tp, roundTrip('m4', 150000));   // rent now 450k
  // Under the flat step this is the THIRD modal of the turn. Under escalation it is silence.
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, undefined);
});

test('R14 third fire widens again — 4x base, ordinal keeps counting', () => {
  const fix = mkFixture({ turnGateTokens: PARKED, turnRentGateTokens: 100000 });
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, roundTrip('m2', 150000));   // fire 1 @150k -> 250k
  preToolUse(fix);
  fs.appendFileSync(fix.tp, roundTrip('m3', 150000));   // fire 2 @300k -> 500k
  preToolUse(fix);
  fs.appendFileSync(fix.tp, roundTrip('m4', 250000));   // rent 550k >= 500k -> fire 3
  const r = reason(fix);
  assert.match(r, /^⚠️ RENT · 3rd check — /);
  assert.match(r, /≈ 95k\)/);                           // 550k + (100k x 4) = 950k raw, 95k billed
});

test('a new prompt resets the fire count — escalation never leaks across turns', () => {
  const fix = mkFixture({ turnGateTokens: PARKED, turnRentGateTokens: 100000 });
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, roundTrip('m2', 150000));
  preToolUse(fix);                                      // fire 1
  fs.appendFileSync(fix.tp, roundTrip('m3', 150000));
  assert.match(reason(fix), /RENT · 2nd check/);        // fire 2, same turn
  promptSubmit(fix);                                    // <- turn boundary: re-baseline + reset
  fs.appendFileSync(fix.tp, roundTrip('m4', 150000));   // 150k of rent in the NEW turn
  const r = reason(fix);
  assert.match(r, /^⚠️ RENT · 1st check — /);            // ordinal resets with the fire count
  assert.match(r, /Next check ≈ 25k this turn\./);       // plain again, base width again
  assert.doesNotMatch(r, /Each approval doubles/);
});

// ---------------------------------------------------------------- R13b (work)

test('R13b escalates on the same rule — repeat named, width doubled', () => {
  const fix = mkFixture({ turnGateTokens: 100000, turnRentGateTokens: PARKED });
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, workLine('m2', 150000));    // work ~150k >= 100k -> fire 1
  const first = reason(fix);
  assert.match(first, /^⚠️ TASK SIZE · 1st check — this ONE turn has burned/);
  assert.match(first, /Next check ≈ 250k this turn\./);
  assert.doesNotMatch(first, /Each approval doubles/);
  fs.appendFileSync(fix.tp, workLine('m3', 150000));    // work ~300k >= 250k -> fire 2
  const second = reason(fix);
  assert.match(second, /^⚠️ TASK SIZE · 2nd check — /);
  assert.match(second, /≈ 500k/);                       // doubled, not the flat 400k
  assert.doesNotMatch(second, /≈ 400k/);
});

test('escalated copy still ends on the deny-side instruction, and stays token-denominated', () => {
  const fix = mkFixture({ turnGateTokens: PARKED, turnRentGateTokens: 100000 });
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, roundTrip('m2', 150000));
  preToolUse(fix);
  fs.appendFileSync(fix.tp, roundTrip('m3', 150000));
  const r = reason(fix);
  // The escalation clause rides the "if it continues" line, so it cannot eat the ask below it.
  // Which side the verdict names is the ratio's business (gate-verdict pins that);
  // what this test guards is that the deny path is still spelled out whichever side wins.
  assert.match(r, /^• verdict — /m);
  assert.match(r, /land at a commit point, then \/clear \+ \/continue/);
  assert.doesNotMatch(r, /\$/);
});

// ------------------------------------------------- the two meters must not read as one ladder

// THE REGRESSION (observed 2026-08-08, session 563f51a8): R14 walked 115k -> 232k -> 435k of
// re-reads, each card promising the next at roughly double. Rent then stalled at ~725k — under
// its own ~835k re-arm — so R14 never spoke a 4th time. What spoke instead was R13b's FIRST fire,
// at its flat 1M floor, on a DIFFERENT unit. Andrew read four cards as one ladder and reasonably
// concluded the doubling had broken: "never 5X them until this last one."
//
// Nothing about the thresholds was wrong. The cards were: same '⚠️ Hey — this … turn' opener,
// same Cost/Restart/Choice bullets, and R13b's restart bullet even cites round trips × context,
// which is R14's headline. Without the meter named, the sequence is unreadable.
//
// This test fails on the old copy (both headlines start '⚠️ Hey —', so the two cards are not
// separable) and passes on the tagged copy.
test('a turn firing BOTH gates renders two labeled ladders, not one', () => {
  const fix = mkFixture({ turnGateTokens: 100000, turnRentGateTokens: 100000 });
  promptSubmit(fix);

  // Rent first: a fat round trip, trivial work — R14's shape, and too little work for R13b.
  fs.appendFileSync(fix.tp, roundTrip('m2', 150000));
  const rentCard = reason(fix);
  assert.match(rentCard, /^⚠️ RENT · 1st check — /);

  // Then real work on top. Work tokens count cache reads at 0.1x, so this is R13b's shape.
  fs.appendFileSync(fix.tp, workLine('m3', 400000));
  const workCard = reason(fix);
  assert.match(workCard, /^⚠️ TASK SIZE · 1st check — /);

  // The point of the whole exercise: two cards in one turn, and the first token of each says
  // which instrument is speaking. Both are a "1st check" — of different meters.
  assert.notEqual(rentCard.split('\n')[0], workCard.split('\n')[0]);
  assert.doesNotMatch(rentCard, /TASK SIZE/);
  assert.doesNotMatch(workCard, /^⚠️ RENT/);
});
