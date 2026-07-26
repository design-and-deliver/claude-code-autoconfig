#!/usr/bin/env node
/**
 * Sync the canonical .claude/hooks fleet from CCA to every adopting copy.
 *
 * Generalized out of sync-terminal-title.js on 2026-07-25, after token-guard.js drifted 231
 * lines behind canonical in job-agent-extension. That drift happened because token-guard had no
 * actuator at all: the 2026-07-24 hand-port cherry-picked ONE constant out of CCA 03c3922 and
 * silently skipped 7e8cffb, landed six minutes earlier, which is the fix that makes R13b meter
 * work tokens instead of raw cache re-reads. The rails already existed for terminal-title.js;
 * they just covered one file. Now they cover a manifest.
 *
 *   node scripts/sync-hook-fleet.js               # CHECK: report drift, exit 1 if any
 *   node scripts/sync-hook-fleet.js --write       # WRITE: copy canonical over drifted targets
 *   node scripts/sync-hook-fleet.js --write --quiet --only <projectDir>
 *                                                 # session-start pull: silent unless it acted
 *
 * NOT shipped to users (scripts/ is outside package.json "files"). This file IS tracked in a
 * public repo, so personal paths must never be hardcoded — the per-machine repo list lives in
 * the gitignored sibling scripts/hook-fleet.local.json (falling back to the older
 * terminal-title-fleet.local.json). A missing target is skipped, not failed: that repo may not
 * be checked out on this box, and adoption is opt-in by design (see ADOPT-ONLY below).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// The canonical fleet manifest. ADOPT-ONLY is the default and the important safety property:
// a target that does not already have the file is SKIPPED, never created. Syncing must not be
// how a repo acquires a hook — that is what the installer and a deliberate opt-in are for, and
// silently dropping token-guard.js into a repo whose settings.json never wires it would leave
// an inert file that reads as adoption.
const MANIFEST = [
  { file: 'terminal-title.js', global: true },
  // The hook reads its directive from its own directory, so the pair moves together: this one
  // IS created when its partner is present, because a repo with the .js and no .md is a fleet
  // gap rather than an unadopted repo.
  { file: 'terminal-title.directive.md', global: true, pairsWith: 'terminal-title.js' },
  // Dev-only (DEV_ONLY_FILES in bin/cli.js) — never in a user install, and deliberately NOT
  // synced to ~/.claude: the global hooks dir has no token-guard today, and putting one there
  // without a matching settings.json entry would be inert.
  { file: 'token-guard.js', global: false },
];

const PAD = 46;                                               // report column for the target label

const canonicalFor = f => path.join(__dirname, '..', '.claude', 'hooks', f);

// Per-machine fleet. Prefer the general name; fall back to the terminal-title-era one so an
// existing box keeps working with no migration step.
//   [{ "label": "my-repo", "dir": "C:\\path\\to\\repo\\.claude\\hooks" }, ...]
// CCA_HOOK_FLEET_FILE overrides both — the seam test/hook-fleet-sync.test.js drives the real
// CLI against throwaway dirs instead of this machine's actual repos.
const FLEET_FILES = ['hook-fleet.local.json', 'terminal-title-fleet.local.json'];
function readLocalFleet() {
  const candidates = process.env.CCA_HOOK_FLEET_FILE
    ? [process.env.CCA_HOOK_FLEET_FILE]
    : FLEET_FILES.map(n => path.join(__dirname, n));
  for (const file of candidates) {
    try {
      const list = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(list)) {
        return list.filter(t => t && typeof t.label === 'string' && typeof t.dir === 'string');
      }
    } catch (_) { /* next candidate */ }
  }
  return [];
}

const norm = s => s.replace(/\r/g, '');                       // CRLF-proof comparison
const readOr = f => { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return null; } };
const driftLines = (a, b) => {                                // rough count of lines in b not in a
  const setA = new Set(norm(a).split('\n'));
  return norm(b).split('\n').filter(l => !setA.has(l)).length;
};

// Resolve to a comparable absolute form — the --only filter compares a project dir against
// target hook dirs that were authored by hand in the local fleet file (mixed slashes, mixed case
// on Windows), so neither side can be trusted to be canonical already.
const key = p => path.resolve(p).replace(/\\/g, '/').toLowerCase();

function resolveTargets(only) {
  return [
    { label: 'global (~/.claude)', dir: path.join(os.homedir(), '.claude', 'hooks'), isGlobal: true },
    ...readLocalFleet(),
  ].filter(t => !only || key(t.dir).startsWith(key(only)));
}

// Read every canonical up front: a missing one is a broken checkout, not drift, and must abort
// before anything is written.
function loadCanonical(entries) {
  const canon = {};
  for (const e of entries) {
    const c = readOr(canonicalFor(e.file));
    if (c == null) return { canon: null, missingFile: canonicalFor(e.file) };
    canon[e.file] = c;
  }
  return { canon, missingFile: null };
}

function header(entries, canon, write, say) {
  for (const e of entries) {
    say(`CANONICAL  ${canonicalFor(e.file)}  (${norm(canon[e.file]).split('\n').length} lines)`);
  }
  say(`MODE       ${write ? 'WRITE (sync drifted targets)' : 'CHECK (report only)'}`);
  say('');
}

