#!/usr/bin/env node
'use strict';

/**
 * bootstrap-worktree.js — make a fresh `.claude/worktrees/<name>` checkout usable.
 *
 * DEV-ONLY. `scripts/` is not in package.json `files`, so nothing here ships to users.
 *
 * A worktree starts from a git ref, which means it has every TRACKED file and NO gitignored
 * one. In this repo the gitignored set is not incidental — it is where the dev box keeps its
 * permissions, its npm-publish command, and its hook-fleet list. Without them a worktree
 * session re-prompts on every Bash call, `npm test` dies in the complexity ratchet (it loads
 * eslint from node_modules), and `scripts/sync-hook-fleet.js` has no fleet to check.
 *
 * Run it once, from inside the worktree, before the first edit:
 *     node scripts/bootstrap-worktree.js
 *
 * See .claude/rules/parallel-session-worktrees.md for the surrounding loop.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Gitignored files copied from the main checkout. Each is optional — a box that never made
// one just skips it. Order is cosmetic (it is the report order).
const COPY_FILES = [
  '.claude/settings.local.json',              // permissions — without it every Bash call re-prompts
  '.claude/cca.config.json',                  // this repo's own CCA config (e.g. /gls screenshot dir)
  '.claude/commands/deploy-to-npmjs.md',      // dev-only publish command
  'scripts/hook-fleet.local.json',            // fleet list for sync-hook-fleet.js…
  'scripts/terminal-title-fleet.local.json',  // …and its pre-rename fallback name
];

// (directory, filename filter) pairs copied wholesale — per-install opt-in flags.
const COPY_MATCHING = [
  ['.claude/sounds', name => name.endsWith('.enabled')],
];

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Absolute path of the MAIN checkout — `git worktree list` always prints it first. */
function mainCheckout(cwd) {
  const first = git(['worktree', 'list', '--porcelain'], cwd).split(/\r?\n/)[0] || '';
  const match = first.match(/^worktree (.+)$/);
  if (!match) throw new Error('could not parse `git worktree list --porcelain`');
  return path.resolve(match[1]);
}

function copyOne(relPath, from, to, report) {
  const src = path.join(from, relPath);
  if (!fs.existsSync(src)) return report.push(`  – skipped  ${relPath} (not on the main checkout)`);
  const dest = path.join(to, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  report.push(`  ✓ copied   ${relPath}`);
}

function copyMatching(dir, accept, from, to, report) {
  const srcDir = path.join(from, dir);
  if (!fs.existsSync(srcDir)) return;
  for (const name of fs.readdirSync(srcDir).filter(accept)) {
    copyOne(`${dir}/${name}`, from, to, report);
  }
}

/** True only if both lockfiles exist and are byte-identical. */
function lockfilesMatch(root, main_) {
  const rootLock = path.join(root, 'package-lock.json');
  const mainLock = path.join(main_, 'package-lock.json');
  if (!fs.existsSync(rootLock) || !fs.existsSync(mainLock)) return false;
  return fs.readFileSync(rootLock).equals(fs.readFileSync(mainLock));
}

function installDeps(cwd, main_, report) {
  const nodeModulesPath = path.join(cwd, 'node_modules');
  let existing = null;
  try {
    existing = fs.lstatSync(nodeModulesPath);
  } catch {
    // doesn't exist — fall through to junction/install decision below
  }

  if (existing) {
    // lstat (not existsSync) so a junction is caught even if its target is gone —
    // existsSync follows the link and would report a broken junction as absent (⛔6).
    report.push(
      existing.isSymbolicLink()
        ? '  – skipped  npm install (node_modules is already a junction — never install through it)'
        : '  – skipped  npm install (node_modules already present)'
    );
    return;
  }

  // Opt-in only — see "⛔ node_modules junction is opt-in, not automatic" in
  // parallel-session-worktrees.md. Confirmed 2026-08-15 that `git worktree remove --force`
  // — the path `ExitWorktree remove` and every manual cleanup uses — recurses through a
  // Windows junction and deletes the REAL target's contents, not just the link.
  // sync-worktrees.js's own --write sweep now guards against this, but that protects only
  // its own removal path, not native git or ExitWorktree. Until that's solved repo-wide,
  // junctioning is opt-in and off by default so a routine bootstrap can't leave a worktree
  // that silently destroys the main checkout's node_modules when it's later removed.
  const mainNodeModules = path.join(main_, 'node_modules');
  if (process.env.CCA_UNSAFE_NODE_MODULES_JUNCTION === '1') {
    if (fs.existsSync(mainNodeModules) && lockfilesMatch(cwd, main_)) {
      fs.symlinkSync(mainNodeModules, nodeModulesPath, 'junction');
      report.push(`  ✓ junction node_modules → ${mainNodeModules} (CCA_UNSAFE_NODE_MODULES_JUNCTION=1)`);
      return;
    }
  }

  const reason = !fs.existsSync(mainNodeModules)
    ? 'no node_modules in main checkout'
    : process.env.CCA_UNSAFE_NODE_MODULES_JUNCTION !== '1'
      ? 'junction is opt-in — see ⛔9 in parallel-session-worktrees.md'
      : 'package-lock.json differs from main checkout';
  report.push(`  – fallback npm install (${reason})`);
  // Node >= 18.20 / 20.12 refuses to spawn a .cmd without a shell (EINVAL, CVE-2024-27980),
  // so on Windows npm.cmd has to go through one.
  execFileSync(NPM, ['install', '--no-audit', '--no-fund'],
    { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  report.push('  ✓ done     npm install');
}

function main() {
  const here = process.cwd();
  const root = git(['rev-parse', '--show-toplevel'], here).replace(/\//g, path.sep);
  const main_ = mainCheckout(here);

  if (path.resolve(root) === main_) {
    console.log('Not in a worktree — this IS the main checkout. Nothing to bootstrap.');
    return;
  }

  console.log(`Bootstrapping worktree: ${root}`);
  console.log(`Source (main checkout): ${main_}`);
  console.log();

  const report = [];
  for (const rel of COPY_FILES) copyOne(rel, main_, root, report);
  for (const [dir, accept] of COPY_MATCHING) copyMatching(dir, accept, main_, root, report);
  installDeps(root, main_, report);

  console.log(report.join('\n'));
  console.log();
  console.log('Ready. Reminder: sync-hook-fleet --write, npm version, and npm publish stay');
  console.log('on the main checkout (.claude/rules/parallel-session-worktrees.md).');
}

try {
  main();
} catch (err) {
  console.error(`bootstrap-worktree failed: ${err.message}`);
  process.exitCode = 1;
}
