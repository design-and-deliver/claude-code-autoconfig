'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Pin `.claude/` to CommonJS so CCA's hooks and scripts run in ESM host repos.
 *
 * Node resolves a `.js` file's module type from the NEAREST package.json. In a host whose root
 * package.json says `"type": "module"`, every CommonJS hook under `.claude/` loads as ESM and dies
 * with `require is not defined in ES module scope`. Hooks fail non-blocking, so nothing surfaces:
 * the title stops painting, and a PreToolUse guard exits 1 — which lets the tool call through.
 * A `.claude/package.json` of `{ "type": "commonjs" }` is the nearer package.json and wins.
 *
 * Written on EVERY install/update, not only when the host is ESM today: a host can turn ESM later
 * (a scaffold adding `"type": "module"` is exactly how this was found). An existing file is never
 * overwritten — one with no `type` already means CommonJS; any other type only gets a warning.
 *
 * @param {string} claudeDir  the project's .claude directory
 * @param {(msg: string) => void} [warn=console.warn]
 * @returns {'written'|'ok'|'conflict'} what happened
 */
function ensureCommonJsScope(claudeDir, warn = console.warn) {
  const file = path.join(claudeDir, 'package.json');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
    return 'written';
  }
  const type = readType(file);
  if (type === undefined || type === 'commonjs') return 'ok';
  warn(`⚠️  .claude/package.json sets "type": ${JSON.stringify(type)} — left unchanged, but CCA's hooks ` +
    'need CommonJS and will not run in an ESM repo. Set "type": "commonjs" in that file.');
  return 'conflict';
}

// The file's `type` value; undefined when absent. Unparseable JSON returns a sentinel string so
// the caller warns rather than guessing — Node itself errors on a malformed package.json.
function readType(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).type;
  } catch (_) {
    return '<unparseable JSON>';
  }
}

module.exports = { ensureCommonJsScope };
