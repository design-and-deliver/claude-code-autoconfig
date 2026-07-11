#!/usr/bin/env node

/**
 * Live ↔ twin parity test — kills the silent-lag class.
 *
 * The live user-level hook (~/.claude/hooks/terminal-title.js) is edited first; the twin
 * (this repo's .claude/hooks/terminal-title.js) follows via the AUTOCONFIG-SYNC ledger.
 * That's a discipline, not a guarantee — and historically where divergence crept in.
 *
 * This test normalizes both files (comments and blank lines stripped) and asserts the
 * remaining code is IDENTICAL except for the single whitelisted divergence: the .titles
 * state-dir line (live = os.homedir()-scoped; twin = ownerDir/project-scoped).
 *
 * Skips (passes) on machines without the live hook — it's a dev-box guard.
 * A failure means: run the "sync autoconfig" batch, or update the whitelist if a NEW
 * intentional divergence was introduced (document it in AUTOCONFIG-SYNC.md first).
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
  console.log('LIVE hook not present on this machine — skipping (expected off the dev box).');
  console.log('ALL TESTS PASSED (0 tests, skipped)');
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

// The ONLY allowed code divergence: the .titles dir resolution.
const WHITELIST = [
  /^const dir = path\.join\(os\.homedir\(\), '\.claude', 'hooks', '\.titles'\);$/, // live
  /^const dir = path\.join\(ownerDir, '\.claude', 'hooks', '\.titles'\);$/,        // twin
];

// TEMPORARY pending-sync allowance (2026-07-11, approved by Andrew — see the two
// PENDING 2026-07-11 rows in ~/.claude/hooks/AUTOCONFIG-SYNC.md): the live hook gained
// the idle-rescue v3 + --turn-watch watchdog, which its own ledger marks as not yet
// e2e-verified, so the twin deliberately lags until the "sync autoconfig" batch runs.
// While active, LIVE-only additions are tolerated (reported as a warning); any
// unexpected TWIN-side divergence still fails. TWIN_REPLACED covers the one twin line
// the live rewrite superseded (the Stop transcript canary, now event-conditional).
// REMOVE this whole block when the sync batch lands.
const PENDING_SYNC_ALLOWANCE = true;
const TWIN_REPLACED = [
  /^if \(event === 'Stop' && !data\.transcript_path\) degraded\.push\('transcript_path'\);$/,
];

const live = normalize(fs.readFileSync(LIVE, 'utf8'));
const twin = normalize(fs.readFileSync(TWIN, 'utf8'));

const liveOnly = live.filter(l => !twin.includes(l));
const twinOnly = twin.filter(l => !live.includes(l));
let offenders = [...liveOnly, ...twinOnly].filter(l => !WHITELIST.some(re => re.test(l)));

if (PENDING_SYNC_ALLOWANCE && offenders.length > 0) {
  const twinOffenders = twinOnly.filter(l =>
    !WHITELIST.some(re => re.test(l)) && !TWIN_REPLACED.some(re => re.test(l)));
  const tolerated = offenders.length - twinOffenders.length;
  if (twinOffenders.length === 0) {
    console.log(`⚠ pending-sync allowance active: tolerating ${tolerated} live-only divergent lines`);
    console.log('  (idle-rescue + turn-watch await the "sync autoconfig" batch — see AUTOCONFIG-SYNC.md)');
  }
  offenders = twinOffenders;
}

if (offenders.length === 0) {
  console.log(`✓ live and twin are at parity (${live.length}/${twin.length} normalized lines; 1 whitelisted divergence)`);
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
