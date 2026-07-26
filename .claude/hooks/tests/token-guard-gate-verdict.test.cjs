// gateVerdict — the recommendation layer on the two in-turn tripwires (R13b work, R14 rent).
//
// The premise: token math measures the TURN'S STATE and is identical whether the next call is a
// commit or another god-file read, so a recommendation derived from it never varies — and a
// recommendation that never varies is wallpaper. The discriminator is the SHAPE of the pending
// call, which PreToolUse already hands the hook.
//
// Born from the 2026-07-26 screenshot: R14 fired on `git add … && git status --short` — the exact
// "land at a commit point" its own Choice bullet was asking for, three lines above. Two behaviors
// are pinned here: a turn-ender DEFERS the gate entirely (no fire, no re-arm — silence beats a
// green "approve recommended" label, which would teach the user the warnings are theatre), and a
// bomb (full suite / explicitly-unbounded Grep) fires with deny LEADING the Choice bullet.
// Run: node --test token-guard-gate-verdict.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');

const usageLine = (id, inp) => JSON.stringify({ type: 'assistant',
  message: { id, model: 'claude-fable-5', usage: { input_tokens: inp, output_tokens: 10 } } }) + '\n';
const roundTrip = (id, cr) => JSON.stringify({ type: 'assistant',
  message: { id, model: 'claude-fable-5',
    usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: cr } } }) + '\n';

function mkFixture(guardCfg) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'tgv-'));
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'cca.config.json'),
    // R13b parked high: these cases are about rent (R14), which is what the screenshot showed.
    JSON.stringify({ tokenGuard: Object.assign(
      { turnGateTokens: 10000000, turnRentGateTokens: 100000 }, guardCfg) }));
  const tp = path.join(proj, 'main.jsonl');
  fs.writeFileSync(tp, usageLine('m1', 1000));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tgv-home-'));
  return { proj, home, tp };
}

function runHook(fix, payload) {
  const env = Object.assign({}, process.env, {
    CLAUDE_PROJECT_DIR: fix.proj, USERPROFILE: fix.home, HOME: fix.home,
    ANTHROPIC_API_KEY: 'sk-test',
  });
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(Object.assign({ session_id: 'sid-tgv', transcript_path: fix.tp }, payload)),
    encoding: 'utf8', env, timeout: 20000,
  });
  return r.stdout || '';
}

const call = (fix, tool_name, tool_input) =>
  runHook(fix, { hook_event_name: 'PreToolUse', tool_name, tool_input });
const promptSubmit = fix => runHook(fix, { hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
const gateOut = raw => (JSON.parse(raw || '{}').hookSpecificOutput || {});

// Arms a turn that is 3 gate-widths into rent — R14 is primed to fire on the next call.
function primed(guardCfg) {
  const fix = mkFixture(guardCfg);
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, roundTrip('m2', 300000));
  return fix;
}

test('turn-ender defers the gate: the screenshot command does not fire', () => {
  const fix = primed();
  // The literal 2026-07-26 case. Fails on the pre-verdict hook, which fired here.
  const out = gateOut(call(fix, 'Bash', {
    command: 'cd C:/CODE/job-agent-extension && git add src/a.ts src/b.ts && git status --short' }));
  assert.equal(out.permissionDecision, undefined);
});

test('deferral does NOT re-arm — the very next non-turn-ender call takes the check', () => {
  const fix = primed();
  assert.equal(gateOut(call(fix, 'Bash', { command: 'git commit -m "wip"' })).permissionDecision,
    undefined);
  // Same rent, ordinary call ⇒ the gate the commit deferred fires now. This is what separates
  // "deferred" from "suppressed"; a re-arm on skip would have swallowed it.
  assert.equal(gateOut(call(fix, 'Bash', { command: 'ls -la' })).permissionDecision, 'ask');
});

test('one non-turn-ender segment disqualifies the whole command (fails closed)', () => {
  const fix = primed();
  const out = gateOut(call(fix, 'Bash', { command: 'git add . && pnpm run build' }));
  assert.equal(out.permissionDecision, 'ask');
});

test('full test suite fires with deny LEADING the Choice bullet', () => {
  const fix = primed();
  const out = gateOut(call(fix, 'Bash', { command: 'pnpm test --run' }));
  assert.equal(out.permissionDecision, 'ask');
  const lines = out.permissionDecisionReason.split('\n');
  assert.equal(lines.length, 4);                       // R14's pinned 4-line shape survives
  assert.match(lines[3], /^• Choice: deny looks right here — /);
  assert.match(lines[3], /whole test suite/);
  // Advisory, not authoritarian: the approve path is still stated.
  assert.match(lines[3], /Approving pushes on/);
});

test('a SCOPED test run is not a bomb — no recommendation, neutral copy', () => {
  const fix = primed();
  const out = gateOut(call(fix, 'Bash', { command: 'pnpm test --run src/utils/foo.test.ts' }));
  assert.equal(out.permissionDecision, 'ask');
  const lines = out.permissionDecisionReason.split('\n');
  assert.match(lines[3], /^• Choice: approve to push on — or deny/);
  assert.doesNotMatch(lines[3], /looks right here/);
});

test('explicitly-unbounded Grep is a bomb; an unset head_limit (caps at 250) is not', () => {
  const bomb = gateOut(call(primed(), 'Grep',
    { pattern: 'foo', output_mode: 'content', head_limit: 0 }));
  assert.match(bomb.permissionDecisionReason.split('\n')[3], /^• Choice: deny looks right here — /);
  assert.match(bomb.permissionDecisionReason, /explicitly unbounded/);

  const ordinary = gateOut(call(primed(), 'Grep', { pattern: 'foo', output_mode: 'content' }));
  assert.equal(ordinary.permissionDecision, 'ask');
  assert.match(ordinary.permissionDecisionReason.split('\n')[3], /^• Choice: approve to push on/);
});

test('R13b carries the same verdict layer', () => {
  // Work gate armed low, rent gate off ⇒ the fire below is R13b's, not R14's.
  const fix = mkFixture({ turnGateTokens: 50000, turnRentGateTokens: null });
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, usageLine('m2', 200000));
  assert.equal(gateOut(call(fix, 'Bash', { command: 'git status --short' })).permissionDecision,
    undefined);
  const out = gateOut(call(fix, 'Bash', { command: 'vitest' }));
  assert.equal(out.permissionDecision, 'ask');
  assert.match(out.permissionDecisionReason, /spiraled/);            // R13b's framing
  assert.match(out.permissionDecisionReason, /deny looks right here/);
});
