#!/usr/bin/env node
'use strict';

/**
 * worktree-gate.js — ask before a session's FIRST edit lands in a SHARED main checkout.
 *
 * WHY THIS EXISTS
 * `.claude/rules/parallel-session-worktrees.md` has said "call EnterWorktree first" since
 * 2026-07. On 2026-07-31 03:32 this repo had SIX live sessions and, per `git worktree list`,
 * ZERO worktrees; the same morning three sessions in claude-code-autoconfig interleaved
 * line-by-line edits into one `token-guard.js` and none of them could commit afterwards.
 * Every one of those sessions had read the rule. The rule is not the problem — its TRIGGER is:
 * it asks a session to predict, at minute zero, whether it will later write. A session that
 * opens read-only (a /continue recovery, a log read) answers "no" honestly, then drifts into a
 * write ten minutes later and never re-asks.
 *
 * So this moves the question to the moment it can actually be answered: the first Write/Edit.
 * At that instant "am I about to write?" is not a prediction, it is a fact.
 *
 * WHY `ask` AND NOT `deny`
 * Writing into the main checkout is legitimate and routine — merges land there, and
 * /bundle-prod releases MUST run there. A hard deny would block correct work and teach
 * everyone to disable the hook. `ask` puts the decision in front of the human once, which is
 * all it takes: the failure mode was never that Andrew wanted the collision, it was that
 * nobody was told a collision was happening.
 *
 * WHY THE FIRST EDIT, AND ONLY THE FIRST
 * A worktree checks out clean from HEAD, so uncommitted work does NOT follow it. The moment a
 * session has dirty files the offer is worthless — you cannot retroactively isolate. So the
 * gate gets exactly one shot, at the first repo edit, and marks itself spent whatever the
 * verdict ({sid}.wtgate, beside the session's other title state). It never nags mid-task.
 *
 * FIRES only when ALL of these hold (cheapest test first):
 *   1. the tool is a mutating one with a resolvable target path
 *   2. that path sits in a repo whose `.git` is a DIRECTORY — a worktree's `.git` is a FILE,
 *      so a session that already did the right thing is never gated. Keyed on the file being
 *      written, not on cwd: a session rooted in the main checkout can still be editing into a
 *      worktree, and what matters is which checkout receives the write.
 *   3. the target is not this repo's own hook state (see below)
 *   4. this session has not been gated yet
 *   5. >=1 OTHER session painted a `{sid}.glyph` inside the liveness window — the same 3-min
 *      bar terminal-title.js's dupe guard uses. Own lineage ancestors (pre-/clear ghosts) are
 *      not siblings; they lived in this terminal by construction.
 *
 * WHAT IT DELIBERATELY IGNORES
 * Paths outside the target repo (another repo's files are that repo's problem), and the repo's
 * own `.claude/hooks/.titles/` state — the terminal-title directive has every session writing
 * its title file as turn one's first action, so gating on that would fire the ask in every
 * session before any real work, which is how a useful gate gets uninstalled.
 *
 * OFF SWITCHES: env `CLAUDE_WORKTREE_GATE=off`, or `.claude/cca.config.json` →
 *   `"worktreeGate": { "enabled": false }`
 * Wiring the hook in settings.json IS the opt-in; there is no enable flag to also set.
 *
 * FAIL OPEN: any internal error exits 0 with no output. A PreToolUse hook that throws turns
 * every Edit in the repo into an error, so a broken gate must never block work.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Same bar as terminal-title.js's DUPE_WINDOW_MS and /fleet's LIVE_MS. A session composing a
// long turn can go ~90s between paints; 3 min is the generous read, and generous is the safe
// direction — under-calling liveness is what lets you take an occupied file.
const LIVE_WINDOW_MS = 180000;

const MUTATING = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// Edit/Write/MultiEdit carry file_path; NotebookEdit carries notebook_path.
function targetOf(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  const p = toolInput.file_path || toolInput.notebook_path;
  return typeof p === 'string' && p ? path.resolve(p) : null;
}

// The repo the EDITED FILE lives in. Returns { root, isWorktree } or null when outside a repo.
// A worktree's `.git` is a file containing a gitdir pointer, the main checkout's is a directory
// — that one stat distinguishes them without spawning git on a PreToolUse critical path.
function repoOf(file) {
  let dir = path.dirname(path.resolve(file));
  for (let i = 0; i < 40; i++) {
    let st = null;
    try { st = fs.statSync(path.join(dir, '.git')); } catch { st = null; }
    if (st) return { root: dir, isWorktree: !st.isDirectory() };
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

// Both tiers, project first: a session registers in whichever .titles dir its hook resolved.
function titleDirs(repoRoot) {
  const dirs = [path.join(repoRoot, '.claude', 'hooks', '.titles')];
  const home = path.join(os.homedir(), '.claude', 'hooks', '.titles');
  if (home !== dirs[0]) dirs.push(home);
  return dirs.filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
}

// The sid this one was /clear'd from, read from whichever tier holds the lineage file.
function prevSidOf(dirs, sid) {
  for (const d of dirs) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(d, `${sid}.lineage.json`), 'utf8'));
      if (rec && rec.prevSid) return rec.prevSid;
    } catch { /* try the other tier */ }
  }
  return '';
}

// The sids this session used to BE (prevSid chain in {sid}.lineage.json). Same bounded walk as
// terminal-title.js: rapid /clears stack several ghosts inside the liveness window, and a ghost
// with a still-warm glyph would otherwise read as a concurrent tab.
function lineageAncestors(dirs, sid) {
  const out = new Set();
  let cur = sid;
  for (let hop = 0; hop < 5; hop++) {
    const prev = prevSidOf(dirs, cur);
    if (!prev || prev === sid || out.has(prev)) break;
    out.add(prev);
    cur = prev;
  }
  return out;
}

