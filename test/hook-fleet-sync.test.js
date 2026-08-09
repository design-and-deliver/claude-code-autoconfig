#!/usr/bin/env node
'use strict';

/**
 * Tests for scripts/sync-hook-fleet.js — the actuator that keeps every copy of the canonical
 * .claude/hooks files byte-derived from CCA's.
 *
 * Why this suite exists: token-guard.js drifted 231 lines behind canonical precisely because
 * nothing checked it, and the manifest-driven actuator that fixed that (2026-07-25) shipped
 * with the dev-box pre-push hook as its ONLY guard — a hook that lives in untracked
 * .git/hooks/, so a fresh checkout has no coverage at all. These tests pin the semantics that
 * make the actuator safe to run unattended, ADOPT-ONLY above all: syncing must never be how a
 * repo ACQUIRES a hook, because an unwired hook file reads as adoption while doing nothing.
 *
 * Behavioral: every case drives the real syncFleet()/CLI against throwaway target dirs and
 * compares them byte-for-byte against the repo's actual canonical files. Nothing here can
 * reach a real fleet member — the in-process cases pass an explicit `targets` list, and the
 * CLI case scopes itself with --only under a temp dir (which the ~/.claude target can never
 * match).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { test, assert, summary } = require('./_harness');
const { syncFleet, MANIFEST } = require('../scripts/sync-hook-fleet.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'sync-hook-fleet.js');
const CANON_DIR = path.join(__dirname, '..', '.claude', 'hooks');

const norm = s => s.replace(/\r/g, '');
const canonOf = f => fs.readFileSync(path.join(CANON_DIR, f), 'utf8');

const STALE = '// a stale copy\n';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-fleet-'));
let seq = 0;

// A throwaway adopting repo's hooks dir, pre-seeded with whatever files the case needs.
function target(files, opts) {
  const o = opts || {};
  const label = o.label || `t${++seq}`;
  const dir = path.join(tmpRoot, label);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of Object.keys(files || {})) fs.writeFileSync(path.join(dir, name), files[name]);
  return { label, dir, isGlobal: o.isGlobal === true };
}

const read = (t, f) => {
  try { return fs.readFileSync(path.join(t.dir, f), 'utf8'); } catch (_) { return null; }
};
const inSync = (t, f) => norm(read(t, f) || '') === norm(canonOf(f));

function runCli(args, fleetFile, env) {
  const r = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CCA_HOOK_FLEET_FILE: fleetFile, ...(env || {}) },
  });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

console.log('============================================================');
console.log('HOOK FLEET SYNC TESTS');
console.log('============================================================');
console.log();

test('ADOPT-ONLY: an unadopted target gains nothing, even in write mode', () => {
  const t = target({});
  const r = syncFleet({ write: true, targets: [t] });
  assert(r.wrote === 0, `nothing may be written into an unadopted repo, wrote ${r.wrote}`);
  assert(r.missing === MANIFEST.length, `every entry must be skipped, skipped ${r.missing}`);
  assert(fs.readdirSync(t.dir).length === 0, 'the target dir must still be empty');
});

test('the paired directive IS created next to an adopted terminal-title.js', () => {
  const t = target({ 'terminal-title.js': STALE });
  const r = syncFleet({ write: true, targets: [t] });
  assert(inSync(t, 'terminal-title.js'), 'terminal-title.js must be brought to canonical');
  assert(inSync(t, 'terminal-title.directive.md'), 'its directive must be created (fleet gap)');
  assert(read(t, 'token-guard.js') === null, 'an unadopted token-guard must NOT be created');
  // Counted against the manifest rather than a literal, so growing the fleet doesn't fail a
  // test that is really asserting "exactly the pair moved, nothing else did".
  assert(r.wrote === 2 && r.missing === MANIFEST.length - 2,
    `expected 2 written / the rest skipped, got ${r.wrote}/${r.missing}`);
});

test('token-guard.js is never pushed to the global (~/.claude) target', () => {
  const t = target({
    'terminal-title.js': STALE,
    'terminal-title.directive.md': STALE,
    'token-guard.js': STALE,
  }, { isGlobal: true });
  syncFleet({ write: true, targets: [t] });
  assert(inSync(t, 'terminal-title.js'), 'terminal-title.js must sync to the global target');
  assert(read(t, 'token-guard.js') === STALE,
    'a global token-guard.js must be left untouched — nothing there wires it');
});

test("token-guard's partners are created wherever it is adopted — and only there", () => {
  // A guard without its canary is a fleet gap: every token-guard handler is fail-open, so a
  // dead guard in that repo would be silent. The claim registry is the same shape — the guard
  // require()s it lazily and fails open, so a drifted or absent copy is silent too, and it sat
  // unmanifested as a hand-copy until 2026-08-07. ADOPT-ONLY still holds for everyone else.
  const adopted = target({ 'token-guard.js': canonOf('token-guard.js') });
  syncFleet({ write: true, targets: [adopted] });
  assert(inSync(adopted, 'token-guard-liveness.js'),
    'a repo with token-guard.js must be given the canary');
  assert(inSync(adopted, 'claim-registry.js'),
    'a repo with token-guard.js must be given the claim registry');
  const unadopted = target({});
  syncFleet({ write: true, targets: [unadopted] });
  assert(read(unadopted, 'token-guard-liveness.js') === null,
    'no guard, no canary — the pair must not create into an unadopted repo');
  assert(read(unadopted, 'claim-registry.js') === null,
    'no guard, no registry — the pair must not create into an unadopted repo');
});

test('check mode reports drift without touching the file; --write then fixes it', () => {
  // Every token-guard partner rides at canonical so the only drift in play is the one this case
  // is about — seed each new pairsWith entry here or its creation reads as a second drift.
  const t = target({ 'token-guard.js': STALE,
    'token-guard-liveness.js': canonOf('token-guard-liveness.js'),
    'claim-registry.js': canonOf('claim-registry.js') });
  const check = syncFleet({ targets: [t] });
  assert(check.drifted === 1 && check.wrote === 0,
    `check mode: expected 1 drift / 0 writes, got ${check.drifted}/${check.wrote}`);
  assert(read(t, 'token-guard.js') === STALE, 'check mode must not write');
  const wrote = syncFleet({ write: true, targets: [t] });
  assert(wrote.wrote === 1, `write mode: expected 1 write, got ${wrote.wrote}`);
  assert(inSync(t, 'token-guard.js'), 'the target must end up byte-identical to canonical');
  assert(syncFleet({ targets: [t] }).drifted === 0, 're-check must report a clean fleet');
});

// The label is the only signal a check-mode run gives about HOW stale a target is, so its
// direction is load-bearing: it is what tells you whether to sync now or after the next commit.
test('"N lines behind" counts what the target LACKS, not what --write would drop', () => {
  const t = target({ 'token-guard.js': STALE });
  const line = syncFleet({ files: ['token-guard.js'], targets: [t] })
    .lines.find(l => l.includes('[DRIFT]'));
  const n = Number((/(\d+) lines behind/.exec(line) || [, '0'])[1]);
  const canonLines = norm(canonOf('token-guard.js')).split('\n').length;
  // A one-line target lacks essentially all of canonical. Measured the other way round it lacks
  // "1" — the junk line canonical doesn't have — which is how a 340-line drift read as "5".
  assert(n > canonLines / 2,
    `a one-line target must read as far behind; got ${n} of ${canonLines} canonical lines`);
});

test('a target holding every canonical line but still differing reads as local edits', () => {
  const t = target({ 'token-guard.js': canonOf('token-guard.js') + '\n// a local tweak\n' });
  const r = syncFleet({ files: ['token-guard.js'], targets: [t] });
  assert(r.drifted === 1, `a locally-edited copy must still count as drift, got ${r.drifted}`);
  const line = r.lines.find(l => l.includes('[DRIFT]'));
  assert(/local edits only/.test(line), `expected a local-edits label, got: ${line.trim()}`);
  assert(!/lines behind/.test(line), `it lacks nothing, so it is not behind: ${line.trim()}`);
});

// --- manifest entries that live outside .claude/hooks (`subdir`) ------------------------------
// The fleet file records each target as its .claude/hooks dir, so a rules entry has to resolve
// as that dir's SIBLING. Getting this wrong is silent: the sync reports success while the file
// lands in the hooks dir and the rule the repo actually reads never changes.

// A throwaway repo with the real .claude/<hooks|rules> shape; `dir` is the hooks dir, exactly
// as a hand-written fleet entry records it.
function repoTarget(tree, opts) {
  const o = opts || {};
  const label = o.label || `r${++seq}`;
  const root = path.join(tmpRoot, label, '.claude');
  const dir = path.join(root, 'hooks');
  for (const sub of Object.keys(tree || {})) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
    for (const name of Object.keys(tree[sub])) {
      fs.writeFileSync(path.join(root, sub, name), tree[sub][name]);
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  return { label, dir, root, isGlobal: o.isGlobal === true };
}
const readIn = (t, sub, f) => {
  try { return fs.readFileSync(path.join(t.root, sub, f), 'utf8'); } catch (_) { return null; }
};
const canonRule = f => fs.readFileSync(path.join(__dirname, '..', '.claude', 'rules', f), 'utf8');
const canonIn = (sub, f) => fs.readFileSync(path.join(__dirname, '..', '.claude', sub, f), 'utf8');

test('a rules entry syncs into .claude/rules — NOT into the hooks dir the fleet points at', () => {
  const t = repoTarget({ rules: { 'plan-authoring.md': STALE } });
  const r = syncFleet({ write: true, files: ['plan-authoring.md'], targets: [t] });
  assert(r.wrote === 1, `the adopted rule must sync, wrote ${r.wrote}`);
  assert(norm(readIn(t, 'rules', 'plan-authoring.md') || '') === norm(canonRule('plan-authoring.md')),
    '.claude/rules/plan-authoring.md must end up byte-identical to canonical');
  assert(readIn(t, 'hooks', 'plan-authoring.md') === null,
    'it must NOT be written into .claude/hooks (the dir the fleet file records)');
  assert(syncFleet({ files: ['plan-authoring.md'], targets: [t] }).drifted === 0,
    're-check must read the rule back from the same place it wrote it');
});

test('ADOPT-ONLY holds across the subdir: hooks adoption does not pull in the rule', () => {
  const t = repoTarget({ hooks: { 'token-guard.js': STALE }, rules: {} });
  syncFleet({ write: true, targets: [t] });
  assert(norm(readIn(t, 'hooks', 'token-guard.js') || '') === norm(canonOf('token-guard.js')),
    'the adopted hook must still sync');
  assert(readIn(t, 'rules', 'plan-authoring.md') === null,
    'an existing-but-empty rules dir is not adoption — the rule must NOT be created');
});

test('a pairsSubdir partner is followed ACROSS directories, and still adopt-only', () => {
  // /continue's doc calls .claude/scripts/recover-session.py. A repo given the command with
  // no script has an adopted-but-broken command — the exact state ADOPT-ONLY exists to avoid —
  // and plain pairsWith cannot prevent it: it looks only in the entry's own directory, so a
  // scripts/ entry could never see a commands/ partner.
  const adopted = repoTarget({ commands: { 'continue.md': STALE }, scripts: {} });
  syncFleet({ write: true, files: ['continue.md', 'recover-session.py'], targets: [adopted] });
  assert(norm(readIn(adopted, 'scripts', 'recover-session.py') || '')
    === norm(canonIn('scripts', 'recover-session.py')),
  'a repo holding continue.md must be given the script that doc calls');

  const unadopted = repoTarget({ commands: {}, scripts: {} });
  syncFleet({ write: true, files: ['continue.md', 'recover-session.py'], targets: [unadopted] });
  assert(readIn(unadopted, 'scripts', 'recover-session.py') === null,
    'no command, no script — a cross-subdir pair must not create into an unadopted repo');
});

test('the files filter scopes the run (sync-terminal-title.js must not touch token-guard)', () => {
  const t = target({ 'terminal-title.js': STALE, 'token-guard.js': STALE });
  syncFleet({
    write: true,
    files: ['terminal-title.js', 'terminal-title.directive.md'],
    targets: [t],
  });
  assert(inSync(t, 'terminal-title.js'), 'a named manifest entry must sync');
  assert(read(t, 'token-guard.js') === STALE, 'an unnamed entry must be left alone');
});

test('quiet mode is silent on an in-sync fleet but still reports drift', () => {
  const clean = target({
    'terminal-title.js': canonOf('terminal-title.js'),
    'terminal-title.directive.md': canonOf('terminal-title.directive.md'),
    'token-guard.js': canonOf('token-guard.js'),
    'token-guard-liveness.js': canonOf('token-guard-liveness.js'),
    'claim-registry.js': canonOf('claim-registry.js'),
  });
  assert(syncFleet({ quiet: true, targets: [clean] }).lines.length === 0,
    'an in-sync fleet must print nothing at all in quiet mode');
  assert(syncFleet({ targets: [clean] }).lines.some(l => l.includes('[ ok ]')),
    'without --quiet the same run still narrates [ ok ]');
  const dirty = target({ 'token-guard.js': STALE });
  assert(syncFleet({ quiet: true, targets: [dirty] }).lines.some(l => l.includes('[DRIFT]')),
    'quiet mode must still speak up when something drifted');
});

test('CLI: drift exits 1, --write exits 0, and --only scopes the run', () => {
  const scoped = target({ 'token-guard.js': STALE }, { label: 'scoped-repo' });
  const excluded = target({ 'token-guard.js': STALE }, { label: 'excluded-repo' });
  const fleetFile = path.join(tmpRoot, 'fleet.json');
  fs.writeFileSync(fleetFile, JSON.stringify([scoped, excluded]));

  // Handed to --only with forward slashes and the wrong case: both sides get normalized, so a
  // hand-written fleet entry and a shell-supplied path still match on Windows.
  const only = scoped.dir.replace(/\\/g, '/').toUpperCase();

  const check = runCli(['--only', only], fleetFile);
  assert(check.status === 1, `drift must exit 1 (the pre-push guard's contract), got ${check.status}`);
  assert(check.out.includes('[DRIFT]'), 'check output must name the drift');
  assert(!check.out.includes('excluded-repo'), '--only must exclude every other fleet member');

  const write = runCli(['--write', '--only', only], fleetFile);
  assert(write.status === 0, `write must exit 0, got ${write.status}`);
  assert(inSync(scoped, 'token-guard.js'), 'the scoped target must be synced');
  assert(read(excluded, 'token-guard.js') === STALE, 'the unscoped target must be untouched');
  assert(runCli(['--only', only], fleetFile).status === 0, 're-check must exit 0');
});

// --- canonical with uncommitted edits (the 2026-08-07 push block) ----------------------------
// Several sessions edit fleet-synced files in this repo by design. Reading canonical from the
// WORKING TREE meant any one of them holding a file open made every downstream copy read as
// drifted, exit 1, and block every other session's push — a `--no-verify` bypass on an 89-commit
// push, over a file nobody had committed. Check mode now asks HEAD for a second opinion.

// A throwaway CCA-shaped git repo whose canonical token-guard.js is committed, then dirtied in
// the working tree — the sibling-mid-edit state, which cannot be staged in the real repo.
function canonicalRepo(committed, workingTree) {
  const root = path.join(tmpRoot, `canon${++seq}`);
  const hooks = path.join(root, '.claude', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  fs.writeFileSync(path.join(hooks, 'token-guard.js'), committed);
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8', windowsHide: true });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('add', '-A');
  git('commit', '-qm', 'canonical');
  fs.writeFileSync(path.join(hooks, 'token-guard.js'), workingTree);
  return root;
}

test('check mode: a target matching HEAD passes while canonical has uncommitted edits', () => {
  const committed = '// canonical v1\n';
  const root = canonicalRepo(committed, committed + '// a sibling is mid-edit\n');
  // The downstream copy is current with everything that has actually been committed.
  const t = target({ 'token-guard.js': committed }, { label: 'at-head-repo' });
  const fleetFile = path.join(tmpRoot, 'fleet-head.json');
  fs.writeFileSync(fleetFile, JSON.stringify([t]));
  const args = ['--only', t.dir, '--files', 'token-guard.js'];

  const r = runCli(args, fleetFile, { CCA_CANONICAL_ROOT: root });
  assert(r.status === 0,
    `a copy matching HEAD must not fail the pre-push guard, got exit ${r.status}: ${r.out.trim()}`);
  assert(/in sync with HEAD/.test(r.out), `the reason must be narrated, got: ${r.out.trim()}`);
  assert(!r.out.includes('[DRIFT]'), 'uncommitted canonical work is not downstream drift');

  // The tolerance is exactly one deep: a copy matching NEITHER canonical is still real drift.
  const stale = target({ 'token-guard.js': STALE }, { label: 'stale-repo' });
  const staleFleet = path.join(tmpRoot, 'fleet-head-stale.json');
  fs.writeFileSync(staleFleet, JSON.stringify([stale]));
  const s = runCli(['--only', stale.dir, '--files', 'token-guard.js'], staleFleet,
    { CCA_CANONICAL_ROOT: root });
  assert(s.status === 1, `a genuinely stale copy must still exit 1, got ${s.status}`);
  assert(s.out.includes('[DRIFT]'), 'real drift must still be reported');
});

test('write mode keeps using the working tree, so edit -> --write -> commit still works', () => {
  const committed = '// canonical v1\n';
  const dirty = committed + '// not committed yet\n';
  const root = canonicalRepo(committed, dirty);
  const t = target({ 'token-guard.js': committed }, { label: 'write-tree-repo' });
  const fleetFile = path.join(tmpRoot, 'fleet-head-write.json');
  fs.writeFileSync(fleetFile, JSON.stringify([t]));

  const w = runCli(['--write', '--only', t.dir, '--files', 'token-guard.js'], fleetFile,
    { CCA_CANONICAL_ROOT: root });
  assert(w.status === 0, `--write must exit 0, got ${w.status}: ${w.out.trim()}`);
  assert(norm(read(t, 'token-guard.js') || '') === norm(dirty),
    '--write must propagate canonical AS EDITED — HEAD tolerance is a check-mode-only rule');
});

test('a value-less --files reads as absent instead of throwing', () => {
  const t = target({ 'token-guard.js': STALE }, { label: 'bare-flag-repo' });
  const fleetFile = path.join(tmpRoot, 'fleet-bare.json');
  fs.writeFileSync(fleetFile, JSON.stringify([t]));
  const r = runCli(['--only', t.dir, '--files'], fleetFile);
  assert(r.status === 1, `must still run the full manifest and report drift, got ${r.status}`);
  assert(!/TypeError/.test(r.out), `must not crash: ${r.out.trim().split('\n')[0]}`);
});

// --- wiring audit (the 2026-08-09 "in sync but inert" gap) -----------------------------------
// Byte-sync is not liveness: worktree-gate.js sat present-and-unwired in THIS repo for nine days
// while the report said [ ok ] for it everywhere, and format.js still ships to every user install
// wired by nothing. These cases pin the audit's two halves — it must find that, and it must stay
// quiet about claim-registry.js, the require()d library it would be trivial to cry wolf over.

// A throwaway repo shaped like a real adopting checkout: <root>/.claude/{hooks,settings*.json}.
// target() above hands back a BARE hooks dir whose parent is the shared tmpRoot, so a settings
// file written there would wire hooks for every other case at once.
function wiringTarget(hooks, settings) {
  const label = `w${++seq}`;
  const claudeDir = path.join(tmpRoot, label, '.claude');
  const dir = path.join(claudeDir, 'hooks');
  fs.mkdirSync(dir, { recursive: true });
  for (const n of Object.keys(hooks || {})) fs.writeFileSync(path.join(dir, n), hooks[n]);
  for (const n of Object.keys(settings || {})) fs.writeFileSync(path.join(claudeDir, n), settings[n]);
  return { label, dir };
}

// Every fixture name is zz-prefixed: the audit also reads the real ~/.claude/settings.json (one
// user-tier entry legitimately wires a hook for every repo), so a plausible name could be wired
// on the dev box and silently drop a case.
const HOOK = 'const raw = [];\nprocess.stdin.on("data", c => raw.push(c));\n';
const LIB = 'module.exports = { claim: () => true };  // no stdin: a require()d library\n';
const wiredAs = (event, file) =>
  JSON.stringify({ hooks: { [event]: [{ hooks: [{ command: `node .claude/hooks/${file}` }] }] } });

test('wiring audit: a stdin-reading hook nothing runs is reported, and is not drift', () => {
  const t = wiringTarget({ 'zz-orphan-hook.js': HOOK });
  const r = syncFleet({ targets: [t] });
  const line = r.lines.find(l => l.includes('[!wire]'));
  assert(line && line.includes('zz-orphan-hook.js'),
    `the orphan must be named, got: ${r.lines.join(' | ') || '(nothing)'}`);
  assert(r.unwired === 1, `exactly one finding, got ${r.unwired}`);
  assert(r.drifted === 0, 'an unwired hook is a finding, not drift — it must not touch the exit code');
});

test('wiring audit: a require()d library and a wired hook are both silent', () => {
  const t = wiringTarget(
    { 'zz-lib.js': LIB, 'zz-wired-hook.js': HOOK },
    { 'settings.json': wiredAs('SessionStart', 'zz-wired-hook.js') },
  );
  assert(syncFleet({ targets: [t] }).unwired === 0,
    'claim-registry.js is the real-world false positive this must never re-create');

  // settings.local.json is a first-class wiring channel, not a stray file: it is exactly where
  // CCA dogfoods worktree-gate.js, since the tracked settings.json is the SHIPPED template.
  const local = wiringTarget({ 'zz-local-hook.js': HOOK },
    { 'settings.local.json': wiredAs('PreToolUse', 'zz-local-hook.js') });
  assert(syncFleet({ targets: [local] }).unwired === 0,
    'a hook wired only in settings.local.json is live, not orphaned');
});

test('wiring audit: quiet mode (the SessionStart pull) stays out of it', () => {
  const t = wiringTarget({ 'zz-quiet-orphan.js': HOOK });
  const r = syncFleet({ quiet: true, targets: [t] });
  assert(r.unwired === 0 && !r.lines.some(l => l.includes('[!wire]')),
    'a standing condition narrated on every session start is a report that gets tuned out');
});

test('CLI: an unwired hook is reported without changing the exit code', () => {
  const t = wiringTarget({ 'zz-cli-orphan.js': HOOK });
  const fleetFile = path.join(tmpRoot, 'fleet-wire.json');
  fs.writeFileSync(fleetFile, JSON.stringify([t]));
  const r = runCli(['--only', t.dir], fleetFile);
  assert(r.status === 0,
    `a wiring finding must never block a push, got exit ${r.status}: ${r.out.trim()}`);
  assert(r.out.includes('[!wire]') && r.out.includes('zz-cli-orphan.js'),
    `the finding must still be printed, got: ${r.out.trim()}`);
  assert(/never fails/.test(r.out), 'the summary must say out loud that this is not a failure');
});

try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* best-effort */ }

summary();
