#!/usr/bin/env node
/**
 * Sync the terminal-title.js fleet from the CCA canonical.
 *
 * The hook is now ONE runtime-branched file (see the terminal-title.js header) with CCA's copy as the
 * single source of truth. Every other copy — the live user-level ~/.claude hook and each adopting
 * project — is a byte-derived artifact of it. This keeps them that way WITHOUT an npm publish (the
 * published tarball can lag git main, e.g. while path B is gated): it copies the canonical over targets.
 *
 *   node scripts/sync-terminal-title.js           # CHECK: report drift, exit 1 if any (pre-commit / CI friendly)
 *   node scripts/sync-terminal-title.js --write   # WRITE: copy the canonical over every drifted target
 *
 * This is NOT shipped to users (scripts/ is outside package.json "files"), so the personal fleet list
 * below stays private. Edit TARGETS when you add or drop a repo. A missing target is skipped, not failed
 * (that repo may not be checked out here). The live-twin-parity test is the CI-side guard for the
 * ~/.claude twin on the dev box; this script is the actuator that puts every copy back in sync.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const CANONICAL = path.join(__dirname, '..', '.claude', 'hooks', 'terminal-title.js');

// Personal fleet — the copies that must stay byte-derived from the canonical. Edit as repos change.
const TARGETS = [
  { label: 'global (~/.claude)',  file: path.join(os.homedir(), '.claude', 'hooks', 'terminal-title.js') },
  { label: 'job-agent-extension', file: 'C:\\CODE\\job-agent-extension\\.claude\\hooks\\terminal-title.js' },
  { label: 'wifi-app',            file: 'C:\\CODE\\wifi-app\\.claude\\hooks\\terminal-title.js' },
  { label: 'test',                file: 'C:\\CODE\\test\\.claude\\hooks\\terminal-title.js' },
];

const WRITE = process.argv.includes('--write');

const norm = s => s.replace(/\r/g, '');                       // CRLF-proof comparison
const readOr = f => { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return null; } };
const driftLines = (a, b) => {                                // rough count of lines in b not present in a
  const setA = new Set(norm(a).split('\n'));
  return norm(b).split('\n').filter(l => !setA.has(l)).length;
};

const canon = readOr(CANONICAL);
if (canon == null) { console.error(`canonical not found: ${CANONICAL}`); process.exit(2); }

console.log(`CANONICAL  ${CANONICAL}  (${norm(canon).split('\n').length} lines)`);
console.log(`MODE       ${WRITE ? 'WRITE (sync drifted targets)' : 'CHECK (report only)'}`);
console.log('');

let drifted = 0, missing = 0, wrote = 0;
for (const t of TARGETS) {
  const cur = readOr(t.file);
  if (cur == null) { console.log(`  [miss]  ${t.label.padEnd(22)} not found (skipped)`); missing++; continue; }
  if (norm(cur) === norm(canon)) { console.log(`  [ ok ]  ${t.label.padEnd(22)} in sync`); continue; }
  const d = driftLines(canon, cur);
  if (WRITE) {
    fs.writeFileSync(t.file, canon);
    console.log(`  [sync]  ${t.label.padEnd(22)} updated (${d} lines)`);
    wrote++;
  } else {
    console.log(`  [DRIFT] ${t.label.padEnd(22)} ${d} lines behind`);
    drifted++;
  }
}
console.log('');
if (WRITE) {
  console.log(`Synced ${wrote} target(s); ${missing} missing/skipped. Re-run without --write to confirm.`);
} else if (drifted) {
  console.log(`${drifted} target(s) drifted; ${missing} missing/skipped. Run with --write to sync.`);
  process.exit(1);
} else {
  console.log(`All present targets in sync (${missing} missing/skipped).`);
}
