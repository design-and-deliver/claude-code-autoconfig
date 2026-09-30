// worktree-safety.js — the only safe way this repo removes a worktree directory.
//
// Shared by sync-worktrees.js (reaping orphans, reclaiming merged worktrees) and the landing
// tooling. reclaimVerdict() below is the gate for removing a REGISTERED worktree unasked. Every removal path here gets the same two protections:
//
//   1. ⛔ A junction/symlink node_modules is unlinked on its own BEFORE any recursive delete.
//      `git worktree remove --force` and a naive recursive delete both follow the link and empty
//      the real target — proved 2026-08-15 against the main checkout's real node_modules.
//   2. Windows file locks. A watcher on its way out (esbuild, vite) makes the delete fail with
//      EBUSY; retries cover most of that, and a directory that still won't delete is renamed into
//      a trash folder, which NTFS usually allows even when deleting is denied.
//
// DEV-ONLY (DEV_ONLY_FILES in bin/cli.js + an exact-path negation in package.json `files`).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RM_OPTS = { recursive: true, force: true, maxRetries: 8, retryDelay: 250 };

// Unlinking the link itself never touches the target — rmdir on Windows removes just the reparse
// point, unlink on POSIX removes just the symlink — but a recursive walk that doesn't special-case
// reparse points follows it and deletes the real content on the other end. Returns the link's
// target (so a caller can put it back) or null when there was no link.
function unlinkNodeModulesLink(dir) {
  const nm = path.join(dir, 'node_modules');
  let st;
  try {
    st = fs.lstatSync(nm);
  } catch {
    return null; // no node_modules here — nothing to protect
  }
  if (!st.isSymbolicLink()) return null; // a real directory is safe to recurse into normally
  const target = fs.readlinkSync(nm);
  if (process.platform === 'win32') fs.rmdirSync(nm);
  else fs.unlinkSync(nm);
  return target;
}

function relinkNodeModules(dir, target) {
  if (!target) return;
  try {
    fs.symlinkSync(target, path.join(dir, 'node_modules'), 'junction');
  } catch { /* best effort — the target itself is untouched either way */ }
}

// Renames `dir` into `trashRoot` and returns the new path. Throws when the rename fails too (a
// handle opened without FILE_SHARE_DELETE blocks renaming as well as deleting).
function trashOrphan(dir, trashRoot, name = path.basename(dir)) {
  fs.mkdirSync(trashRoot, { recursive: true });
  const dest = path.join(trashRoot, `${name}-${Date.now()}`);
  fs.renameSync(dir, dest);
  return dest;
}

// Unlink-then-rmSync, no fallback. { deleted, error } — error only when rmSync threw.
function rmTree(dir) {
  try {
    unlinkNodeModulesLink(dir);
    fs.rmSync(dir, RM_OPTS);
    return { deleted: !fs.existsSync(dir) };
  } catch (e) {
    return { deleted: false, error: String(e.message || e) };
  }
}

// rmTree, then the trash fallback for whatever survived.
//   how: 'deleted' | 'trashed' (trashPath) | 'failed' (trashError)
//   rmError: set when the delete itself threw, whatever happened next
function removeDir(dir, trashRoot, name) {
  const rm = rmTree(dir);
  const res = { how: 'deleted', rmError: rm.error };
  if (rm.deleted) return res;
  try {
    res.trashPath = trashOrphan(dir, trashRoot, name);
    res.how = 'trashed';
  } catch (e) {
    res.how = 'failed';
    res.trashError = String(e.message || e);
  }
  return res;
}

