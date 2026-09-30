#!/usr/bin/env node
'use strict';

/**
 * snapshot-worktrees.js — back up every worktree of one or more repos before anything removes one.
 *
 * Worktree-hardening plan 1.0. Removing a worktree or deleting a branch is the one failure a
 * later code fix cannot undo: uncommitted files in a removed worktree are simply gone. So every
 * substep that removes anything runs this first, and a bad removal becomes a restore instead of
 * a loss.
 *
 * Per repo it writes, under <out>/<repo-name>/:
 *   all.bundle            `git bundle create --all` — every branch and commit. Restore a deleted
 *                         branch with `git fetch <bundle> <branch>:<branch>`.
 *   <worktree>/files/...  every staged, modified or untracked (not ignored) file, copied as-is.
 *   <worktree>/manifest.json  path, branch, HEAD, and the raw status entries (deletions too).
 *
 * READ-ONLY on the repos: status runs with --no-optional-locks so it never takes index.lock
 * under a live session, and the bundle is written outside the repo. Ignored files (node_modules,
 * settings.local.json, build output) are skipped on purpose — bootstrap recreates them.
 *
 * Usage: node scripts/snapshot-worktrees.js [repoDir...] [--out <dir>] [--json]
 *   repoDir defaults to this checkout's main repo; --out defaults to
 *   <parent of the first repo>/_worktree-backups/<YYYY-MM-DD_HHMMSS>.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const git = (cwd, args, opts = {}) =>
  execFileSync('git', ['--no-optional-locks', '-C', cwd, ...args], {
    encoding: opts.encoding ?? 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });

// The main checkout owns the common .git dir, whichever worktree we were started from.
function mainCheckoutOf(dir) {
  const common = git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  return path.dirname(common);
}

function listWorktrees(repo) {
  const out = git(repo, ['worktree', 'list', '--porcelain']);
  return out.split(/\r?\n\r?\n/).filter(Boolean).map(block => {
    const wt = {};
    for (const line of block.split(/\r?\n/)) {
      const [key, ...rest] = line.split(' ');
      wt[key] = rest.join(' ') || true;
    }
    return { path: path.resolve(wt.worktree), branch: wt.branch ?? null, head: wt.HEAD ?? null };
  });
}

// `status --porcelain=v1 -z`: "XY path\0", plus the original path as its own field on renames.
function parseStatus(raw) {
  const fields = raw.split('\0');
  const entries = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (f.length < 4) continue;
    const xy = f.slice(0, 2);
    entries.push({ xy, path: f.slice(3) });
    if (xy[0] === 'R' || xy[0] === 'C') i++; // skip the rename source
  }
  return entries;
}

const isDeletion = xy => xy.includes('D') && !xy.includes('?');

function copyEntries(wtPath, entries, destRoot) {
  let copied = 0;
  for (const e of entries) {
    const src = path.join(wtPath, e.path);
    if (isDeletion(e.xy) || !fs.existsSync(src) || fs.statSync(src).isDirectory()) continue;
    const dest = path.join(destRoot, e.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied++;
  }
  return copied;
}

const safeName = p => p.replace(/[:\\/]+/g, '_').replace(/^_+/, '');

function snapshotWorktree(wt, repoOut, dirName) {
  const dest = path.join(repoOut, dirName);
  if (!fs.existsSync(wt.path)) return { ...wt, missing: true, files: 0 };
  const raw = git(wt.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const entries = parseStatus(raw);
  const files = copyEntries(wt.path, entries, path.join(dest, 'files'));
  const record = { ...wt, files, status: entries };
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(record, null, 2));
  return { ...wt, files, changed: entries.length };
}

function snapshotRepo(repoDir, outRoot) {
  const repo = mainCheckoutOf(repoDir);
  const repoOut = path.join(outRoot, path.basename(repo));
  fs.mkdirSync(repoOut, { recursive: true });
  const bundle = path.join(repoOut, 'all.bundle');
  git(repo, ['bundle', 'create', bundle, '--all']);
  const used = new Set();
  const worktrees = listWorktrees(repo).map(wt => {
    let name = safeName(path.basename(wt.path)) || 'root';
    for (let n = 2; used.has(name); n++) name = `${safeName(path.basename(wt.path))}-${n}`;
    used.add(name);
    return snapshotWorktree(wt, repoOut, name);
  });
  return { repo, bundle, worktrees };
}

function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function parseArgs(argv) {
  const opts = { repos: [], out: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') opts.out = argv[++i];
    else if (argv[i] === '--json') opts.json = true;
    else opts.repos.push(argv[i]);
  }
  if (!opts.repos.length) opts.repos.push(mainCheckoutOf(process.cwd()));
  opts.out ??= path.join(path.dirname(mainCheckoutOf(opts.repos[0])), '_worktree-backups', stamp());
  return opts;
}

function report(result) {
  console.log(`Snapshot written to ${result.out}`);
  for (const r of result.repos) {
    console.log(`\n${r.repo}  (bundle: ${path.basename(r.bundle)})`);
    for (const wt of r.worktrees) {
      const what = wt.missing ? 'MISSING on disk (branch is in the bundle)' : `${wt.files} file(s) saved`;
      console.log(`  ${wt.branch ?? '(detached)'}  ${wt.path}  — ${what}`);
    }
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const result = { out: opts.out, repos: opts.repos.map(r => snapshotRepo(r, opts.out)) };
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else report(result);
}

if (require.main === module) {
  try { main(); } catch (err) {
    console.error(`snapshot-worktrees: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { snapshotRepo, parseStatus, listWorktrees, mainCheckoutOf };
