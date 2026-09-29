#!/usr/bin/env node
'use strict';

/**
 * Tests for scripts/snapshot-worktrees.js — the backup every worktree-removing substep runs first
 * (worktree-hardening plan 1.0).
 *
 * Behavioral: builds a throwaway repo with a linked worktree holding staged, modified, untracked
 * and deleted files plus an ignored one, snapshots it, and checks that the backup restores:
 * the bundle carries every branch, and every uncommitted file is copied byte-for-byte while the
 * ignored one is not. Also pins that the snapshot leaves the repo's status untouched.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { test, assert, summary } = require('./_harness');
const { snapshotRepo, parseStatus } = require('../scripts/snapshot-worktrees.js');

const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-snap-'));
const repo = path.join(tmp, 'repo');
const wt = path.join(tmp, 'wt-feature');
const out = path.join(tmp, 'backup');
const write = (dir, rel, body) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
};

fs.mkdirSync(repo);
git(repo, 'init', '-q', '-b', 'main');
git(repo, 'config', 'user.email', 't@t');
git(repo, 'config', 'user.name', 't');
write(repo, '.gitignore', 'ignored.txt\n');
write(repo, 'kept.txt', 'kept\n');
write(repo, 'gone.txt', 'gone\n');
write(repo, 'staged.txt', 'v1\n');
git(repo, 'add', '.');
git(repo, 'commit', '-qm', 'init');
git(repo, 'worktree', 'add', '-q', '-b', 'feature', wt);
write(wt, 'staged.txt', 'v2 staged\n');
git(wt, 'add', 'staged.txt');
write(wt, 'kept.txt', 'kept, modified\n');
write(wt, 'sub/new file.txt', 'untracked\n');
write(wt, 'ignored.txt', 'ignored\n');
fs.unlinkSync(path.join(wt, 'gone.txt'));

const statusBefore = git(wt, 'status', '--porcelain');
const result = snapshotRepo(wt, out);
const repoOut = path.join(out, 'repo');
const wtOut = path.join(repoOut, 'wt-feature');
const read = rel => fs.readFileSync(path.join(wtOut, 'files', rel), 'utf8');

test('resolves the main checkout from a linked worktree', () => {
  assert(path.resolve(result.repo) === path.resolve(repo), `repo was ${result.repo}`);
  assert(result.worktrees.length === 2, `expected 2 worktrees, got ${result.worktrees.length}`);
});

test('the bundle carries every branch', () => {
  const heads = git(repo, 'bundle', 'list-heads', result.bundle);
  assert(/refs\/heads\/main/.test(heads) && /refs\/heads\/feature/.test(heads), heads);
});

test('staged, modified and untracked files are copied byte-for-byte', () => {
  assert(read('staged.txt') === 'v2 staged\n', 'staged.txt');
  assert(read('kept.txt') === 'kept, modified\n', 'kept.txt');
  assert(read('sub/new file.txt') === 'untracked\n', 'untracked file with a space');
});

test('ignored and deleted files are not copied, deletions are in the manifest', () => {
  assert(!fs.existsSync(path.join(wtOut, 'files', 'ignored.txt')), 'ignored.txt was copied');
  assert(!fs.existsSync(path.join(wtOut, 'files', 'gone.txt')), 'gone.txt was copied');
  const manifest = JSON.parse(fs.readFileSync(path.join(wtOut, 'manifest.json'), 'utf8'));
  assert(manifest.branch === 'refs/heads/feature', `branch ${manifest.branch}`);
  assert(manifest.status.some(e => e.path === 'gone.txt' && e.xy.includes('D')), 'no deletion entry');
});

test('the snapshot leaves the worktree untouched', () => {
  assert(git(wt, 'status', '--porcelain') === statusBefore, 'status changed');
});

test('a clean main checkout gets a manifest with zero files', () => {
  const main = result.worktrees.find(w => path.resolve(w.path) === path.resolve(repo));
  assert(main && main.files === 0, JSON.stringify(main));
});

test('parseStatus skips the source path of a rename', () => {
  const entries = parseStatus('R  new.txt\0old.txt\0?? u.txt\0');
  assert(entries.length === 2 && entries[0].path === 'new.txt' && entries[1].path === 'u.txt',
    JSON.stringify(entries));
});

fs.rmSync(tmp, { recursive: true, force: true });
summary();
