#!/usr/bin/env node
/**
 * Sync the canonical .claude fleet from CCA to every adopting copy — the hooks, and (since
 * 2026-07-26) the shared authoring rules in the sibling .claude/rules directory.
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
 * The two modes read canonical from deliberately different places. CHECK gates the pre-push hook,
 * so it asks "is any copy stale against what this repo has COMMITTED?" and tolerates a target
 * matching HEAD. WRITE asks "make every copy match canonical as it is right now" and always uses
 * the working tree. See tolerateAtHead().
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
const { spawnSync } = require('child_process');

// This checkout's root. CCA_CANONICAL_ROOT overrides it — same test seam as CCA_HOOK_FLEET_FILE:
// the HEAD-tolerance case below needs a canonical file with real uncommitted edits, which can
// only be staged in a throwaway git repo, never in this one.
const repoRoot = () => process.env.CCA_CANONICAL_ROOT || path.join(__dirname, '..');

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
  // The guard's liveness canary. Paired: every token-guard handler is fail-open, so a repo
  // with the guard and no canary is a fleet gap — a dead guard there is silent by design.
  // The canary never require()s its partner (a load-time throw must not kill them both),
  // and wiring (a UserPromptSubmit entry) stays a per-repo opt-in like the guard's own.
  { file: 'token-guard-liveness.js', global: false, pairsWith: 'token-guard.js' },
  // The cross-session write-claim registry. token-guard require()s it lazily and fails open, so a
  // repo with the guard and a drifted registry is the same silent-gap shape as a missing canary —
  // and it WAS an unmanifested hand-copy until 2026-08-07 (job-agent-extension had a byte-identical
  // copy nobody was keeping honest), which is precisely how token-guard drifted 231 lines.
  { file: 'claim-registry.js', global: false, pairsWith: 'token-guard.js' },
  // The SessionEnd clean-exit marker. Global (unlike token-guard) because it IS wired in
  // ~/.claude/settings.json — one user-level SessionEnd entry covers every repo, and the marker
  // resolves its own .titles dir per session, so a project copy would only write the same file
  // twice. Dev-only in bin/cli.js: user installs wire no SessionEnd.
  { file: 'session-close.js', global: true },
  // The PreToolUse worktree gate. Dev-only (DEV_ONLY_FILES in bin/cli.js) and per-repo for the
  // same reason as token-guard: ~/.claude/settings.json wires no PreToolUse entry for it, so a
  // global copy would be an inert file that reads as adoption. It landed in two repos on
  // 2026-07-31 — built independently here and in job-agent-extension, then merged — which is
  // precisely the hand-port arrangement that let token-guard drift 231 lines behind.
  { file: 'worktree-gate.js', global: false },
  // Shared authoring rules — same fleet, one directory over (`subdir`). plan-authoring.md was
  // hand-ported between CCA and job-agent-extension and the two copies diverged for six weeks
  // with NEITHER a superset (the rule's own header says so); a doc drifts exactly like a hook
  // does, so it gets the same actuator rather than another "remember to port it" note. Not
  // global: ~/.claude has no rules dir, and ADOPT-ONLY means a repo without the file keeps not
  // having it.
  { file: 'plan-authoring.md', global: false, subdir: 'rules' },
  // Dev-only commands and their scripts. They were hand-copied between repos before this — the
  // same "remember to port it" arrangement that let token-guard.js drift 231 lines behind, just
  // one directory over. A command drifts exactly like a hook does, so it gets the same actuator.
  //
  // fleet boards ONE repo's sessions, so it stays per-repo (global: false). restore-after-reboot
  // is the opposite: a reboot takes every terminal on the machine, and you run it from wherever
  // you happened to be standing — so it is installed globally too, and its command file resolves
  // the script from either tier. Note that `pairsWith` cannot join these two: it looks for the
  // partner in the SAME directory, and a command and its script never share one. Each half is
  // adopted on its own (ADOPT-ONLY still holds — a repo without the file is never given one).
  { file: 'fleet.md', global: false, subdir: 'commands' },
  { file: 'fleet.js', global: false, subdir: 'scripts' },
  { file: 'restore-after-reboot.md', global: true, subdir: 'commands' },
  { file: 'restore-after-reboot.js', global: true, subdir: 'scripts' },
  // The recovery pair, and the one-shot probe both commands now call instead of inlining
  // eight sequential python heredocs. These two commands DO ship to users (they are absent
  // from DEV_ONLY_FILES), and they had already drifted the classic way: job-agent-extension
  // was on /continue v2 while this repo was on v7 — five versions, hand-ported. The script
  // is the load-bearing half: a repo that takes a command doc calling
  // .claude/scripts/recover-session.py and does NOT have that script gets a broken command,
  // so the two must move together or not at all — hence `pairsSubdir`, which is what lets a
  // scripts/ entry follow a commands/ partner (the older fleet.md/fleet.js pair could not,
  // and each half had to be adopted separately).
  { file: 'continue.md', global: false, subdir: 'commands' },
  { file: 'recover-context.md', global: false, subdir: 'commands' },
  { file: 'recover-session.py', global: false, subdir: 'scripts',
    pairsWith: 'continue.md', pairsSubdir: 'commands' },
];

const PAD = 46;                                               // report column for the target label

// An entry lives under .claude/<subdir>/, defaulting to the hooks dir the fleet grew up in.
const subdirOf = entry => entry.subdir || 'hooks';
const canonicalFor = entry => path.join(repoRoot(), '.claude', subdirOf(entry), entry.file);

// Where THIS entry belongs inside a target repo. The per-machine fleet file records each target
// as its .claude/hooks dir, so a non-hooks entry resolves as that dir's sibling — no fleet-file
// migration on any box, and a hand-authored path with odd slashes still works (path.dirname is
// separator-agnostic on Windows).
const targetDirFor = (target, entry) =>
  entry.subdir ? path.join(path.dirname(target.dir), entry.subdir) : target.dir;

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
// How far a target is BEHIND: the canonical lines it does not have yet — i.e. roughly what a
// --write would bring in. Rough on purpose (a set membership test, so a line repeated elsewhere
// in the target counts as present); an exact diff would be precision this label cannot use.
// The arguments used to be handed over the other way round, which measured the lines the target
// would LOSE and let a badly stale copy read as nearly current — wifi-app sat ~340 lines net
// behind canonical and was labelled "5 lines behind" (2026-07-26). Direction IS the number here,
// so the parameters are named rather than positional-by-convention.
const linesBehind = (current, canonical) => {
  const have = new Set(norm(current).split('\n'));
  return norm(canonical).split('\n').filter(l => !have.has(l)).length;
};

// The canonical AS COMMITTED — the version a push actually carries. Consulted only when a target
// would otherwise read as drifted, so an in-sync fleet spawns no git at all; the cache is cleared
// per syncFleet() run so a long-lived caller never reads a stale blob. Null means "no second
// opinion" (not a git checkout, git absent, or the file not committed yet), which leaves the
// working-tree verdict standing exactly as before.
const headCache = new Map();
function canonicalAtHead(entry) {
  const rel = `.claude/${subdirOf(entry)}/${entry.file}`;
  if (!headCache.has(rel)) {
    const r = spawnSync('git', ['show', `HEAD:${rel}`], {
      cwd: repoRoot(), encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024,
    });
    headCache.set(rel, r.status === 0 ? r.stdout : null);
  }
  return headCache.get(rel);
}

// CHECK MODE ONLY: a target that matches the committed canonical is not stale with respect to
// anything being pushed, so it must not fail the pre-push guard. Without this, ANY session with
// uncommitted edits to a canonical file makes every downstream copy read as drifted and blocks
// every other session's push — which is exactly what happened on 2026-08-07, when a sibling
// mid-edit on recover-session.py cost a `--no-verify` bypass on a 89-commit push.
// WRITE MODE deliberately does not get this tolerance: `--write` means "make the fleet match
// canonical as it is right now", which is the edit -> --write -> commit workflow's whole point.
function tolerateAtHead(entry, cur, mode) {
  if (mode.write || cur == null) return false;
  const head = canonicalAtHead(entry);
  return head != null && norm(cur) === norm(head);
}

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
    const c = readOr(canonicalFor(e));
    if (c == null) return { canon: null, missingFile: canonicalFor(e) };
    canon[e.file] = c;
  }
  return { canon, missingFile: null };
}

function header(entries, canon, write, say) {
  for (const e of entries) {
    say(`CANONICAL  ${canonicalFor(e)}  (${norm(canon[e.file]).split('\n').length} lines)`);
  }
  say(`MODE       ${write ? 'WRITE (sync drifted targets)' : 'CHECK (report only)'}`);
  say('');
}

/**
 * What one (target, manifest entry) pair needs. Returns the current text too, so the caller
 * measures drift without a second read — and the resolved dir, so it never re-derives it (the
 * write must land where the read looked, which for a `subdir` entry is NOT target.dir).
 * @returns {{verdict:'miss'|'ok'|'create'|'update', cur:string|null, dir:string}}
 */
