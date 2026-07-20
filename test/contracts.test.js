#!/usr/bin/env node
'use strict';

/**
 * contracts.test.js — pins the repo's machine-read PROSE contracts so a weak-model
 * edit that breaks one fails loudly here instead of shipping silently. Each assertion
 * guards a convention that today survives only by discipline:
 *
 *   1. Every command .md carries a parseable <!-- @version N --> (trap T6: an unbumped
 *      edit still ships but vanishes from users' upgrade reports).
 *   2. .claude/updates/ numbering is append-only: IDs unique, no 002-* (retired
 *      tombstone), README's "next free" counter exceeds every existing ID (02-4.10).
 *   3. README documents every shipped command (C8 — makes substep 1.2's fix durable).
 *   4. Docs ratchet: sync-docs.js run against a pristine copy reproduces the committed
 *      autoconfig.docs.html byte-for-byte — regenerating is no longer a memory-dependent
 *      convention (02-5.1, trap G4).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const commandsDir = path.join(repoRoot, '.claude', 'commands');
const updatesDir = path.join(repoRoot, '.claude', 'updates');
const readmePath = path.join(repoRoot, 'README.md');
const cliPath = path.join(repoRoot, 'bin', 'cli.js');
const docsPath = path.join(repoRoot, '.claude', 'docs', 'autoconfig.docs.html');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.log(`✗ ${name}`); console.log(`  Error: ${e.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m); }

// DEV_ONLY_FILES + deprecated aliases, parsed straight from bin/cli.js source — the same
// single source of truth the other suites read, never a hand-kept copy (trap T1).
const cliSrc = fs.readFileSync(cliPath, 'utf8');
function parseCliList(name) {
  const block = cliSrc.match(new RegExp('const ' + name + ' = \\[([^\\]]+)\\]'));
  return block ? [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [];
}
const DEV_ONLY_FILES = parseCliList('DEV_ONLY_FILES');
const DEPRECATED_ALIASES = parseCliList('DEPRECATED_COMMAND_ALIASES');

console.log('============================================================');
console.log('PROSE-CONTRACT TESTS');
console.log('============================================================');
console.log();

// 1. @version parseable on every command file (trap T6).
test('every .claude/commands/*.md has a parseable <!-- @version N -->', () => {
  assert(DEV_ONLY_FILES.length > 0,
    'could not parse DEV_ONLY_FILES from bin/cli.js — the literal must stay one line, single-quoted (trap T1)');
  const missing = fs.readdirSync(commandsDir)
    .filter(f => f.endsWith('.md'))
    .filter(f => !/<!-- @version \d+ -->/.test(fs.readFileSync(path.join(commandsDir, f), 'utf8')));
  assert(missing.length === 0,
    `command file(s) missing a parseable <!-- @version N -->: ${missing.join(', ')} (trap T6 — an unbumped edit vanishes from upgrade reports)`);
});

// 2. .claude/updates numbering is append-only (02-4.10).
test('.claude/updates numbering is append-only (unique IDs, no 002, next-free > max)', () => {
  const files = fs.readdirSync(updatesDir).filter(f => /^\d{3}-.*\.md$/.test(f));
  const ids = files.map(f => parseInt(f.slice(0, 3), 10));
  assert(new Set(ids).size === ids.length, `duplicate update IDs among ${files.join(', ')}`);
  assert(!ids.includes(2),
    '002-* is a retired tombstone — never refill it (see .claude/updates/README.md)');
  const readme = fs.readFileSync(path.join(updatesDir, 'README.md'), 'utf8');
  const nf = readme.match(/[Nn]ext available number:\s*`?(\d{3})`?/);
  assert(nf, 'could not find "Next available number: NNN" in .claude/updates/README.md');
  const nextFree = parseInt(nf[1], 10);
  const maxId = Math.max(0, ...ids);
  assert(nextFree > maxId,
    `.claude/updates/README.md "next free" (${nextFree}) must exceed the highest existing ID (${maxId}) — reused numbers are silently skipped by installs`);
});

// 3. README lists every shipped command (C8 — makes 1.2 durable).
test('README.md documents every shipped command', () => {
  const shipped = fs.readdirSync(commandsDir)
    .filter(f => f.endsWith('.md'))
    .filter(f => !DEV_ONLY_FILES.includes(f))
    .filter(f => !DEPRECATED_ALIASES.includes(f))
    .map(f => f.replace(/\.md$/, ''));
  const readme = fs.readFileSync(readmePath, 'utf8');
  const missing = shipped.filter(name => !new RegExp('/' + name + '(?![a-z0-9-])').test(readme));
  assert(missing.length === 0,
    `README.md is missing shipped command(s): ${missing.map(n => '/' + n).join(', ')} (C8)`);
});

// 4. Docs ratchet (02-5.1, trap G4): sync-docs.js run against a pristine copy must
//    reproduce the committed autoconfig.docs.html, so regenerating is a mechanical,
//    verifiable step rather than a memory-dependent convention.
//
//    Caveat — sync-docs is NOT yet idempotent: its treeInfo/fileContents splice grows a
//    pathological leading-whitespace run (hundreds of spaces) on the boundary lines before
//    'rules' and 'autoconfig-update' by a fixed amount every run, so raw output is never
//    byte-stable. Fixing that generator quirk is deferred to substep 3.4 (Phase 3 owns all
//    sync-docs hardening; trap 3 warns against touching the splice from a test substep). We
//    therefore collapse runs of >=64 spaces — a length no legitimate line ever has — to a
//    fixed token on both sides before comparing. That neutralizes ONLY the known quirk;
//    every real content change (a new command, a reworded desc, a changed source preview,
//    ordinary indentation) still fails the ratchet loudly. Tighten this to a byte-for-byte
//    compare once 3.4 makes sync-docs idempotent.
const collapseWsQuirk = s => s.replace(/\r\n/g, '\n').replace(/ {64,}/g, '<<WS-RUN>>');
test('sync-docs.js reproduces autoconfig.docs.html (docs ratchet, tolerant of the 3.4 space-run quirk)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-ratchet-'));
  try {
    // Copy only what sync-docs.js reads: bin/cli.js (its DEV_ONLY_FILES source) plus the
    // scanned .claude subtree. Skip volatile/irrelevant hook subdirs — sync-docs only scans
    // top-level files in each folder, so tests/.titles/.token-guard are never read anyway.
    fs.mkdirSync(path.join(tmp, 'bin'));
    fs.copyFileSync(cliPath, path.join(tmp, 'bin', 'cli.js'));
    const claudeSrc = path.join(repoRoot, '.claude');
    const claudeDst = path.join(tmp, '.claude');
    const skip = new Set(['tests', '.titles', '.token-guard']);
    const filter = src => !skip.has(path.basename(src));
    for (const d of ['docs', 'commands', 'agents', 'hooks', 'feedback', 'scripts', 'rules']) {
      const s = path.join(claudeSrc, d);
      if (fs.existsSync(s)) fs.cpSync(s, path.join(claudeDst, d), { recursive: true, filter });
    }
    for (const f of ['settings.json', '.mcp.json']) {
      const s = path.join(claudeSrc, f);
      if (fs.existsSync(s)) fs.copyFileSync(s, path.join(claudeDst, f));
    }
    const r = spawnSync(process.execPath, [path.join(claudeDst, 'scripts', 'sync-docs.js')],
      { cwd: tmp, encoding: 'utf8' });
    assert(r.status === 0, `sync-docs.js exited ${r.status}: ${(r.stderr || r.stdout || '').trim()}`);
    const regenerated = collapseWsQuirk(fs.readFileSync(path.join(claudeDst, 'docs', 'autoconfig.docs.html'), 'utf8'));
    const committed = collapseWsQuirk(fs.readFileSync(docsPath, 'utf8'));
    assert(committed === regenerated,
      'autoconfig.docs.html is stale — a scanned command/agent/hook/feedback file changed without a docs regen. Run `node .claude/scripts/sync-docs.js` and commit the result (trap G4).');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

console.log();
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
