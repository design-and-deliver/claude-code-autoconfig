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

const { test, assert, summary } = require('./_harness');

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
//    reproduce the committed autoconfig.docs.html BYTE-FOR-BYTE, so regenerating is a
//    mechanical, verifiable step rather than a memory-dependent convention.
//
//    sync-docs is idempotent as of substep 3.5 (its treeInfo/fileContents splice no longer
//    double-indents the boundary lines before 'rules' and 'autoconfig-update'), so the raw
//    output is byte-stable and this compares committed vs. regenerated with no tolerance —
//    every content change (a new command, a reworded desc, a changed source preview, any
//    stray indentation) fails the ratchet loudly.
// Copy only what sync-docs.js reads into a throwaway dir: bin/cli.js (its DEV_ONLY_FILES
// source) plus the scanned .claude subtree. Skip volatile/irrelevant hook subdirs — sync-docs
// only scans top-level files in each folder, so tests/.titles/.token-guard are never read anyway.
function makeSyncFixture(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
  return { tmp, claudeDst };
}

function runSyncDocs(tmp, claudeDst) {
  const r = spawnSync(process.execPath, [path.join(claudeDst, 'scripts', 'sync-docs.js')],
    { cwd: tmp, encoding: 'utf8' });
  assert(r.status === 0, `sync-docs.js exited ${r.status}: ${(r.stderr || r.stdout || '').trim()}`);
  return fs.readFileSync(path.join(claudeDst, 'docs', 'autoconfig.docs.html'), 'utf8');
}

test('sync-docs.js reproduces autoconfig.docs.html byte-for-byte (docs ratchet)', () => {
  const { tmp, claudeDst } = makeSyncFixture('cca-ratchet-');
  try {
    const regenerated = runSyncDocs(tmp, claudeDst);
    const committed = fs.readFileSync(docsPath, 'utf8');
    assert(committed === regenerated,
      'autoconfig.docs.html is stale — a scanned command/agent/hook/feedback file changed without a docs regen. Run `node .claude/scripts/sync-docs.js` and commit the result (trap G4).');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 5. Adversarial previews (bug-hunt BH-2, BH-15): the splice anchors on `};` to find the end
//    of treeInfo/fileContents, and the whole page lives in one <script>. A documented file
//    whose preview contains `};` (routine JS) or `</script>` must not mis-anchor the NEXT sync
//    or terminate the script tag early — either one blanks the docs page.
test('sync-docs.js survives a preview containing }; and </script> (BH-2, BH-15)', () => {
  const vm = require('vm');
  const { tmp, claudeDst } = makeSyncFixture('cca-adversarial-');
  try {
    fs.writeFileSync(path.join(claudeDst, 'commands', 'zz-adversarial.md'), [
      '<!-- @description Preview has }; and </script> in it -->',
      '<!-- @version 1 -->',
      '# Adversarial fixture',
      '```js',
      'const cfg = { a: 1 };',
      "const tag = '</script><script>';",
      '```'
    ].join('\n'));
    const first = runSyncDocs(tmp, claudeDst);
    const second = runSyncDocs(tmp, claudeDst);
    assert(first === second, 'second sync differs from the first — a `};` in a preview mis-anchored the splice (BH-2)');
    // Split scripts the way an HTML parser does: the first `</script` ends the block.
    const blocks = [...second.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script/gi)].map(m => m[1]);
    assert(blocks.length === countOccurrences(fs.readFileSync(docsPath, 'utf8'), '<script'),
      'a `</script>` in a preview split the docs <script> block (BH-15)');
    for (const b of blocks) new vm.Script(b); // throws a SyntaxError if the object closed early
    assert(second.includes("'zz-adversarial': {"), 'fixture command missing from generated docs');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 6. Braces inside KEPT structural entries (bug-hunt BH-14): the splice finds the end of the
//    hand-authored 'claude-dir' (treeInfo) and 'claude-md' (fileContents) entries by counting
//    braces, so a lone `{` or `}` in one of their string values mis-locates the boundary. The
//    result must be the committed page with only the edited values changed, stable across syncs.
test('sync-docs.js ignores braces inside kept structural entries (BH-14)', () => {
  const vm = require('vm');
  const { tmp, claudeDst } = makeSyncFixture('cca-kept-braces-');
  try {
    const edits = [
      ["desc: 'Commands, rules, settings, and these docs.", "desc: 'Commands, rules, settings, and these docs { unbalanced."],
      ['> Run \\`/autoconfig\\` to populate', '> Run \\`/autoconfig\\` } to populate']
    ];
    const fixtureDocs = path.join(claudeDst, 'docs', 'autoconfig.docs.html');
    let expected = fs.readFileSync(fixtureDocs, 'utf8');
    for (const [from, to] of edits) {
      assert(countOccurrences(expected, from) === 1, `fixture anchor not unique: ${from}`);
      expected = expected.replace(from, () => to);
    }
    fs.writeFileSync(fixtureDocs, expected);
    const first = runSyncDocs(tmp, claudeDst);
    const second = runSyncDocs(tmp, claudeDst);
    assert(first === expected, 'sync rewrote more than the generated sections — a brace in a kept entry mis-located its end (BH-14)');
    assert(second === first, 'second sync differs from the first (BH-14)');
    for (const m of first.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script/gi)) new vm.Script(m[1]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

summary();
