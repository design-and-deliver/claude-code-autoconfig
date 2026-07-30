#!/usr/bin/env node
'use strict';

/**
 * session-close.js — the clean-exit marker, wired to SessionEnd.
 *
 * WHY THIS EXISTS
 * A machine reboot (or any kill) leaves every open session's transcript on disk, so the
 * conversations survive — but nothing on disk says WHICH sessions were still open when the
 * power went. The only available signal is a transcript-mtime cluster, and that signal
 * cannot tell a session you deliberately closed at 06:23 from one the reboot took at 06:23.
 * A restore built on it reopens work you had already finished.
 *
 * SessionEnd fires on every ORDERLY end (quit, /clear, logout) and cannot fire on a kill —
 * the process is gone before any hook runs. So the marker inverts a guess into a fact:
 *
 *     transcript exists AND no {sid}.closed  ==  that session was killed
 *
 * Absence is the signal, which is why this has to be installed BEFORE the crash it explains.
 * A marker that is merely late is harmless (the session reads as killed and gets offered for
 * restore); a marker that never existed is a session silently missing from the roster.
 *
 * WHERE THE MARKER GOES
 * Next to the session's own title state, in whichever .titles dir already holds it — see
 * resolveTitlesDir. This hook is wired at the USER level so it covers every repo, but
 * terminal-title.js's project copy writes that repo's OWN .titles dir; keying off tier here
 * would scatter markers into ~/.claude that a project-tier reader never looks at.
 *
 * DEV-ONLY (DEV_ONLY_FILES in bin/cli.js) — not in user installs. The shipped settings
 * template wires no SessionEnd, so a shipped copy would be an inert file that reads as
 * adoption. Fleet-synced by scripts/sync-hook-fleet.js like its neighbors.
 *
 * Contract: read stdin, write one small file, always exit 0. A hook that throws on the way
 * out is a hook that makes quitting Claude Code look broken.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Files terminal-title.js stamps per session. Any ONE of them proves which .titles dir owns
// this session — .txt alone would miss a session that ended before the model set a title, and
// .session.json is written at SessionStart so it is the earliest of the three.
const SESSION_MARKS = ['.session.json', '.txt', '.history.jsonl'];

function fileExists(p) {
  try { return fs.existsSync(p); } catch (_) { return false; }
}

// Follow the SESSION, not this hook's install tier. terminal-title.js picks its .titles root
// at runtime (user-level copy -> homedir, project copy -> CLAUDE_PROJECT_DIR), so the marker
// must land wherever that decision already put this session's state — otherwise a restore
// reader joining {sid}.closed against {sid}.txt finds them in different directories.
function resolveTitlesDir(cwd, sid) {
  const ownerDir = process.env.CLAUDE_PROJECT_DIR || cwd || process.cwd();
  const projectDir = path.join(ownerDir, '.claude', 'hooks', '.titles');
  const homeDir = path.join(os.homedir(), '.claude', 'hooks', '.titles');
  if (sid) {
    for (const dir of [projectDir, homeDir]) {
      if (SESSION_MARKS.some(ext => fileExists(path.join(dir, sid + ext)))) return dir;
    }
  }
  // No state for this session anywhere — a session that ended before its first title paint.
  // Prefer a .titles dir that already exists (that tier is the one actually running a copy)
  // and fall back to the project dir, which is where a project copy would have written.
  if (fileExists(projectDir)) return projectDir;
  if (fileExists(homeDir)) return homeDir;
  return projectDir;
}

// The marker is JSON rather than a touch-file so a restore roster can read it without a second
// source: `reason` separates a /clear (successor session already carries the work) from a real
// quit, and `cwd` is the directory `claude --resume` has to run in — recoverable from the
// transcript's project slug, but only by decoding a lossy path encoding.
function markerBody(data, sid) {
  return JSON.stringify({
    sid,
    reason: data.reason || 'other',
    ts: new Date().toISOString(),
    cwd: data.cwd || process.cwd(),
    transcript: data.transcript_path || '',
  });
}

function onSessionEnd(data) {
  const sid = data.session_id || '';
  if (!sid) return;                              // nothing to key a marker to
  const dir = resolveTitlesDir(data.cwd, sid);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* ignore */ }
  // Last writer wins: SessionEnd can fire more than once for one sid (a /clear followed by a
  // quit in the same terminal), and the LATEST reason is the one that describes how it really
  // ended. Nothing reads the earlier one.
  fs.writeFileSync(path.join(dir, sid + '.closed'), markerBody(data, sid));
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => (input += chunk));
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);
      // Defensive: this hook is wired to SessionEnd only, but Claude Code grows events over
      // time and a stray one must never stamp a session as cleanly closed while it is live.
      if ((data.hook_event_name || 'SessionEnd') === 'SessionEnd') onSessionEnd(data);
    } catch (_) { /* malformed payload — a missing marker is recoverable, a crash on quit isn't */ }
    process.exit(0);
  });
  process.stdin.on('error', () => process.exit(0));
}

module.exports = { resolveTitlesDir, markerBody, onSessionEnd, SESSION_MARKS };
