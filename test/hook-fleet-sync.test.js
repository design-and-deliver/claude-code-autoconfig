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

function runCli(args, fleetFile) {
  const r = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CCA_HOOK_FLEET_FILE: fleetFile },
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

test('the liveness canary is created wherever token-guard.js is adopted — and only there', () => {
  // A guard without its canary is a fleet gap: every token-guard handler is fail-open, so a
  // dead guard in that repo would be silent. ADOPT-ONLY still holds for everyone else.
  const adopted = target({ 'token-guard.js': canonOf('token-guard.js') });
  syncFleet({ write: true, targets: [adopted] });
  assert(inSync(adopted, 'token-guard-liveness.js'),
    'a repo with token-guard.js must be given the canary');
  const unadopted = target({});
  syncFleet({ write: true, targets: [unadopted] });
  assert(read(unadopted, 'token-guard-liveness.js') === null,
    'no guard, no canary — the pair must not create into an unadopted repo');
});

test('check mode reports drift without touching the file; --write then fixes it', () => {
  // The canary rides at canonical so the only drift in play is the one this case is about.
  const t = target({ 'token-guard.js': STALE,
    'token-guard-liveness.js': canonOf('token-guard-liveness.js') });
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

test('a value-less --files reads as absent instead of throwing', () => {
  const t = target({ 'token-guard.js': STALE }, { label: 'bare-flag-repo' });
  const fleetFile = path.join(tmpRoot, 'fleet-bare.json');
  fs.writeFileSync(fleetFile, JSON.stringify([t]));
  const r = runCli(['--only', t.dir, '--files'], fleetFile);
  assert(r.status === 1, `must still run the full manifest and report drift, got ${r.status}`);
  assert(!/TypeError/.test(r.out), `must not crash: ${r.out.trim().split('\n')[0]}`);
});

try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* best-effort */ }

summary();
