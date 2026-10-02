#!/usr/bin/env node
'use strict';

/**
 * Tests for .claude/scripts/docs-previews.js (/autoconfig Step 6).
 *
 * Regression pinned: Step 6 used to be a hand splice by the model. On the CRLF docs file a
 * search for '---\n\n' returned -1, the splice started at offset 4, and ~1,500 lines including
 * the opening <script> were deleted (2026-10-01, a Windows user project). These tests run the
 * real shipped docs file — which IS CRLF — through the script and read the previews back by
 * evaluating the spliced literals, so "it didn't throw" is never the only evidence.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, assert, summary } = require('./_harness');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, '.claude', 'scripts', 'docs-previews.js');
const DOCS = path.join(REPO, '.claude', 'docs', 'autoconfig.docs.html');
const { updatePreviews, defaultMemoryPath, valueEnd } = require(SCRIPT);
const { escapeTemplateLiteral } = require(SCRIPT);

// Content that is hostile to every layer: template syntax, structure markers, CRLF-sensitive
// separators and a trailing backslash.
const NASTY = 'Use `npx x` and ${HOME}\n---\n\n## H\n};\n</script><b>\nC:\\path\\';

const raw = fs.readFileSync(DOCS, 'utf8');

// Evaluate fileContents[key].content from the HTML, with memoryPath bound to 'MEM'.
function previewOf(html, key) {
  const lf = html.replace(/\r\n/g, '\n');
  const fc = lf.indexOf('const fileContents = {');
  const keyAt = lf.indexOf(`'${key}': {`, fc);
  const start = lf.indexOf('content: `', keyAt) + 'content: '.length;
  const expr = lf.slice(start, valueEnd(lf, start));
  return new Function('memoryPath', 'return ' + expr)('MEM');
}

function updates(text) {
  return [
    ['claude-md', escapeTemplateLiteral(text), 'CLAUDE.md'],
    ['memory-md', '# Native Claude Code File — Debugging instructions appended by autoconfig\n\n' +
      'Location: ` + memoryPath + `\n\n---\n\n' + escapeTemplateLiteral(text), 'MEMORY.md'],
    ['settings', escapeTemplateLiteral('{ "a": 1 }'), 'settings.json'],
  ];
}

test('shipped docs file is CRLF (the condition that broke the hand splice)', () => {
  assert(raw.includes('\r\n'), 'fixture assumption: autoconfig.docs.html should be CRLF');
});

test('CRLF docs: previews round-trip exactly and the page survives', () => {
  const out = updatePreviews(raw, updates(NASTY));
  assert(out.startsWith('<!DOCTYPE html>'), 'document shell lost');
  assert(!/[^\r]\n/.test(out), 'a bare LF leaked into a CRLF file');
  assert(previewOf(out, 'claude-md') === NASTY, 'claude-md preview differs from source');
  assert(previewOf(out, 'memory-md').endsWith('Location: MEM\n\n---\n\n' + NASTY),
    'memory-md lost its header or content');
  assert(previewOf(out, 'settings') === '{ "a": 1 }', 'settings preview differs');
  const grew = out.split('\n').length - raw.split('\n').length;
  assert(Math.abs(grew) < 200, `line count moved by ${grew} — splice hit the wrong range`);
});

test('LF docs stay LF', () => {
  const lf = raw.replace(/\r\n/g, '\n');
  const out = updatePreviews(lf, updates('hello'));
  assert(!out.includes('\r'), 'CR introduced into an LF file');
  assert(previewOf(out, 'claude-md') === 'hello', 'claude-md preview wrong');
});

test('idempotent: a second run changes nothing', () => {
  const once = updatePreviews(raw, updates(NASTY));
  assert(updatePreviews(once, updates(NASTY)) === once, 'second run changed the file');
});

test('missing anchor throws instead of splicing at a bogus offset', () => {
  const broken = raw.replace("'memory-md': {\r\n                filename: 'MEMORY.md',\r\n                content",
    "'memory-md': {\r\n                filename: 'MEMORY.md',\r\n                body");
  assert(broken !== raw, 'fixture edit did not apply');
  let threw = false;
  try { updatePreviews(broken, updates('x')); } catch { threw = true; }
  assert(threw, 'expected a refusal when the content anchor is gone');
});

test('defaultMemoryPath uses Claude Code project encoding', () => {
  const p = defaultMemoryPath(path.join(path.parse(process.cwd()).root, 'CODE', 'my-project'));
  assert(/[\\/]projects[\\/][A-Za-z-]*-CODE-my-project[\\/]memory[\\/]MEMORY\.md$/.test(p), p);
});

function tmpProject(docsText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-previews-'));
  fs.mkdirSync(path.join(dir, '.claude', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'docs', 'autoconfig.docs.html'), docsText);
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'real `project` notes\n');
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ "env": {} }\n');
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), '## Debugging\nmem\n');
  return dir;
}

const run = dir => spawnSync(process.execPath, [SCRIPT, '--memory', path.join(dir, 'MEMORY.md')],
  { cwd: dir, encoding: 'utf8' });

test('CLI: updates a real project', () => {
  const dir = tmpProject(raw);
  const r = run(dir);
  assert(r.status === 0, 'exit ' + r.status + ': ' + r.stderr);
  const out = fs.readFileSync(path.join(dir, '.claude', 'docs', 'autoconfig.docs.html'), 'utf8');
  assert(previewOf(out, 'claude-md') === 'real `project` notes', 'CLAUDE.md not applied');
  assert(previewOf(out, 'memory-md').endsWith('## Debugging\nmem'), 'MEMORY.md not applied');
  assert(previewOf(out, 'settings') === '{ "env": {} }', 'settings.json not applied');
});

test('CLI: refusal exits 1 and leaves the docs byte-identical', () => {
  const broken = raw.replace('const fileContents = {', 'const fileContentz = {');
  const dir = tmpProject(broken);
  const r = run(dir);
  assert(r.status === 1, 'expected exit 1, got ' + r.status);
  const after = fs.readFileSync(path.join(dir, '.claude', 'docs', 'autoconfig.docs.html'), 'utf8');
  assert(after === broken, 'docs file was modified on refusal');
  assert(fs.readdirSync(path.join(dir, '.claude', 'docs')).length === 1, 'temp file left behind');
});

summary();
