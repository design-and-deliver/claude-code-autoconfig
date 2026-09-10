#!/usr/bin/env node
/**
 * token-saver-liveness.js — the watcher for the watcher (2026-08-05; token-guard-liveness.js
 * until the 2026-09 TokenSaver rename).
 *
 * Every handler in token-saver.js is deliberately fail-open: any exception is swallowed and
 * the hook emits nothing — so a dead guard (a partial-clobber runtime throw, a load-time
 * SyntaxError, or a transcript path meterSession can't read) is indistinguishable from a
 * quiet, healthy session. This file is the one guard that must NOT share that fate, which is
 * why it is small, dependency-free, and never require()s token-saver.js — inheriting the big
 * file's load-time throw would kill the canary with the patient.
 *
 * How it works: a healthy token-saver touches its per-session state file
 * (.claude/hooks/.token-saver/<sid>.json) on virtually every hook event after turn 1 —
 * UserPromptSubmit, the PreToolUse baseline arm, Stop. This hook runs on UserPromptSubmit
 * only and counts CONSECUTIVE prompts across which that file's mtime never moved (absent
 * counts as never-moved). N in a row (default 3) => one warning; any mtime movement re-arms
 * the one-shot, so a guard that recovers and dies again warns again. A blind session can
 * land one stray write (r14's baseline arm runs even on an unreadable transcript) — that
 * only delays the alarm by a prompt; the freeze after it still trips the counter.
 *
 * Config: tokenSaver.livenessWarnPrompts (read-alias tokenGuard) in .claude/cca.config.json —
 *         null/0 disables.
 * State:  .claude/hooks/.token-saver/<sid>.liveness.json, beside the file it watches.
 * NOT covered: a repo with no token-saver wired has no canary either — that gap needs a
 * user-level observer and stays on the gaps page (token-guard-remaining-gaps-after-r17).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_WARN_PROMPTS = 3;
const SID_SHORT_LEN = 8;

// TokenSaver rename (2026-09): the state dir moved .token-guard -> .token-saver. Up to six
// concurrent sessions run the engine per repo and every hook event is a fresh process, so the
// migration is a one-shot rename any process may win: rename only when the new dir is absent
// and the old exists; swallow everything (a sibling holding a handle makes renameSync throw
// EPERM on Windows); fall back to whichever dir exists; never delete; never throw.
function resolveStateDir(oldDir, newDir) {
  try {
    if (fs.existsSync(newDir)) return newDir;
    if (fs.existsSync(oldDir)) {
      try { fs.renameSync(oldDir, newDir); return newDir; } catch (_) { return oldDir; }
    }
  } catch (_) { /* fall through */ }
  return newDir;
}

function stateDir(projectDir) {
  const hooks = path.join(projectDir, '.claude', 'hooks');
  return resolveStateDir(path.join(hooks, '.token-guard'), path.join(hooks, '.token-saver'));
}
// (Copied from token-saver.js on purpose — this hook never requires the engine, see above.)

function warnPrompts(projectDir) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectDir, '.claude', 'cca.config.json'), 'utf8'));
    const block = cfg && (cfg.tokenSaver || cfg.tokenGuard);   // read-alias: key renamed 2026-09
    const v = block ? block.livenessWarnPrompts : undefined;
    return v === undefined ? DEFAULT_WARN_PROMPTS : v;
  } catch (_) { return DEFAULT_WARN_PROMPTS; }
}

// The verdict's four moving parts, split out so each clears the repo's CC ≤ 9 bar (clean-code
// plan 4.3). Nothing about the folding changed — every point of the old CC 13 was a defensive
// `||` or a ternary, not a decision.

// Unreadable or corrupt prior state degrades to a fresh count rather than throwing.
function normalizePrev(prev) {
  return prev && typeof prev === 'object' ? prev : { silent: 0, lastMtime: null, warnedAt: null };
}

// "Alive" = the file exists AND its mtime moved since the last look (first sighting counts —
// lastMtime null against a real mtime).
function isGuardAlive(guardMtimeMs, lastMtime) {
  return guardMtimeMs != null && guardMtimeMs !== lastMtime;
}

