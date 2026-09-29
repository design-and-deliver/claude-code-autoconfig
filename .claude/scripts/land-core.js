// land-core.js — the read-only questions landing a worktree branch has to answer first.
//
// None of these touch a working tree or the index: the conflict check uses
// `git merge-tree --write-tree`, which merges into the object store only, so it is safe to run
// against a main checkout another session is sitting in. Every function takes an explicit
// `mainDir` and runs git with `-C mainDir`, so the caller's cwd never decides which repo answers.
//
// Consumed by land.js (plan substep 3.1). DEV-ONLY (DEV_ONLY_FILES in bin/cli.js + an exact-path
// negation in package.json `files`).

const path = require('path');
const { spawnSync } = require('child_process');

function run(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: (r.stdout || '').replace(/\r/g, '') };
}

function gitOut(dir, args) {
  const r = run(dir, args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${dir} (exit ${r.status})`);
  return r.out.trim();
}

// The main checkout is the parent of the common .git dir, from the main checkout or any worktree.
function mainCheckoutOf(dir) {
  return path.dirname(gitOut(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
}

function isLinkedWorktree(dir) {
  const flags = ['rev-parse', '--path-format=absolute'];
  const gitDir = path.resolve(gitOut(dir, [...flags, '--git-dir']));
  const commonDir = path.resolve(gitOut(dir, [...flags, '--git-common-dir']));
  return gitDir !== commonDir;
}

// --name-only output: the tree id, then one conflicted path per line, then a blank line and the
// informational messages. Exit 0 = clean, 1 = conflicts; anything else is a real error.
function conflictCheck(mainDir, base, branch) {
  const r = run(mainDir, ['merge-tree', '--write-tree', '--name-only', base, branch]);
  if (r.status === 0) return { clean: true };
  if (r.status !== 1) throw new Error(`git merge-tree failed (exit ${r.status})`);
  const lines = r.out.split('\n');
  const end = lines.indexOf('', 1);
  const files = lines.slice(1, end === -1 ? undefined : end).filter(Boolean);
  return { clean: false, files: [...new Set(files)] };
}

// `status --porcelain -z`: each entry is "XY path"; a rename/copy carries its source path as the
// next NUL-separated field, which is dirty too.
function dirtyPaths(mainDir) {
  const out = run(mainDir, ['status', '--porcelain', '-z', '--untracked-files=all']).out;
  const fields = out.split('\0');
  const paths = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (f.length < 4) continue;
    paths.push(f.slice(3));
    if (f[0] === 'R' || f[0] === 'C') paths.push(fields[++i]);
  }
  return paths.filter(Boolean);
}

// Files uncommitted in main that the branch also changes — the merge would refuse, or worse,
// the user's in-progress edit and the branch's change would have to be reconciled by hand.
function dirtyOverlap(mainDir, base, branch) {
  const changed = new Set(
    gitOut(mainDir, ['diff', '--name-only', `${base}...${branch}`]).split('\n').filter(Boolean)
  );
  return [...new Set(dirtyPaths(mainDir))].filter((p) => changed.has(p)).sort();
}

function worktreeFor(mainDir, branch) {
  const want = `branch refs/heads/${branch}`;
  let dir = null;
  for (const line of gitOut(mainDir, ['worktree', 'list', '--porcelain']).split('\n')) {
    if (line.startsWith('worktree ')) dir = line.slice(9).trim();
    else if (line.trim() === want) return dir;
  }
  return null;
}

module.exports = { mainCheckoutOf, isLinkedWorktree, conflictCheck, dirtyOverlap, worktreeFor };
