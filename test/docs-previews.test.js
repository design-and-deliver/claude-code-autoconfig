#!/usr/bin/env node
'use strict';

/**
 * Tests for .claude/scripts/docs-previews.js (/autoconfig Step 6) and the docs page's
 * autoconfig.previews.js hook.
 *
 * Regression pinned: Step 6 used to be a hand splice into the page's one big <script>. On the
 * CRLF docs file a search for '---\n\n' returned -1, the splice ran from offset 4, and ~1,500
 * lines including the opening <script> were deleted (2026-10-01, a Windows user project). The
 * fix moves project previews into a separate file the page loads with its own <script src>, so
 * these tests pin: the HTML is never written, the page's own code applies the previews, and a
 * missing or garbage previews value leaves the placeholders in place.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, assert, summary } = require('./_harness');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, '.claude', 'scripts', 'docs-previews.js');
const DOCS = path.join(REPO, '.claude', 'docs', 'autoconfig.docs.html');
const { renderPreviewsFile, verifyPreviewsFile, defaultMemoryPath, GLOBAL } = require(SCRIPT);

// Hostile to every layer: template syntax, the page's structure markers, a closing script tag,
// CRLF-sensitive separators and backslashes.
const NASTY = 'Use `npx x` and ${HOME}\n---\n\n## H\n};\n</script><b>\nC:\\path\\';

const html = fs.readFileSync(DOCS, 'utf8').replace(/\r\n/g, '\n');
const MAIN_OPEN = '<script>\n        const slides';

function mainScript() {
  const open = html.indexOf(MAIN_OPEN) + '<script>'.length;
  return html.slice(open, html.indexOf('</script>', open));
}

// Run the page's own fileContents literal + applyProjectPreviews hook, the same code the
// browser runs, and return the resulting fileContents.
function pageFileContents(win) {
  const body = mainScript();
  const from = body.indexOf('const fileContents = {');
  const endMark = '})(window.' + GLOBAL + ');';
  const to = body.indexOf(endMark) + endMark.length;
  assert(from !== -1 && to > from, 'page is missing fileContents or the previews hook');
  return new Function('window', 'memoryPath', body.slice(from, to) + '\nreturn fileContents;')(win, 'MEM');
}

// What the browser does: evaluate the previews file into window, then run the page.
function pageWith(previews) {
  const win = {};
  new Function('window', renderPreviewsFile(previews))(win);
  return pageFileContents(win);
}

test('page loads autoconfig.previews.js in its OWN script, before the main script', () => {
  const loader = html.indexOf('<script src="autoconfig.previews.js"></script>');
  assert(loader !== -1, 'loader tag missing');
  assert(loader < html.indexOf(MAIN_OPEN), 'loader must run before the main script');
});

test('page main script still parses', () => {
  new Function(mainScript());
});

test('previews round-trip exactly into the page, hostile content included', () => {
  const fc = pageWith({ 'claude-md': NASTY, 'memory-md': NASTY, settings: '{ "a": 1 }' });
  assert(fc['claude-md'].content === NASTY, 'claude-md preview differs from source');
  assert(fc['memory-md'].content.endsWith('Location: MEM\n\n---\n\n' + NASTY), 'memory-md lost header or content');
  assert(fc.settings.content === '{ "a": 1 }', 'settings preview differs');
});

test('no previews file: placeholders stay', () => {
  const fc = pageFileContents({});
  assert(fc['claude-md'].content.includes('/autoconfig'), 'claude-md placeholder changed');
});

test('garbage previews value is ignored, not applied', () => {
  const fc = pageFileContents({ [GLOBAL]: { 'claude-md': 42, 'no-such-key': 'x' } });
  assert(fc['claude-md'].content.includes('/autoconfig'), 'non-string preview was applied');
  assert(!('no-such-key' in fc), 'unknown key was added');
});

test('verifyPreviewsFile rejects a file that does not round-trip', () => {
  let threw = false;
  try { verifyPreviewsFile('window.' + GLOBAL + ' = {};', { 'claude-md': 'x' }); } catch { threw = true; }
  assert(threw, 'expected a mismatch to throw');
});

test('defaultMemoryPath uses Claude Code project encoding', () => {
  const p = defaultMemoryPath(path.join(path.parse(process.cwd()).root, 'CODE', 'my-project'));
  assert(/[\\/]projects[\\/][A-Za-z-]*-CODE-my-project[\\/]memory[\\/]MEMORY\.md$/.test(p), p);
});

function tmpProject(withDocs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-previews-'));
  fs.mkdirSync(path.join(dir, '.claude', 'docs'), { recursive: true });
  if (withDocs) fs.copyFileSync(DOCS, path.join(dir, '.claude', 'docs', 'autoconfig.docs.html'));
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'real `project` notes\r\n');
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ "env": {} }\n');
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), '## Debugging\nmem\n');
  return dir;
}

const run = dir => spawnSync(process.execPath, [SCRIPT, '--memory', path.join(dir, 'MEMORY.md')],
  { cwd: dir, encoding: 'utf8' });

test('CLI: writes the previews file and never touches the HTML', () => {
  const dir = tmpProject(true);
  const docsFile = path.join(dir, '.claude', 'docs', 'autoconfig.docs.html');
  const before = fs.readFileSync(docsFile);
  const r = run(dir);
  assert(r.status === 0, 'exit ' + r.status + ': ' + r.stderr);
  assert(fs.readFileSync(docsFile).equals(before), 'autoconfig.docs.html was modified');
  const win = {};
  new Function('window', fs.readFileSync(path.join(dir, '.claude', 'docs', 'autoconfig.previews.js'), 'utf8'))(win);
  const fc = pageFileContents(win);
  assert(fc['claude-md'].content === 'real `project` notes', 'CLAUDE.md not applied (or CRLF kept)');
  assert(fc['memory-md'].content.endsWith('## Debugging\nmem'), 'MEMORY.md not applied');
  assert(fc.settings.content === '{ "env": {} }', 'settings.json not applied');
  assert(fs.readdirSync(path.join(dir, '.claude', 'docs')).length === 2, 'temp file left behind');
});

test('CLI: no docs installed → exit 0, nothing written', () => {
  const dir = tmpProject(false);
  const r = run(dir);
  assert(r.status === 0, 'exit ' + r.status);
  assert(fs.readdirSync(path.join(dir, '.claude', 'docs')).length === 0, 'wrote into a docs-less project');
});

summary();
