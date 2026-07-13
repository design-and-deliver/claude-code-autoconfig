// Workflow fan-size guard — unit tests on the pure verdict + E2E against the live hook.
// Run: node --test token-guard-fan.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');
const { fanVerdict, workflowSource } = require(HOOK);

const CFG = { fanWarnAgents: 20 };

// Representative scripts ------------------------------------------------------

// The deep-research shape that planned 103 agents: fixed fan constants + a verify tier that
// fans (votes) inside a fan (claims) over run-time data.
const OVERFAN = `
export const meta = { name: 'deep-research', description: 'fan-out and adversarially verify claims' }
const VOTES_PER_CLAIM = 3
const MAX_VERIFY_CLAIMS = 25
const claims = await agent('find claims')
await parallel(claims.slice(0, MAX_VERIFY_CLAIMS).map(c => () =>
  parallel(Array.from({ length: VOTES_PER_CLAIM }, () => () => agent('refute ' + c)))))
`;

// A small, bounded pipeline over a literal array — the guard must stay silent on this.
const SMALL = `
export const meta = { name: 'tidy', description: 'small task' }
const files = ['a.ts', 'b.ts', 'c.ts']
await pipeline(files, f => agent('lint ' + f), r => agent('summarize'))
`;

// The canonical review workflow: parallel-over-.map, two fan levels, but no fan constants and
// no research-harness marker — must NOT trip (false-positive guard).
const REVIEW = `
const DIMENSIONS = [{ k: 'bugs' }, { k: 'perf' }]
await pipeline(DIMENSIONS,
  d => agent('review ' + d.k),
  review => parallel(review.findings.map(f => () => agent('verify ' + f))))
`;

// A genuine runaway: a concrete fan constant well over the hard cap — the DENY tier.
const RUNAWAY = `
export const meta = { name: 'mega', description: 'huge fan' }
const FLEET_SIZE = 80
await parallel(items.map(x => () => agent(x)))
`;

// ---------- unit: fanVerdict (pure) ----------

test('over-fanned research harness fires with both signals', () => {
  const v = fanVerdict(OVERFAN, CFG);
  assert.ok(v, 'should fire');
  assert.equal(v.level, 'high');
  assert.ok(v.signals.some(s => /fan constant of 25/.test(s)), 'names the 25-claim constant');
  assert.ok(v.signals.some(s => /inside another fan-out/.test(s)), 'flags the multiplicative tier');
  // Honest ceiling composes the RIGHT pair: 25 claims × 3 votes = 75, not 25 × any other constant.
  assert.match(v.estimate, /~75 agents total \(25 × 3/);
  assert.equal(v.ceiling, 75);
  assert.equal(v.concrete, 25, 'concrete stays the largest literal count (25), below the hard cap');
});

test('small bounded pipeline is silent', () => {
  assert.equal(fanVerdict(SMALL, CFG), null);
});

test('canonical review workflow does not false-positive', () => {
  assert.equal(fanVerdict(REVIEW, CFG), null);
});

test('a single large fan constant fires', () => {
  const v = fanVerdict('const WORKERS = 50\nawait parallel(items.map(x => agent(x)))', CFG);
  assert.ok(v && v.signals.some(s => /fan constant of 50/.test(s)));
});

test('a below-threshold constant alone is silent', () => {
  assert.equal(fanVerdict('const VOTES = 3\nawait agent("x")', CFG), null);
});

test('an oversized literal fan fires', () => {
  const v = fanVerdict('await parallel(Array.from({length: 40}, () => () => agent("x")))', CFG);
  assert.ok(v && v.signals.some(s => /literal fan of 40/.test(s)));
});

test('empty / non-string source is silent (never guess)', () => {
  assert.equal(fanVerdict('', CFG), null);
  assert.equal(fanVerdict(null, CFG), null);
  assert.equal(fanVerdict(undefined, CFG), null);
});

test('threshold is configurable', () => {
  assert.equal(fanVerdict('const WORKERS = 15\nagent("x")', { fanWarnAgents: 20 }), null);
  assert.ok(fanVerdict('const WORKERS = 15\nagent("x")', { fanWarnAgents: 10 }));
});

// ---------- unit: hard-cap tier (block) ----------

test('a concrete fan at/over the hard cap blocks', () => {
  const v = fanVerdict('const FLEET_SIZE = 80\nawait parallel(items.map(x => () => agent(x)))', CFG);
  assert.ok(v, 'should fire');
  assert.equal(v.level, 'block', 'a concrete 80-agent fan is over the default cap of 50');
  assert.equal(v.concrete, 80);
});

test('an oversized literal fan over the cap blocks', () => {
  const v = fanVerdict('await parallel(Array.from({length: 100}, () => () => agent("x")))', CFG);
  assert.ok(v && v.level === 'block');
  assert.equal(v.concrete, 100);
});

test('the hard cap is configurable', () => {
  const src = 'const WORKERS = 40\nawait parallel(items.map(x => () => agent(x)))';
  assert.equal(fanVerdict(src, { fanWarnAgents: 20, fanHardCap: 50 }).level, 'high', '40 < 50 → ask tier');
  assert.equal(fanVerdict(src, { fanWarnAgents: 20, fanHardCap: 30 }).level, 'block', '40 >= 30 → block');
});

test('the multiplicative CEILING never blocks — only a concrete count does', () => {
  // 25 × 3 = 75 exceeds the cap of 50, but 75 is an estimate; the concrete count (25) does not.
  const v = fanVerdict(OVERFAN, { fanWarnAgents: 20, fanHardCap: 50 });
  assert.equal(v.ceiling, 75, 'ceiling exceeds the cap');
  assert.equal(v.level, 'high', 'but the estimate must not trip the hard block');
});

// ---------- golden fixture: the REAL deep-research harness ----------
// Regression anchor: the actual ~103-agent run that motivated this guard, copied verbatim into
// fixtures/. Synthetic scripts prove the logic; this proves it against the thing in the wild.

const HARNESS = path.join(__dirname, 'fixtures', 'deep-research-harness.js');

test('golden: the real deep-research harness trips the guard (names 25, ceiling 75, level high)', () => {
  const src = fs.readFileSync(HARNESS, 'utf8');
  const v = fanVerdict(src, CFG);
  assert.ok(v, 'the real over-fanned harness must fire');
  assert.equal(v.level, 'high', 'concrete 25 < cap 50 → ask tier, not a block');
  assert.ok(v.signals.some(s => /fan constant of 25/.test(s)), 'names the 25-claim constant');
  assert.ok(v.signals.some(s => /inside another fan-out/.test(s)), 'flags the multiplicative verify tier');
  // The harness has MAX_FETCH=15 too; the ceiling must compose 25 × 3 (verify tier), never 25 × 15.
  assert.match(v.estimate, /~75 agents total \(25 × 3/);
  assert.equal(v.ceiling, 75);
});

// ---------- unit: workflowSource ----------

test('workflowSource prefers inline script, reads scriptPath, tolerates named', () => {
  assert.equal(workflowSource({ script: 'const a = 1' }), 'const a = 1');
  const f = path.join(os.tmpdir(), `tgfan-${process.pid}.js`);
  fs.writeFileSync(f, 'const b = 2');
  assert.equal(workflowSource({ scriptPath: f }), 'const b = 2');
  fs.unlinkSync(f);
  assert.equal(workflowSource({ name: 'saved-wf' }), '');
  assert.equal(workflowSource(null), '');
});

// ---------- E2E: spawn the live hook ----------

function runHook(projectDir, data) {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(data),
    encoding: 'utf8',
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projectDir }),
    timeout: 20000,
  });
  return r.stdout || '';
}

