'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Keep FEEDBACK.md to live feedback only.
 *
 * CLAUDE.md imports FEEDBACK.md, so every line in it is in context every session. v1.0.239's
 * /extract-rules left a "→ Moved to rule" pointer behind for each converted entry — useful to the
 * team, useless to Claude (the rule loads on its own), and the list only ever grows. Pointers now
 * live in EXTRACTED.md beside it, which nothing imports. This moves any pointers an earlier run
 * left behind, and rewrites the shipped header sentence that told Claude to write them.
 */

const EXTRACTED_TEMPLATE = [
  '<!-- @description Log of FEEDBACK.md entries /extract-rules turned into .claude/rules/ files. Not imported by CLAUDE.md, so it never costs context. -->',
  '',
  '# Extracted Feedback',
  '',
  'Team feedback that became a path-scoped rule. Each line links the rule that now carries it.',
  '',
  '---',
  '',
  '',
].join('\n');

const OLD_HEADER = 'except to replace an entry /extract-rules turned into a rule with a pointer line to that rule.';
const NEW_HEADER = 'except to remove an entry /extract-rules turned into a rule (EXTRACTED.md, next to this file, logs where each one went).';

const POINTER_RE = /^-\s*→\s*Moved to rule\b/;

/**
 * @param {string} text  FEEDBACK.md contents
 * @returns {{ feedback: string, pointers: string[] } | null} null when nothing needs to change
 */
function splitPointers(text) {
  const lines = text.split(/\r?\n/);
  const sep = lines.findIndex((l) => l.trim() === '---');
  const pointers = lines.filter((l, i) => i > sep && POINTER_RE.test(l.trim()));
  const header = text.includes(OLD_HEADER);
  if (!pointers.length && !header) return null;
  const kept = lines.filter((l, i) => !(i > sep && POINTER_RE.test(l.trim())));
  return { feedback: kept.join('\n').replace(OLD_HEADER, NEW_HEADER), pointers: pointers.map((l) => l.trim()) };
}

/**
 * Append log lines to <feedbackDir>/EXTRACTED.md, creating it from the template when absent.
 */
function appendExtracted(feedbackDir, lines) {
  const file = path.join(feedbackDir, 'EXTRACTED.md');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : EXTRACTED_TEMPLATE;
  const base = current.endsWith('\n') ? current : `${current}\n`;
  fs.writeFileSync(file, `${base}${lines.join('\n')}\n`);
}

/**
 * Move legacy pointer lines out of <cwd>/.claude/feedback/FEEDBACK.md. Never throws — an install
 * must not fail over this.
 *
 * @returns {number} pointers moved (0 also when only the header was rewritten, or nothing changed)
 */
function migrateFeedbackPointers(cwd) {
  try {
    const dir = path.join(cwd, '.claude', 'feedback');
    const file = path.join(dir, 'FEEDBACK.md');
    if (!fs.existsSync(file)) return 0;
    const split = splitPointers(fs.readFileSync(file, 'utf8'));
    if (!split) return 0;
    if (split.pointers.length) appendExtracted(dir, split.pointers);
    fs.writeFileSync(file, split.feedback);
    return split.pointers.length;
  } catch (_) {
    return 0;
  }
}

module.exports = { migrateFeedbackPointers, splitPointers, EXTRACTED_TEMPLATE, OLD_HEADER, NEW_HEADER };
