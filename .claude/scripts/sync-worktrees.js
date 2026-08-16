#!/usr/bin/env node
// sync-worktrees.js — reap what the worktree loop leaves behind.
//
// The problem it answers: `ExitWorktree remove` de-registers a worktree and THEN deletes its tree.
// On Windows the second half loses — something holds a handle inside node_modules (esbuild, vite, a
// file watcher), the recursive delete aborts partway, and git has already forgotten the entry. The
// result is a directory that no git command will ever mention again:
//
// ⛔ A junctioned node_modules (bootstrap-worktree.js links it to the main checkout's, instead of
// installing) makes the SAME recursive delete dangerous in the opposite direction: proved
// 2026-08-15 that `git worktree remove --force` on a worktree whose node_modules is a Windows
// junction recurses THROUGH it and deletes the real target's contents — the directory itself
// survives, everything inside it is gone. Nothing here can patch git's own removal, so the reap
// step below unlinks a junctioned node_modules on its own BEFORE the recursive delete ever reaches
// it (see unlinkNodeModulesLink). `git worktree remove` / `ExitWorktree remove` get no such
// protection — see the ⛔ trap section in parallel-session-worktrees.md.
//
//   git worktree list      → only the base checkout
//   .git/worktrees/        → empty
//   git worktree prune     → nothing to do
//   .claude/worktrees/     → five full working trees, node_modules and all
//
// So `prune` is NOT the fix here. Orphans are found by walking the worktree base and subtracting
// what git still knows about; they are only ever deleted after every file in them is proven to
// already exist in the object store.
//
// DEV-ONLY (gated out of user installs via DEV_ONLY_FILES in bin/cli.js) — dogfooded from the CCA
// repo like fleet and token-guard.
//
// ⛔ DRY-RUN BY DEFAULT. --write is the only thing that deletes. And it never merges: landing a
// branch is the one operation here that can destroy work across sessions, so it stays a human verb
// (see the LAND marker at the bottom). This is the reaper half of /fleet, nothing more.
//
// Three things get reaped, in ascending order of how much git already helps:
//   1. orphan dirs        — git has forgotten them; we prove-then-delete
//   2. stale registrations — git knows, dir is gone; `git worktree prune`
//   3. merged branches    — fully contained in base; `git branch -d` (refuses if we're wrong)
//
// Usage:
//   node sync-worktrees.js [--project-dir DIR] [--write] [--json] [--keep-branches]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

// ---- args -------------------------------------------------------------
const opts = {
  projectDir: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  write: false,
  json: false,
  keepBranches: false,
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--project-dir') opts.projectDir = argv[++i];
  else if (a === '--write') opts.write = true;
  else if (a === '--json') opts.json = true;
  else if (a === '--keep-branches') opts.keepBranches = true;
}

// A session mid-turn can go ~90s between transcript writes, so the liveness window is generous on
// purpose. Erring long costs us a skipped directory; erring short deletes the tree out from under
// somebody who is still working in it.
const LIVE_MS = 3 * 60_000;
const NOW = Date.now();

// Never walk into these. node_modules is the whole reason the delete failed in the first place, and
// hashing 40k dependency files to decide the fate of a directory git already disowned is absurd.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.vite', 'coverage', '.turbo']);

// Branches we refuse to delete even if git says they're merged.
const PROTECTED = new Set(['main', 'master', 'HEAD']);

// ---- git helpers ------------------------------------------------------
function git(args, cwd = opts.projectDir) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}
function gitTry(args, cwd = opts.projectDir) {
  try { return git(args, cwd); } catch { return null; }
}

let baseDir;
try {
  baseDir = fs.realpathSync(git(['rev-parse', '--show-toplevel']));
} catch {
  console.error('sync-worktrees: not a git repository.');
  process.exit(1);
}
const baseBranch = gitTry(['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD';

// ---- 1. what git still knows about ------------------------------------
// --porcelain gives one "worktree <path>" line per registration, base checkout included.
function registeredTrees() {
  const out = gitTry(['worktree', 'list', '--porcelain']) || '';
  const trees = [];
  let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { dir: line.slice(9).trim(), branch: null, prunable: false };
      trees.push(cur);
    } else if (cur && line.startsWith('branch ')) {
      cur.branch = line.slice(7).replace('refs/heads/', '').trim();
    } else if (cur && line.startsWith('prunable')) {
      cur.prunable = true;
    }
  }
  return trees;
}
const registered = registeredTrees();
const registeredReal = new Set(
  registered.map((t) => { try { return fs.realpathSync(t.dir); } catch { return path.resolve(t.dir); } })
);

