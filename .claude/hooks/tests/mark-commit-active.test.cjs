// mark-commit-active: PostToolUse(Bash) hook that stamps .git/.cc-commit-active on git
// WRITE commands so the Stop-hook "Uncommitted work" reminder stays quiet while any
// session sharing the working tree is mid-commit. Read-only git must NOT arm the flag
// (the Stop hook itself runs status/diff — arming on reads would silence it forever).
// Run: node --test mark-commit-active.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.resolve(__dirname, '..', 'mark-commit-active.js');

function tmpRepo({ withGitDir = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mca-'));
  if (withGitDir) fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

function runHook(dir, command, session_id = 'sess-1') {
  const payload = JSON.stringify({ tool_input: { command }, cwd: dir, session_id });
  return spawnSync(process.execPath, [HOOK], {
    input: payload,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    encoding: 'utf8',
  });
}

function flagPath(dir) {
  return path.join(dir, '.git', '.cc-commit-active');
}

test('git commit arms the flag with the session id', () => {
  const dir = tmpRepo();
  const r = runHook(dir, 'git commit -m "feat: x"', 'sess-42');
  assert.strictEqual(r.status, 0);
  assert.ok(fs.existsSync(flagPath(dir)), 'flag should exist after git commit');
  const flag = JSON.parse(fs.readFileSync(flagPath(dir), 'utf8'));
  assert.strictEqual(flag.session, 'sess-42');
});

test('git with leading global flags still arms (git -C . push)', () => {
  const dir = tmpRepo();
  runHook(dir, 'git -C . push origin main');
  assert.ok(fs.existsSync(flagPath(dir)), 'flag should exist after git -C . push');
});

test('compound command containing git add arms', () => {
  const dir = tmpRepo();
  runHook(dir, 'cd /some/where && git add -A && git status');
  assert.ok(fs.existsSync(flagPath(dir)), 'flag should exist after git add');
});

test('read-only git does NOT arm (status/log/diff)', () => {
  const dir = tmpRepo();
  for (const cmd of ['git status --porcelain', 'git log -1', 'git diff HEAD --numstat']) {
    runHook(dir, cmd);
  }
  assert.ok(!fs.existsSync(flagPath(dir)), 'read-only git must not create the flag');
});

test('non-git command does NOT arm', () => {
  const dir = tmpRepo();
  runHook(dir, 'npm test && ls -la');
  assert.ok(!fs.existsSync(flagPath(dir)), 'non-git command must not create the flag');
});

test('no .git directory (worktree .git file) → no flag, exit 0', () => {
  const dir = tmpRepo({ withGitDir: false });
  fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /elsewhere');
  const r = runHook(dir, 'git commit -m x');
  assert.strictEqual(r.status, 0, 'hook must not crash on a .git file');
  assert.ok(!fs.existsSync(path.join(dir, '.git', '.cc-commit-active')));
});

test('malformed stdin never breaks the pipeline', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json{', encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
});
