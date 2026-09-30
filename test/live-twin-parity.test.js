#!/usr/bin/env node

/**
 * Live ↔ twin parity test — kills the silent-lag class.
 *
 * The live user-level hook (~/.claude/hooks/terminal-title.js) and the twin (this repo's
 * .claude/hooks/terminal-title.js) are now the SAME file: the title-dir root is chosen at
 * RUNTIME (project root vs ~/.claude) instead of forked in source, so the live copy is a
 * byte-derived artifact of the twin. This test enforces that — it normalizes both (comments
 * and blank lines stripped) and asserts the remaining code is IDENTICAL, zero divergence.
 *
 * (Historically ONE line was whitelisted: the .titles state-dir resolution, which used to
 * differ live=os.homedir() vs twin=ownerDir. The runtime branch folded that difference into
 * shared code, so the whitelist is now empty and ANY drift is a real failure.)
 *
 * Skips (passes) on machines without the live hook — it's a dev-box guard.
 * A failure means: re-sync the live copy from the twin (they must be identical).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const TWIN = path.join(__dirname, '..', '.claude', 'hooks', 'terminal-title.js');
const LIVE = path.join(os.homedir(), '.claude', 'hooks', 'terminal-title.js');

console.log('============================================================');
console.log('LIVE ↔ TWIN PARITY');
console.log('============================================================');
console.log();

if (!fs.existsSync(LIVE)) {
  console.log('LIVE hook not present on this machine (expected off the dev box).');
  console.log('SKIPPED (no live hook) — parity NOT verified');
  process.exit(0);
}

// Strip block comments, line comments, and blank lines; trim each line.
// Line-based '//' stripping is conservative: only strips when preceded by start-of-line
// or whitespace, so protocol strings like 'https://' would survive (none exist today).
function normalize(src) {
  return src
    .replace(/\r/g, '') // CRLF-proof: a trailing \r blocks the $-anchored comment strip
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(l => l.replace(/(^|\s)\/\/.*$/, '$1').trim())
    .filter(l => l.length > 0);
}

// No allowed divergence: the live copy is a byte-derived artifact of the twin. The old
// .titles-dir fork is now a runtime branch (isUserLevel ? os.homedir() : ownerDir) that lives
// identically in both files, so nothing is whitelisted anymore.
const WHITELIST = [];

const live = normalize(fs.readFileSync(LIVE, 'utf8'));
const twin = normalize(fs.readFileSync(TWIN, 'utf8'));

const liveOnly = live.filter(l => !twin.includes(l));
const twinOnly = twin.filter(l => !live.includes(l));
const offenders = [...liveOnly, ...twinOnly].filter(l => !WHITELIST.some(re => re.test(l)));

if (offenders.length === 0) {
  console.log(`✓ live and twin are at full parity (${live.length}/${twin.length} normalized lines; 0 divergences)`);
  console.log();
  console.log('ALL TESTS PASSED (1 tests)');
} else {
  console.log('✗ live and twin have diverged beyond the whitelist:');
  for (const l of offenders.slice(0, 12)) console.log(`    ${l}`);
  if (offenders.length > 12) console.log(`    …and ${offenders.length - 12} more`);
  console.log();
  console.log('Fix: run the "sync autoconfig" batch (see ~/.claude/hooks/AUTOCONFIG-SYNC.md),');
  console.log('or whitelist a NEW intentional divergence after documenting it in the ledger.');
  console.log('TESTS FAILED: 0 passed, 1 failed');
  process.exit(1);
}
