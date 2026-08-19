#!/usr/bin/env node
'use strict';

/**
 * Guardrail tests for .claude/scripts/sync-worktrees.js — the prove-then-delete gate.
 *
 * This script deletes directories, so the only interesting failures are the two directions of its
 * content check, and they fail in opposite ways:
 *
 *   FALSE REAP  — a file exists only in that directory and we delete it anyway. Loses work. This is
 *                 the one that matters, and it is invisible in normal use because the happy path
 *                 (everything already committed) reports REAP too. A tautological check that always
 *                 said REAP would look identical on a clean repo.
 *   FALSE BLOCK — a gitignored file (crx-key.ts, .env, dev-build-number.json — exactly what
 *                 bootstrap-worktree.js copies in) is counted as unrecoverable. Nothing is lost, but
 *                 every orphan becomes permanently undeletable and the command is useless.
 *
 * So the suite plants a unique file twice — once tracked, once ignored — and asserts the verdict
 * flips for the first and does NOT flip for the second. Both were verified by hand against five real
 * orphans on 2026-07-31; this pins them.
 *
 * Exercised end-to-end against the real script over a real temp git repo — no stubbed git. HOME and
 * USERPROFILE point at an empty fake home so the liveness probe (which reads
 * ~/.claude/projects/<slug>/*.jsonl) can never see the machine's real transcripts and mark a
 * fixture HELD.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { test, assert, summary } = require('./_harness');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'sync-worktrees.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-syncwt-'));
const home = path.join(tmp, 'home');
const repo = path.join(tmp, 'repo');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(repo, { recursive: true });

const git = (...args) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const WT = path.join(repo, '.claude', 'worktrees');
const ORPHAN = path.join(WT, 'reapable');

git('init', '--initial-branch=main');
git('config', 'user.email', 'test@example.com');
git('config', 'user.name', 'SyncWorktrees Test');
git('config', 'commit.gpgsign', 'false');

// secret.key stands in for the gitignored files bootstrap-worktree.js copies into every worktree.
fs.writeFileSync(path.join(repo, '.gitignore'), 'secret.key\nnode_modules/\n');
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
fs.writeFileSync(path.join(repo, 'src', 'b.ts'), 'export const b = 2;\n');
git('add', '-A');
git('commit', '-m', 'seed');

// The orphan: a directory under the worktree base that git knows nothing about — no .git file, no
// registration. This is what ExitWorktree leaves behind when the recursive delete loses to a file
// lock. Its content is a byte-copy of committed files, so every blob is already in the object store.
fs.mkdirSync(path.join(ORPHAN, 'src'), { recursive: true });
fs.copyFileSync(path.join(repo, 'src', 'a.ts'), path.join(ORPHAN, 'src', 'a.ts'));
fs.copyFileSync(path.join(repo, 'src', 'b.ts'), path.join(ORPHAN, 'src', 'b.ts'));

// node_modules is the whole reason the original delete failed, and hashing it to decide a fate git
// already disowned would be absurd — it must be skipped, not walked.
fs.mkdirSync(path.join(ORPHAN, 'node_modules', 'junk'), { recursive: true });
fs.writeFileSync(path.join(ORPHAN, 'node_modules', 'junk', 'index.js'), 'module.exports = null;\n');

function run(...extra) {
  const out = execFileSync('node', [SCRIPT, '--json', '--project-dir', repo, ...extra], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CODE_SESSION_ID: '' },
  });
  return JSON.parse(out);
}
const orphanNamed = (r, name) => r.orphans.find((o) => o.name === name);

console.log('============================================================');
console.log('SYNC-WORKTREES TESTS');
console.log('============================================================');
console.log();

test('an unregistered directory whose files are all committed reports REAP', () => {
  const o = orphanNamed(run(), 'reapable');
  assert(o, 'the orphan directory was not detected at all');
  assert(o.verdict === 'REAP', `expected REAP, got ${o.verdict} (${o.reason})`);
});

test('node_modules is skipped, not walked', () => {
  // Assert on `walked` (pre-filter), never `checked`. node_modules is gitignored here exactly as it
  // is in every real repo, so `checked` is 2 whether the walker skipped the directory or descended
  // into it and paid check-ignore on every file — an assertion on `checked` survives deleting
  // 'node_modules' from SKIP_DIRS and therefore tests nothing (mutation-verified 2026-07-31).
  const o = orphanNamed(run(), 'reapable');
  assert(o.walked === 2, `expected 2 files walked, got ${o.walked} — node_modules was descended into`);
  assert(o.checked === 2, `expected 2 files checked, got ${o.checked}`);
});

// The load-bearing one. If this ever passes while the file is unique, the script deletes work.
test('a file that exists ONLY in the orphan flips it to BLOCKED and is named', () => {
  const unique = path.join(ORPHAN, 'src', 'only-here.ts');
  fs.writeFileSync(unique, 'export const neverCommitted = "9f3a2";\n');
  try {
    const o = orphanNamed(run(), 'reapable');
    assert(o.verdict === 'BLOCKED', `expected BLOCKED, got ${o.verdict} — this deletes real work`);
    assert(o.missing.includes('src/only-here.ts'),
      `the unrecoverable file must be named; got ${JSON.stringify(o.missing)}`);
  } finally {
    fs.rmSync(unique, { force: true });
  }
});

// The opposite failure: block on a file that was never going to be in git in the first place.
test('a unique but GITIGNORED file does not block the reap', () => {
  const ignored = path.join(ORPHAN, 'secret.key');
  fs.writeFileSync(ignored, 'unique-secret-never-committed-zzz\n');
  try {
    const o = orphanNamed(run(), 'reapable');
    assert(o.verdict === 'REAP',
      `gitignored files must be filtered before the object-store check; got ${o.verdict} (${o.reason})`);
  } finally {
    fs.rmSync(ignored, { force: true });
  }
});

test('a REGISTERED worktree is never treated as an orphan', () => {
  const live = path.join(WT, 'live-one');
  git('worktree', 'add', '-b', 'wt-live', live);
  try {
    assert(!orphanNamed(run(), 'live-one'),
      'a directory still in `git worktree list` must be skipped entirely — deleting it corrupts a live session');
  } finally {
    git('worktree', 'remove', '--force', live);
    git('branch', '-D', 'wt-live');
  }
});

test('a dry run deletes nothing', () => {
  const r = run();
  assert(r.mode === 'dry-run', `expected dry-run mode, got ${r.mode}`);
  assert(r.actions.length === 0, `dry run must take no actions; got ${JSON.stringify(r.actions)}`);
  assert(fs.existsSync(ORPHAN), 'the orphan directory must survive a dry run');
});

test('a merged branch is offered, an unmerged one is not', () => {
  git('branch', 'merged-already');                       // points at main — fully contained
  git('checkout', '-q', '-b', 'has-own-work');
  fs.writeFileSync(path.join(repo, 'src', 'c.ts'), 'export const c = 3;\n');
  git('add', '-A');
  git('commit', '-m', 'unmerged work');
  git('checkout', '-q', 'main');
  try {
    const r = run();
    assert(r.mergedBranches.includes('merged-already'),
      `a branch contained in main should be reapable; got ${JSON.stringify(r.mergedBranches)}`);
    assert(!r.mergedBranches.includes('has-own-work'),
      'an unmerged branch must never be offered for deletion');
  } finally {
    git('branch', '-D', 'has-own-work');
  }
});

test('--write actually removes the directory and the merged branch', () => {
  const r = run('--write');
  assert(r.mode === 'write', `expected write mode, got ${r.mode}`);
  assert(!fs.existsSync(ORPHAN), 'the orphan directory should be gone after --write');
  const branches = git('branch', '--format=%(refname:short)').split('\n').map((s) => s.trim());
  assert(!branches.includes('merged-already'), 'the merged branch should be gone after --write');
  assert(branches.includes('main'), 'main must never be deleted');
});

// The complement of the merged-branch check above, and the blind spot that motivated it: a branch
// that is NOT in main and has NO worktree is invisible to `--merged` (excluded by definition) and
// to fleet.js (which enumerates worktrees). Found by hand 2026-08-19 holding 11 commits of drift.
// The --write half of this test pins the contract that matters — reported, never reaped.
test('an unlanded branch with no worktree is reported with ahead/behind, and --write never deletes it', () => {
  git('checkout', '-q', '-b', 'stranded-work');
  fs.writeFileSync(path.join(repo, 'src', 'd.ts'), 'export const d = 4;\n');
  git('add', '-A');
  git('commit', '-m', 'work nobody landed');
  git('checkout', '-q', 'main');
  // main moves on without it — this is the drift the report exists to surface.
  fs.writeFileSync(path.join(repo, 'src', 'e.ts'), 'export const e = 5;\n');
  git('add', '-A');
  git('commit', '-m', 'main moves on');
  try {
    const u = run().unlandedBranches.find((b) => b.branch === 'stranded-work');
    assert(u, 'an unmerged branch with no worktree must be reported');
    assert(u.ahead === 1, `expected 1 unlanded commit, got ${u.ahead}`);
    assert(u.behind === 1, `expected 1 commit behind main, got ${u.behind}`);

    run('--write');
    const branches = git('branch', '--format=%(refname:short)').split('\n').map((s) => s.trim());
    assert(branches.includes('stranded-work'),
      '--write must never delete an unlanded branch — it can be the only copy of that work');
  } finally {
    git('branch', '-D', 'stranded-work');
  }
});

// A branch that HAS a worktree is somebody's current desk, not a leftover — it belongs to /fleet's
// UNLANDED block, not to this one, or every active session gets nagged about its own branch.
test('a branch with a live worktree is not reported as unlanded', () => {
  const LIVE = path.join(WT, 'live-unlanded');
  git('worktree', 'add', '-q', '-b', 'busy-branch', LIVE);
  try {
    const names = run().unlandedBranches.map((b) => b.branch);
    assert(!names.includes('busy-branch'),
      `a checked-out branch must not be reported as unlanded; got ${JSON.stringify(names)}`);
  } finally {
    git('worktree', 'remove', '--force', LIVE);
    git('branch', '-D', 'busy-branch');
  }
});

// Regression for the 2026-08-15 incident: a junctioned node_modules must be unlinked on its own
// before the orphan's recursive delete, or the delete follows the junction and destroys whatever
// real directory it points at (proved by hand against the main checkout's actual node_modules).
test('a junctioned node_modules is unlinked, not recursed into, on --write', () => {
  const JUNCTION_ORPHAN = path.join(WT, 'reapable-junction');
  fs.mkdirSync(path.join(JUNCTION_ORPHAN, 'src'), { recursive: true });
  fs.copyFileSync(path.join(repo, 'src', 'a.ts'), path.join(JUNCTION_ORPHAN, 'src', 'a.ts'));
  fs.copyFileSync(path.join(repo, 'src', 'b.ts'), path.join(JUNCTION_ORPHAN, 'src', 'b.ts'));

  // The canary lives OUTSIDE the worktree base entirely — real content that must survive.
  const canary = path.join(tmp, 'canary-node-modules');
  fs.mkdirSync(canary, { recursive: true });
  fs.writeFileSync(path.join(canary, 'real-package.js'), 'module.exports = "do not delete";\n');
  fs.symlinkSync(canary, path.join(JUNCTION_ORPHAN, 'node_modules'), 'junction');

  try {
    const o = orphanNamed(run(), 'reapable-junction');
    assert(o.verdict === 'REAP', `expected REAP, got ${o.verdict} (${o.reason})`);

    run('--write');

    assert(!fs.existsSync(JUNCTION_ORPHAN), 'the junctioned orphan should be gone after --write');
    assert(fs.existsSync(path.join(canary, 'real-package.js')),
      'the canary file behind the junction must survive — a recursive delete followed the link and destroyed real content');
  } finally {
    fs.rmSync(JUNCTION_ORPHAN, { recursive: true, force: true });
    fs.rmSync(canary, { recursive: true, force: true });
  }
});

test('a second run is a clean no-op', () => {
  const r = run();
  assert(r.orphans.length === 0, `expected no orphans left; got ${JSON.stringify(r.orphans.map((o) => o.name))}`);
  assert(r.mergedBranches.length === 0, 'nothing left to reap');
});

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }

summary();
