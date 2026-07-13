// R8 payload pre-gate — unit tests on the pure verdict + E2E against the live hook.
// Run: node --test token-guard-r8.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');
const { payloadVerdict } = require(HOOK);

const CFG = { bombJumpTokens: 50000 };

// ---------- unit: payloadVerdict (pure) ----------

test('skill over threshold fires, floor preserved', () => {
  const v = payloadVerdict('Skill', {}, { skillTok: 302000, skillFloor: true }, CFG);
  assert.ok(v && v.door === 'skill' && v.estTokens === 302000 && v.floor === true);
});

test('skill at/under threshold is silent', () => {
  assert.equal(payloadVerdict('Skill', {}, { skillTok: 50000 }, CFG), null);
  assert.equal(payloadVerdict('Skill', {}, { skillTok: 3000 }, CFG), null);
});

test('unresolvable sizes are silent (never guess)', () => {
  assert.equal(payloadVerdict('Skill', {}, null, CFG), null);
  assert.equal(payloadVerdict('Read', {}, null, CFG), null);
  assert.equal(payloadVerdict('Skill', {}, { skillTok: null }, CFG), null);
});

test('read over threshold fires at chars/2.6', () => {
  const v = payloadVerdict('Read', {}, { fileChars: 200000, isImage: false }, CFG);
  assert.ok(v && v.door === 'read' && v.estTokens === Math.round(200000 / 2.6));
});

test('ranged reads are exempt', () => {
  assert.equal(payloadVerdict('Read', { offset: 100 }, { fileChars: 900000, isImage: false }, CFG), null);
  assert.equal(payloadVerdict('Read', { limit: 50 }, { fileChars: 900000, isImage: false }, CFG), null);
});

test('images are exempt (vision tokens != chars/2.6)', () => {
  assert.equal(payloadVerdict('Read', {}, { fileChars: 900000, isImage: true }, CFG), null);
});

test('other tools are silent', () => {
  assert.equal(payloadVerdict('Grep', {}, { fileChars: 900000 }, CFG), null);
});

// ---------- E2E: spawn the live hook ----------

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg8-'));
  fs.mkdirSync(path.join(dir, '.claude', 'skills', 'tg8-big'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude', 'skills', 'tg8-small'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'skills', 'tg8-big', 'SKILL.md'), 'x'.repeat(200000));
  fs.writeFileSync(path.join(dir, '.claude', 'skills', 'tg8-small', 'SKILL.md'), 'x'.repeat(10000));
  fs.writeFileSync(path.join(dir, '.claude', 'commands', 'tg8-huge.md'), 'x'.repeat(200000));
  return dir;
}

function runHook(projectDir, data) {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(data),
    encoding: 'utf8',
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projectDir }),
    timeout: 20000,
  });
  return r.stdout || '';
}

function pre(tool, input, sid) {
  return { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, session_id: sid };
}

test('E2E door 1: big skill asks; state arms R3 suppression', () => {
  const dir = mkProject();
  const out = runHook(dir, pre('Skill', { skill: 'tg8-big' }, 'sid-door1'));
  const j = JSON.parse(out);
  assert.equal(j.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /at least ~77k tokens/);
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /disposable subagent/);
  const st = JSON.parse(fs.readFileSync(
    path.join(dir, '.claude', 'hooks', '.token-guard', 'sid-door1.json'), 'utf8'));
  assert.equal(st.approvedPayloadHop.est, 76923);
  assert.equal(st.approvedPayloadHop.ttl, 1);
  assert.equal(st.approvedPayloadHop.skill, 'tg8-big');
});

test('E2E door 1: budgets table beats the stat floor', () => {
  const dir = mkProject();
  fs.writeFileSync(path.join(dir, '.claude', 'skill-budgets.md'),
    'tg8-big  799k chars ≈ 302k tok  ⚠\n');
  const out = runHook(dir, pre('Skill', { skill: 'tg8-big' }, 'sid-budget'));
  const j = JSON.parse(out);
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /~302k tokens/);
  assert.doesNotMatch(j.hookSpecificOutput.permissionDecisionReason, /at least/);
});

test('E2E door 1: small skill passes silently', () => {
  const dir = mkProject();
  assert.equal(runHook(dir, pre('Skill', { skill: 'tg8-small' }, 'sid-small')), '');
});

test('E2E door 1: payloadGate:false disables', () => {
  const dir = mkProject();
  fs.writeFileSync(path.join(dir, '.claude', 'cca.config.json'),
    JSON.stringify({ tokenGuard: { payloadGate: false } }));
  assert.equal(runHook(dir, pre('Skill', { skill: 'tg8-big' }, 'sid-off')), '');
});

test('E2E door 2: big full read asks; ranged and image reads pass', () => {
  const dir = mkProject();
  const big = path.join(dir, 'big.txt');
  fs.writeFileSync(big, 'x'.repeat(200000));
  const img = path.join(dir, 'shot.png');
  fs.writeFileSync(img, Buffer.alloc(200000));
  const out = runHook(dir, pre('Read', { file_path: big }, 'sid-read'));
  const j = JSON.parse(out);
  assert.equal(j.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /big\.txt/);
  assert.equal(runHook(dir, pre('Read', { file_path: big, limit: 100 }, 'sid-read2')), '');
  assert.equal(runHook(dir, pre('Read', { file_path: img }, 'sid-read3')), '');
});

test('E2E door 3: oversized slash command blocks once, re-send passes', () => {
  const dir = mkProject();
  fs.writeFileSync(path.join(dir, '.claude', 'cca.config.json'),
    JSON.stringify({ tokenGuard: { commandPayloadGate: true } }));
  const data = { hook_event_name: 'UserPromptSubmit', prompt: '/tg8-huge some args',
    session_id: 'sid-cmd', transcript_path: path.join(dir, 'none.jsonl') };
  const first = JSON.parse(runHook(dir, data));
  assert.equal(first.decision, 'block');
  assert.match(first.reason, /\/tg8-huge/);
  assert.match(first.reason, /↑ then Enter/);
  const st = JSON.parse(fs.readFileSync(
    path.join(dir, '.claude', 'hooks', '.token-guard', 'sid-cmd.json'), 'utf8'));
  assert.equal(st.payloadGateOkOnce, 'tg8-huge');
  assert.equal(st.approvedPayloadHop.ttl, 2);
  assert.equal(runHook(dir, data), ''); // one-shot consumed -> passes through
});

test('E2E door 3: default OFF never blocks', () => {
  const dir = mkProject();
  const data = { hook_event_name: 'UserPromptSubmit', prompt: '/tg8-huge',
    session_id: 'sid-cmd-off', transcript_path: path.join(dir, 'none.jsonl') };
  assert.equal(runHook(dir, data), '');
});