/**
 * What one (target, manifest entry) pair needs. Returns the current text too, so the caller
 * measures drift without a second read.
 * @returns {{verdict:'miss'|'ok'|'create'|'update', cur:string|null}}
 */
function classify(dir, entry, canonText) {
  const cur = readOr(path.join(dir, entry.file));
  if (cur == null) {
    // ADOPT-ONLY: absent means unadopted, unless this entry pairs with a file that IS here.
    const partnerPresent = entry.pairsWith != null && readOr(path.join(dir, entry.pairsWith)) != null;
    return { verdict: partnerPresent ? 'create' : 'miss', cur: null };
  }
  return { verdict: norm(cur) === norm(canonText) ? 'ok' : 'update', cur };
}

// The two "nothing to do" verdicts. Narrated only outside quiet mode — this runs on every
// SessionStart, and a hook that speaks when there is no news trains you to stop reading it.
function noteNoop(verdict, label, quiet, say, tally) {
  if (verdict === 'miss') tally.missing++;
  if (quiet) return;
  say(verdict === 'miss' ? `  [miss]  ${label} not found (skipped)` : `  [ ok ]  ${label} in sync`);
}

// Classify one pair, then act on it and narrate. Mutates `tally`.
function applyOne(target, entry, canonText, mode, say, tally) {
  const label = `${target.label} ${entry.file}`.padEnd(PAD);
  const { verdict, cur } = classify(target.dir, entry, canonText);
  if (verdict === 'miss' || verdict === 'ok') {
    noteNoop(verdict, label, mode.quiet, say, tally);
    return;
  }
  const created = verdict === 'create';
  const n = created ? norm(canonText).split('\n').length : driftLines(canonText, cur);
  if (mode.write) {
    fs.writeFileSync(path.join(target.dir, entry.file), canonText);
    say(`  [sync]  ${label} ${created ? 'created' : 'updated'} (${n} lines)`);
    tally.wrote++;
    return;
  }
  say(`  [DRIFT] ${label} ${created ? 'absent' : `${n} lines behind`}`);
  tally.drifted++;
}

/**
 * @param {object}   opts
 * @param {boolean}  opts.write   copy canonical over drifted targets (default: report only)
 * @param {boolean}  opts.quiet   print nothing unless something drifted or was written
 * @param {string}   opts.only    restrict to targets under this project dir
 * @param {string[]} opts.files   restrict to these manifest entries (default: all)
 * @param {object[]} opts.targets explicit {label, dir, isGlobal} list, bypassing this machine's
 *                                fleet entirely (default: resolve it) — how the suite exercises
 *                                the global branch without writing into a real ~/.claude
 * @returns {{drifted:number, wrote:number, missing:number, lines:string[]}}
 */
function syncFleet(opts) {
  const write = opts.write === true;
  const quiet = opts.quiet === true;
  const entries = opts.files ? MANIFEST.filter(e => opts.files.includes(e.file)) : MANIFEST;
  const lines = [];
  const say = s => lines.push(s);
  const tally = { drifted: 0, wrote: 0, missing: 0, lines };

  const { canon, missingFile } = loadCanonical(entries);
  if (canon == null) {
    console.error(`canonical not found: ${missingFile}`);
    process.exitCode = 2;
    return tally;
  }
  if (!quiet) header(entries, canon, write, say);

  for (const t of (opts.targets || resolveTargets(opts.only))) {
    for (const e of entries) {
      if (t.isGlobal && !e.global) continue;                  // not part of this file's fleet
      applyOne(t, e, canon[e.file], { write, quiet }, say, tally);
    }
  }
  return tally;
}

// The full report + exit code. Shared with the sync-terminal-title.js front-end so there is
// exactly one implementation of the CLI's contract.
function report(r, write) {
  for (const l of r.lines) console.log(l);
  console.log('');
  if (write) {
    console.log(`Synced ${r.wrote} target(s); ${r.missing} missing/skipped. Re-run without --write to confirm.`);
  } else if (r.drifted) {
    console.log(`${r.drifted} target(s) drifted; ${r.missing} missing/skipped. Run with --write to sync.`);
    process.exitCode = 1;
  } else {
    console.log(`All present targets in sync (${r.missing} missing/skipped).`);
  }
}

// A value-taking flag with nothing after it (`--files` last, or `--only --write`) reads as
// absent rather than crashing or swallowing the next flag — `--files` used to throw on
// undefined.split, which would have failed the run for a typo.
function parseArgs(argv) {
  const value = flag => {
    const v = argv[argv.indexOf(flag) + 1];
    return argv.includes(flag) && v && !v.startsWith('--') ? v : null;
  };
  const files = value('--files');
  return {
    write: argv.includes('--write'),
    quiet: argv.includes('--quiet'),
    only: value('--only'),
    files: files ? files.split(',') : null,
  };
}

function main(argv) {
  const opts = parseArgs(argv);
  const r = syncFleet(opts);
  if (!opts.quiet) {
    report(r, opts.write);
    return;
  }
  // Quiet mode: a fully in-sync fleet says nothing at all, and never prints the summary.
  if (r.wrote === 0 && r.drifted === 0) return;
  for (const l of r.lines) console.log(l);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { syncFleet, report, MANIFEST, main };
