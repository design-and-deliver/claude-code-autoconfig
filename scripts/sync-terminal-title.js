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
 * This is NOT shipped to users (scripts/ is outside package.json "files"). The per-machine repo
 * list lives in the gitignored sibling scripts/terminal-title-fleet.local.json — this file IS
 * tracked in a public repo, so personal paths must never be hardcoded here (they were, until the
 * 2026-07-24 review). A missing target is skipped, not failed (that repo may not be checked out
 * here). The live-twin-parity test is the CI-side guard for the ~/.claude twin on the dev box;
 * this script is the actuator that puts every copy back in sync.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// The hook reads terminal-title.directive.md from its own directory, so the pair syncs together.
const CANONICAL_FILES = ['terminal-title.js', 'terminal-title.directive.md'];
const canonicalFor = f => path.join(__dirname, '..', '.claude', 'hooks', f);

// Personal fleet — the copies that must stay byte-derived from the canonical. The ~/.claude twin
// is universal; the machine-specific repo list comes from the gitignored local file:
//   scripts/terminal-title-fleet.local.json
//   [{ "label": "my-repo", "dir": "C:\\path\\to\\repo\\.claude\\hooks" }, ...]
// Absent/invalid local file just means the fleet is the ~/.claude twin alone.
const LOCAL_FLEET_FILE = path.join(__dirname, 'terminal-title-fleet.local.json');
function readLocalFleet() {
  try {
    const list = JSON.parse(fs.readFileSync(LOCAL_FLEET_FILE, 'utf8'));
    return Array.isArray(list)
      ? list.filter(t => t && typeof t.label === 'string' && typeof t.dir === 'string')
      : [];
  } catch (_) { return []; }
}
const TARGET_DIRS = [
  { label: 'global (~/.claude)',  dir: path.join(os.homedir(), '.claude', 'hooks') },
  ...readLocalFleet(),
];
const TARGETS = TARGET_DIRS.flatMap(t =>
  CANONICAL_FILES.map(f => ({ label: `${t.label} ${f === 'terminal-title.js' ? '' : '(directive)'}`.trim(),
    file: path.join(t.dir, f), canonical: canonicalFor(f) })));

const WRITE = process.argv.includes('--write');

const norm = s => s.replace(/\r/g, '');                       // CRLF-proof comparison
const readOr = f => { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return null; } };
const driftLines = (a, b) => {                                // rough count of lines in b not present in a
  const setA = new Set(norm(a).split('\n'));
  return norm(b).split('\n').filter(l => !setA.has(l)).length;
};

const canonCache = {};
for (const f of CANONICAL_FILES) {
  const c = readOr(canonicalFor(f));
  if (c == null) { console.error(`canonical not found: ${canonicalFor(f)}`); process.exit(2); }
  canonCache[f] = c;
  console.log(`CANONICAL  ${canonicalFor(f)}  (${norm(c).split('\n').length} lines)`);
}
console.log(`MODE       ${WRITE ? 'WRITE (sync drifted targets)' : 'CHECK (report only)'}`);
console.log('');

let drifted = 0, missing = 0, wrote = 0;
for (const t of TARGETS) {
  const canon = canonCache[path.basename(t.file)];
  const cur = readOr(t.file);
  // A target repo missing just the directive .md is a fleet gap, not an unadopted repo — only
  // skip when the .js itself is absent; the .md is created on --write.
  if (cur == null && (path.basename(t.file) !== 'terminal-title.directive.md'
      || readOr(t.file.replace(/\.directive\.md$/, '.js')) == null)) {
    console.log(`  [miss]  ${t.label.padEnd(34)} not found (skipped)`); missing++; continue;
  }
  if (cur != null && norm(cur) === norm(canon)) { console.log(`  [ ok ]  ${t.label.padEnd(34)} in sync`); continue; }
  const d = cur == null ? norm(canon).split('\n').length : driftLines(canon, cur);
  if (WRITE) {
    fs.writeFileSync(t.file, canon);
    console.log(`  [sync]  ${t.label.padEnd(34)} ${cur == null ? 'created' : 'updated'} (${d} lines)`);
    wrote++;
  } else {
    console.log(`  [DRIFT] ${t.label.padEnd(34)} ${cur == null ? 'absent' : `${d} lines behind`}`);
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