function readTitle(file) {
  try { return fs.readFileSync(file, 'utf8').trim().split('\n')[0].trim(); } catch { return ''; }
}

// One .glyph filename → a sibling record, or null when it is not a live OTHER session.
function siblingFrom(dir, file, skip, now) {
  if (!file.endsWith('.glyph')) return null;
  const other = file.slice(0, -'.glyph'.length);
  if (!other || skip(other)) return null;
  let at = 0;
  try { at = fs.statSync(path.join(dir, file)).mtimeMs; } catch { return null; }
  if (now - at > LIVE_WINDOW_MS) return null;
  return { sid: other, at, title: readTitle(path.join(dir, `${other}.txt`)) };
}

// Other sessions with a glyph painted inside the window, deduped by sid across both tiers.
function liveSiblings(dirs, sid, now) {
  const ghosts = lineageAncestors(dirs, sid);
  const seen = new Map();
  const skip = (other) => other === sid || ghosts.has(other) || seen.has(other);
  for (const d of dirs) {
    let files = [];
    try { files = fs.readdirSync(d); } catch { continue; }
    for (const f of files) {
      const rec = siblingFrom(d, f, skip, now);
      if (rec) seen.set(rec.sid, rec);
    }
  }
  return [...seen.values()].sort((a, b) => b.at - a.at);
}

function agoStr(ms, now) {
  const s = Math.max(1, Math.round((now - ms) / 1000));
  return s < 90 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

function disabled(repoRoot) {
  if (String(process.env.CLAUDE_WORKTREE_GATE || '').toLowerCase() === 'off') return true;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude', 'cca.config.json'), 'utf8'));
    if (cfg && cfg.worktreeGate && cfg.worktreeGate.enabled === false) return true;
  } catch { /* no config → stay on */ }
  return false;
}

// path.relative gives '' for the dir itself and a '..'-leading path for anything outside it.
function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function reasonFor(target, repoRoot, siblings, now) {
  const rel = path.relative(repoRoot, target).replace(/\\/g, '/');
  const list = siblings
    .slice(0, 4)
    .map((s) => `${s.sid.slice(0, 8)}${s.title ? ` “${s.title}”` : ''} (active ${agoStr(s.at, now)})`)
    .join(', ');
  const more = siblings.length > 4 ? ` +${siblings.length - 4} more` : '';
  return [
    `worktree-gate: this is your first edit of the session and it writes ${rel} in the MAIN `,
    `checkout of ${path.basename(repoRoot)}, with ${siblings.length} live sibling session`,
    `${siblings.length === 1 ? '' : 's'}: ${list}${more}.`,
    '\n\nEditing here risks interleaving with their uncommitted work — last write wins and neither ',
    'side is told. A worktree cannot fix it afterwards, because uncommitted changes do not follow ',
    'one, so this is the only moment the offer is worth anything.',
    '\n\nTo isolate: call EnterWorktree, then run the repo’s bootstrap script, and redo the edit there.',
    '\n\nApprove instead if this write BELONGS in the main checkout — a merge, a release, or a file ',
    'no one else is touching (check `git status --short` first).',
    '\n\nAsked once per session; silence it with CLAUDE_WORKTREE_GATE=off.',
  ].join('');
}

// The main-checkout write this payload represents, or null when the gate has nothing to say:
// a non-mutating tool, an unresolvable target, a path outside any checkout, a worktree (already
// isolated), or a repo that switched the gate off.
function gatedWriteFor(data) {
  if (!MUTATING.has(data.tool_name)) return null;
  const target = targetOf(data.tool_input);
  if (!target) return null;
  const repo = repoOf(target);
  if (!repo || repo.isWorktree || disabled(repo.root)) return null;
  return { target, root: repo.root };
}

// The one shot, spent on the first real repo edit whatever the verdict. A later edit is past the
// point where a worktree could have helped, so re-asking would be pure noise. False = already
// spent (or unreadable, which we treat as spent rather than risk nagging every edit).
function spendOneShot(dir, sid) {
  const marker = path.join(dir, `${sid}.wtgate`);
  try { if (fs.existsSync(marker)) return false; } catch { return false; }
  try { fs.writeFileSync(marker, String(Date.now())); } catch { /* still worth asking once */ }
  return true;
}

// The whole decision: the reason to ask with, or '' to stay silent.
function gateReason(data) {
  const hit = gatedWriteFor(data);
  if (!hit) return '';

  const sid = data.session_id || process.env.CLAUDE_CODE_SESSION_ID;
  if (!sid) return '';            // cannot tell self from sibling → stay silent

  // Checked BEFORE the marker is spent: the title write is turn one's first action in every
  // session, so burning the one shot on it would silence the gate for the real edit that follows.
  if (isInside(hit.target, path.join(hit.root, '.claude', 'hooks', '.titles'))) return '';

  // No session registry → no liveness signal to read.
  const dirs = titleDirs(hit.root);
  if (!dirs.length || !spendOneShot(dirs[0], sid)) return '';

  const now = Date.now();
  const siblings = liveSiblings(dirs, sid, now);
  // No siblings → working alone, and the shared checkout is fine.
  return siblings.length ? reasonFor(hit.target, hit.root, siblings, now) : '';
}

function main() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return;   // unparseable payload is not ours to diagnose
  }

  const reason = gateReason(data);
  if (!reason) return;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  }));
}

try { main(); } catch { /* fail open */ }
process.exit(0);
