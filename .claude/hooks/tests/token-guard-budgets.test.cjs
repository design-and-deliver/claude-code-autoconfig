// R5 producer (--budgets) + observed-landing loop — unit tests on the table helpers + E2E
// against the live hook. Run: node --test token-guard-budgets.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');
const { recordObservedSkill, skillSizes } = require(HOOK);

const CFG = { bombJumpTokens: 50000, skillBudgetWarnChars: 150000 };

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgb-'));
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  return dir;
}

// Spawned hooks must NEVER see the real home dir: real ~/.claude carries live credentials
// (the meter fetch would hit the real usage API) and the global window-warns memory (a test
// firing would swallow the user's real rung announcement — happened live 2026-07-19).
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tgb-home-'));

function runHook(projectDir, data, home) {
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projectDir });
  const h = home || TMP_HOME;
  env.USERPROFILE = h; env.HOME = h;
  const r = spawnSync('node', [HOOK].concat(data == null ? ['--budgets'] : []), {
    input: data == null ? undefined : JSON.stringify(data),
    encoding: 'utf8', env, timeout: 20000,
  });
  return r.stdout || '';
}

// ---------- unit: recordObservedSkill + skillSizes round-trip ----------

test('observed row: append, ⚠ over threshold, read back by skillSizes', () => {
  const dir = mkProject();
  recordObservedSkill(dir, 'tg-builtin', 302000, 786000, CFG);
  const table = fs.readFileSync(path.join(dir, '.claude', 'skill-budgets.md'), 'utf8');
  assert.match(table, /^tg-builtin {2}786k chars ≈ 302k tok {2}⚠ {2}\(observed \d{4}-\d{2}-\d{2}\)$/m);
  assert.deepEqual(skillSizes(dir, 'tg-builtin'), { skillTok: 302000, skillFloor: false });
});

test('observed row: re-record replaces in place, no duplicate', () => {
  const dir = mkProject();
  recordObservedSkill(dir, 'tg-x', 77000, null, CFG);
  recordObservedSkill(dir, 'tg-x', 99000, null, CFG);
  const rows = fs.readFileSync(path.join(dir, '.claude', 'skill-budgets.md'), 'utf8')
    .split('\n').filter(l => l.startsWith('tg-x'));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /≈ 99k tok/);
});

