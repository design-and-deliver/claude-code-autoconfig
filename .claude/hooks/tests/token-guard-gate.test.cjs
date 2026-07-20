// Hard gate (hardGateUSD) — billing-aware copy. The gate itself fires on every billing kind
// (it's a deliberate backstop), but its message must follow wantDollars(): $ figures for
// API-billed sessions, token-denominated copy on a subscription (a $ there reads as a phantom
// bill — the 2026-07-20 live sighting). Run: node --test token-guard-gate.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');

// ~100k fable input tokens => a few $ of estimated spend, comfortably over the 0.01 gate.
const usageLine = (id, inp) => JSON.stringify({ type: 'assistant',
  message: { id, model: 'claude-fable-5', usage: { input_tokens: inp, output_tokens: 10 } } }) + '\n';

function mkFixture(billing) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'tgg-'));
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'cca.config.json'),
    JSON.stringify({ tokenGuard: { hardGateUSD: 0.01, gateStepUSD: 0.01 } }));
  const tp = path.join(proj, 'main.jsonl');
  fs.writeFileSync(tp, usageLine('m1', 100000));
  // Isolated home (never the real one — live credentials). Subscription is simulated with a
  // minimal credentials file carrying only the field billingKind() reads.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tgg-home-'));
  if (billing === 'subscription') {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { subscriptionType: 'max' } }));
  }
  return { proj, home, tp };
}

function fireGate(billing) {
  const { proj, home, tp } = mkFixture(billing);
  const env = Object.assign({}, process.env, {
    CLAUDE_PROJECT_DIR: proj, USERPROFILE: home, HOME: home,
  });
  // billingKind()'s first branch: an inherited API key would mask the subscription fixture.
  if (billing === 'subscription') delete env.ANTHROPIC_API_KEY;
  else env.ANTHROPIC_API_KEY = 'sk-test';
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash',
      session_id: `sid-gate-${billing}`, transcript_path: tp }),
    encoding: 'utf8', env, timeout: 20000,
  });
  const j = JSON.parse(r.stdout || '{}');
  return j.hookSpecificOutput || {};
}

test('hard gate on an API-billed session asks in dollars', () => {
  const out = fireGate('api');
  assert.equal(out.permissionDecision, 'ask');
  assert.match(out.permissionDecisionReason, /session estimate \$\d/);
  assert.match(out.permissionDecisionReason, /next check at \$\d/);
});

test('hard gate on a subscription asks in tokens — no $ anywhere', () => {
  const out = fireGate('subscription');
  assert.equal(out.permissionDecision, 'ask');
  assert.match(out.permissionDecisionReason, /session estimate \d+k? tokens/);
  assert.doesNotMatch(out.permissionDecisionReason, /\$/);
});