function mkProject(cfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgfan-'));
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  if (cfg) fs.writeFileSync(path.join(dir, '.claude', 'cca.config.json'),
    JSON.stringify({ tokenGuard: cfg }));
  return dir;
}

function pre(input, sid) {
  return { hook_event_name: 'PreToolUse', tool_name: 'Workflow', tool_input: input, session_id: sid };
}

test('E2E: over-fanned launch asks with the fan-led message', () => {
  const dir = mkProject();
  const j = JSON.parse(runHook(dir, pre({ script: OVERFAN }, 'sid-of')));
  assert.equal(j.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /over-fanned/);
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /fan constant of 25/);
});

test('E2E: fan guard stays silent on a small workflow when R2 confirm is off', () => {
  const dir = mkProject({ workflowConfirm: false }); // isolate the fan guard
  assert.equal(runHook(dir, pre({ script: SMALL }, 'sid-small')), '');
});

test('E2E: over-fan still caught with R2 confirm off (guard is independent)', () => {
  const dir = mkProject({ workflowConfirm: false });
  const j = JSON.parse(runHook(dir, pre({ script: OVERFAN }, 'sid-of2')));
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /over-fanned/);
});

test('E2E: both guards off -> even an over-fanned launch passes silently', () => {
  const dir = mkProject({ workflowConfirm: false, workflowFanGuard: false });
  assert.equal(runHook(dir, pre({ script: OVERFAN }, 'sid-off')), '');
});

test('E2E: default (R2 on) small workflow still asks, but with the generic R2 message', () => {
  const dir = mkProject(); // defaults: both on
  const j = JSON.parse(runHook(dir, pre({ script: SMALL }, 'sid-r2')));
  assert.equal(j.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /Workflow launch/);
  assert.doesNotMatch(j.hookSpecificOutput.permissionDecisionReason, /over-fanned/);
});

test('E2E golden: the real harness launched through the live hook asks with the fan-led message', () => {
  const dir = mkProject({ workflowConfirm: false }); // isolate the fan guard
  const src = fs.readFileSync(HARNESS, 'utf8');
  const j = JSON.parse(runHook(dir, pre({ script: src }, 'sid-golden')));
  assert.equal(j.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /over-fanned/);
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /fan constant of 25/);
});

test('E2E: a runaway fan over the hard cap is DENIED, not merely asked', () => {
  const dir = mkProject(); // defaults: warn 10, hard cap 50
  const j = JSON.parse(runHook(dir, pre({ script: RUNAWAY }, 'sid-runaway')));
  assert.equal(j.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /blocked/);
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /hard fan cap of 50/);
});

test('E2E: raising fanHardCap downgrades a runaway from deny to ask', () => {
  const dir = mkProject({ workflowConfirm: false, fanHardCap: 100 });
  const j = JSON.parse(runHook(dir, pre({ script: RUNAWAY }, 'sid-raised')));
  assert.equal(j.hookSpecificOutput.permissionDecision, 'ask', '80 < 100 → back to the ask tier');
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /over-fanned/);
});
