#!/usr/bin/env node
/**
 * arcade-beeps — optional Pole-Position status cues for the Claude Code tab.
 * Companion to terminal-title.js. Registered (settings.json) on Stop + Notification.
 *
 * OFF unless the enable flag exists:  <install>/.claude/sounds/status-beeps.enabled
 *   toggle via  /enable-status-beeps   /disable-status-beeps
 * (The legacy flag arcade-beeps.enabled is still honored so installs that enabled beeps
 * before the status-beeps rename keep beeping after an upgrade; the deprecated
 * /enable-arcade-beeps + /disable-arcade-beeps aliases now write/remove the new flag.
 * This FILE keeps its arcade-beeps.js name — every installed settings.json points at it.)
 * The flag lives beside THIS install's sounds dir, so it is PER-PROJECT: a fresh
 * `npx claude-code-autoconfig` install never beeps until /enable-status-beeps is run in that
 * project. (A copy of this hook living in ~/.claude/hooks keys off ~/.claude/sounds — a
 * deliberate consequence: a global install gets a global toggle.)
 *
 * Mapping (matches the ◐/✻ tab glyph that terminal-title.js paints on the SAME event):
 *   Stop, turn ended on a question   -> ◐ awaiting  -> get-ready tick (pp3-getready-G4.wav, G4/384Hz)
 *   Stop, turn ended normally         -> ✻ complete  -> GO beep        (pp3-go-F#5.wav, F#5/759Hz)
 *   Notification (permission_prompt) -> ◐ awaiting  -> get-ready tick
 *
 * Tones are an extracted+smoothed take on the Pole Position race-start cue (arcade-ping
 * envelope). LOWER tick = awaiting, HIGHER GO = complete.
 *
 * Assets resolve relative to THIS file (../sounds) so a per-project CCA install finds its own
 * copy at <project>/.claude/sounds — no dependency on a global sounds dir.
 *
 * Playback is cross-platform and best-effort: PowerShell SoundPlayer on Windows, afplay on
 * macOS, paplay||aplay on Linux. If none is present the hook simply stays silent — never errors.
 *
 * Playback BLOCKS (spawnSync) so the sound finishes inside the hook's lifetime — a detached
 * fire-and-forget child can be killed by the hook runner's job/process-group cleanup before it
 * plays. Blocking costs ~0.5s on turn-end but is reliable. Still fail-safe: wrapped so it never
 * throws into the turn, and every path ends in exit(0).
 *
 * State detection reuses terminal-title.js's exported inspectLastResponse (lazy-required only
 * when enabled) so sound and glyph agree. A tiny inline '?' check is the fallback.
 *
 * Diagnostic log (bounded ~64KB) at ~/.claude/hooks/.titles/arcade-beeps.log records every
 * invocation + choice, so we can prove whether the hook fires on a real Stop.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ASSET_DIR = path.join(__dirname, '..', 'sounds');           // wavs ship beside the hook
const FLAG = path.join(ASSET_DIR, 'status-beeps.enabled');        // per-install toggle, beside the wavs
const LEGACY_FLAG = path.join(ASSET_DIR, 'arcade-beeps.enabled'); // pre-rename toggle, still honored
const LOG = path.join(os.homedir(), '.claude', 'hooks', '.titles', 'arcade-beeps.log');
const DEBUG = process.env.STATUS_BEEPS_DEBUG === '1' || process.env.ARCADE_BEEPS_DEBUG === '1';

function logLine(msg) {
  try {
    try { if (fs.statSync(LOG).size > 64 * 1024) fs.renameSync(LOG, `${LOG}.1`); } catch (_) { /* none yet */ }
    fs.appendFileSync(LOG, `${new Date().toISOString()}  ${msg}\n`);
  } catch (_) { /* logging must never throw */ }
}

function enabled() { try { return fs.existsSync(FLAG) || fs.existsSync(LEGACY_FLAG); } catch (_) { return false; } }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Pick a blocking audio player for the current OS. Returns [cmd, args].
function playerFor(wav) {
  if (process.platform === 'win32') {
    return ['powershell', ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${wav}').PlaySync()`]];
  }
  if (process.platform === 'darwin') {
    return ['afplay', [wav]];
  }
  // linux / other: prefer paplay (PulseAudio/PipeWire), fall back to aplay (ALSA)
  return ['sh', ['-c', `paplay "${wav}" 2>/dev/null || aplay "${wav}" 2>/dev/null`]];
}

function play(wavName, why) {
  if (DEBUG) process.stderr.write(`arcade-beeps: chose ${wavName} (${why})\n`);
  logLine(`play ${wavName} (${why})`);
  try {
    const wav = path.join(ASSET_DIR, wavName);
    if (!fs.existsSync(wav)) { logLine(`MISSING ${wav}`); return; }
    // Block until the sound finishes so it can't be reaped with the hook process.
    const [cmd, cmdArgs] = playerFor(wav);
    spawnSync(cmd, cmdArgs, { stdio: 'ignore', windowsHide: true });
  } catch (e) { logLine(`play-error ${e && e.message}`); }
}

// Fallback: does the last visible assistant text end on a question? (Mirrors terminal-title.js's regex.)
function endsOnQuestionInline(transcriptPath) {
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i].trim(); if (!l) continue;
      let o; try { o = JSON.parse(l); } catch (_) { continue; }
      if (!o || o.type !== 'assistant' || !o.message) continue;
      const c = o.message.content; let t = '';
      if (typeof c === 'string') t = c;
      else if (Array.isArray(c)) t = c.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
      if (t.trim()) return /\?[\s)*_"]*(\([^()]*\)[\s.*_"]*)?$/.test(t);
    }
  } catch (_) { /* ignore */ }
  return false;
}

async function main(input) {
  let data = {};
  try { data = JSON.parse(input); } catch (_) { /* ignore */ }
  const event = data.hook_event_name || '?';
  const en = enabled();
  logLine(`invoked event=${event} enabled=${en ? 1 : 0}`);
  if (!en) return;                               // opt-in only

  if (event === 'Notification') { play('pp3-getready-G4.wav', 'notification'); return; }
  if (event !== 'Stop') return;

  // awaiting (question) vs complete — same signals terminal-title.js uses, so the tone matches the glyph.
  const sid = data.session_id || '';
  // The ask flag lives under the PROJECT root for a project-tier install and under ~/.claude for the
  // user-level tier (terminal-title.js's runtime title-dir split). Check both roots — sid-keyed, so a
  // wrong-tier probe can't false-positive on another session.
  const titleRoots = [process.env.CLAUDE_PROJECT_DIR || data.cwd || process.cwd(), os.homedir()];
  let pending = titleRoots.some(root => {
    try { return fs.existsSync(path.join(root, '.claude', 'hooks', '.titles', `${sid}.ask`)); }
    catch (_) { return false; }
  });

  if (!pending) {
    let inspect = null;
    try { ({ inspectLastResponse: inspect } = require('./terminal-title.js')); } catch (_) { /* fallback below */ }
    if (inspect) {
      let q = inspect(data.transcript_path);
      let n = 0;
      while (!q.ends && (q.suspectRace || !q.found) && n < 5) { await delay(120); q = inspect(data.transcript_path); n++; }
      pending = q.ends;
    } else {
      pending = endsOnQuestionInline(data.transcript_path);
    }
  }

  play(pending ? 'pp3-getready-G4.wav' : 'pp3-go-F#5.wav', pending ? 'awaiting' : 'complete');
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => (input += c));
  process.stdin.on('end', async () => { try { await main(input); } catch (_) { /* ignore */ } process.exit(0); });
}

module.exports = { endsOnQuestionInline };
