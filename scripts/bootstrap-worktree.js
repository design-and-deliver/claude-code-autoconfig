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

function installDeps(cwd, report) {
  if (fs.existsSync(path.join(cwd, 'node_modules'))) {
    report.push('  – skipped  npm install (node_modules already present)');
    return;
  }
  report.push('  … running  npm install (eslint — the complexity ratchet needs it)');
  execFileSync(NPM, ['install', '--no-audit', '--no-fund'], { cwd, stdio: 'inherit' });
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
  installDeps(root, report);

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
