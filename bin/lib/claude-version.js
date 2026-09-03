'use strict';

// ============================================================================
// Claude Code minimum-version gate — pure helpers (no I/O; bin/cli.js runs the probe)
//
// CCA ships `"outputStyle": "Concise"` in the project settings it installs. Claude Code
// added the built-in Concise style in v2.1.237; an older binary treats the name as unknown
// and silently falls back to its default style — no error, no Concise, no explanation. So
// the installer refuses to proceed below this floor and tells the user to update, instead
// of installing a setting that quietly does nothing.
//
// Raise MIN_CLAUDE_CODE_VERSION only when a shipped file starts depending on a newer
// Claude Code feature, and name that feature in the comment beside it.
// ============================================================================

const MIN_CLAUDE_CODE_VERSION = '2.1.237'; // built-in "Concise" output style

// First x.y.z in `claude --version` output ("2.1.257 (Claude Code)") as a numeric triple;
// null when the text carries no version at all.
function parseVersion(text) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(text || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// -1 / 0 / 1 for a < b, a == b, a > b over [major, minor, patch] triples.
function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

// The gate verdict for one `claude --version` output. Unparseable output is NOT "too old":
// the floor can't be checked, so the install proceeds (fail open — a gate that blocked on a
// banner format change would lock every user out the day Claude Code rewords it).
function checkClaudeVersion(text, minimum = MIN_CLAUDE_CODE_VERSION) {
  const found = parseVersion(text);
  if (!found) return { found: null, tooOld: false };
  return {
    found: found.join('.'),
    tooOld: compareVersions(found, parseVersion(minimum)) < 0
  };
}

module.exports = { MIN_CLAUDE_CODE_VERSION, parseVersion, compareVersions, checkClaudeVersion };
