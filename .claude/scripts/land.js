#!/usr/bin/env node
'use strict';

// land.js — land a worktree branch into the main checkout: conflict-checked merge, safe worktree
// removal, branch delete, push. Backs the /land command.
//
//   node .claude/scripts/land.js <branch> [--base main] [--no-push] [--keep-worktree] [--dry-run] [--json]
//
// Steps, in order, stopping at the first failure:
//   1. preflight  — run from the main checkout, which is on --base; the branch exists
//   2. conflicts  — `git merge-tree`, which never touches a working tree (land-core.js)
//   3. overlap    — files uncommitted in main that the branch also changes: another session's
//                   in-progress work. Never resolved here — no stash, no checkout.
//   4. merge      — --ff-only, falling back to a merge commit
//   5. worktree   — safeRemoveWorktree (junction-safe, never forced); a dirty worktree is left
//   6. branch     — `git branch -d` (never -D)
//   7. push       — `git push origin <base>`; in CCA the pre-push hook runs the full suite
// --dry-run stops after step 3 and says what 4–7 would do.
//
// Exit codes: 0 ok · 1 usage/preflight/unexpected · 2 conflicts · 3 dirty overlap ·
//             4 run from inside a worktree · 5 cleanup failed AFTER the merge · 6 push failed
//
// DEV-ONLY (DEV_ONLY_FILES in bin/cli.js + an exact-path negation in package.json `files`).

const path = require('path');
const { spawnSync } = require('child_process');
const core = require('./land-core');
const { safeRemoveWorktree } = require('./worktree-safety');

const EXIT = { ok: 0, usage: 1, conflict: 2, overlap: 3, inWorktree: 4, cleanup: 5, push: 6 };
const USAGE = 'usage: node .claude/scripts/land.js <branch> [--base main] [--no-push] [--keep-worktree] [--dry-run] [--json]';
const FLAGS = { '--no-push': 'noPush', '--keep-worktree': 'keepWorktree', '--dry-run': 'dryRun', '--json': 'json' };

function parseArgs(argv) {
  const opts = { branch: null, base: 'main', noPush: false, keepWorktree: false, dryRun: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') opts.base = argv[++i];
    else if (FLAGS[a]) opts[FLAGS[a]] = true;
    else if (a.startsWith('-') || opts.branch) return { error: `unexpected argument: ${a}\n${USAGE}` };
    else opts.branch = a;
  }
  if (!opts.branch || !opts.base) return { error: USAGE };
  return opts;
}

