// R9 mini-bomb accumulator — E2E against the live hook (PostToolUse has no pure half:
// the rule is one comparison; the mechanics are all state). Run: node --test token-guard-r9.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');

function mkProject(cfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg9-'));
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  if (cfg) fs.writeFileSync(path.join(dir, '.claude', 'cca.config.json'),
    JSON.stringify({ tokenGuard: cfg }));
  return dir;
}

function runHook(projectDir, data) {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(data), encoding: 'utf8',
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projectDir }),
    timeout: 20000,
  });
  return r.stdout || '';
}

function post(dir, sid, resp, transcript) {
  return runHook(dir, { hook_event_name: 'PostToolUse', tool_name: 'Read',
    tool_input: {}, tool_response: resp, session_id: sid,
    transcript_path: transcript || path.join(dir, 'main.jsonl') });
}

function state(dir, sid) {
  return JSON.parse(fs.readFileSync(
    path.join(dir, '.claude', 'hooks', '.token-guard', `${sid}.json`), 'utf8'));
}

const BIG = 'x'.repeat(78000); // 30k tok at chars/2.6

test('accumulates silently below threshold', () => {
  const dir = mkProject();
  assert.equal(post(dir, 's1', BIG), '');
  const st = state(dir, 's1');
  assert.equal(st.turnPayloadTok, 30000);
  assert.equal(st.turnPayloadWarned, false);
});

test('crossing emits the mid-turn note once, then stays quiet', () => {
  const dir = mkProject();
  post(dir, 's2', BIG);
  const out = post(dir, 's2', BIG); // 60k > 50k
  const j = JSON.parse(out);
  assert.match(j.hookSpecificOutput.additionalContext, /turn-payload/);
  assert.match(j.hookSpecificOutput.additionalContext, /~60k tokens/);
  assert.match(j.hookSpecificOutput.additionalContext, /disposable subagent/);
  assert.equal(state(dir, 's2').turnPayloadWarned, true);
  assert.equal(state(dir, 's2').miniBombGateArmed, false); // gate is opt-in
  assert.equal(post(dir, 's2', BIG), ''); // once per turn
});

test('object tool_response counts via stringify', () => {
  const dir = mkProject();
  post(dir, 's3', { content: 'x'.repeat(78000) });
  const out = post(dir, 's3', { content: 'x'.repeat(78000) });
  assert.match(out, /turn-payload/);
});

test('image tool_response is charged a flat ceiling, not its base64 length', () => {
  const dir = mkProject();
  // ~490k base64 chars ≈ 188k tok at chars/2.6 — the phantom that used to trip the mini-bomb.
  const IMG = [{ type: 'image', source: { type: 'base64', media_type: 'image/png',
    data: 'A'.repeat(490000) } }];
  const out = post(dir, 'img1', IMG);
  assert.equal(out, ''); // a single screenshot must NOT trip the 50k warning
  const st = state(dir, 'img1');
  assert.ok(st.turnPayloadTok > 0 && st.turnPayloadTok < 5000,
    `image sized ~flat (~2.5k), got ${st.turnPayloadTok}`);
});

test('images accumulate by count; a big fleet of them still crosses', () => {
  const dir = mkProject();
  // 30 screenshots in one turn ≈ 30 × 2500 = 75k > 50k — real cost worth warning about.
  const many = Array.from({ length: 30 }, () => ({ type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(20000) } }));
  const out = post(dir, 'img2', many);
  assert.match(out, /turn-payload/);
  const tp = state(dir, 'img2').turnPayloadTok;
  assert.ok(tp > 60000 && tp < 90000, `30 imgs ≈ 75k, got ${tp}`);
});

test('UserPromptSubmit resets the accumulator', () => {
  const dir = mkProject();
  post(dir, 's4', BIG);
  post(dir, 's4', BIG); // warned
  const tp = path.join(dir, 'main.jsonl');
  fs.writeFileSync(tp, JSON.stringify({ type: 'assistant',
    message: { id: 'm1', model: 'claude-fable-5',
      usage: { input_tokens: 1000, output_tokens: 10 } } }) + '\n');
  runHook(dir, { hook_event_name: 'UserPromptSubmit', prompt: 'hi',
    session_id: 's4', transcript_path: tp });
  const st = state(dir, 's4');
  assert.equal(st.turnPayloadTok, 0);
  assert.equal(st.turnPayloadWarned, false);
  const out = post(dir, 's4', BIG) + post(dir, 's4', BIG); // fresh turn re-accumulates
  assert.match(out, /turn-payload/);
});

