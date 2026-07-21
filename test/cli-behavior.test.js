#!/usr/bin/env node

/**
 * Behavioral install / upgrade tests (audit 02-3.4).
 *
 * Drives the REAL bin/cli.js headlessly against throwaway temp fixtures and asserts on the
 * TREE IT PRODUCES — not on cli.js source text. The pre-existing install tests grep cli.js
 * source (`cliCode.includes(...)`); those pass VACUOUSLY the moment the code they assert on is
 * moved or refactored (trap 4 / T14). This suite is the behavioral net that has to stay green
 * through the Phase-3 extractions: it exercises the install flow end to end and checks the
 * files, settings.json, and markers that actually land on disk.
 *
 * Six fixtures:
 *   1. fresh project        — `--bootstrap` into an empty dir: shipped commands present,
 *                             DEV_ONLY_FILES absent, deprecated aliases pruned, settings.json
 *                             copied whole, updates/ absent, whats-new NOT written (upgrade-only).
 *   2. upgrade w/ content    — `--bootstrap` over a configured project: user files backed up +
 *                             preserved, managed hooks refreshed, user's own hooks untouched,
 *                             settings.json MERGED not replaced, whats-new written, and the
 *                             user's @applied block preserved — a PENDING update id must not
 *                             be pre-marked applied by the upgrade (BH-3).
 *   3. populated @applied    — `--pull-updates`: already-applied updates are NOT re-copied and
 *                             the user's @applied block is preserved (exercises parseAppliedUpdates
 *                             + pullUpdates' block-preservation for real).
 *   4. legacy gls marker     — `--bootstrap` upgrade migrates an old gls.md @screenshotDir marker
 *                             into cca.config.json instead of dropping it (substep 2.8).
 *   5. legacy hook migration — `--bootstrap` upgrade migrates a pre-anchor relative terminal-title
 *                             command + dedups to ONE anchored entry (net for 3.3's extraction).
 *   6. version pin           — `--pull-updates` on a pinned project skips the refresh entirely
 *                             (net for 3.4's pullUpdates extraction).
 *
 * The `claude` binary is shimmed onto PATH so isClaudeInstalled() passes without a real install —
 * without the shim, a machine lacking Claude Code (CI) would trigger `npm install -g` mid-test.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const PKG_DIR = path.join(__dirname, '..');
const CLI_PATH = path.join(PKG_DIR, 'bin', 'cli.js');
const PKG_VERSION = require(path.join(PKG_DIR, 'package.json')).version;

// Kept in sync with bin/cli.js by substep 2.2's dev-gate-consistency test — here we only need
// a representative subset to assert absence.
const DEV_ONLY_COMMANDS = ['deploy-to-npmjs.md', 'usage-report.md', 'analyze-session.md', 'eval-new-session.md', 'migrate-new-session.md'];
const DEPRECATED_ALIASES = ['enable-arcade-beeps.md', 'disable-arcade-beeps.md'];
const SHIPPED_COMMANDS = ['autoconfig.md', 'autoconfig-update.md', 'continue.md', 'recover-context.md', 'gls.md'];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// A throwaway dir on PATH holding a `claude` that answers `claude --version` and exits 0, so
// isClaudeInstalled() returns true without a real Claude Code install (and never shells out to
// `npm install -g`). Cross-platform: .cmd on Windows, an executable shell script elsewhere.
function makeClaudeShim() {
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-shim-'));
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(shimDir, 'claude.cmd'), '@echo off\r\necho claude 1.0.0\r\n');
  } else {
    const p = path.join(shimDir, 'claude');
    fs.writeFileSync(p, '#!/bin/sh\necho claude 1.0.0\n');
    fs.chmodSync(p, 0o755);
  }
  return shimDir;
}

// Run the CLI without ever throwing. Returns { code, out } (stdout+stderr combined). CLAUDECODE
// is cleared so the inside-Claude block never fires for --bootstrap when this suite itself runs
// inside a Claude session; the shim dir is prepended to PATH (handling Windows' 'Path' casing).
function runCli(projectDir, args, shimDir) {
  const env = { ...process.env, CLAUDECODE: '' };
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = shimDir + path.delimiter + (env[pathKey] || '');
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

function makeProject(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cca-behavior-${label}-`));
}

function writeFile(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// Does any hook in `event` carry a command containing `substr`?
function hasCommandContaining(settings, event, substr) {
  const matchers = (settings.hooks && settings.hooks[event]) || [];
  return matchers.some(m => (m.hooks || []).some(h => typeof h.command === 'string' && h.command.includes(substr)));
}

const shimDir = makeClaudeShim();
const cleanups = [shimDir];

console.log('============================================================');
console.log('BEHAVIORAL INSTALL / UPGRADE TESTS');
console.log('============================================================');
console.log();

// ── Fixture 1: fresh install ────────────────────────────────────────────────
console.log('fresh install (--bootstrap into an empty dir):');

const fresh = makeProject('fresh');
cleanups.push(fresh);
const freshResult = runCli(fresh, ['--bootstrap'], shimDir);
const freshCmds = path.join(fresh, '.claude', 'commands');

test('exits 0', () => {
  assert(freshResult.code === 0, `expected exit 0, got ${freshResult.code}\n${freshResult.out}`);
});

test('shipped commands are present', () => {
  for (const c of SHIPPED_COMMANDS) {
    assert(fs.existsSync(path.join(freshCmds, c)), `expected shipped command ${c} to be installed`);
  }
});

test('DEV_ONLY_FILES are NOT installed', () => {
  for (const c of DEV_ONLY_COMMANDS) {
    assert(!fs.existsSync(path.join(freshCmds, c)), `dev-only command ${c} must not be installed`);
  }
  assert(!fs.existsSync(path.join(fresh, '.claude', 'hooks', 'token-guard.js')), 'dev-only hook token-guard.js must not be installed');
});

test('deprecated aliases are pruned on a fresh install', () => {
  for (const a of DEPRECATED_ALIASES) {
    assert(!fs.existsSync(path.join(freshCmds, a)), `deprecated alias ${a} must not be introduced on a fresh install`);
  }
});

test('settings.json is created as a full copy of the shipped template', () => {
  const dest = path.join(fresh, '.claude', 'settings.json');
  assert(fs.existsSync(dest), 'settings.json should exist');
  const shipped = fs.readFileSync(path.join(PKG_DIR, '.claude', 'settings.json'), 'utf8');
  assert(fs.readFileSync(dest, 'utf8') === shipped, 'fresh settings.json should be byte-identical to the shipped template');
});

test('.claude/updates/ is absent (updates are tracked in the @applied block, not copied)', () => {
  assert(!fs.existsSync(path.join(fresh, '.claude', 'updates')), 'updates/ must not be copied into a user project');
});

test('bundled updates are pre-marked applied in autoconfig-update.md', () => {
  const md = fs.readFileSync(path.join(freshCmds, 'autoconfig-update.md'), 'utf8');
  const block = md.match(/<!-- @applied\r?\n([\s\S]*?)-->/);
  assert(block, 'autoconfig-update.md should have an @applied block');
  assert(/^001\b/m.test(block[1]), 'the bundled updates should be pre-marked applied (expected 001 in the block)');
});

test('whats-new JSON is NOT written on a fresh install (it is an upgrade-only artifact)', () => {
  assert(!fs.existsSync(path.join(fresh, '.claude', '.autoconfig-whats-new.json')), 'whats-new must not be written on a fresh install');
});

// ── Fixture 2: upgrade over a configured project ─────────────────────────────
console.log();
console.log('upgrade over a configured project (--bootstrap):');

const up = makeProject('upgrade');
cleanups.push(up);

// A project that already ran autoconfig: CLAUDE.md marker (→ isUpgrade), an old version marker
// (→ whats-new), user content in .claude/ (→ backup), a stale MANAGED hook, the user's own hook,
// and a settings.json the merge must fold into (not replace).
writeFile(up, 'CLAUDE.md', '# My Project\n\n<!-- AUTO-GENERATED BY /autoconfig -->\n');
writeFile(up, '.claude/.autoconfig-version', '1.0.100');
writeFile(up, '.claude/my-notes.md', 'USER NOTES — keep me\n');
writeFile(up, '.claude/hooks/terminal-title.js', '// STALE managed hook — must be refreshed\n');
writeFile(up, '.claude/hooks/user-own.js', '// USER HOOK — must be left untouched\n');
writeFile(up, '.claude/settings.json', JSON.stringify({
  env: { MY_VAR: 'keep' },
  hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'node .claude/hooks/user-own.js' }] }] },
  permissions: { allow: ['Read(./**)'], deny: [] }
}, null, 2));
// The user has applied 001 + 003; bundled 004 is still PENDING. The upgrade's copyDir
// overwrites this file with the shipped empty-@applied copy — the block must be preserved,
// or the pre-mark pass refills it with ALL bundled ids and 004 never runs (BH-3).
writeFile(up, '.claude/commands/autoconfig-update.md',
  '<!-- @description test -->\n<!-- @version 1 -->\n\n<!-- @applied\n001 - Debug Methodology\n003 - Feedback to Rules\n-->\n\nold body\n');

const upResult = runCli(up, ['--bootstrap'], shimDir);
const upClaude = path.join(up, '.claude');

test('exits 0', () => {
  assert(upResult.code === 0, `expected exit 0, got ${upResult.code}\n${upResult.out}`);
});

test('user content is backed up into .claude/migration/ AND preserved in place', () => {
  const migRoot = path.join(upClaude, 'migration');
  assert(fs.existsSync(migRoot), 'migration/ backup dir should be created');
  const stamps = fs.readdirSync(migRoot).filter(e => fs.statSync(path.join(migRoot, e)).isDirectory());
  assert(stamps.length === 1, `expected exactly one dated backup folder, found ${stamps.length}`);
  assert(fs.existsSync(path.join(migRoot, stamps[0], 'my-notes.md')), 'user file should be copied into the backup');
  assert(fs.existsSync(path.join(upClaude, 'my-notes.md')), 'user file should still be present in .claude/ (backup copies, never moves)');
});

test('managed hook (terminal-title.js) is refreshed to the shipped version', () => {
  const shipped = fs.readFileSync(path.join(PKG_DIR, '.claude', 'hooks', 'terminal-title.js'), 'utf8');
  const installed = fs.readFileSync(path.join(upClaude, 'hooks', 'terminal-title.js'), 'utf8');
  assert(installed === shipped, 'stale managed hook must be overwritten with the shipped copy');
});

test("user's own hook is left untouched", () => {
  const installed = fs.readFileSync(path.join(upClaude, 'hooks', 'user-own.js'), 'utf8');
  assert(installed === '// USER HOOK — must be left untouched\n', "user's own hook must be preserved verbatim");
});

test('settings.json is MERGED, not replaced (user env + hook kept; shipped contributions folded in)', () => {
  const merged = readJson(path.join(upClaude, 'settings.json'));
  const pkg = readJson(path.join(PKG_DIR, '.claude', 'settings.json'));
  // User's own values survive.
  assert(merged.env && merged.env.MY_VAR === 'keep', "user's env var MY_VAR must be preserved");
  assert(hasCommandContaining(merged, 'Stop', 'user-own.js'), "user's own Stop hook must be preserved");
  // Shipped contributions are folded in.
  for (const k of Object.keys(pkg.env)) {
    assert(merged.env[k] === pkg.env[k], `shipped env key ${k} should be merged in`);
  }
  assert(hasCommandContaining(merged, 'Stop', 'terminal-title.js'), 'shipped Stop hook should be merged in');
  assert(merged.hooks.SessionStart && merged.hooks.PreToolUse, 'shipped hook events should be merged in');
  assert(merged.permissions.allow.includes('WebSearch'), 'shipped allow rule should be merged in');
  assert(merged.permissions.allow.includes('Read(./**)'), "user's allow rule should be preserved");
  // A replace would have dropped MY_VAR / user-own.js — prove it's not a byte copy of the template.
  assert(JSON.stringify(merged) !== JSON.stringify(pkg), 'merged settings must not equal the shipped template verbatim');
});

test('whats-new JSON is written on upgrade with the correct from/to', () => {
  const wn = path.join(upClaude, '.autoconfig-whats-new.json');
  assert(fs.existsSync(wn), 'whats-new JSON should be written on upgrade');
  const j = readJson(wn);
  assert(j.from === '1.0.100', `whats-new .from should be the previous version, got ${j.from}`);
  assert(j.to === PKG_VERSION, `whats-new .to should be the current version ${PKG_VERSION}, got ${j.to}`);
});

test('a PENDING update id is NOT marked applied by the upgrade (BH-3)', () => {
  const md = fs.readFileSync(path.join(upClaude, 'commands', 'autoconfig-update.md'), 'utf8');
  const block = md.match(/<!-- @applied\r?\n([\s\S]*?)-->/);
  assert(block, 'upgraded autoconfig-update.md should still have an @applied block');
  const ids = block[1].trim().split('\n').map(l => (l.match(/^(\d{3})/) || [])[1]).filter(Boolean);
  assert(ids.includes('001') && ids.includes('003'), `the user's applied ids (001, 003) must survive the upgrade, got: ${ids.join(', ') || '(empty)'}`);
  assert(!ids.includes('004'), 'pending update 004 must NOT be pre-marked applied — it has not run, and --pull-updates must still deliver it');
  assert(ids.length === 2, `only the user's applied ids belong in the block, got: ${ids.join(', ')}`);
  assert(!md.includes('old body'), 'the command body itself should still be refreshed to the shipped version');
});

// ── Fixture 3: --pull-updates preserves a populated @applied block ────────────
console.log();
console.log('--pull-updates over a project with a populated @applied block:');

const pull = makeProject('pull');
cleanups.push(pull);

// autoconfig-update.md marks ONLY update 001 as applied. Package ships 001, 003, 004.
// Expect: 003 + 004 get copied (id > highestApplied=1); 001 does NOT; the block is preserved.
writeFile(pull, '.claude/commands/autoconfig-update.md',
  '<!-- @description test -->\n<!-- @version 1 -->\n\n<!-- @applied\n001 - Debug Methodology\n-->\n\nbody\n');

const pullResult = runCli(pull, ['--pull-updates'], shimDir);
const pullUpdatesDir = path.join(pull, '.claude', 'updates');

test('exits 0', () => {
  assert(pullResult.code === 0, `expected exit 0, got ${pullResult.code}\n${pullResult.out}`);
});

test('already-applied update (001) is NOT re-copied', () => {
  assert(!fs.existsSync(path.join(pullUpdatesDir, '001-debug-methodology.md')), 'update 001 is already applied and must not be re-copied');
});

test('newer updates (003, 004) ARE copied', () => {
  assert(fs.existsSync(path.join(pullUpdatesDir, '003-feedback-to-rules-migration.md')), 'update 003 should be copied (id > highest applied)');
  assert(fs.existsSync(path.join(pullUpdatesDir, '004-feedback-to-discoveries-migration.md')), 'update 004 should be copied (id > highest applied)');
});

test("the user's @applied block is preserved (not wiped or re-marked)", () => {
  const md = fs.readFileSync(path.join(pull, '.claude', 'commands', 'autoconfig-update.md'), 'utf8');
  const block = md.match(/<!-- @applied\r?\n([\s\S]*?)-->/);
  assert(block, 'refreshed autoconfig-update.md should still have an @applied block');
  assert(/001 - Debug Methodology/.test(block[1]), "the user's applied entry (001) must be preserved");
  assert(!/003/.test(block[1]) && !/004/.test(block[1]), 'pull-updates must not re-mark newer updates as applied in the block');
});

// ── Fixture 4: legacy gls @screenshotDir migration ──────────────────────────
// Very old installs stored the /gls path in a first-line marker inside gls.md. Shipped gls.md
// (v5+) has no marker, so the old in-file re-insert dropped it silently. Upgrade must migrate
// the value into cca.config.json gls.screenshotDir instead (audit 01-A5 / T17, substep 2.8).
console.log();
console.log('legacy gls @screenshotDir migration (--bootstrap upgrade):');

const LEGACY_DIR = 'C:/Users/jane/Pictures/Screenshots';

// Build an "old install" fixture: CLAUDE.md marker (→ upgrade) + a gls.md whose first line
// carries the legacy @screenshotDir marker, plus an optional starting cca.config.json.
function makeLegacyGls(label, configObj) {
  const dir = makeProject(label);
  cleanups.push(dir);
  writeFile(dir, 'CLAUDE.md', '# Legacy\n\n<!-- AUTO-GENERATED BY /autoconfig -->\n');
  writeFile(dir, '.claude/.autoconfig-version', '1.0.50');
  writeFile(dir, '.claude/commands/gls.md',
    `<!-- @screenshotDir ${LEGACY_DIR} -->\n<!-- @description old -->\n<!-- @version 1 -->\nold body\n`);
  if (configObj) writeFile(dir, '.claude/cca.config.json', JSON.stringify(configObj, null, 2));
  const result = runCli(dir, ['--bootstrap'], shimDir);
  return { dir, result, cfgPath: path.join(dir, '.claude', 'cca.config.json') };
}

// (a) No prior config → the marker is migrated into a freshly written cca.config.json.
const glsA = makeLegacyGls('gls-migrate', null);

test('(a) exits 0', () => {
  assert(glsA.result.code === 0, `expected exit 0, got ${glsA.result.code}\n${glsA.result.out}`);
});

test('(a) legacy @screenshotDir is migrated into cca.config.json gls.screenshotDir', () => {
  assert(fs.existsSync(glsA.cfgPath), 'cca.config.json should be written by the migration');
  const cfg = readJson(glsA.cfgPath);
  assert(cfg.gls && cfg.gls.screenshotDir === LEGACY_DIR,
    `expected migrated screenshotDir ${LEGACY_DIR}, got ${JSON.stringify(cfg.gls)}`);
});

test('(a) migration prints a preservation notice naming the folder', () => {
  assert(/screenshot folder/i.test(glsA.result.out), `expected a preservation notice, got:\n${glsA.result.out}`);
});

// (b) Config exists WITHOUT gls.screenshotDir → value is added and every other key round-trips.
const glsB = makeLegacyGls('gls-roundtrip', { gls: { maxEdge: 900 }, keepMe: true });

test('(b) migration preserves unrelated config keys (round-trip, trap 1)', () => {
  const cfg = readJson(glsB.cfgPath);
  assert(cfg.gls.screenshotDir === LEGACY_DIR, 'screenshotDir should be migrated in');
  assert(cfg.gls.maxEdge === 900, 'existing gls.maxEdge must be preserved');
  assert(cfg.keepMe === true, 'unrelated top-level key must be preserved');
});

// (c) Config already has a gls.screenshotDir → the legacy marker must NOT clobber it.
const glsC = makeLegacyGls('gls-noclobber', { gls: { screenshotDir: 'D:/already/set' } });

test('(c) an existing gls.screenshotDir is not clobbered by the legacy marker', () => {
  const cfg = readJson(glsC.cfgPath);
  assert(cfg.gls.screenshotDir === 'D:/already/set',
    `existing screenshotDir must win, got ${cfg.gls.screenshotDir}`);
  assert(!/screenshot folder/i.test(glsC.result.out), 'no notice should print when nothing was migrated');
});

// ── Fixture 5: legacy hook-command migration dedups on upgrade ───────────────
// A configured project whose settings.json still carries the pre-2026-07-08 RELATIVE
// terminal-title command (`node .claude/hooks/terminal-title.js`). The upgrade must migrate
// it to the anchored form BEFORE merging the shipped (already-anchored) fragment, yielding
// exactly ONE anchored entry — not a legacy+anchored double. Behavioral replacement for the
// source-extraction tests in cli-install.test.js (extractCliFn migrateLegacyHookCommands /
// mergeSettingsInto), so substep 3.3 can move those helpers into bin/lib/settings-merge.js
// without the source-greps going vacuous (trap 4 / T14).
console.log();
console.log('legacy hook-command migration dedups on upgrade (--bootstrap):');

const legacyHook = makeProject('legacy-hook');
cleanups.push(legacyHook);
writeFile(legacyHook, 'CLAUDE.md', '# Legacy hook\n\n<!-- AUTO-GENERATED BY /autoconfig -->\n');
writeFile(legacyHook, '.claude/.autoconfig-version', '1.0.100');
writeFile(legacyHook, '.claude/settings.json', JSON.stringify({
  hooks: { Stop: [{ matcher: '', hooks: [
    { type: 'command', command: 'node .claude/hooks/terminal-title.js' }
  ] }] }
}, null, 2));

const legacyResult = runCli(legacyHook, ['--bootstrap'], shimDir);

test('exits 0', () => {
  assert(legacyResult.code === 0, `expected exit 0, got ${legacyResult.code}\n${legacyResult.out}`);
});

test('a legacy relative terminal-title Stop hook is migrated + deduped to ONE anchored entry', () => {
  const merged = readJson(path.join(legacyHook, '.claude', 'settings.json'));
  const cmds = ((merged.hooks && merged.hooks.Stop) || [])
    .flatMap(m => (m.hooks || []).map(h => h.command))
    .filter(c => typeof c === 'string' && c.includes('terminal-title.js'));
  assert(cmds.length === 1, `expected exactly ONE terminal-title Stop entry after upgrade, got ${cmds.length}: ${cmds.join(' | ')}`);
  assert(cmds[0].includes('${CLAUDE_PROJECT_DIR:-.}'), `surviving entry must be the anchored form, got: ${cmds[0]}`);
});

// ── Fixture 6: --pull-updates respects a version pin ─────────────────────────
// A pinned project (cca.config.json pinVersion ≠ installer version) must make pullUpdates
// return BEFORE refreshing anything. Same fixture as Fixture 3 but pinned — Fixture 3 proves
// this setup copies 003/004 unpinned, so "copies nothing" here isolates the pin as the cause.
// Behavioral replacement for the `function pullUpdates() { … pinnedVersion … }` source-grep in
// cli-install.test.js, so substep 3.4 can move pullUpdates into bin/lib/updates.js safely.
console.log();
console.log('--pull-updates respects a version pin:');

const pinned = makeProject('pinned');
cleanups.push(pinned);
writeFile(pinned, '.claude/cca.config.json', JSON.stringify({ pinVersion: '0.0.1' }, null, 2));
writeFile(pinned, '.claude/commands/autoconfig-update.md',
  '<!-- @description test -->\n<!-- @version 1 -->\n\n<!-- @applied\n001 - Debug Methodology\n-->\n\nbody\n');

const pinnedResult = runCli(pinned, ['--pull-updates'], shimDir);

test('exits 0', () => {
  assert(pinnedResult.code === 0, `expected exit 0, got ${pinnedResult.code}\n${pinnedResult.out}`);
});

test('a pinned project skips the update pull (prints the pin notice, copies nothing)', () => {
  assert(/skipped the v[\d.]+ update pull/i.test(pinnedResult.out) || /Pinned to v0\.0\.1/.test(pinnedResult.out),
    `expected the pin-skip notice, got:\n${pinnedResult.out}`);
  const updatesDir = path.join(pinned, '.claude', 'updates');
  const copied = fs.existsSync(updatesDir) ? fs.readdirSync(updatesDir) : [];
  assert(copied.length === 0, `a pinned pull must copy no updates, found: ${copied.join(', ')}`);
});

// ── nul-cleanup is guarded to Windows (BH-8) ─────────────────────────────────
// A stray `nul` file is only a Windows `> nul` redirect artifact. On POSIX a file named `nul`
// is a real file the user created and must survive. Drives the extracted helper directly with an
// injected platform so the guard is proven on ANY OS — on this Windows box a `--bootstrap` fixture
// can't demonstrate POSIX survival (win32 would legitimately delete it).
console.log();
console.log('nul-cleanup is guarded to Windows (BH-8):');

const { cleanupNulFile } = require('../bin/lib/nul-cleanup.js');

test('a real `nul` file survives cleanup on POSIX (linux + darwin)', () => {
  const dir = makeProject('nul-posix');
  cleanups.push(dir);
  const nulPath = path.join(dir, 'nul');
  fs.writeFileSync(nulPath, 'user data');
  cleanupNulFile(dir, 'linux');
  assert(fs.existsSync(nulPath), 'a `nul` file on Linux must not be deleted');
  cleanupNulFile(dir, 'darwin');
  assert(fs.existsSync(nulPath), 'a `nul` file on macOS must not be deleted');
  fs.unlinkSync(nulPath); // leave the temp dir clean for the recursive remove below
});

test('the stray `nul` artifact is still removed on Windows', () => {
  const dir = makeProject('nul-win');
  cleanups.push(dir);
  const nulPath = path.join(dir, 'nul');
  fs.writeFileSync(nulPath, 'redirect artifact');
  cleanupNulFile(dir, 'win32');
  assert(!fs.existsSync(nulPath), 'the Windows `nul` artifact must still be cleaned up');
});

// ── Cleanup ──────────────────────────────────────────────────────────────────
for (const dir of cleanups) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
}

console.log();
console.log('============================================================');
if (failed === 0) {
  console.log(`ALL TESTS PASSED (${passed} tests)`);
} else {
  console.log(`TESTS FAILED: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
