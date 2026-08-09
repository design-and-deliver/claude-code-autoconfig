// R19 — restart-advice instrumentation. Every card that ends on "/clear, then /continue"
// interrupts the user's thread and charges them a cold start to resume, but every one of them
// gates on tokens, dollars, or context size — nothing in this file has ever counted the user's
// own PROMPTS. So a card firing on prompt 1 (the user never finished a single request) has been
// indistinguishable in the logs from one firing on prompt 30. R19 writes a `restart-advice`
// line naming the prompt number at every fire site, and changes NO fire condition.
//
// The counter is the thing under test, so these drive it through the real hook and read the
// real usage.log — a unit call on an unexported helper would pass with the wiring cut.
// Run: node --test token-guard-r19-restart-advice.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');

const usageLine = (id, inp) => JSON.stringify({ type: 'assistant',
  message: { id, model: 'claude-fable-5', usage: { input_tokens: inp, output_tokens: 10 } } }) + '\n';

function mkFixture() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'tg19-'));
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'cca.config.json'),
    JSON.stringify({ tokenGuard: { turnGateTokens: 100000 } }));
  const tp = path.join(proj, 'main.jsonl');
  fs.writeFileSync(tp, usageLine('m1', 1000));
  // Isolated home — never the real one (live credentials).
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg19-home-'));
  return { proj, home, tp };
}

function runHook(fix, payload) {
  const env = Object.assign({}, process.env, {
    CLAUDE_PROJECT_DIR: fix.proj, USERPROFILE: fix.home, HOME: fix.home,
    ANTHROPIC_API_KEY: 'sk-test',
  });
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(Object.assign({ session_id: 'sid-r19', transcript_path: fix.tp }, payload)),
    encoding: 'utf8', env, timeout: 20000,
  });
  return r.stdout || '';
}

const preToolUse = fix => runHook(fix, { hook_event_name: 'PreToolUse', tool_name: 'Bash' });
const prompt = (fix, text) => runHook(fix, { hook_event_name: 'UserPromptSubmit', prompt: text || 'hi' });
const gateOut = raw => (JSON.parse(raw || '{}').hookSpecificOutput || {});

const adviceLines = (fix) => {
  const log = path.join(fix.proj, '.claude', 'hooks', '.token-guard', 'usage.log');
  const raw = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  return raw.split('\n').filter(l => l.includes('restart-advice'));
};

// Drives one turn past R13b's turn-spend gate — the cheapest deterministic restart card.
const fireRestartCard = (fix, id) => {
  fs.appendFileSync(fix.tp, usageLine(id, 300000));
  return gateOut(preToolUse(fix));
};

test('a restart card names the prompt it fired on — and prompt 1 is legible as prompt 1', () => {
  const fix = mkFixture();
  prompt(fix);
  assert.equal(fireRestartCard(fix, 'm2').permissionDecision, 'ask');
  const lines = adviceLines(fix);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /restart-advice {2}prompt#1 {2}from=fresh {2}sid=sid-r19 {2}pretool-ask/);
  // The card's own copy rides along, so the log says WHICH card fired, not just that one did.
  assert.match(lines[0], /TASK SIZE/);
});

test('the counter follows the user\'s prompts, not round trips', () => {
  const fix = mkFixture();
  prompt(fix); prompt(fix); prompt(fix);
  preToolUse(fix); preToolUse(fix);   // round trips inside a turn must not advance it
  assert.equal(fireRestartCard(fix, 'm2').permissionDecision, 'ask');
  assert.match(adviceLines(fix).pop(), /prompt#3 {2}from=fresh/);
});

test('a recovery turn restarts the count at 1 — after a /clear the user IS starting over', () => {
  const fix = mkFixture();
  prompt(fix); prompt(fix);
  prompt(fix, '/continue');           // reset to 1 …
  prompt(fix, 'carry on');            // … so the next real prompt is 2, not 4
  assert.equal(fireRestartCard(fix, 'm2').permissionDecision, 'ask');
  assert.match(adviceLines(fix).pop(), /prompt#2 {2}from=recovery/);
});

test('from= separates the pathology from the by-design reset, and is sticky across the run', () => {
  // The whole point of the flag: BOTH of these fire on a low prompt number, and only the first
  // one means "the user never finished a request". Without from= they are the same line.
  const cold = mkFixture();
  prompt(cold);
  assert.equal(fireRestartCard(cold, 'm2').permissionDecision, 'ask');
  assert.match(adviceLines(cold).pop(), /prompt#1 {2}from=fresh/);

  const resumed = mkFixture();
  prompt(resumed, '/continue');
  prompt(resumed, 'carry on');        // sticky: prompt 2 of a RESUMED thread, not a fresh one
  assert.equal(fireRestartCard(resumed, 'm2').permissionDecision, 'ask');
  assert.match(adviceLines(resumed).pop(), /prompt#2 {2}from=recovery/);
});

test('two sessions sharing one project log stay tellable apart', () => {
  // usage.log is per-PROJECT, the counter is per-SESSION, and this repo runs up to six at once.
  // Interleaved bare prompt#N lines are unreadable — which is how the first real capture failed.
  const fix = mkFixture();
  prompt(fix);                                          // session A, prompt 1
  assert.equal(fireRestartCard(fix, 'm2').permissionDecision, 'ask');

  const asB = p => runHook(fix, Object.assign({ session_id: 'sid-bbbbbbbb-tail' }, p));
  asB({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' });   // session B baselines here …
  asB({ hook_event_name: 'UserPromptSubmit', prompt: 'again' });// … at its own prompt 2
  fs.appendFileSync(fix.tp, usageLine('m3', 300000));
  const outB = JSON.parse(asB({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }) || '{}');
  assert.equal((outB.hookSpecificOutput || {}).permissionDecision, 'ask');

  const [a, b] = adviceLines(fix);
  assert.match(a, /prompt#1 {2}from=fresh {2}sid=sid-r19 /);
  assert.match(b, /prompt#2 {2}from=fresh {2}sid=sid-bbbb /);   // sidShort — first 8 chars
});

test('log-only: an ordinary prompt writes no advice line', () => {
  const fix = mkFixture();
  prompt(fix); prompt(fix);
  // The R13a plan steer rides every prompt — a note, but not a restart recommendation.
  assert.match(gateOut(prompt(fix)).additionalContext || '', /plan-steer/);
  assert.deepEqual(adviceLines(fix), []);
});

test('a fire on a state file with no counter logs nothing rather than a wrong prompt#0', () => {
  const fix = mkFixture();
  // No prompt ever seen (pre-R19 state, or a turn that began mid-flight): R13b lazy-arms on the
  // first call, then fires on the second — with nothing truthful to say about prompt count.
  fs.appendFileSync(fix.tp, usageLine('m2', 300000));
  preToolUse(fix);
  assert.equal(fireRestartCard(fix, 'm3').permissionDecision, 'ask');
  assert.deepEqual(adviceLines(fix), []);
});
