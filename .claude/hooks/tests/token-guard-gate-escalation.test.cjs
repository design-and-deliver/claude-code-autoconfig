// Same-turn escalation for the two in-turn tripwires (R13b work, R14 rent).
//
// WHY: both gates re-armed at a FLAT step (the next gate-width above the observed level), so a
// long turn met the same byte-identical modal over and over. Observed 2026-07-25, session
// c9ad7711: one 48-minute turn walked turnGateAt from 1M to 6M — five identical asks, approved
// every time. A gate you meet five times is a keystroke, not a decision.
//
// The fix has two halves and this suite pins both:
//   1. the re-arm WIDTH doubles on each same-turn fire (base, 2x, 4x…), so repeats get rarer;
//   2. the copy NAMES the repeat ("2nd check this turn"), so a repeat is legible as a repeat.
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

test('R14 first fire reads plain — no ordinal, forward-looking next check', () => {
  const fix = mkFixture({ turnGateTokens: PARKED, turnRentGateTokens: 100000 });
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, roundTrip('m2', 150000));   // rent 150k >= 100k gate
  const r = reason(fix);
  assert.match(r, /Next check ≈ 250k of re-reads this turn\./);
  assert.doesNotMatch(r, /check this turn —/);           // no repeat framing on the first ask
  assert.doesNotMatch(r, /\b\d+(st|nd|rd|th) check\b/);
});

test('R14 second same-turn fire names the repeat and DOUBLES the width', () => {
  const fix = mkFixture({ turnGateTokens: PARKED, turnRentGateTokens: 100000 });
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, roundTrip('m2', 150000));   // fire 1 @150k -> re-arm 250k
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, 'ask');
  fs.appendFileSync(fix.tp, roundTrip('m3', 150000));   // rent 300k >= 250k -> fire 2
  const r = reason(fix);
  // Half 2 — the repeat is legible as a repeat.
  assert.match(r, /This is the 2nd check this turn/);
  assert.match(r, /each approval doubles the gap to the next/);
  // Half 1 — width doubled: 300k observed + (100k x 2) = 500k, NOT the flat step's 400k.
  assert.match(r, /≈ 500k of re-reads/);
  assert.doesNotMatch(r, /≈ 400k/);
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
  assert.match(r, /This is the 3rd check this turn/);
  assert.match(r, /≈ 950k of re-reads/);                // 550k + (100k x 4)
});

test('a new prompt resets the fire count — escalation never leaks across turns', () => {
  const fix = mkFixture({ turnGateTokens: PARKED, turnRentGateTokens: 100000 });
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, roundTrip('m2', 150000));
  preToolUse(fix);                                      // fire 1
  fs.appendFileSync(fix.tp, roundTrip('m3', 150000));
  assert.match(reason(fix), /2nd check this turn/);     // fire 2, same turn
  promptSubmit(fix);                                    // <- turn boundary: re-baseline + reset
  fs.appendFileSync(fix.tp, roundTrip('m4', 150000));   // 150k of rent in the NEW turn
  const r = reason(fix);
  assert.match(r, /Next check ≈ 250k of re-reads this turn\./);  // plain again, base width again
  assert.doesNotMatch(r, /check this turn —/);
});

// ---------------------------------------------------------------- R13b (work)

test('R13b escalates on the same rule — repeat named, width doubled', () => {
  const fix = mkFixture({ turnGateTokens: 100000, turnRentGateTokens: PARKED });
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, workLine('m2', 150000));    // work ~150k >= 100k -> fire 1
  const first = reason(fix);
  assert.match(first, /this ONE turn has burned/);
  assert.match(first, /Next check ≈ 250k this turn\./);
  assert.doesNotMatch(first, /check this turn —/);
  fs.appendFileSync(fix.tp, workLine('m3', 150000));    // work ~300k >= 250k -> fire 2
  const second = reason(fix);
  assert.match(second, /This is the 2nd check this turn/);
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
  assert.match(r, /Approve to push on — or deny/);      // the escalation clause did not eat the ask
  assert.match(r, /\/clear \+ \/continue/);
  assert.doesNotMatch(r, /\$/);
});