function advanceState(prev, guardMtimeMs, alive) {
  return {
    silent: alive ? 0 : (prev.silent || 0) + 1,
    lastMtime: guardMtimeMs,                        // store the observation as-is, absence included
    warnedAt: alive ? null : prev.warnedAt || null, // recovery re-arms the one-shot
  };
}

// The silent count to report, or null to stay quiet. A null/0 threshold disables firing while
// advanceState keeps counting.
function shouldFire(next, threshold) {
  return threshold && next.silent >= threshold && !next.warnedAt ? next.silent : null;
}

// Pure verdict — pinned by test/token-guard-liveness.test.js.
//   prev:         { silent, lastMtime, warnedAt } or null (first prompt / unreadable state)
//   guardMtimeMs: mtime of token-guard's <sid>.json, or null when the file is absent
//   threshold:    consecutive silent prompts before firing; null/0 disables
// Returns { next, fire }: next is the state to persist; fire is the silent count when the
// warning should emit this prompt, else null.
function livenessVerdict(prev, guardMtimeMs, threshold, now) {
  const p = normalizePrev(prev);
  const next = advanceState(p, guardMtimeMs, isGuardAlive(guardMtimeMs, p.lastMtime));
  const fire = shouldFire(next, threshold);
  if (fire) next.warnedAt = now || Date.now();
  return { next, fire };
}

function livenessNote(fire, threshold, sid) {
  const sid8 = String(sid).slice(0, SID_SHORT_LEN);
  return `TokenSaver liveness: the TokenSaver hook (token-saver.js) appears DEAD in this session — ` +
    `${fire} prompts in a row with zero writes to its state file ` +
    `(.claude/hooks/.token-saver/${sid8}….json; threshold ${threshold}). Its guards are all ` +
    `fail-open, so nothing is watching this session's spend right now — no turn tripwires, ` +
    `no spend ladders, no payload gates. RELAY THIS to the user in your reply, then ` +
    `diagnose: \`node --check .claude/hooks/token-saver.js\` (a partial clobber can pass ` +
    `--check yet throw at runtime — also try \`node .claude/hooks/token-saver.js --report ` +
    `<transcript>\`), and confirm the session transcript path is readable (a blind meter ` +
    `exits before its first state write).`;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } // first prompt
}

function guardMtime(dir, sid) {
  try { return fs.statSync(path.join(dir, `${sid}.json`)).mtimeMs; } catch (_) { return null; } // no write yet
}

function persistState(dir, file, state) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state));
  } catch (_) { /* state loss just re-counts — harmless */ }
}

function resolveProjectDir(data) {
  return process.env.CLAUDE_PROJECT_DIR || data.cwd || process.cwd();
}

// The side-effecting half: read both state files, fold ONE prompt through the verdict, persist,
// and hand back the note to emit ('' = stay silent). Extracted from the stdin 'end' arrow
// (clean-code plan 4.3) so the I/O path is reachable from a test instead of only via a spawn.
// Non-UserPromptSubmit events and a missing sid return '' where the arrow used to exit early —
// same outcome (exit 0, no output), one fewer place that knows about process exit.
function livenessCheck(data) {
  if ((data.hook_event_name || '') !== 'UserPromptSubmit') return '';
  const sid = data.session_id || '';
  if (!sid) return '';                         // no session to watch — touch nothing
  const projectDir = resolveProjectDir(data);
  const dir = stateDir(projectDir);
  const threshold = warnPrompts(projectDir);   // read once; the old arrow read the config twice
  const mePath = path.join(dir, `${sid}.liveness.json`);
  const { next, fire } = livenessVerdict(readJson(mePath), guardMtime(dir, sid), threshold);
  persistState(dir, mePath, next);
  return fire ? livenessNote(fire, threshold, sid) : '';
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => (input += c));
  process.stdin.on('end', () => {
    try {
      const note = livenessCheck(JSON.parse(input));
      if (note) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: `<token-guard-liveness>${note}</token-guard-liveness>`,
          },
        }));
      }
    } catch (_) { /* the canary stays fail-open too — its defense is having nothing to break */ }
    process.exit(0);
  });
}

if (require.main === module) main();

// main is exported for the token-guard-liveness.js compatibility shim (TokenSaver rename, 2026-09).
module.exports = { main, livenessVerdict, livenessNote, livenessCheck };