function samePath(a, b) {
  const norm = (p) => {
    let r;
    try { r = fs.realpathSync(p); } catch { r = path.resolve(p); }
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

function isRegistered(mainDir, wtPath) {
  const r = spawnSync('git', ['-C', mainDir, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
  return (r.stdout || '').split('\n')
    .filter((l) => l.startsWith('worktree '))
    .some((l) => samePath(l.slice('worktree '.length).trim(), wtPath));
}

// Removes a registered worktree without ever forcing. git refuses a dirty or locked worktree, and
// that refusal is final: the result is ok:false and the worktree (junction included) is left as it
// was. Only when git has already de-registered the worktree but lost the race with a file lock —
// the Windows half-delete sync-worktrees exists to reap — is the leftover directory removed here.
//   { ok, how: 'git' | 'trash' | 'failed', error }
function safeRemoveWorktree(mainDir, wtPath, trashRoot) {
  const linkTarget = unlinkNodeModulesLink(wtPath);
  const r = spawnSync('git', ['-C', mainDir, 'worktree', 'remove', wtPath], { encoding: 'utf8' });
  if (r.status === 0 && !fs.existsSync(wtPath)) return { ok: true, how: 'git' };
  const error = (r.stderr || '').trim().split('\n')[0] || `git exited ${r.status}`;
  if (isRegistered(mainDir, wtPath)) {
    relinkNodeModules(wtPath, linkTarget);
    return { ok: false, how: 'failed', error };
  }
  if (!fs.existsSync(wtPath)) return { ok: true, how: 'git' };
  const rd = removeDir(wtPath, trashRoot);
  spawnSync('git', ['-C', mainDir, 'worktree', 'prune'], { encoding: 'utf8' });
  if (rd.how === 'failed') return { ok: false, how: 'failed', error: rd.trashError };
  return { ok: true, how: 'trash' };
}

// ---- reclaim: is a REGISTERED worktree finished with? -----------------
// Long enough that a plan session idling while the user reads isn't mistaken for a finished one.
const RECLAIM_IDLE_MS = 30 * 60_000;
// bootstrap-worktree.js copies settings.local.json into every worktree and Claude Code rewrites it
// as permissions are granted — in a repo that tracks it, a changed copy is churn, not work.
const CHURN_RE = /(^|\/)\.claude\/settings\.local\.json$/;

function gitOut(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

// Porcelain "XY path" lines. ⛔ Never trim the whole output first: the first line's leading space
// IS its X column, and losing it shifts that path by one char (the JAE reclaim bug, Ledger 4.1).
// --untracked-files=all, or a new .claude/ folder collapses to "?? .claude/" and hides the churn.
function statusLines(dir) {
  const out = gitOut(dir, ['status', '--porcelain', '--untracked-files=all']);
  if (out == null) return null;
  return out.split('\n').filter(Boolean).map((l) => ({ xy: l.slice(0, 2), file: l.slice(3) }));
}

function isInside(child, parent) {
  const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  const rel = path.relative(norm(parent), norm(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function mergedGuard(mainDir, tree, baseBranch) {
  if (!tree.branch) return { guard: 'merged', ok: false, why: 'detached HEAD' };
  const r = spawnSync('git', ['-C', mainDir, 'merge-base', '--is-ancestor', tree.branch, baseBranch]);
  return { guard: 'merged', ok: r.status === 0, why: `${tree.branch} not in ${baseBranch}` };
}

function cleanGuard(dir) {
  const lines = statusLines(dir);
  if (lines == null) return { guard: 'clean', ok: false, why: 'git status failed' };
  const real = lines.filter((l) => !CHURN_RE.test(l.file));
  return { guard: 'clean', ok: real.length === 0, why: `${real.length} changed path(s)` };
}

function idleGuard(newestMs, now) {
  const idleMs = newestMs == null ? Infinity : now - newestMs;
  return { guard: 'idle', ok: idleMs >= RECLAIM_IDLE_MS, why: `session wrote ${Math.round(idleMs / 60_000)}m ago` };
}

// Every guard is evaluated, never short-circuited, so a dry run can say which one kept a worktree.
//   tree: { dir, branch, locked }   ctx: { baseBranch, newestMs, now, cwd }
function reclaimVerdict(mainDir, tree, ctx) {
  const guards = [
    mergedGuard(mainDir, tree, ctx.baseBranch),
    cleanGuard(tree.dir),
    { guard: 'unlocked', ok: !tree.locked, why: 'locked' },
    idleGuard(ctx.newestMs, ctx.now),
    { guard: 'not-cwd', ok: !isInside(ctx.cwd, tree.dir), why: 'this process runs inside it' },
  ];
  const failed = guards.filter((g) => !g.ok).map((g) => ({ guard: g.guard, why: g.why }));
  return { verdict: failed.length ? 'KEEP' : 'RECLAIM', passed: guards.filter((g) => g.ok).map((g) => g.guard), failed };
}

// git refuses to remove a worktree with modified or untracked files, and the clean guard let the
// settings.local.json churn through — so put that one file back before asking git.
function discardChurn(dir) {
  for (const l of statusLines(dir) || []) {
    if (!CHURN_RE.test(l.file)) continue;
    if (l.xy === '??') fs.rmSync(path.join(dir, l.file), { force: true });
    else gitOut(dir, ['checkout', 'HEAD', '--', l.file]);
  }
}

module.exports = {
  unlinkNodeModulesLink, trashOrphan, rmTree, removeDir, safeRemoveWorktree,
  reclaimVerdict, discardChurn, RECLAIM_IDLE_MS,
};
