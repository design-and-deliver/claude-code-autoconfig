'use strict';

/**
 * worktree-gate.test.cjs — drives the real hook as a child process.
 *
 * Every case builds a throwaway git repo and a throwaway HOME, then pipes a real PreToolUse
 * payload to worktree-gate.js and reads its stdout. Nothing is stubbed: the hook stats real
 * `.git` entries and real `{sid}.glyph` files, because the two questions worth getting right
 * here — "is this already a worktree?" and "is anyone else live?" — live entirely in those two
 * lookups. A test that mocked them would pass on a hook that gates nothing.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, '..', 'worktree-gate.js');

let seq = 0;
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wtgate-${process.pid}-${seq++}-`));
  return fs.realpathSync(dir);   // macOS/Windows hand back symlinked temp roots; the hook resolves
}

// A minimal but REAL repo — `git worktree add` needs a commit to branch from.
function makeRepo() {
  const root = scratch();
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  fs.mkdirSync(repo);
  fs.mkdirSync(home);
  const g = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  g('init', '-b', 'main');
  g('config', 'user.email', 't@t.test');
  g('config', 'user.name', 'T');
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
  g('add', 'seed.txt');
  g('commit', '-m', 'seed');
  return { root, repo, home };
}

const titlesIn = (dir) => path.join(dir, '.claude', 'hooks', '.titles');

// Plant a glyph (and optionally a title) for some OTHER session, in whichever tier the caller
// names. `ageMs` back-dates the glyph to test the liveness window.
function addLiveSession(baseDir, sid, { ageMs = 0, title = '' } = {}) {
  const dir = titlesIn(baseDir);
  fs.mkdirSync(dir, { recursive: true });
  const glyph = path.join(dir, `${sid}.glyph`);
  fs.writeFileSync(glyph, 'working|PostToolUse');
  if (title) fs.writeFileSync(path.join(dir, `${sid}.txt`), `${title}\n`);
  if (ageMs) {
    const when = new Date(Date.now() - ageMs);
    fs.utimesSync(glyph, when, when);
  }
  return glyph;
}

// {sid}.lineage.json is how a session records the sid it used to be before a /clear.
function setLineage(baseDir, sid, prevSid) {
  const dir = titlesIn(baseDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sid}.lineage.json`), JSON.stringify({ prevSid }));
}

function run({ home, cwd, tool = 'Edit', target, sid = 'self-sid', env = {} }) {
  const payload = {
    session_id: sid,
    cwd,
    tool_name: tool,
    tool_input: target ? { file_path: target } : {},
  };
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_WORKTREE_GATE: '',
      CLAUDE_CODE_SESSION_ID: '',
      ...env,
    },
  });
  assert.strictEqual(res.status, 0, `hook must always exit 0 (stderr: ${res.stderr})`);
  const out = res.stdout.trim();
  return out ? JSON.parse(out) : null;
}

const decisionOf = (r) => (r && r.hookSpecificOutput ? r.hookSpecificOutput.permissionDecision : null);
const reasonOf = (r) => (r && r.hookSpecificOutput ? r.hookSpecificOutput.permissionDecisionReason : '');

test('asks when another session is live in the same main checkout', () => {
  const { repo, home } = makeRepo();
  addLiveSession(repo, 'other-sid', { title: 'Journal modal — Fix the empty state' });
  const r = run({ home, cwd: repo, target: path.join(repo, 'src', 'a.ts') });
  assert.strictEqual(decisionOf(r), 'ask');
  assert.match(reasonOf(r), /EnterWorktree/);
  assert.match(reasonOf(r), /src\/a\.ts/);
  // Naming the sibling is the whole point — "someone else is live" is not actionable.
  assert.match(reasonOf(r), /other-si/);
  assert.match(reasonOf(r), /Journal modal/);
});

// A deny would put the gate in the way of the one thing it cannot be in the way of: the merge
// or release that has to run in the main checkout by definition. Ask degrades to one keystroke;
// deny degrades to uninstalling the hook.
test('the decision is never a hard deny', () => {
  const { repo, home } = makeRepo();
  addLiveSession(repo, 'other-sid');
  const r = run({ home, cwd: repo, target: path.join(repo, 'src', 'a.ts') });
  assert.notStrictEqual(decisionOf(r), 'deny');
});

test('stays silent when this session is alone in the tree', () => {
  const { repo, home } = makeRepo();
  fs.mkdirSync(titlesIn(repo), { recursive: true });
  assert.strictEqual(run({ home, cwd: repo, target: path.join(repo, 'src', 'a.ts') }), null);
});

test('a sibling quiet for longer than the liveness window does not gate', () => {
  const { repo, home } = makeRepo();
  addLiveSession(repo, 'stale-sid', { ageMs: 5 * 60_000 });
  assert.strictEqual(run({ home, cwd: repo, target: path.join(repo, 'src', 'a.ts') }), null);
});

test('its own glyph never counts as a sibling', () => {
  const { repo, home } = makeRepo();
  addLiveSession(repo, 'self-sid');
  assert.strictEqual(run({ home, cwd: repo, target: path.join(repo, 'src', 'a.ts'), sid: 'self-sid' }), null);
});

test('a pre-/clear ghost of this same terminal is not a sibling', () => {
  const { repo, home } = makeRepo();
  addLiveSession(repo, 'ghost-sid');            // warm glyph, but it IS us, one /clear ago
  setLineage(repo, 'self-sid', 'ghost-sid');
  assert.strictEqual(run({ home, cwd: repo, target: path.join(repo, 'src', 'a.ts') }), null);
});

test('a session already inside a worktree is never gated', () => {
  const { repo, home } = makeRepo();
  addLiveSession(repo, 'other-sid');
  // Also in the HOME tier: a worktree has no .titles dir of its own, so without this the hook
  // would fall out at "no session registry" and this test would pass on a deleted guard.
  addLiveSession(home, 'other-sid-2');
  const wt = path.join(repo, '.claude', 'worktrees', 'w1');
  execFileSync('git', ['worktree', 'add', '-b', 'w1', wt], { cwd: repo, stdio: 'ignore' });
  // The worktree's .git is a FILE, the main checkout's is a directory — that is the whole test.
  assert.ok(fs.statSync(path.join(wt, '.git')).isFile());
  assert.strictEqual(run({ home, cwd: wt, target: path.join(wt, 'src', 'a.ts') }), null);
});

test('the target repo decides, not the cwd', () => {
  const { repo, home } = makeRepo();
  addLiveSession(repo, 'other-sid');
  const wt = path.join(repo, '.claude', 'worktrees', 'w2');
  execFileSync('git', ['worktree', 'add', '-b', 'w2', wt], { cwd: repo, stdio: 'ignore' });
  // Sitting in the worktree but writing into the shared checkout is exactly the collision.
  assert.strictEqual(decisionOf(run({ home, cwd: wt, target: path.join(repo, 'src', 'a.ts') })), 'ask');
});

test('Write, MultiEdit and NotebookEdit are gated too, not just Edit', () => {
  // Write especially: creating a file is the most common way a session's FIRST repo write
  // lands, so a gate that only caught Edit would miss the case it exists for.
  const { repo: r0, home: h0 } = makeRepo();
  addLiveSession(r0, 'other-sid');
  assert.strictEqual(decisionOf(run({ home: h0, cwd: r0, tool: 'Write', target: path.join(r0, 'new.ts') })), 'ask');
  const { repo, home } = makeRepo();
  addLiveSession(repo, 'other-sid');
  assert.strictEqual(decisionOf(run({ home, cwd: repo, tool: 'MultiEdit', target: path.join(repo, 'a.ts') })), 'ask');
  const { repo: r2, home: h2 } = makeRepo();
  addLiveSession(r2, 'other-sid');
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      session_id: 'self-sid', cwd: r2, tool_name: 'NotebookEdit',
      tool_input: { notebook_path: path.join(r2, 'nb.ipynb') },
    }),
    encoding: 'utf8',
    env: { ...process.env, HOME: h2, USERPROFILE: h2, CLAUDE_WORKTREE_GATE: '', CLAUDE_CODE_SESSION_ID: '' },
  });
  assert.strictEqual(JSON.parse(res.stdout).hookSpecificOutput.permissionDecision, 'ask');
});

test('non-mutating tools are not gated', () => {
  const { repo, home } = makeRepo();
  addLiveSession(repo, 'other-sid');
  assert.strictEqual(run({ home, cwd: repo, tool: 'Bash', target: path.join(repo, 'src', 'a.ts') }), null);
});

test('a target outside any repo is not this repo problem', () => {
  const { repo, home, root } = makeRepo();
  addLiveSession(repo, 'other-sid');
  assert.strictEqual(run({ home, cwd: repo, target: path.join(root, 'elsewhere.ts') }), null);
});

test('title-hook state is exempt, and does not burn the one shot', () => {
  const { repo, home } = makeRepo();
  addLiveSession(repo, 'other-sid');
  const titleFile = path.join(titlesIn(repo), 'self-sid.txt');
  assert.strictEqual(run({ home, cwd: repo, target: titleFile }), null);
  // Turn one writes the title before any real edit. If that spent the marker, the gate would be
  // silent for the write it actually exists to catch.
  assert.strictEqual(decisionOf(run({ home, cwd: repo, target: path.join(repo, 'src', 'a.ts') })), 'ask');
});

test('asks once per session, then goes quiet', () => {
  const { repo, home } = makeRepo();
  addLiveSession(repo, 'other-sid');
  assert.strictEqual(decisionOf(run({ home, cwd: repo, target: path.join(repo, 'a.ts') })), 'ask');
  const second = run({ home, cwd: repo, target: path.join(repo, 'b.ts') });
  assert.strictEqual(second, null, 'a gate that re-asks on every edit gets uninstalled');
});

test('the one shot is spent even when no sibling was live', () => {
  const { repo, home } = makeRepo();
  fs.mkdirSync(titlesIn(repo), { recursive: true });
  assert.strictEqual(run({ home, cwd: repo, target: path.join(repo, 'a.ts') }), null);
  // A sibling appearing later is too late: this session already has dirty files, and a worktree
  // checks out clean from HEAD. Asking now would offer something that cannot work.
  addLiveSession(repo, 'other-sid');
  assert.strictEqual(run({ home, cwd: repo, target: path.join(repo, 'b.ts') }), null);
});

test('CLAUDE_WORKTREE_GATE=off silences it', () => {
  const { repo, home } = makeRepo();
  addLiveSession(repo, 'other-sid');
  const r = run({ home, cwd: repo, target: path.join(repo, 'a.ts'), env: { CLAUDE_WORKTREE_GATE: 'off' } });
  assert.strictEqual(r, null);
  // ...and it must not have burned the marker, or turning the gate back on would do nothing.
  assert.strictEqual(decisionOf(run({ home, cwd: repo, target: path.join(repo, 'b.ts') })), 'ask');
});

test('cca.config.json can disable it per repo', () => {
  const { repo, home } = makeRepo();
  addLiveSession(repo, 'other-sid');
  fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.claude', 'cca.config.json'),
    JSON.stringify({ worktreeGate: { enabled: false } }),
  );
  assert.strictEqual(run({ home, cwd: repo, target: path.join(repo, 'a.ts') }), null);
});

// Fail-open is right for a corrupt PAYLOAD and wrong for a corrupt CONFIG: an unreadable
// cca.config.json is not an opt-out, and reading it as one would silently disable the gate in
// exactly the repo whose .claude someone just broke.
test('a corrupt cca.config.json does not disable the gate', () => {
  const { repo, home } = makeRepo();
  addLiveSession(repo, 'other-sid');
  fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude', 'cca.config.json'), '{ not json');
  assert.strictEqual(decisionOf(run({ home, cwd: repo, target: path.join(repo, 'a.ts') })), 'ask');
});

test('malformed stdin exits clean and gates nothing', () => {
  const res = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout.trim(), '');
});

// The live sibling is load-bearing: without it the empty-siblings guard keeps the hook silent on
// its own, and this test would pass even on a repoOf() that walked to the filesystem root instead
// of returning null. Planting one in the HOME tier makes the not-a-repo guard the ONLY thing
// standing between this payload and an ask.
test('outside a git repo it is a no-op', () => {
  const home = scratch();
  const plain = scratch();
  addLiveSession(home, 'other-sid');
  assert.strictEqual(run({ home, cwd: plain, target: path.join(plain, 'a.ts') }), null);
});
