// R13 — task-sized budgeting, both halves. R13b: the turn-spend tripwire (ONE turn's WORK
// tokens ≥ turnGateTokens ⇒ PreToolUse ask; re-arms ABOVE observed spend; every prompt
// re-baselines). Work tokens = input + output + cache writes at full weight, cache re-reads
// at their 0.1x billing weight — re-reads are rent (context × round trips), and unweighted
// they cross any gate on routine multi-tool-call turns. R13a: the plan-first steer
// (every-prompt model-facing line asking Claude to gauge blast radius and propose a plan
// before >3×-normal work). Copy contract: R13b is TOKEN-denominated on every billing kind —
// task size is work volume, not price.
// Run: node --test token-guard-r13.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');

const usageLine = (id, inp) => JSON.stringify({ type: 'assistant',
  message: { id, model: 'claude-fable-5', usage: { input_tokens: inp, output_tokens: 10 } } }) + '\n';
const cacheReadLine = (id, cr) => JSON.stringify({ type: 'assistant',
  message: { id, model: 'claude-fable-5',
    usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: cr } } }) + '\n';

function mkFixture(guardCfg) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'tg13-'));
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'cca.config.json'),
    JSON.stringify({ tokenGuard: Object.assign({ turnGateTokens: 100000 }, guardCfg) }));
  const tp = path.join(proj, 'main.jsonl');
  fs.writeFileSync(tp, usageLine('m1', 1000));
  // Isolated home — never the real one (live credentials).
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg13-home-'));
  return { proj, home, tp };
}

function runHook(fix, payload) {
  const env = Object.assign({}, process.env, {
    CLAUDE_PROJECT_DIR: fix.proj, USERPROFILE: fix.home, HOME: fix.home,
    ANTHROPIC_API_KEY: 'sk-test', // API-billed on purpose: R13b must stay token-denominated anyway
  });
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(Object.assign({ session_id: 'sid-r13', transcript_path: fix.tp }, payload)),
    encoding: 'utf8', env, timeout: 20000,
  });
  return r.stdout || '';
}

const preToolUse = fix => runHook(fix, { hook_event_name: 'PreToolUse', tool_name: 'Bash' });
const promptSubmit = fix => runHook(fix, { hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
const gateOut = raw => (JSON.parse(raw || '{}').hookSpecificOutput || {});

test('R13b fires once a turn crosses the gate — token copy, no $, re-arms above observed spend', () => {
  const fix = mkFixture();
  promptSubmit(fix);                              // baseline ≈ 1k
  fs.appendFileSync(fix.tp, usageLine('m2', 300000)); // one landing blows 3 gate-widths past
  const out = gateOut(preToolUse(fix));
  assert.equal(out.permissionDecision, 'ask');
  assert.match(out.permissionDecisionReason, /ONE turn has burned ~300k tokens/);
  // The plan steer now straddles two bullets: the Lever names it, the Choice acts on it.
  assert.match(out.permissionDecisionReason, /plan with session-sized substeps/);
  // "propose" when the Choice bullet is neutral, "proposes" when it leads with a recommendation
  // and reuses the deny tail — either way the plan steer has to survive to the ask.
  assert.match(out.permissionDecisionReason, /proposes? that plan/);
  assert.doesNotMatch(out.permissionDecisionReason, /\$/);
  // Structure (2026-07-26): headline reading, then ONE bullet per thought. R14 was cut to two
  // bullets on 2026-07-29; R13b keeps four, so this is now the ONLY place restartBullet renders.
  const lines = out.permissionDecisionReason.split('\n');
  assert.equal(lines.length, 5);
  assert.match(lines[0], /^⚠️ Hey — this ONE turn has burned ~300k tokens\.$/);
  assert.deepEqual(lines.slice(1).map(l => l.slice(0, 8)),
    ['• Cost: ', '• Lever:', '• Restar', '• Choice']);
  // R13b's headline states tokens, not trips — so its Restart bullet KEEPS the position clause.
  assert.match(lines[3], /^• Restart: (\d+ round trips?|this turn is) carrying ~\d+k of context/);
  // …and the fat-window tail, which R14 no longer has a bullet to print.
  assert.match(lines[3], /Past the fat line — but take the restart FROM a commit point/);
  // Re-armed at 400k (above the 300k observed), so the very next call must NOT re-fire.
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, undefined);
});

test('R13b re-baselines on the next prompt — the new turn starts clean', () => {
  const fix = mkFixture();
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, usageLine('m2', 300000));
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, 'ask');
  promptSubmit(fix);                              // new turn: baseline ≈ 301k, re-arm cleared
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, undefined);
});

test('R13b lazy-arms the baseline when none exists — never bills the session to one turn', () => {
  const fix = mkFixture();
  // No prompt ever metered: first PreToolUse sees 301k session tokens and must arm, not ask.
  fs.appendFileSync(fix.tp, usageLine('m2', 300000));
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, undefined);
  // From that mid-turn baseline, another 300k landing IS a turn-spend crossing.
  fs.appendFileSync(fix.tp, usageLine('m3', 300000));
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, 'ask');
});

test('R13b weighs cache re-reads at 0.1x — a rent-heavy turn does not fire', () => {
  const fix = mkFixture();
  promptSubmit(fix);
  // 600k of cache re-reads ≈ ten 60k-context round trips: 60k work tokens, under the 100k
  // gate. Unweighted this was 6 gate-widths — the routine-turn false fire the weighting kills.
  fs.appendFileSync(fix.tp, cacheReadLine('m2', 600000));
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, undefined);
});

test('R13b still counts cache re-reads — at a tenth, 1M of them crosses a 100k gate', () => {
  const fix = mkFixture();
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, cacheReadLine('m2', 1000000)); // 0.1x ⇒ ~100k work tokens
  const out = gateOut(preToolUse(fix));
  assert.equal(out.permissionDecision, 'ask');
  assert.match(out.permissionDecisionReason, /ONE turn has burned ~100k tokens/);
});

test('R13b: turnGateTokens null disables the tripwire', () => {
  const fix = mkFixture({ turnGateTokens: null });
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, usageLine('m2', 300000));
  assert.equal(preToolUse(fix).trim(), '');
});

test('R13a plan steer rides every prompt; planSteer false removes it', () => {
  const on = mkFixture();
  const ctx = (JSON.parse(promptSubmit(on) || '{}').hookSpecificOutput || {}).additionalContext || '';
  assert.match(ctx, /plan-steer/);
  assert.match(ctx, /100k/);   // quotes the beyond-small bar (= one normal task)
  assert.match(ctx, /Ledger/); // names the plan-based form /continue resumes from
  const off = mkFixture({ planSteer: false });
  const ctx2 = (JSON.parse(promptSubmit(off) || '{}').hookSpecificOutput || {}).additionalContext || '';
  assert.doesNotMatch(ctx2, /plan-steer/);
});
