#!/usr/bin/env node
'use strict';

/**
 * docs-previews.js — /autoconfig Step 6: put this project's real CLAUDE.md, MEMORY.md and
 * settings.json into the preview entries of .claude/docs/autoconfig.docs.html.
 *
 * Step 6 used to tell the model to find the `fileContents` object and splice the text in by
 * hand. On a CRLF copy of the docs a hand-written `indexOf('---\n\n')` returned -1, the splice
 * ran from offset 4, and ~1,500 lines (the opening <script> included) were deleted — the page
 * rendered as raw JS text. This script owns the surgery instead:
 *   - LF-normalizes before searching and restores the file's EOL on write (as sync-docs.js does);
 *   - fails loudly when an anchor is missing or ambiguous, before touching anything;
 *   - re-parses the page's <script> and checks the document shell, and writes only if both pass
 *     (temp file + rename, so a crash never leaves a half-written page).
 * A failure leaves the docs exactly as they were — the placeholders are harmless.
 *
 * Usage (from the project root):
 *     node .claude/scripts/docs-previews.js [--memory <path-to-MEMORY.md>]
 * Exit 0 = updated (or nothing to update), 1 = refused; the docs file is untouched on 1.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const FC_MARKER = 'const fileContents = {';
const MEMORY_HEADER = '# Native Claude Code File — Debugging instructions appended by autoconfig\n\n' +
  'Location: ` + memoryPath + `\n\n---\n\n';

// Same escapes as sync-docs.js escapeTemplateLiteral() + neutralizeStructure(): content must
// read back as the same characters inside a template literal, and must never contain `};`
// (sync-docs anchors the end of fileContents on it) or `</script` (ends the page's one script).
function escapeTemplateLiteral(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
    .replace(/\};/g, '\\u007d;')
    .replace(/<\/(script)/gi, '<\\/$1');
}

// Claude Code's project-dir encoding: every non-alphanumeric char becomes '-'
// (C:\CODE\my-project → C--CODE-my-project).
function defaultMemoryPath(projectDir) {
  const encoded = path.resolve(projectDir).replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', encoded, 'memory', 'MEMORY.md');
}

// Index just past the template literal whose opening backtick is at `i`.
function literalEnd(html, i) {
  for (let j = i + 1; j < html.length; j++) {
    if (html[j] === '\\') { j++; continue; }
    if (html[j] === '`') return j + 1;
  }
  throw new Error('unterminated template literal at offset ' + i);
}

// End of a `content:` value: one literal, or literals joined by ` + identifier + `
// (memory-md's value is `...` + memoryPath + `...`).
const JOIN = /^ \+ [A-Za-z_$][\w$]* \+ `/;
function valueEnd(html, i) {
  let end = literalEnd(html, i);
  let m = JOIN.exec(html.slice(end, end + 80));
  while (m) {
    end = literalEnd(html, end + m[0].length - 1);
    m = JOIN.exec(html.slice(end, end + 80));
  }
  return end;
}

function fileContentsAt(html) {
  const at = html.indexOf(FC_MARKER);
  if (at === -1) throw new Error('anchor not found: fileContents');
  if (html.indexOf(FC_MARKER, at + 1) !== -1) throw new Error('anchor not unique: fileContents');
  return at;
}

// Replace the `content:` value of fileContents[key] with a new template literal.
function replaceEntry(html, key, literalBody) {
  const fcAt = fileContentsAt(html);
  const keyAt = html.indexOf(`'${key}': {`, fcAt);
  if (keyAt === -1) throw new Error(`anchor not found: fileContents['${key}']`);
  const contentAt = html.indexOf('content: `', keyAt);
  const nextEntry = html.indexOf('\n            },', keyAt);
  if (contentAt === -1 || (nextEntry !== -1 && contentAt > nextEntry)) {
    throw new Error(`fileContents['${key}'] has no template-literal content`);
  }
  const start = contentAt + 'content: '.length;
  return html.slice(0, start) + '`' + literalBody + '`' + html.slice(valueEnd(html, start));
}

function scriptBody(html) {
  const open = html.lastIndexOf('<script>');
  const close = html.lastIndexOf('</script>');
  if (open === -1 || close < open) throw new Error('page <script> block not found');
  return html.slice(open + '<script>'.length, close);
}

// The page must still be a whole document whose script compiles.
function validate(before, after) {
  if (!after.startsWith(before.slice(0, 15))) throw new Error('document shell changed');
  const count = (s, re) => (s.match(re) || []).length;
  if (count(after, /<script\b/gi) !== count(before, /<script\b/gi)) {
    throw new Error('<script> tag count changed');
  }
  try {
    new Function(scriptBody(after));
  } catch (e) {
    throw new Error('page script no longer parses: ' + e.message);
  }
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
}

// Build the list of [key, literalBody, label] for every source file that exists.
function collectUpdates(projectDir, memoryPath) {
  const sources = [
    ['claude-md', path.join(projectDir, 'CLAUDE.md'), '', 'CLAUDE.md'],
    ['memory-md', memoryPath, MEMORY_HEADER, 'MEMORY.md'],
    ['settings', path.join(projectDir, '.claude', 'settings.json'), '', 'settings.json'],
  ];
  const updates = [];
  for (const [key, file, prefix, label] of sources) {
    const text = readIfExists(file);
    if (text !== null) updates.push([key, prefix + escapeTemplateLiteral(text.trimEnd()), label]);
  }
  return updates;
}

// Pure transform: returns the new HTML (in the input's EOL) or throws, never half-applies.
function updatePreviews(rawHtml, updates) {
  const eol = rawHtml.includes('\r\n') ? '\r\n' : '\n';
  const before = rawHtml.replace(/\r\n/g, '\n');
  let html = before;
  for (const [key, body] of updates) html = replaceEntry(html, key, body);
  validate(before, html);
  return eol === '\r\n' ? html.replace(/\n/g, '\r\n') : html;
}

function writeAtomic(file, content) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function parseArgs(argv) {
  const i = argv.indexOf('--memory');
  return { memory: i !== -1 ? argv[i + 1] : null };
}

function main() {
  const projectDir = process.cwd();
  const docsPath = path.join(projectDir, '.claude', 'docs', 'autoconfig.docs.html');
  if (!fs.existsSync(docsPath)) {
    console.log('No .claude/docs/autoconfig.docs.html — nothing to update.');
    return 0;
  }
  const memoryPath = parseArgs(process.argv.slice(2)).memory || defaultMemoryPath(projectDir);
  const updates = collectUpdates(projectDir, memoryPath);
  try {
    const raw = fs.readFileSync(docsPath, 'utf8');
    const next = updatePreviews(raw, updates);
    if (next !== raw) writeAtomic(docsPath, next);
  } catch (e) {
    console.error('docs-previews: left the docs unchanged — ' + e.message);
    return 1;
  }
  console.log('Docs previews updated: ' + (updates.map(u => u[2]).join(', ') || 'none'));
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { updatePreviews, escapeTemplateLiteral, defaultMemoryPath, valueEnd };
