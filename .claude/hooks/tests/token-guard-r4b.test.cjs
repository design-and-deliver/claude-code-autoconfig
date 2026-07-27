// R4b — the idle-return RECEIPT, i.e. the background-wake half of R4. R4 lives in
// PROMPT_GUARDS, so it only ever sees a gap the USER walked back into. A session re-invoked by
// a finished background task never fires UserPromptSubmit at all: measured 2026-07-27 on
// session 7ab5b90c, which sat 9h40m at 221k context, woke itself when a build completed, and
// re-uploaded the whole conversation at write rates with `warnedIdleAt` still 0.
//
// R4's elapsed-gap test cannot be reused on PreToolUse — the wake request has already landed by
// then, so Date.now() - lastTs is seconds, not hours. R4b keys on the CACHE SPLIT instead: a
// request that WRITES six figures of context instead of reading them is definitionally a
// full-price re-upload, whatever the clock says. Nothing can pre-empt that charge (no hook runs
// before a task-notification re-invocation), so this is a receipt with an out, not a gate.
// Run: node --test token-guard-r4b.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');

let clock = Date.parse('2026-07-27T00:00:00Z');
const stamp = () => new Date((clock += 60000)).toISOString();

// A cached round trip — the whole context read back at 0.1x. The ordinary case.
const cached = (id, cr) => JSON.stringify({ type: 'assistant', timestamp: stamp(),
  message: { id, model: 'claude-fable-5',
    usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: cr,
      cache_creation_input_tokens: 2000 } } }) + '\n';

// The wake: nothing to read back, so the entire context is WRITTEN at full price.
const coldWrite = (id, cw) => JSON.stringify({ type: 'assistant', timestamp: stamp(),
  message: { id, model: 'claude-fable-5',
    usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0,
      cache_creation_input_tokens: cw } } }) + '\n';

function mkFixture(guardCfg) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'tg4b-'));
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'cca.config.json'),
    // Spend gates parked out of reach: these cases are about the cache split alone.
    JSON.stringify({ tokenGuard: Object.assign(
      { contextWarnTokens: 150000, turnGateTokens: 100000000,
        turnRentGateTokens: 100000000, hardGateUSD: null }, guardCfg) }));
  const tp = path.join(proj, 'main.jsonl');
  fs.writeFileSync(tp, cached('m1', 120000));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg4b-home-'));
  return { proj, home, tp };
}

const SID = 'sid-r4b';

function writeState(fix, patch) {
  const dir = path.join(fix.proj, '.claude', 'hooks', '.token-guard');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${SID}.json`);
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* first write */ }
  fs.writeFileSync(file, JSON.stringify(Object.assign(cur, patch)));
}

function runHook(fix, payload) {
  const env = Object.assign({}, process.env, {
    CLAUDE_PROJECT_DIR: fix.proj, USERPROFILE: fix.home, HOME: fix.home,
    ANTHROPIC_API_KEY: 'sk-test',
  });
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(Object.assign({ session_id: SID, transcript_path: fix.tp }, payload)),
    encoding: 'utf8', env, timeout: 20000,
  });
  return r.stdout || '';
}

const preToolUse = fix => runHook(fix, { hook_event_name: 'PreToolUse', tool_name: 'Bash' });
const gateOut = raw => (JSON.parse(raw || '{}').hookSpecificOutput || {});

test('R4b fires on a cold re-upload — receipt copy, one-shot per wake', () => {
  const fix = mkFixture();
  fs.appendFileSync(fix.tp, coldWrite('m2', 221000));
  const out = gateOut(preToolUse(fix));
  assert.equal(out.permissionDecision, 'ask');
  assert.match(out.permissionDecisionReason, /^⚠️ Hey — this session picked itself back up/);
  assert.match(out.permissionDecisionReason, /~221k tokens of it at full price/);
  assert.match(out.permissionDecisionReason, /about 20x what the same turn costs while cached/);
  // The out is action-first and names both commands (ux copy/action-lines-lead-with-the-action).
  assert.match(out.permissionDecisionReason, /\/clear, then \/continue/);
  // Copy contract (feedback_token_guard_warning_copy): never a dollar figure — subscription
  // users read one as a real charge — and never the exact idle duration.
  assert.doesNotMatch(out.permissionDecisionReason, /\$/);
  assert.doesNotMatch(out.permissionDecisionReason, /\d+\s*(h|hour|min)/i);
  // One-shot: the same wake must not re-ask on every subsequent tool call of that turn.
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, undefined);
});

test('R4b stays silent on an ordinary cached turn — a cache READ is not a re-upload', () => {
  const fix = mkFixture();
  fs.appendFileSync(fix.tp, cached('m2', 221000));
  assert.equal(preToolUse(fix).trim(), '');
});

test('R4b stays silent on turn 1 — a session baseline writes its context fresh by design', () => {
  const fix = mkFixture();
  fs.writeFileSync(fix.tp, coldWrite('m1', 221000));   // the ONLY request in the session
  assert.equal(preToolUse(fix).trim(), '');
});

test('R4b stays silent below contextWarnTokens — a thin context refills for pennies', () => {
  const fix = mkFixture();
  fs.appendFileSync(fix.tp, coldWrite('m2', 40000));
  assert.equal(preToolUse(fix).trim(), '');
});

test('R4b defers to R4 — no second warning for a gap R4 already owned', () => {
  const fix = mkFixture();
  fs.appendFileSync(fix.tp, coldWrite('m2', 221000));
  // R4 blocked the user's return moments ago; the cold write is their ↑+Enter re-send landing.
  writeState(fix, { idleFiredAt: Date.now() });
  assert.equal(preToolUse(fix).trim(), '');
});

test('R4b survives a stale suppression stamp — an OLD R4 fire must not mute a new wake', () => {
  const fix = mkFixture();
  fs.appendFileSync(fix.tp, coldWrite('m2', 221000));
  writeState(fix, { idleFiredAt: Date.now() - 30 * 60000 });
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, 'ask');
});

test('R4b runs with every spend gate disabled — it is not a spend gate', () => {
  // The metered block used to bail when no spend gate was armed, which would have taken the
  // receipt down with it. Pins the carve-out in spendGatesGuard.
  const fix = mkFixture({ turnGateTokens: null, turnRentGateTokens: null, hardGateUSD: null });
  fs.appendFileSync(fix.tp, coldWrite('m2', 221000));
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, 'ask');
});
