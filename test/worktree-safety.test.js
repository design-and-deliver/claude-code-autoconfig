#!/usr/bin/env node
'use strict';

/**
 * Tests for .claude/scripts/worktree-safety.js — the one removal path worktrees go through.
 *
 * The three cases that matter, each against a real throwaway repo (no stubbed git):
 *   - a clean worktree is removed by git itself;
 *   - a worktree whose node_modules is a junction loses only the link — the target keeps its files
 *     (the 2026-08-15 incident: a recursive delete through the junction emptied the real one);
 *   - a dirty worktree is refused: ok:false, the directory stays, and its junction is put back.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { test, assert, summary } = require('./_harness');
const {
  safeRemoveWorktree, unlinkNodeModulesLink, removeDir,
} = require('../.claude/scripts/worktree-safety');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-wtsafe-'));
const repo = path.join(tmp, 'repo');
const trash = path.join(tmp, 'trash');
fs.mkdirSync(repo, { recursive: true });

const git = (...args) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

git('init', '--initial-branch=main');
git('config', 'user.email', 'test@example.com');
git('config', 'user.name', 'WorktreeSafety Test');
git('config', 'commit.gpgsign', 'false');
fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules\n');
fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
git('add', '-A');
git('commit', '-m', 'seed');

function addWorktree(name) {
  const dir = path.join(tmp, 'wt', name);
  git('worktree', 'add', '-b', name, dir);
  return dir;
}

// A sibling folder standing in for the main checkout's real node_modules.
function makeLinkTarget(name) {
  const target = path.join(tmp, `${name}-real-modules`);
  fs.mkdirSync(path.join(target, 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(target, 'pkg', 'index.js'), 'module.exports = 1;\n');
  return target;
}

const listed = () => git('worktree', 'list', '--porcelain');

test('a clean worktree is removed by git', () => {
  const wt = addWorktree('clean');
  const r = safeRemoveWorktree(repo, wt, trash);
  assert(r.ok === true, `expected ok, got ${JSON.stringify(r)}`);
  assert(r.how === 'git', `expected how=git, got ${r.how}`);
  assert(!fs.existsSync(wt), 'worktree directory should be gone');
  assert(!listed().includes('/clean\n') && !listed().includes('\\clean\n'), 'worktree should be de-registered');
});

test('a junctioned node_modules loses only the link; the target keeps its files', () => {
  const wt = addWorktree('junctioned');
  const target = makeLinkTarget('junctioned');
  fs.symlinkSync(target, path.join(wt, 'node_modules'), 'junction');
  const r = safeRemoveWorktree(repo, wt, trash);
  assert(r.ok === true, `expected ok, got ${JSON.stringify(r)}`);
  assert(!fs.existsSync(wt), 'worktree directory should be gone');
  assert(fs.existsSync(path.join(target, 'pkg', 'index.js')), 'link target lost its files');
});

test('a dirty worktree is refused and left in place, junction restored', () => {
  const wt = addWorktree('dirty');
  const target = makeLinkTarget('dirty');
  fs.symlinkSync(target, path.join(wt, 'node_modules'), 'junction');
  fs.writeFileSync(path.join(wt, 'work-in-progress.txt'), 'only copy\n');
  const r = safeRemoveWorktree(repo, wt, trash);
  assert(r.ok === false, `expected ok:false, got ${JSON.stringify(r)}`);
  assert(r.how === 'failed', `expected how=failed, got ${r.how}`);
  assert(fs.existsSync(path.join(wt, 'work-in-progress.txt')), 'uncommitted file was deleted');
  assert(fs.lstatSync(path.join(wt, 'node_modules')).isSymbolicLink(), 'junction was not restored');
  assert(fs.existsSync(path.join(target, 'pkg', 'index.js')), 'link target lost its files');
});

test('unlinkNodeModulesLink leaves a real node_modules directory alone', () => {
  const dir = path.join(tmp, 'plain');
  fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
  assert(unlinkNodeModulesLink(dir) === null, 'should report no link');
  assert(fs.existsSync(path.join(dir, 'node_modules', 'x')), 'real node_modules was touched');
});

test('removeDir deletes a plain directory without trashing it', () => {
  const dir = path.join(tmp, 'doomed');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sub', 'f.txt'), 'x');
  const r = removeDir(dir, trash);
  assert(r.how === 'deleted', `expected deleted, got ${JSON.stringify(r)}`);
  assert(!fs.existsSync(dir), 'directory should be gone');
});

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp cleanup is best effort */ }
summary();
