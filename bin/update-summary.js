'use strict';

/**
 * update-summary.js — renders the "what changed" summary shown on the installer's
 * upgrade path (right before the ENTER prompt).
 *
 * Pure + side-effect free so it can be unit-tested without executing the installer
 * (cli.js runs its whole flow on require, so its inline logic can't be imported).
 *
 * formatUpdateSummary() returns an array of { kind, text } segments; the caller
 * (cli.js) maps kind -> color + indent:
 *   'latest'  -> already on the newest version (a single line, no feature relist)
 *   'heading' -> "What's new since your last update (v…):"
 *   'group'   -> "New features" / "Fixes & improvements"
 *   'item'    -> one change bullet
 *   'more'    -> "… and N more" overflow line
 *
 * Source of truth is CHANGELOG.md ("## vX.Y.Z" headers, "- type(scope): summary" bullets).
 */

const MAX_ITEMS = 12;
// Conventional-commit types that are housekeeping, not user-facing features/fixes.
const SKIP_TYPES = new Set(['chore', 'docs', 'test', 'ci', 'build', 'style']);

function parseVersion(v) {
  return String(v || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
}

// -1 if a < b, 0 if equal, 1 if a > b (segment-wise numeric compare).
function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// Parse "## vX.Y.Z" sections -> [{ ver, items: [rawBullet, ...] }] in file order (newest first).
function parseChangelog(text) {
  const entries = [];
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line.startsWith('## v')) {
      cur = { ver: line.slice(3).trim(), items: [] };
      entries.push(cur);
    } else if (cur && line.startsWith('- ')) {
      cur.items.push(line.slice(2).trim());
    }
  }
  return entries;
}

function capitalize(s) {
  s = String(s || '').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// "feat(scope): do a thing" -> { type: 'feat', text: 'Do a thing' }
function classifyBullet(raw) {
  const m = String(raw).match(/^(\w+)(?:\([^)]*\))?:\s*(.*)$/);
  if (!m) return { type: 'other', text: capitalize(raw) };
  return { type: m[1].toLowerCase(), text: capitalize(m[2]) };
}

function formatUpdateSummary(previousVersion, currentVersion, changelogText) {
  // Already current — a re-run. One confirmation line, no feature relist.
  if (previousVersion && compareVersions(previousVersion, currentVersion) === 0) {
    return [{ kind: 'latest', text: `You're already on the latest version (v${currentVersion})` }];
  }

  const entries = parseChangelog(changelogText);

  // Which versions to describe:
  //   known older prev -> everything newer than prev (since your last update)
  //   unknown prev      -> just the current version's own entry
  let relevant, heading;
  if (previousVersion) {
    relevant = entries.filter(e => compareVersions(e.ver, previousVersion) > 0);
    heading = `What's new since your last update (v${previousVersion}):`;
  } else {
    relevant = entries.filter(e => compareVersions(e.ver, currentVersion) === 0);
    heading = `This install includes (v${currentVersion}):`;
  }

  // Split bullets into two buckets, dropping housekeeping types.
  const features = [], fixes = [];
  for (const e of relevant) {
    for (const raw of e.items) {
      const c = classifyBullet(raw);
      if (SKIP_TYPES.has(c.type)) continue;
      (c.type === 'feat' ? features : fixes).push(c.text);
    }
  }

  // Upgrade with nothing user-facing (e.g. all housekeeping) — just confirm the bump.
  if (features.length === 0 && fixes.length === 0) {
    return [{ kind: 'latest', text: `Updated to v${currentVersion}` }];
  }

  const out = [{ kind: 'heading', text: heading }];
  let shown = 0, overflow = 0;

  function emitGroup(label, items) {
    if (items.length === 0) return;
    const take = items.slice(0, Math.max(0, MAX_ITEMS - shown));
    overflow += items.length - take.length;
    if (take.length === 0) return; // no room left; counted toward overflow
    out.push({ kind: 'group', text: label });
    for (const t of take) { out.push({ kind: 'item', text: t }); shown++; }
  }

  emitGroup('New features', features);
  emitGroup('Fixes & improvements', fixes);

  if (overflow > 0) out.push({ kind: 'more', text: `… and ${overflow} more (see CHANGELOG.md)` });

  return out;
}

module.exports = { formatUpdateSummary, compareVersions, parseChangelog, classifyBullet };