function classify(target, entry, canonText) {
  const dir = targetDirFor(target, entry);
  const cur = readOr(path.join(dir, entry.file));
  if (cur == null) {
    // ADOPT-ONLY: absent means unadopted, unless this entry pairs with a file that IS here.
    // `pairsSubdir` lets the partner live one directory over — a command and the script it
    // calls never share a dir, yet shipping the command without the script is exactly the
    // "adopted but broken" state ADOPT-ONLY exists to avoid.
    const partnerDir = entry.pairsSubdir
      ? targetDirFor(target, { subdir: entry.pairsSubdir })
      : dir;
    const partnerPresent = entry.pairsWith != null && readOr(path.join(partnerDir, entry.pairsWith)) != null;
    return { verdict: partnerPresent ? 'create' : 'miss', cur: null, dir };
  }
  return { verdict: norm(cur) === norm(canonText) ? 'ok' : 'update', cur, dir };
}

// The three "nothing to do" outcomes, as a lookup rather than a branch chain. `head` says WHY it
// is being let through — silence there would read as a plain in-sync fleet and hide the fact that
// canonical has uncommitted work the fleet has not seen yet.
const NOOP_LINE = {
  miss: l => `  [miss]  ${l} not found (skipped)`,
  ok: l => `  [ ok ]  ${l} in sync`,
  head: l => `  [ ok ]  ${l} in sync with HEAD (canonical has uncommitted edits)`,
};

