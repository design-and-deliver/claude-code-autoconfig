'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Make CLAUDE.md actually load team feedback, via an `@` import.
 *
 * Older /autoconfig runs pointed at FEEDBACK.md in prose ("Read it at the start of every
 * session…", or earlier "See `.claude/feedback/` for corrections…"). Claude Code never loads a
 * file just because CLAUDE.md mentions it — only an `@path` import is expanded at launch — so
 * that feedback was read only when Claude happened to choose to. This rewrites exactly those
 * shipped pointer lines to the import; anything a user wrote themselves is left alone.
 */

const FEEDBACK_IMPORT = '@.claude/feedback/FEEDBACK.md';

// The pointer lines CCA has shipped in CLAUDE.md, newest first. Whole-line matches only.
const LEGACY_POINTERS = [
  /^The contents of `\.claude\/feedback\/FEEDBACK\.md` are an extension of this file\.\r?\nRead it at the start of every session before taking any action\.$/m,
  /^See `\.claude\/feedback\/` for corrections and guidance from the team\.$/m,
];

/**
 * @param {string} text  CLAUDE.md contents
 * @returns {string|null} rewritten contents, or null when nothing needs to change
 */
function withFeedbackImport(text) {
  if (text.includes(FEEDBACK_IMPORT)) return null;
  const pointer = LEGACY_POINTERS.find((re) => re.test(text));
  return pointer ? text.replace(pointer, FEEDBACK_IMPORT) : null;
}

/**
 * Rewrite <cwd>/CLAUDE.md in place when it carries a legacy feedback pointer and the project has
 * a FEEDBACK.md to import. Never throws — an install must not fail over this.
 *
 * @returns {boolean} true when CLAUDE.md was rewritten
 */
function ensureFeedbackImport(cwd) {
  try {
    if (!fs.existsSync(path.join(cwd, '.claude', 'feedback', 'FEEDBACK.md'))) return false;
    const claudeMdPath = path.join(cwd, 'CLAUDE.md');
    const next = withFeedbackImport(fs.readFileSync(claudeMdPath, 'utf8'));
    if (next === null) return false;
    fs.writeFileSync(claudeMdPath, next);
    return true;
  } catch (_) {
    return false; // no CLAUDE.md, or unreadable — nothing to migrate
  }
}

module.exports = { ensureFeedbackImport, withFeedbackImport, FEEDBACK_IMPORT };
