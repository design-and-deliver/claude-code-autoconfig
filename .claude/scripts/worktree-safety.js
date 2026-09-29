// worktree-safety.js — the only safe way this repo removes a worktree directory.
//
// Shared by sync-worktrees.js (reaping orphans) and, from plan substep 2.2 on, the landing
// tooling. Every removal path here gets the same two protections:
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

module.exports = { unlinkNodeModulesLink, trashOrphan, rmTree, removeDir, safeRemoveWorktree };