// ---- 2. liveness: is a session sitting in this directory? --------------
// Same forward-slugify trick fleet.js uses: a transcript lives at ~/.claude/projects/<slug>/<sid>.jsonl
// where <slug> is the cwd with every non-alphanumeric char replaced by '-'. Decoding the slug is
// lossy, so we slugify the directory we're about to delete and compare forward instead.
function slugify(dir) {
  return dir.replace(/[^a-zA-Z0-9]/g, '-');
}
function newestTranscriptMs(dir) {
  const slug = slugify(dir);
  const projDir = path.join(os.homedir(), '.claude', 'projects', slug);
  let newest = null;
  let names;
  try { names = fs.readdirSync(projDir); } catch { return null; }
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue;
    try {
      const ms = fs.statSync(path.join(projDir, n)).mtimeMs;
      if (newest == null || ms > newest) newest = ms;
    } catch { /* raced with a delete; ignore */ }
  }
  return newest;
}

// ---- 3. prove every file is already in the object store ----------------
function walkFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        stack.push(full);
      } else if (e.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}

// Feed newline-delimited paths on stdin — the arg list for 400+ files blows past Windows' command
// line limit, and chunking it would just be a slower way to reach the same answer.
function runWithStdin(args, input, cwd = opts.projectDir) {
  const r = spawnSync('git', args, {
    cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) return null;
  return { stdout: r.stdout || '', status: r.status };
}

// Gitignored files (crx-key.ts, .env, dev-build-number.json — the three bootstrap-worktree.js
// copies in) are NOT in the object store and never will be. Counting them as "unrecoverable" would
// make every orphan permanently undeletable, so they're filtered out before the object-store check.
// The ignore rules are evaluated against the BASE repo using the same relative paths: .gitignore is
// tracked, so a worktree's copy is byte-identical.
function ignoredSet(root, files) {
  if (!files.length) return new Set();
  const rel = files.map((f) => path.relative(root, f).split(path.sep).join('/'));
  const r = runWithStdin(['check-ignore', '--stdin'], rel.join('\n') + '\n');
  if (!r) return new Set();
  return new Set(r.stdout.split('\n').map((s) => s.trim()).filter(Boolean));
}

// A file counts as recoverable only if hashing it yields a blob git already has. Anything we can't
// prove is treated as unrecoverable — the safe direction, since the consequence is "we keep the
// directory" rather than "we delete unique work".
function unrecoverableFiles(root) {
  const all = walkFiles(root);
  // `walked` is the pre-filter count, and it is the ONLY place SKIP_DIRS is observable: node_modules
  // is gitignored in every real repo, so `checked` reads the same whether the walker skipped it or
  // descended into all 40k files and paid check-ignore on every one.
  const walked = all.length;
  if (!all.length) return { walked, checked: 0, missing: [] };
  const ignored = ignoredSet(root, all);
  const candidates = all.filter(
    (f) => !ignored.has(path.relative(root, f).split(path.sep).join('/'))
  );
  if (!candidates.length) return { walked, checked: 0, missing: [] };

  const hashed = runWithStdin(['hash-object', '--stdin-paths'], candidates.join('\n') + '\n');
  if (!hashed) return { walked, checked: candidates.length, missing: candidates, unknown: true };
  const hashes = hashed.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  if (hashes.length !== candidates.length) {
    return { walked, checked: candidates.length, missing: candidates, unknown: true };
  }

  const checked = runWithStdin(['cat-file', '--batch-check'], hashes.join('\n') + '\n');
  if (!checked) return { walked, checked: candidates.length, missing: candidates, unknown: true };
  const lines = checked.stdout.split('\n').filter(Boolean);
  const missing = [];
  lines.forEach((line, i) => {
    if (/\bmissing\b/.test(line)) missing.push(candidates[i]);
  });
  return { walked, checked: candidates.length, missing };
}

// ---- 4. classify every directory under the worktree base ---------------
const wtBase = path.join(baseDir, '.claude', 'worktrees');
const trashDir = path.join(wtBase, '.trash');
const orphans = [];
let baseNames = [];
try {
  baseNames = fs.readdirSync(wtBase, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== '.trash').map((e) => e.name);
} catch { /* no worktree base yet — fine */ }

for (const name of baseNames) {
  const dir = path.join(wtBase, name);
  let real;
  try { real = fs.realpathSync(dir); } catch { real = path.resolve(dir); }
  if (registeredReal.has(real)) continue;           // a live worktree; not ours to touch

  const rec = { name, dir, hasGit: fs.existsSync(path.join(dir, '.git')) };
  const live = newestTranscriptMs(real);
  rec.sessionAgeMs = live == null ? null : NOW - live;
  rec.held = live != null && NOW - live < LIVE_MS;

  if (rec.held) {
    rec.verdict = 'HELD';
    rec.reason = 'a session wrote here in the last 3 min';
  } else {
    const { walked, checked, missing, unknown } = unrecoverableFiles(dir);
    rec.walked = walked;
    rec.checked = checked;
    rec.missing = missing.map((f) => path.relative(dir, f).split(path.sep).join('/'));
    if (unknown) {
      rec.verdict = 'BLOCKED';
      rec.reason = 'could not verify contents against the object store';
    } else if (missing.length) {
      rec.verdict = 'BLOCKED';
      rec.reason = `${missing.length} file(s) exist only here`;
    } else {
      rec.verdict = 'REAP';
      rec.reason = `${checked} files, all already in git`;
    }
  }
  orphans.push(rec);
}

// ---- 4.5. .trash sweep — survivors of a failed delete, retried every run ----
// Excluded from the orphan scan above (baseNames filters '.trash' out) so the trash dir
// itself is never classified as an orphan on the next run.
const trashItems = [];
try {
  for (const name of fs.readdirSync(trashDir)) {
    const dir = path.join(trashDir, name);
    let ageMs = null;
    try { ageMs = NOW - fs.statSync(dir).mtimeMs; } catch { /* stat race — leave age unknown */ }
    trashItems.push({ name, dir, ageMs });
  }
} catch { /* no .trash yet — fine */ }

// ---- 5. stale registrations + merged branches -------------------------
const prunable = registered.filter((t) => t.prunable).map((t) => t.dir);

const checkedOut = new Set(registered.map((t) => t.branch).filter(Boolean));
let mergedBranches = [];
if (!opts.keepBranches) {
  const out = gitTry(['branch', '--merged', baseBranch, '--format=%(refname:short)']) || '';
  mergedBranches = out.split('\n').map((s) => s.trim()).filter(Boolean)
    .filter((b) => !PROTECTED.has(b) && b !== baseBranch && !checkedOut.has(b));
}

// A junction/symlink node_modules must be unlinked on its own BEFORE any recursive delete of the
// worktree that contains it. Unlinking the link itself never touches the target — rmdir on
// Windows removes just the reparse point, unlink on POSIX removes just the symlink — but a
// recursive walk that doesn't special-case reparse points follows it and deletes the real
// content on the other end (proved 2026-08-15 against the main checkout's real node_modules).
function unlinkNodeModulesLink(dir) {
  const nm = path.join(dir, 'node_modules');
  let st;
  try {
    st = fs.lstatSync(nm);
  } catch {
    return; // no node_modules here — nothing to protect
  }
  if (!st.isSymbolicLink()) return; // a real directory is safe to recurse into normally
  if (process.platform === 'win32') fs.rmdirSync(nm);
  else fs.unlinkSync(nm);
}

// ---- 6. act (only under --write) --------------------------------------
const actions = [];

// A directory `fs.rmSync` couldn't fully remove is renamed into `.trash/` instead of left in
// place — NTFS usually allows renaming a dir with open handles even when deleting it is denied
// (agy §8), which covers the ordinary Node/esbuild-style locks this exists for. It is not
// universal: a handle opened without FILE_SHARE_DELETE also blocks the rename, in which case
// this falls through to PARTIAL below — a strict superset of the old delete-only behavior,
// never a regression.
function trashOrphan(o, reason) {
  try {
    fs.mkdirSync(trashDir, { recursive: true });
    const dest = path.join(trashDir, `${o.name}-${Date.now()}`);
    fs.renameSync(o.dir, dest);
    o.verdict = 'TRASHED';
    o.trashPath = dest;
    actions.push(`TRASHED ${o.name} — ${reason}, moved to .trash/ for retry`);
  } catch (e2) {
    o.verdict = 'PARTIAL';
    o.error = String(e2.message || e2);
    actions.push(`PARTIAL ${o.name} — rename to .trash/ also failed (${o.error})`);
  }
}

if (opts.write) {
  for (const o of orphans.filter((x) => x.verdict === 'REAP')) {
    try {
      unlinkNodeModulesLink(o.dir);
      // maxRetries/retryDelay is the whole point on Windows: EBUSY from a watcher that is on its
      // way out succeeds on the second or third swing.
      fs.rmSync(o.dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      o.deleted = !fs.existsSync(o.dir);
      if (o.deleted) actions.push(`deleted ${o.name}`);
      else trashOrphan(o, 'some files survived the delete (still locked)');
    } catch (e) {
      o.error = String(e.message || e);
      trashOrphan(o, `delete failed (${o.error})`);
    }
  }
  // Same unlink-then-rmSync protection as above (⛔5 — remove a junction link, never recurse
  // through it) applied to whatever previous runs already parked in .trash/.
  for (const t of trashItems) {
    try {
      unlinkNodeModulesLink(t.dir);
      fs.rmSync(t.dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      t.deleted = !fs.existsSync(t.dir);
      actions.push(t.deleted
        ? `swept .trash/${t.name}`
        : `still locked .trash/${t.name} — left for next sweep`);
    } catch (e) {
      t.error = String(e.message || e);
      actions.push(`still locked .trash/${t.name} — ${t.error}`);
    }
  }
  if (prunable.length) {
    gitTry(['worktree', 'prune']);
    actions.push(`pruned ${prunable.length} stale registration(s)`);
  }
  for (const b of mergedBranches) {
    // -d, never -D: if our merge math is wrong, git refuses and we learn about it here.
    const r = spawnSync('git', ['branch', '-d', b], { cwd: opts.projectDir, encoding: 'utf8' });
    actions.push(r.status === 0
      ? `deleted branch ${b}`
      : `kept branch ${b} — git refused (${(r.stderr || '').trim().split('\n')[0]})`);
  }
}

// ---- 7. report --------------------------------------------------------
if (opts.json) {
  console.log(JSON.stringify({
    base: { dir: baseDir, branch: baseBranch },
    mode: opts.write ? 'write' : 'dry-run',
    orphans, prunable, mergedBranches, trashItems, actions,
  }, null, 2));
  process.exit(0);
}

function fmtAgo(ms) {
  if (ms == null) return 'never';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const L = [];
const reapN = orphans.filter((o) => o.verdict === 'REAP').length;
L.push(`SYNC-WORKTREES — ${opts.write ? 'WRITE' : 'dry run'} · ${orphans.length} orphan dir` +
       `${orphans.length === 1 ? '' : 's'} · ${trashItems.length} in .trash · ` +
       `${prunable.length} stale reg · ` +
       `${mergedBranches.length} merged branch${mergedBranches.length === 1 ? '' : 'es'}`);
L.push(`base: ${baseBranch} at ${baseDir}`);
L.push('');

const GLYPH = {
  REAP: '✓ REAP   ', BLOCKED: '⚠ BLOCKED', HELD: '● HELD   ',
  PARTIAL: '⚠ PARTIAL', TRASHED: '↪ TRASHED',
};
if (orphans.length) {
  L.push('ORPHAN DIRECTORIES  (git has forgotten these — prune will never see them)');
  for (const o of orphans) {
    L.push(`  ${GLYPH[o.verdict] || o.verdict}  ${o.name.padEnd(24)} ${o.reason}`);
    if (o.verdict === 'HELD') L.push(`             last session write ${fmtAgo(o.sessionAgeMs)}`);
    if (o.verdict === 'TRASHED') L.push(`             moved to ${path.relative(baseDir, o.trashPath)}`);
    for (const f of (o.missing || []).slice(0, 5)) L.push(`             only here: ${f}`);
    if ((o.missing || []).length > 5) L.push(`             (+${o.missing.length - 5} more)`);
  }
  L.push('');
}

if (trashItems.length) {
  L.push('TRASH  (.trash/ — survivors of a failed delete; retried on every --write run)');
  for (const t of trashItems) {
    L.push(`  ${(t.deleted ? '✓ swept  ' : '● waiting')}  ${t.name.padEnd(24)} parked ${fmtAgo(t.ageMs)}`);
  }
  L.push('');
}

if (prunable.length) {
  L.push('STALE REGISTRATIONS  (git knows them, the directory is gone)');
  for (const d of prunable) L.push(`  ${d}`);
  L.push('');
}

if (mergedBranches.length) {
  L.push(`MERGED BRANCHES  (fully contained in ${baseBranch})`);
  for (const b of mergedBranches) L.push(`  ${b}`);
  L.push('');
}

if (actions.length) {
  L.push('ACTIONS TAKEN');
  for (const a of actions) L.push(`  ${a}`);
  L.push('');
}

if (!orphans.length && !prunable.length && !mergedBranches.length && !trashItems.length) {
  L.push('Nothing to reap. Worktree base is clean.');
} else if (!opts.write) {
  const bits = [];
  if (reapN) bits.push(`${reapN} director${reapN === 1 ? 'y' : 'ies'}`);
  if (trashItems.length) bits.push(`${trashItems.length} .trash retr${trashItems.length === 1 ? 'y' : 'ies'}`);
  if (prunable.length) bits.push(`${prunable.length} registration(s)`);
  if (mergedBranches.length) bits.push(`${mergedBranches.length} branch(es)`);
  L.push(`Dry run — nothing changed. --write would remove ${bits.join(', ') || 'nothing'}.`);
}

console.log(L.join('\n'));

// LAND (deferred): landing an unlanded branch is NOT here on purpose. It needs a per-session
// handoff record — "what I finished, what's unlanded, what blocks it" — that nothing currently
// writes. Inferring it from a branch name and a diff is the guess that loses work. Once
// {sid}.handoff.json exists next to the title files, join it with `fleet.js --json` and the
// zero-conflict subset becomes landable; the conflicting subset stays a human's call, always.
