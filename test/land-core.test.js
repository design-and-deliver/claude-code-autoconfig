#!/usr/bin/env node
'use strict';

/**
 * Tests for .claude/scripts/land-core.js — the read-only checks landing a branch runs first.
 *
 * All against a real throwaway repo (no stubbed git):
 *   - conflictCheck: a clean merge, and a real conflict reported by file name;
 *   - dirtyOverlap: dirty main that doesn't touch the branch's files (empty), and one that does;
 *   - worktreeFor: found and not found;
 *   - isLinkedWorktree / mainCheckoutOf from the main checkout and from a linked worktree.
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

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp cleanup is best effort */ }
summary();