test('approvedPayloadHop suppresses the whole turn (one decision, one surface)', () => {
  const dir = mkProject();
  post(dir, 's5', 'seed'); // create state file
  const stPath = path.join(dir, '.claude', 'hooks', '.token-guard', 's5.json');
  const st = JSON.parse(fs.readFileSync(stPath, 'utf8'));
  st.approvedPayloadHop = { est: 77000, ttl: 1 };
  fs.writeFileSync(stPath, JSON.stringify(st));
  assert.equal(post(dir, 's5', BIG), '');
  assert.equal(post(dir, 's5', BIG), '');
  assert.ok(state(dir, 's5').turnPayloadTok < 10); // only the seed landed, neither BIG counted
});

test('subagent tool calls are ignored (their context dies with the agent)', () => {
  const dir = mkProject();
  assert.equal(post(dir, 's6', BIG, path.join(dir, 'agent-abc123.jsonl')), '');
  assert.throws(() => state(dir, 's6')); // no state was even created
});

test('parent-side subagent calls are skipped (tool_response embeds disposable agent internals)', () => {
  const dir = mkProject();
  // A subagent's tool_response carries its FULL internal payload; only a compact summary lands
  // in the parent transcript. R9 must not size the raw payload (measured 2026-07-14: ~50k counted
  // vs ~3.5k actually carried). Both the "Agent" (this harness) and "Task" (stock) names skip.
  for (const [sid, name] of [['s10', 'Agent'], ['s11', 'Task']]) {
    const out = runHook(dir, { hook_event_name: 'PostToolUse', tool_name: name,
      tool_input: {}, tool_response: { content: 'x'.repeat(400000) }, session_id: sid,
      transcript_path: path.join(dir, 'main.jsonl') });
    assert.equal(out, '');
    assert.throws(() => state(dir, sid)); // not even counted
  }
  // Guard the anchor: the TaskCreate/TaskUpdate todo tools must NOT be swept in by SUBAGENT_TOOLS
  // (they're skipped as mutating instead — the point is they never reach the accumulator).
  const tc = runHook(dir, { hook_event_name: 'PostToolUse', tool_name: 'TaskCreate',
    tool_input: {}, tool_response: { content: 'x'.repeat(400000) }, session_id: 's12',
    transcript_path: path.join(dir, 'main.jsonl') });
  assert.equal(tc, '');
  assert.throws(() => state(dir, 's12'));
});

test('mutating tools are skipped (their hook payload echoes what context never carries)', () => {
  const dir = mkProject();
  const out = runHook(dir, { hook_event_name: 'PostToolUse', tool_name: 'Edit',
    tool_input: {}, tool_response: { originalFile: 'x'.repeat(400000) }, session_id: 's9',
    transcript_path: path.join(dir, 'main.jsonl') });
  assert.equal(out, '');
  assert.throws(() => state(dir, 's9')); // not even counted
});

test('miniBombWarn:false + miniBombGate:false disables entirely', () => {
  const dir = mkProject({ miniBombWarn: false, miniBombGate: false });
  assert.equal(post(dir, 's7', BIG), '');
  assert.equal(post(dir, 's7', BIG), '');
  assert.throws(() => state(dir, 's7'));
});

test('miniBombGate:true arms a one-shot ask on the next tool call', () => {
  const dir = mkProject({ miniBombGate: true });
  post(dir, 's8', BIG);
  const note = post(dir, 's8', BIG);
  assert.match(note, /turn-payload/); // warn still ships
  assert.equal(state(dir, 's8').miniBombGateArmed, true);
  const out = runHook(dir, { hook_event_name: 'PreToolUse', tool_name: 'Grep',
    tool_input: { pattern: 'x' }, session_id: 's8' });
  const j = JSON.parse(out);
  assert.equal(j.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /~60k tokens/);
  assert.equal(state(dir, 's8').miniBombGateArmed, false); // consumed
  assert.equal(runHook(dir, { hook_event_name: 'PreToolUse', tool_name: 'Grep',
    tool_input: { pattern: 'x' }, session_id: 's8' }), ''); // one-shot
});
