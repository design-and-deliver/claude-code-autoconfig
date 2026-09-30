#!/usr/bin/env node
'use strict';

/**
 * Tests for .claude/scripts/land-core.js — the read-only checks landing a branch runs first.
 *
 * All against a real throwaway repo (no stubbed git):
 *   - conflictCheck: a clean merge, and a real conflict reported by file name;
 *   - dirtyOverlap: dirty main that doesn't touch the branch's files (empty), and one that does;
 *   - worktreeFor: found and not found;
 *   - isLinkedWorktree / mainCheckoutOf from the main checkout and from a linked worktree;
 *   - land.js end to end (--no-push): happy path, conflict (2), dirty overlap (3), run from
 *     inside the worktree (4), --dry-run, and a dirty worktree left in place.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { test, assert, summary } = require('./_harness');
const {
  mainCheckoutOf, isLinkedWorktree, conflictCheck, dirtyOverlap, worktreeFor,
} = require('../.claude/scripts/land-core');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cca-landcore-')));
const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo, { recursive: true });

const git = (...args) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const write = (name, text) => fs.writeFileSync(path.join(repo, name), text);
const commit = (msg) => { git('add', '-A'); git('commit', '-m', msg); };
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

git('init', '--initial-branch=main');
git('config', 'user.email', 'test@example.com');
git('config', 'user.name', 'LandCore Test');
git('config', 'commit.gpgsign', 'false');
write('a.txt', 'a\n');
write('b.txt', 'b\n');
commit('seed');

// feat-clean touches only b.txt; feat-conflict and main both rewrite a.txt.
git('switch', '-c', 'feat-clean');
write('b.txt', 'b from branch\n');
commit('branch edits b');
git('switch', 'main');
git('switch', '-c', 'feat-conflict');
write('a.txt', 'a from branch\n');
commit('branch edits a');
git('switch', 'main');
write('a.txt', 'a from main\n');
commit('main edits a');

const wt = path.join(tmp, 'wt', 'feat-wt');
git('worktree', 'add', '-b', 'feat-wt', wt);

test('conflictCheck reports a clean merge', () => {
  const r = conflictCheck(repo, 'main', 'feat-clean');
  assert(r.clean === true, `expected clean, got ${JSON.stringify(r)}`);
});

test('conflictCheck names the conflicting file', () => {
  const r = conflictCheck(repo, 'main', 'feat-conflict');
  assert(r.clean === false, `expected a conflict, got ${JSON.stringify(r)}`);
  assert(JSON.stringify(r.files) === '["a.txt"]', `expected [a.txt], got ${JSON.stringify(r.files)}`);
});

test('conflictCheck leaves the main working tree untouched', () => {
  assert(git('status', '--porcelain').trim() === '', 'merge-tree dirtied the working tree');
  assert(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8') === 'a from main\n', 'a.txt changed');
});

test('dirtyOverlap is empty when main is dirty elsewhere', () => {
  write('a.txt', 'uncommitted a\n');
  write('untracked.txt', 'new\n');
  const r = dirtyOverlap(repo, 'main', 'feat-clean');
  assert(r.length === 0, `expected no overlap, got ${JSON.stringify(r)}`);
});

test('dirtyOverlap names a dirty file the branch also changes', () => {
  write('b.txt', 'uncommitted b\n');
  const r = dirtyOverlap(repo, 'main', 'feat-clean');
  assert(JSON.stringify(r) === '["b.txt"]', `expected [b.txt], got ${JSON.stringify(r)}`);
  git('checkout', '--', 'a.txt', 'b.txt');
  fs.rmSync(path.join(repo, 'untracked.txt'));
});

test('worktreeFor finds the worktree holding a branch', () => {
  const found = worktreeFor(repo, 'feat-wt');
  assert(found && same(found, wt), `expected ${wt}, got ${found}`);
});

test('worktreeFor returns null for a branch with no worktree', () => {
  assert(worktreeFor(repo, 'feat-clean') === null, 'feat-clean has no worktree');
  assert(worktreeFor(repo, 'no-such-branch') === null, 'unknown branch should be null');
});

test('isLinkedWorktree is false in main and true in a worktree', () => {
  assert(isLinkedWorktree(repo) === false, 'main checkout reported as linked');
  assert(isLinkedWorktree(wt) === true, 'linked worktree not detected');
});

test('mainCheckoutOf resolves to the main checkout from both sides', () => {
  assert(same(mainCheckoutOf(repo), repo), `from main: ${mainCheckoutOf(repo)}`);
  assert(same(mainCheckoutOf(wt), repo), `from worktree: ${mainCheckoutOf(wt)}`);
});

// ---- land.js end to end: a fresh repo + worktree per scenario, always --no-push ----

const { spawnSync } = require('child_process');
const LAND = path.join(__dirname, '..', '.claude', 'scripts', 'land.js');
let fixtureN = 0;

// main with a.txt/b.txt; branch `feat` checked out in its own worktree with one commit on b.txt.
function landFixture() {
  const root = path.join(tmp, `land-${++fixtureN}`);
  const main = path.join(root, 'main');
  const wtDir = path.join(root, 'wt', 'feat');
  fs.mkdirSync(main, { recursive: true });
  const g = (dir, ...args) =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  g(main, 'init', '--initial-branch=main');
  g(main, 'config', 'user.email', 'test@example.com');
  g(main, 'config', 'user.name', 'Land Test');
  g(main, 'config', 'commit.gpgsign', 'false');
  g(main, 'config', 'core.autocrlf', 'false'); // a system-level `true` would rewrite merged files as CRLF
  fs.writeFileSync(path.join(main, 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(main, 'b.txt'), 'b\n');
  g(main, 'add', '-A');
  g(main, 'commit', '-m', 'seed');
  g(main, 'worktree', 'add', '-b', 'feat', wtDir);
  fs.writeFileSync(path.join(wtDir, 'b.txt'), 'b from feat\n');
  g(wtDir, 'commit', '-am', 'feat edits b');
  return { main, wtDir, g, head: () => g(main, 'rev-parse', 'HEAD') };
}

function runLand(cwd, ...args) {
  const r = spawnSync(process.execPath, [LAND, 'feat', '--no-push', ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const branchExists = (f) => f.g(f.main, 'branch', '--list', 'feat') !== '';

test('land.js happy path: merged, worktree gone, branch deleted, exit 0', () => {
  const f = landFixture();
  const r = runLand(f.main);
  assert(r.code === 0, `exit ${r.code}\n${r.out}${r.err}`);
  assert(fs.readFileSync(path.join(f.main, 'b.txt'), 'utf8') === 'b from feat\n', 'b.txt not merged into main');
  assert(!fs.existsSync(f.wtDir), 'worktree directory still exists');
  assert(!branchExists(f), 'branch feat was not deleted');
});

test('land.js exits 2 on a conflict and leaves main unchanged', () => {
  const f = landFixture();
  fs.writeFileSync(path.join(f.main, 'b.txt'), 'b from main\n');
  f.g(f.main, 'commit', '-am', 'main edits b');
  const before = f.head();
  const r = runLand(f.main);
  assert(r.code === 2, `expected exit 2, got ${r.code}\n${r.out}${r.err}`);
  assert(/b\.txt/.test(r.out), `conflict file not named:\n${r.out}`);
  assert(f.head() === before, 'main HEAD moved');
  assert(f.g(f.main, 'status', '--porcelain') === '', 'main working tree dirtied');
  assert(fs.existsSync(f.wtDir) && branchExists(f), 'worktree or branch touched');
});

test('land.js exits 3 on a dirty overlap and leaves the uncommitted edit alone', () => {
  const f = landFixture();
  fs.writeFileSync(path.join(f.main, 'b.txt'), 'in-progress edit\n');
  const before = f.head();
  const r = runLand(f.main);
  assert(r.code === 3, `expected exit 3, got ${r.code}\n${r.out}${r.err}`);
  assert(/not touching it/.test(r.out) && /b\.txt/.test(r.out), `overlap not reported:\n${r.out}`);
  assert(fs.readFileSync(path.join(f.main, 'b.txt'), 'utf8') === 'in-progress edit\n', 'uncommitted edit lost');
  assert(f.head() === before, 'main HEAD moved');
});

test('land.js exits 4 when run from inside the worktree', () => {
  const f = landFixture();
  const r = runLand(f.wtDir);
  assert(r.code === 4, `expected exit 4, got ${r.code}\n${r.out}${r.err}`);
  assert(/ExitWorktree keep/.test(r.out), `missing the ExitWorktree hint:\n${r.out}`);
  assert(fs.existsSync(f.wtDir) && branchExists(f), 'worktree or branch touched');
});

test('land.js --dry-run changes nothing and reports the plan as JSON', () => {
  const f = landFixture();
  const before = f.head();
  const r = runLand(f.main, '--dry-run', '--json');
  assert(r.code === 0, `exit ${r.code}\n${r.out}${r.err}`);
  const j = JSON.parse(r.out);
  assert(j.branch === 'feat' && j.base === 'main', `bad header: ${r.out}`);
  const steps = j.steps.map((s) => s.step).join(',');
  assert(steps === 'preflight,conflicts,overlap,dry-run', `unexpected steps: ${steps}`);
  assert(j.steps.every((s) => s.ok), `a step failed: ${r.out}`);
  assert(/fast-forward/.test(j.steps[3].detail) && /remove worktree/.test(j.steps[3].detail),
    `dry-run detail: ${j.steps[3].detail}`);
  assert(f.head() === before, 'main HEAD moved');
  assert(fs.existsSync(f.wtDir) && branchExists(f), 'worktree or branch touched');
});

test('land.js keeps a dirty worktree and the branch it holds, still exit 0', () => {
  const f = landFixture();
  fs.writeFileSync(path.join(f.wtDir, 'scratch.txt'), 'unsaved\n');
  const r = runLand(f.main);
  assert(r.code === 0, `exit ${r.code}\n${r.out}${r.err}`);
  assert(fs.readFileSync(path.join(f.main, 'b.txt'), 'utf8') === 'b from feat\n', 'not merged');
  assert(fs.existsSync(path.join(f.wtDir, 'scratch.txt')), 'dirty worktree was removed');
  assert(branchExists(f), 'branch deleted while a worktree still holds it');
});

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp cleanup is best effort */ }
summary();