function git(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

const firstLine = (s) => String(s || '').split('\n')[0];

function makeReport(json) {
  const steps = [];
  const add = (step, ok, detail) => {
    steps.push({ step, ok, detail });
    if (!json) console.log(`${ok ? '✓' : '✗'} ${step}: ${detail}`);
  };
  return { steps, add };
}

// ---- 1. preflight ----

function preflightProblem(dir, { branch, base }) {
  if (core.isLinkedWorktree(dir)) {
    return [EXIT.inWorktree, 'Run /land from the main checkout — call ExitWorktree keep first.'];
  }
  if (git(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).status !== 0) {
    return [EXIT.usage, `no local branch "${branch}"`];
  }
  const head = git(dir, ['symbolic-ref', '--short', '-q', 'HEAD']).out;
  if (head !== base) return [EXIT.usage, `the main checkout is on "${head || 'a detached HEAD'}", not "${base}"`];
  return null;
}

function preflight(ctx) {
  const problem = preflightProblem(ctx.dir, ctx.opts);
  if (problem) {
    ctx.report.add('preflight', false, problem[1]);
    return problem[0];
  }
  const { branch, base } = ctx.opts;
  const ahead = git(ctx.dir, ['rev-list', '--count', `${base}..${branch}`]).out;
  ctx.report.add('preflight', true, `${branch} → ${base}, ${ahead} commit(s) to land`);
  return null;
}

// ---- 2–3. read-only checks ----

function checkConflicts(ctx) {
  const r = core.conflictCheck(ctx.dir, ctx.opts.base, ctx.opts.branch);
  if (r.clean) {
    ctx.report.add('conflicts', true, 'merges cleanly');
    return null;
  }
  ctx.report.add('conflicts', false, `would conflict in: ${r.files.join(', ')}`);
  return EXIT.conflict;
}

function checkOverlap(ctx) {
  const files = core.dirtyOverlap(ctx.dir, ctx.opts.base, ctx.opts.branch);
  if (!files.length) {
    ctx.report.add('overlap', true, 'no uncommitted file in main is touched by the branch');
    return null;
  }
  ctx.report.add('overlap', false,
    `another session's uncommitted work overlaps this merge — not touching it: ${files.join(', ')}`);
  return EXIT.overlap;
}

// ---- dry run: say what 4–7 would do, then stop ----

function plannedActions(ctx) {
  const { branch, base, keepWorktree, noPush } = ctx.opts;
  const ff = git(ctx.dir, ['merge-base', '--is-ancestor', base, branch]).status === 0;
  const wt = core.worktreeFor(ctx.dir, branch);
  const removesWt = wt && !keepWorktree;
  return [
    `merge ${branch} into ${base} (${ff ? 'fast-forward' : 'merge commit'})`,
    removesWt ? `remove worktree ${wt}` : `keep worktree ${wt || '(none holds this branch)'}`,
    wt && !removesWt ? `keep branch ${branch} (still checked out)` : `delete branch ${branch}`,
    noPush ? 'skip push (--no-push)' : `push origin ${base}`,
  ];
}

function dryRunStop(ctx) {
  if (!ctx.opts.dryRun) return null;
  ctx.report.add('dry-run', true, `would ${plannedActions(ctx).join('; ')}`);
  return EXIT.ok;
}

// ---- 4. merge ----

function merge(ctx) {
  const { dir, opts: { branch, base } } = ctx;
  if (git(dir, ['merge', '--ff-only', branch]).status === 0) {
    ctx.report.add('merge', true, `fast-forwarded ${base} to ${branch}`);
    return null;
  }
  const r = git(dir, ['merge', '--no-edit', branch]);
  if (r.status === 0) {
    ctx.report.add('merge', true, `merged ${branch} into ${base} (merge commit)`);
    return null;
  }
  // Only abort a merge that actually started — `merge --abort` with no MERGE_HEAD is a no-op
  // error, and the check keeps it from ever touching anything else.
  if (git(dir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).status === 0) git(dir, ['merge', '--abort']);
  ctx.report.add('merge', false, `git merge failed, nothing landed: ${firstLine(r.err || r.out)}`);
  return EXIT.usage;
}

// ---- 5–7. after the merge — every failure message says the merge landed ----

function removeWorktree(ctx) {
  const { dir, opts, report } = ctx;
  if (opts.keepWorktree) {
    report.add('worktree', true, 'kept (--keep-worktree)');
    return null;
  }
  const wt = core.worktreeFor(dir, opts.branch);
  if (!wt) {
    report.add('worktree', true, 'none holds this branch');
    return null;
  }
  if (git(wt, ['status', '--porcelain']).out) {
    report.add('worktree', true, `skipped: ${wt} has uncommitted changes — left in place`);
    return null;
  }
  const r = safeRemoveWorktree(dir, wt, path.join(path.dirname(wt), '.trash'));
  if (r.ok) {
    report.add('worktree', true, `removed ${wt}${r.how === 'trash' ? ' (leftover moved to .trash)' : ''}`);
    return null;
  }
  report.add('worktree', false, `the merge landed, but removing ${wt} failed: ${r.error} — run /sync-worktrees`);
  return EXIT.cleanup;
}

function deleteBranch(ctx) {
  const { dir, opts: { branch }, report } = ctx;
  const holder = core.worktreeFor(dir, branch);
  if (holder) {
    report.add('branch', true, `kept ${branch}: still checked out in ${holder}`);
    return null;
  }
  const r = git(dir, ['branch', '-d', branch]);
  if (r.status === 0) {
    report.add('branch', true, `deleted ${branch}`);
    return null;
  }
  report.add('branch', false, `the merge landed, but git branch -d failed: ${firstLine(r.err)}`);
  return EXIT.cleanup;
}

function push(ctx) {
  const { dir, opts: { base, noPush }, report } = ctx;
  if (noPush) {
    report.add('push', true, 'skipped (--no-push)');
    return null;
  }
  // git's own stdout goes to our stderr so --json output stays one parseable object.
  const r = spawnSync('git', ['-C', dir, 'push', 'origin', base], { stdio: ['inherit', 2, 'inherit'] });
  if (r.status === 0) {
    report.add('push', true, `pushed origin ${base}`);
    return null;
  }
  report.add('push', false, `the merge landed locally, but git push exited ${r.status}`);
  return EXIT.push;
}

const PIPELINE = [preflight, checkConflicts, checkOverlap, dryRunStop, merge, removeWorktree, deleteBranch, push];

function land(opts, dir) {
  const report = makeReport(opts.json);
  const ctx = { opts, dir, report };
  let code = EXIT.ok;
  try {
    for (const step of PIPELINE) {
      const r = step(ctx);
      if (r !== null) { code = r; break; }
    }
  } catch (e) {
    report.add('error', false, firstLine(e.message || e));
    code = EXIT.usage;
  }
  return { code, steps: report.steps };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error(opts.error);
    return EXIT.usage;
  }
  const { code, steps } = land(opts, process.cwd());
  if (opts.json) console.log(JSON.stringify({ branch: opts.branch, base: opts.base, steps }, null, 2));
  return code;
}

if (require.main === module) process.exitCode = main();

module.exports = { parseArgs, land, EXIT };