test('observed row under threshold gets no ⚠', () => {
  const dir = mkProject();
  recordObservedSkill(dir, 'tg-small', 12000, null, CFG);
  assert.match(fs.readFileSync(path.join(dir, '.claude', 'skill-budgets.md'), 'utf8'),
    /^tg-small {2}≈ 12k tok {2}\(observed /m);
});

// ---------- E2E: --budgets static scan ----------

function mkScanFixture() {
  const proj = mkProject();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tgb-home-'));
  const w = (fp, content) => {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  };
  // project: one monolith (full > warn chars), one thin skill fanning into a heavy ref
  w(path.join(proj, '.claude', 'skills', 'tg-proj-big', 'SKILL.md'), 'x'.repeat(200000));
  w(path.join(proj, '.claude', 'skills', 'tg-proj-thin', 'SKILL.md'),
    'Read references/data.md before starting.\n' + 'y'.repeat(4000));
  w(path.join(proj, '.claude', 'skills', 'tg-proj-thin', 'references', 'data.md'), 'z'.repeat(300000));
  // user-level skill
  w(path.join(home, '.claude', 'skills', 'tg-user-skill', 'SKILL.md'), 'u'.repeat(3000));
  // plugin cache: 0.44.0 must beat 0.9.0 (numeric compare — lexical sort picks 0.9.0)
  const plug = path.join(home, '.claude', 'plugins', 'cache', 'mkt', 'myplug');
  w(path.join(plug, '0.44.0', 'skills', 'alpha', 'SKILL.md'), 'p'.repeat(26000));
  w(path.join(plug, '0.9.0', 'skills', 'alpha', 'SKILL.md'), 'p'.repeat(260));
  // pre-existing observed row must survive regeneration
  w(path.join(proj, '.claude', 'skill-budgets.md'),
    'tg-builtin  ≈ 302k tok  ⚠  (observed 2026-07-11)\n');
  return { proj, home };
}

test('E2E --budgets: scans project/user/plugin skills, flags heavies, keeps observed rows', () => {
  const { proj, home } = mkScanFixture();
  runHook(proj, null, home);
  const table = fs.readFileSync(path.join(proj, '.claude', 'skill-budgets.md'), 'utf8');
  assert.match(table, /^tg-proj-big {2}200k chars ≈ 77k tok {2}⚠$/m);
  assert.match(table, /^tg-proj-thin {2}4k chars ≈ 2k tok {2}\(\+refs → 304k chars full\) {2}⚠$/m);
  assert.match(table, /^tg-user-skill {2}3k chars ≈ 1k tok$/m);
  assert.match(table, /^myplug:alpha {2}26k chars ≈ 10k tok$/m); // 0.44.0 won, not 0.9.0
  assert.match(table, /^tg-builtin {2}≈ 302k tok {2}⚠ {2}\(observed 2026-07-11\)$/m);
});

test('E2E: door 1 gates a built-in from its observed row (the blindness fix)', () => {
  const { proj, home } = mkScanFixture();
  runHook(proj, null, home);
  const out = runHook(proj, { hook_event_name: 'PreToolUse', tool_name: 'Skill',
    tool_input: { skill: 'tg-builtin' }, session_id: 'sid-blind' }, home);
  const j = JSON.parse(out);
  assert.equal(j.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /~302k tokens/);
  assert.doesNotMatch(j.hookSpecificOutput.permissionDecisionReason, /at least/);
});

// ---------- E2E: observed-landing loop through the live hook ----------

const usageLine = (id, ctx) => JSON.stringify({ type: 'assistant',
  message: { id, model: 'claude-fable-5', usage: { input_tokens: ctx, output_tokens: 10 } } }) + '\n';

test('E2E: approved skill hop landing records the measured jump, R3 stays silent', () => {
  const dir = mkProject();
  const tp = path.join(dir, 'main.jsonl');
  fs.writeFileSync(tp, usageLine('m1', 1000));
  const prompt = { hook_event_name: 'UserPromptSubmit', prompt: 'hello',
    session_id: 'sid-land', transcript_path: tp };
  runHook(dir, prompt); // seeds lastLiveContext = 1000
  const stPath = path.join(dir, '.claude', 'hooks', '.token-guard', 'sid-land.json');
  const st = JSON.parse(fs.readFileSync(stPath, 'utf8'));
  st.approvedPayloadHop = { est: 77000, ttl: 1, skill: 'tg-obs' };
  fs.writeFileSync(stPath, JSON.stringify(st));
  fs.appendFileSync(tp, usageLine('m2', 100100)); // +99k jump
  const out = runHook(dir, prompt);
  assert.doesNotMatch(out, /context-bomb/); // one decision, one surface
  const table = fs.readFileSync(path.join(dir, '.claude', 'skill-budgets.md'), 'utf8');
  assert.match(table, /^tg-obs {2}≈ 99k tok {2}⚠ {2}\(observed /m);
});

test('E2E: R3 bomb note prices re-reads at cache weight, not ×50 full price (2026-07-20)', () => {
  const dir = mkProject();
  // pin the tokens-only branch regardless of the machine's billing env
  fs.writeFileSync(path.join(dir, '.claude', 'cca.config.json'),
    JSON.stringify({ tokenGuard: { showDollars: false } }));
  const tp = path.join(dir, 'main.jsonl');
  fs.writeFileSync(tp, usageLine('m1', 1000));
  const prompt = { hook_event_name: 'UserPromptSubmit', prompt: 'hello',
    session_id: 'sid-cache', transcript_path: tp };
  runHook(dir, prompt); // seeds lastLiveContext
  fs.appendFileSync(tp, usageLine('m2', 61000)); // +60k jump, unapproved
  const out = runHook(dir, prompt);
  assert.match(out, /context-bomb/);
  assert.match(out, /per cache-warm turn/);                  // warm re-reads at ~10% weight
  assert.match(out, /break longer than the cache TTL/);      // full price only after a gap
  assert.match(out, /context-window headroom/);              // occupancy is the third cost
  assert.doesNotMatch(out, /50 more turns/, 'the ×50 full-price extrapolation was cut 2026-07-20');
});

test('E2E: R3 attribution Skill(name) records an observed row alongside the warn', () => {
  const dir = mkProject();
  const tp = path.join(dir, 'main.jsonl');
  fs.writeFileSync(tp, usageLine('m1', 1000));
  const prompt = { hook_event_name: 'UserPromptSubmit', prompt: 'hello',
    session_id: 'sid-attr', transcript_path: tp };
  runHook(dir, prompt);
  fs.appendFileSync(tp, JSON.stringify({ type: 'assistant', message: { id: 'm2', content: [
    { type: 'tool_use', id: 'tu1', name: 'Skill', input: { skill: 'tg-skill-x' } }] } }) + '\n');
  fs.appendFileSync(tp, JSON.stringify({ type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'tu1', content: 'x'.repeat(150000) }] } }) + '\n');
  fs.appendFileSync(tp, usageLine('m3', 61000)); // +60k jump, unapproved
  const out = runHook(dir, prompt);
  assert.match(out, /context-bomb/);
  assert.match(out, /Skill\(tg-skill-x\)/);
  const table = fs.readFileSync(path.join(dir, '.claude', 'skill-budgets.md'), 'utf8');
  assert.match(table, /^tg-skill-x {2}\d+k chars ≈ 60k tok {2}⚠ {2}\(observed /m);
});
