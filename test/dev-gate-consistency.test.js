#!/usr/bin/env node
'use strict';

/**
 * dev-gate-consistency.test.js — pins the DEV_ONLY_FILES install gate so its
 * three hand-kept mirrors can never drift from bin/cli.js again.
 *
 * bin/cli.js's DEV_ONLY_FILES (bin/cli.js, one-line literal) is the ONLY real
 * install gate (CLAUDE.md trap: not package.json "files"). Three other places
 * name the same files and used to drift:
 *   (a) the shipped interactive docs (.claude/docs/autoconfig.docs.html) —
 *       drifted at 1 vs 6, so users saw docs for commands they never received;
 *   (b) package.json "files" negations (tarball-shaping only, but any command
 *       file negated there must also be gated by DEV_ONLY_FILES);
 *   (c) validate-cca-install.md's `dev_only` list (else false "MISSING CMD").
 *
 * sync-docs.js now parses (a) straight from DEV_ONLY_FILES; this suite proves it
 * stayed parsed, and pins (b) and (c).
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const cliPath = path.join(repoRoot, 'bin', 'cli.js');
const docsPath = path.join(repoRoot, '.claude', 'docs', 'autoconfig.docs.html');
const pkgPath = path.join(repoRoot, 'package.json');
const validateMdPath = path.join(repoRoot, '.claude', 'commands', 'validate-cca-install.md');

const { test, assert, summary } = require('./_harness');

// The canonical source of truth — parsed exactly as bin/cli.js and sync-docs.js do.
function parseDevOnlyFiles(src) {
  const block = src.match(/const DEV_ONLY_FILES = \[([^\]]+)\]/);
  if (!block) return [];
  return [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

const cliSrc = fs.readFileSync(cliPath, 'utf8');
const DEV_ONLY_FILES = parseDevOnlyFiles(cliSrc);

console.log('============================================================');
console.log('DEV-GATE CONSISTENCY TESTS');
console.log('============================================================');
console.log();

test('DEV_ONLY_FILES parses to a non-empty one-line literal', () => {
  assert(DEV_ONLY_FILES.length > 0,
    'could not parse DEV_ONLY_FILES from bin/cli.js — the literal must stay one line, single-quoted (trap T1)');
});

// (a) The shipped docs must not document ANY dev-only file. This is the live bug
//     substep 2.2 fixed: sync-docs.js drifted and documented five of six.
test('shipped docs HTML documents zero dev-only files', () => {
  const html = fs.readFileSync(docsPath, 'utf8');
  const leaked = DEV_ONLY_FILES.filter(name => html.includes(`<span class="file">${name}</span>`));
  assert(leaked.length === 0,
    `autoconfig.docs.html documents dev-only file(s) users never receive: ${leaked.join(', ')} — re-run \`node .claude/scripts/sync-docs.js\``);
});

// (b) Every command file negated in package.json "files" must also be in the real
//     gate. (The negations only shape the tarball; DEV_ONLY_FILES is what installs.)
test('package.json "files" command negations are all in DEV_ONLY_FILES', () => {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const negatedCmds = (pkg.files || [])
    .filter(f => /^!\.claude\/commands\/.+\.md$/.test(f))
    .map(f => path.basename(f));
  for (const cmd of negatedCmds) {
    assert(DEV_ONLY_FILES.includes(cmd),
      `package.json negates .claude/commands/${cmd} but it is missing from DEV_ONLY_FILES (bin/cli.js) — the real install gate`);
  }
});

// (b2) …and the converse, which (b) alone does not cover. (b) proves the negations are a SUBSET
//      of the gate; nothing proved the gate was covered BY the negations, so a new dev-only file
//      could be correctly gated from installs and still be published inside the tarball. That is
//      how fleet.md/fleet.js (21kB) and refactor.md shipped to npm while (b) stayed green.
//      Publishing them is not a leak — nothing secret is in them, and no user project receives
//      them — but it is dead weight in every install, and the asymmetry is what let it pass
//      unseen. Resolved by real path so a rename cannot satisfy the check by basename alone.
test('every DEV_ONLY_FILES entry on disk is also negated in package.json "files"', () => {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const negated = new Set((pkg.files || []).filter(f => f.startsWith('!')).map(f => f.slice(1)));

  // Walk .claude once; a dev-only name may live under commands/, scripts/, hooks/ or rules/.
  // SKIP .claude/worktrees/ — a git worktree is a nested checkout of this same repo, so every
  // dev-only file appears there a second time under a path that is not part of the package's
  // authored tree. Enumerating those copies here cannot work: `negated` above is a set of EXACT
  // literal paths, so satisfying the check would need a per-path entry for every file in every
  // worktree, and that list would break the moment a worktree is created, renamed or removed.
  // (On 2026-07-30 this reported 13 "leaked" files that were all one locked worktree's copies.)
  // The real tarball leak those copies cause is bigger than the gated files and belongs to the
  // "!.claude/worktrees/**" negation, pinned by (b3) below.
  const found = new Map();
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        const relDir = path.relative(repoRoot, abs).split(path.sep).join('/');
        if (relDir !== '.claude/worktrees') walk(abs);
        continue;
      }
      const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
      if (!found.has(e.name)) found.set(e.name, []);
      found.get(e.name).push(rel);
    }
  })(path.join(repoRoot, '.claude'));

  const leaked = DEV_ONLY_FILES
    .filter(name => (found.get(name) || []).some(rel => !negated.has(rel)))
    .map(name => found.get(name).filter(rel => !negated.has(rel)).join(', '));

  assert(leaked.length === 0,
    `dev-only file(s) ship in the npm tarball — add a "!<path>" entry to package.json "files": ${leaked.join('; ')}`);
});

// (b3) Runtime scratch under .claude/ must never reach the tarball. Every path below is excluded
//      from GIT via .git/info/exclude — but that file is untracked per-machine setup and has no
//      bearing whatsoever on npm, while "files" includes ".claude" wholesale. So each one is a
//      latent publish leak: it ships if and only if the scratch happens to exist at publish time,
//      which is why this needs a test rather than a habit — a clean `npm pack` yesterday proves
//      nothing about today's.
//      Worst case, measured 2026-07-30 with one locked worktree present: .claude/worktrees/ alone
//      put 2,003 files / 19.5 MB in the tarball against 58 files / 693 kB for the real package —
//      97% of it, an entire nested checkout of this repo. Two smaller ones were shipping to users
//      at that point (scheduled_tasks.lock and cross-session-instructions/).
//      The list is hardcoded rather than parsed from .git/info/exclude ON PURPOSE: that file is
//      per-machine and untracked, so a test keyed on it would pass or fail by checkout rather than
//      by defect. Add a path here when you add one there.
const RUNTIME_SCRATCH_DIRS = [
  '.claude/worktrees', '.claude/checkpoints', '.claude/mailbox', '.claude/routines/.state',
  '.claude/cross-session-instructions', '.claude/agent-memory-local',
];
const RUNTIME_SCRATCH_FILES = [
  '.claude/scheduled_tasks.lock', '.claude/scheduled_tasks.json', '.claude/agent-registry.json',
  '.claude/assistant-daemon-state.json', '.claude/first-run',
];

test('package.json "files" negates every runtime-scratch path under .claude/', () => {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const files = new Set(pkg.files || []);
  const missing = [];
  // A directory needs BOTH forms: the bare path stops the dir entry, the /** glob stops its
  // contents. The existing !.claude/hooks/.titles pair is the precedent.
  for (const d of RUNTIME_SCRATCH_DIRS) {
    for (const entry of [`!${d}`, `!${d}/**`]) if (!files.has(entry)) missing.push(entry);
  }
  for (const f of RUNTIME_SCRATCH_FILES) if (!files.has(`!${f}`)) missing.push(`!${f}`);
  assert(missing.length === 0,
    `package.json "files" is missing runtime-scratch negation(s): ${missing.join(', ')} — a publish while that scratch exists would ship it (see (b3))`);
});

// (c) validate-cca-install.md's dev_only list must equal DEV_ONLY_FILES exactly,
//     or the validator reports false "MISSING CMD" errors (substep 1.4).
test('validate-cca-install.md dev_only list equals DEV_ONLY_FILES', () => {
  const md = fs.readFileSync(validateMdPath, 'utf8');
  const block = md.match(/dev_only = \[([^\]]+)\]/);
  assert(block, 'could not find `dev_only = [...]` list in validate-cca-install.md');
  const mdList = [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const a = [...mdList].sort();
  const b = [...DEV_ONLY_FILES].sort();
  assert(JSON.stringify(a) === JSON.stringify(b),
    `validate-cca-install.md dev_only [${a.join(', ')}] != DEV_ONLY_FILES [${b.join(', ')}] — keep them in sync`);
});

summary();