// Narrated only outside quiet mode — this runs on every SessionStart, and a hook that speaks when
// there is no news trains you to stop reading it.
function noteNoop(kind, label, quiet, say, tally) {
  if (kind === 'miss') tally.missing++;
  if (quiet) return;
  say(NOOP_LINE[kind](label));
}

// Which no-op this pair is, or null if there is real work to do.
function noopKind(verdict, entry, cur, mode) {
  if (verdict === 'miss' || verdict === 'ok') return verdict;
  return tolerateAtHead(entry, cur, mode) ? 'head' : null;
}

// Every target here is a file the OTHER live sessions are executing right now — the hooks read
// token-guard.js fresh on each tool call. A plain writeFileSync truncates first, so a read landing
// inside that window gets a half file: it passes `node --check` often enough to look fine and then
// throws mid-turn in somebody else's session (observed once, hence this). Same-directory temp plus
// rename makes the swap atomic, so a concurrent reader sees the old file or the new one, never a
// prefix. Same directory matters — rename across a filesystem boundary is a copy, not a swap.
function writeAtomic(dest, text) {
  const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.sync-${process.pid}.tmp`);
  // The temp file is born 0644; carry the destination's mode across so a POSIX fleet does not
  // quietly lose the +x bit on an updating pair. A create has no mode to preserve.
  let mode = null;
  try { mode = fs.statSync(dest).mode; } catch { /* create, not update */ }
  try {
    fs.writeFileSync(tmp, text);
    if (mode !== null) fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, dest);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
    throw err;
  }
}

// Classify one pair, then act on it and narrate. Mutates `tally`.
function applyOne(target, entry, canonText, mode, say, tally) {
  const label = `${target.label} ${entry.file}`.padEnd(PAD);
  const { verdict, cur, dir } = classify(target, entry, canonText);
  const noop = noopKind(verdict, entry, cur, mode);
  if (noop) {
    noteNoop(noop, label, mode.quiet, say, tally);
    return;
  }
  const created = verdict === 'create';
  const n = created ? norm(canonText).split('\n').length : linesBehind(cur, canonText);
  // n === 0 on an updating pair means the target holds every canonical line and still differs:
  // it is not behind, it has local edits (which --write reverts). Saying "0 lines behind" of a
  // file that is about to change would read as a broken counter.
  const amount = n ? `${n} lines` : 'local edits';
  if (mode.write) {
    writeAtomic(path.join(dir, entry.file), canonText);
    say(`  [sync]  ${label} ${created ? `created (${n} lines)` : `updated (${amount})`}`);
    tally.wrote++;
    return;
  }
  say(`  [DRIFT] ${label} ${created ? 'absent' : (n ? `${n} lines behind` : 'local edits only')}`);
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
  headCache.clear();

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
