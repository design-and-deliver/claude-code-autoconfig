#!/usr/bin/env node

/**
 * ccr — "claude code, recover"
 *
 * One-word recovery after token-guard's stale-session block. The guard writes a
 * pointer (.claude/hooks/.token-guard/recover.json) whenever the idle-return rule
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

function readPointer(projectDir) {
  const file = path.join(projectDir, '.claude', 'hooks', '.token-guard', 'recover.json');
  try {
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    return rec && typeof rec.recoverCmd === 'string' && rec.recoverCmd.startsWith('/') ? rec : null;
  } catch (_) { return null; }
}

// recoverCmd never contains double quotes (slash command + digits + hex sid), so plain
// wrapping is safe. One string through the shell so the Windows .cmd shim resolves too.
function buildLaunch(recoverCmd) { return `claude "${recoverCmd}"`; }

function main() {
  const rec = readPointer(process.cwd());
  if (!rec) {
    console.error('ccr: no recovery pointer here (.claude/hooks/.token-guard/recover.json).');
    console.error('Run ccr from the project whose session went stale — the token-guard writes');
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
