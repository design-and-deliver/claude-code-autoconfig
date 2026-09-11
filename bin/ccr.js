#!/usr/bin/env node

/**
 * ccr — "claude code, recover"
 *
 * One-word recovery after token-saver's stale-session block. The engine writes a
 * pointer (.claude/hooks/.token-saver/recover.json — .token-guard/ until the 2026-09
 * rename; ccr reads new-then-old) whenever the idle-return rule
 * fires; ccr, run from that same project directory, reads it and relaunches
 * Claude Code on the same work in a fresh, cheap context:
 *
 *   claude "/recover-context pid=<N>"
 *
 * LEGACY since 2026-07-18: the guard's warnings no longer advertise ccr (the
 * new-terminal handoff was too hacky) — they show the /recover-context pid=N
 * command to run in a fresh session instead. ccr keeps working off the same
 * pointer for anyone in the habit.
 *
 * Flags:
 *   --dry-run   print the command that would run, don't launch (used by tests)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// The only shape token-saver ever writes: a slash command of letters/digits/space/_=.:-
// (e.g. "/recover-context pid=12345 sid=abc123de"). Enforcing it HERE is what makes
// buildLaunch's plain quote-wrap safe by construction — no quotes, no shell
// metacharacters can reach the `shell: true` spawn, even from a tampered pointer file.
const SAFE_RECOVER_CMD = /^\/[A-Za-z0-9][A-Za-z0-9 _=.:-]*$/;

// Pointer dirs, newest name first: the engine writes .token-saver/ since the 2026-09 rename;
// a pre-rename hook still in the wild writes .token-guard/. First readable, valid pointer wins.
const POINTER_DIRS = ['.token-saver', '.token-guard'];

function readPointer(projectDir) {
  for (const dir of POINTER_DIRS) {
    const file = path.join(projectDir, '.claude', 'hooks', dir, 'recover.json');
    try {
      const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (rec && typeof rec.recoverCmd === 'string' && SAFE_RECOVER_CMD.test(rec.recoverCmd)) return rec;
    } catch (_) { /* try the next dir */ }
  }
  return null;
}

// recoverCmd is validated against SAFE_RECOVER_CMD above, so plain wrapping is safe.
// One string through the shell so the Windows .cmd shim resolves too.
function buildLaunch(recoverCmd) { return `claude "${recoverCmd}"`; }

function main() {
  const rec = readPointer(process.cwd());
  if (!rec) {
    console.error('ccr: no recovery pointer here (.claude/hooks/.token-saver/recover.json).');
    console.error('Run ccr from the project whose session went stale — the token-saver writes');
    console.error('the pointer when it warns about an idle session.');
    process.exit(1);
  }
  const cmd = buildLaunch(rec.recoverCmd);
  const ageDays = (Date.now() - (rec.writtenAt || 0)) / 86400000;
  if (ageDays > 7) console.error(`ccr: pointer is ${Math.round(ageDays)} days old — recovering anyway.`);
  if (process.argv.includes('--dry-run')) { console.log(cmd); return; }
  console.log(`ccr → ${cmd}`);
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true });
  process.exit(r.status === null ? 1 : r.status);
}

if (require.main === module) main();
module.exports = { readPointer, buildLaunch };
