// R14 — the in-turn RENT tripwire. ONE turn's cache RE-READS (round trips × resident context)
// ≥ turnRentGateTokens ⇒ PreToolUse ask; re-arms ABOVE the observed rent; every prompt
// re-baselines. R14 exists because R13b, by construction, cannot see this: R13b discounts
// re-reads 10× so it can judge TASK SIZE, which makes it blind to a turn that does ordinary
// work over many round trips at a fat context. Observed 2026-07-25 (session afd2a755): 24 round
// trips × ~104k context = 2.5M of re-reads and $2.62 in ONE 22-minute plan-authoring turn,
// while the work itself was 83k — under the ~100k normal-task bar. Copy contract: leads with
// round trips × context (the lever is context size, not task length), never calls it a spiral.
// Run: node --test token-guard-r14.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');

const usageLine = (id, inp) => JSON.stringify({ type: 'assistant',
  message: { id, model: 'claude-fable-5', usage: { input_tokens: inp, output_tokens: 10 } } }) + '\n';
// One round trip at a fat context: a little new input, a little output, the whole context re-read.
const roundTrip = (id, cr, outT) => JSON.stringify({ type: 'assistant',
  message: { id, model: 'claude-fable-5',
    usage: { input_tokens: 100, output_tokens: outT == null ? 10 : outT,
      cache_read_input_tokens: cr } } }) + '\n';

function mkFixture(guardCfg) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'tg14-'));
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'cca.config.json'),
    // turnGateTokens parked high so R13b never pre-empts: these cases are about rent alone.
    JSON.stringify({ tokenGuard: Object.assign(
      { turnGateTokens: 10000000, turnRentGateTokens: 100000 }, guardCfg) }));
  const tp = path.join(proj, 'main.jsonl');
  fs.writeFileSync(tp, usageLine('m1', 1000));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg14-home-'));
  return { proj, home, tp };
}

function runHook(fix, payload) {
  const env = Object.assign({}, process.env, {
    CLAUDE_PROJECT_DIR: fix.proj, USERPROFILE: fix.home, HOME: fix.home,
    ANTHROPIC_API_KEY: 'sk-test', // API-billed on purpose: R14 copy stays token-denominated
  });
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(Object.assign({ session_id: 'sid-r14', transcript_path: fix.tp }, payload)),
    encoding: 'utf8', env, timeout: 20000,
  });
  return r.stdout || '';
}

const preToolUse = fix => runHook(fix, { hook_event_name: 'PreToolUse', tool_name: 'Bash' });
const promptSubmit = fix => runHook(fix, { hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
const gateOut = raw => (JSON.parse(raw || '{}').hookSpecificOutput || {});

test('R14 fires once a turn\'s re-reads cross the gate — round-trip copy, re-arms above observed', () => {
  const fix = mkFixture();
  promptSubmit(fix);                                 // baseline: 0 rent, 1 round trip
  fs.appendFileSync(fix.tp, roundTrip('m2', 300000)); // 3 gate-widths of rent in one trip
  const out = gateOut(preToolUse(fix));
  assert.equal(out.permissionDecision, 'ask');
  assert.match(out.permissionDecisionReason, /1 round trip carrying/);   // singular, not "1 round trips"
  assert.match(out.permissionDecisionReason, /~300k tokens of re-reads/);
  assert.match(out.permissionDecisionReason, /rent, not progress/);
  assert.match(out.permissionDecisionReason, /smaller resident context/);
  assert.doesNotMatch(out.permissionDecisionReason, /\$/);
  // Structure (2026-07-26): a headline reading, then ONE bullet per thought — cost / lever /
  // restart / choice. The prior single wrapped paragraph buried the ask under the arithmetic;
  // this pins it so a future copy edit can't quietly re-blob it. Restart joined 2026-07-26
  // (R15); it renders whenever the context meter is non-empty and the gap positive, which this
  // fixture guarantees — see the empty-meter case below for the 4-line shape.
  const lines = out.permissionDecisionReason.split('\n');
  assert.equal(lines.length, 5);
  assert.match(lines[0], /^⚠️ Hey — .*round trip carrying ~\d+k of context\.$/);
  assert.deepEqual(lines.slice(1).map(l => l.slice(0, 8)),
    ['• Cost: ', '• Lever:', '• Restar', '• Choice']);
  // R14 suppresses the position clause — the headline already stated trips × context.
  assert.match(lines[3], /^• Restart: \/clear \+ \/continue rebuilds that /);
  // Re-armed at 400k (above the 300k observed) ⇒ the very next tool call must not re-fire.
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, undefined);
});

test('R14 catches what R13b cannot: ordinary work spread over many trips at a fat context', () => {
  // The 2026-07-25 shape, at default gates. 24 trips × 104k = 2.5M of rent; work = 24×1.6k ≈
  // 38k. R13b's work meter reads ~288k against a 1M gate ⇒ silent. R14 must not be.
  const fix = mkFixture({ turnGateTokens: 1000000, turnRentGateTokens: 1000000 });
  promptSubmit(fix);
  for (let i = 2; i <= 25; i++) fs.appendFileSync(fix.tp, roundTrip(`m${i}`, 104000, 1500));
  const out = gateOut(preToolUse(fix));
  assert.equal(out.permissionDecision, 'ask');
  assert.match(out.permissionDecisionReason, /24 round trips/);
  assert.match(out.permissionDecisionReason, /~2\.5M tokens of re-reads/);
  assert.match(out.permissionDecisionReason, /against ~38k tokens of actual work/);
  // It is rent, not a spiral — R13b's framing must not leak into this message.
  assert.doesNotMatch(out.permissionDecisionReason, /spiral/i);
});

test('R14 re-baselines on the next prompt — a new turn starts rent-free', () => {
  const fix = mkFixture();
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, roundTrip('m2', 300000));
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, 'ask');
  promptSubmit(fix);                                 // new turn: baseline 300k, re-arm cleared
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, undefined);
});

test('R14 lazy-arms its baseline when none exists — never bills the session\'s rent to one turn', () => {
  const fix = mkFixture();
  fs.appendFileSync(fix.tp, roundTrip('m2', 300000)); // no prompt ever metered
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, undefined);
  fs.appendFileSync(fix.tp, roundTrip('m3', 300000)); // from that baseline, this IS a crossing
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, 'ask');
});

test('R14: turnRentGateTokens null disables the tripwire', () => {
  const fix = mkFixture({ turnRentGateTokens: null, turnGateTokens: null });
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, roundTrip('m2', 900000));
  assert.equal(preToolUse(fix).trim(), '');
});
