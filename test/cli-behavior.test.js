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
 * Fixtures:
 *   1. fresh project        — `--bootstrap` into an empty dir: shipped commands present,
 *                             DEV_ONLY_FILES absent, deprecated aliases pruned, settings.json
 *                             copied whole, updates/ absent, whats-new NOT written (upgrade-only),
 *                             version marker written, run reported as fresh.
 *   2. upgrade w/ content    — `--bootstrap` over a configured project: user files backed up +
 *                             preserved, managed hooks refreshed, user's own hooks untouched,
 *                             settings.json MERGED not replaced, whats-new written (with the
 *                             rendered segments), version marker advanced, upgrade detection
 *                             reported, no unsupported-version notice, and the user's @applied
 *                             block preserved — a PENDING update id must not be pre-marked
 *                             applied by the upgrade (BH-3), and un-gated 1.0.224 token-guard
 *                             leftovers (files + hook entries) are retracted.
 *   2b. paid activation      — `--bootstrap` upgrade over a project with a
 *                             tokenGuard.verdictServiceKey: the licensed token-guard files and
 *                             hook entries survive the retraction untouched.
 *   3. populated @applied    — `--pull-updates`: already-applied updates are NOT re-copied and
 *                             the user's @applied block is preserved (exercises parseAppliedUpdates
 *                             + pullUpdates' block-preservation for real).
 *   4. legacy gls marker     — `--bootstrap` upgrade migrates an old gls.md @screenshotDir marker
 *                             into cca.config.json instead of dropping it (substep 2.8).
 *   5. legacy hook migration — `--bootstrap` upgrade migrates a pre-anchor relative terminal-title
 *                             command + dedups to ONE anchored entry (net for 3.3's extraction).
 *   6. version pin           — `--pull-updates` on a pinned project skips the refresh entirely
 *                             (net for 3.4's pullUpdates extraction).
 *   7. preserve-vs-refresh   — upgrade WITHOUT --force: user-EDITED copies of shipped files are
 *                             preserved in the user-authorable classes (feedback/, non-managed
 *                             hooks/) but refreshed in the cca-managed classes (commands/,
 *                             scripts/) — the per-file-class copy matrix (clean-code 2.1a).
 *   8. --force overwrite     — `--bootstrap --force`: the preserved classes ARE refreshed and
 *                             settings.json is REPLACED with the template (no merge) — while
 *                             the user's OWN files still survive (--force is not a wipe).
 *   9. docs-HTML detection   — upgrade is detected from autoconfig.docs.html ALONE (no
 *                             CLAUDE.md): the second upgrade indicator, proven behaviorally
 *                             by the upgrade-only whats-new artifact appearing (clean-code 2.1b).
 *  10. same-version re-run   — an upgrade whose version marker already matches the installer
 *                             writes NO whats-new (the version-changed gate).
 *  11. unsupported old ver   — old version marker + never-configured project: the "no longer
 *                             supported" notice prints AND the sweep to latest still proceeds.
 *  12. interactive launch    — the real no-flag flow, ENTER piped to stdin: READY TO CONFIGURE
 *                             + /autoconfig on fresh vs READY TO UPDATE + /autoconfig-update on
 *                             upgrade (the launched `claude` is the PATH shim, so it's instant).
 *  13. settings.local scrub  — retired Write(...) permission rules are stripped from
 *                             settings.local.json on EVERY install path (it is user-owned, so
 *                             no shipped copy ever replaces it), the user's own rules/env
 *                             survive, nothing is merged IN, an unaffected file is left
 *                             byte-identical, and a corrupt one warns without losing data.
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
const DEV_ONLY_COMMANDS = ['deploy-to-npmjs.md', 'usage-report.md', 'analyze-session.md', 'migrate-new-session.md', 'enable-retro.md'];
const RETIRED_COMMANDS = ['enable-arcade-beeps.md', 'disable-arcade-beeps.md'];
const SHIPPED_COMMANDS = ['autoconfig.md', 'autoconfig-update.md', 'continue.md', 'recover-context.md', 'gls.md'];

const { test, assert, summary, makeClaudeShim, runCli } = require('./_harness');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
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
  assert(!fs.existsSync(path.join(fresh, '.claude', 'hooks', 'token-guard-liveness.js')), 'dev-only hook token-guard-liveness.js must not be installed');
  assert(!fs.existsSync(path.join(fresh, '.claude', 'agents', 'create-retro-item.md')), 'dev-only agent create-retro-item.md must not be installed');
});

test('retired commands are never installed fresh', () => {
  for (const a of RETIRED_COMMANDS) {
    assert(!fs.existsSync(path.join(freshCmds, a)), `retired command ${a} must not be installed`);
  }
});

test('every file class lands (docs, agents, feedback, hooks, scripts, sounds)', () => {
  const expect = [
    ['docs', 'autoconfig.docs.html'],
    ['agents', 'docs-refresh.md'],
    ['feedback', 'FEEDBACK.md'],
    ['hooks', 'format.js'],
    ['hooks', 'terminal-title.js'],
    ['scripts', 'sync-docs.js'],
    ['sounds', 'pp3-getready-G4.wav']
  ];
  for (const [dir, file] of expect) {
    assert(fs.existsSync(path.join(fresh, '.claude', dir, file)), `expected ${dir}/${file} to be installed`);
  }
});

test('docs/ lands as .html only', () => {
  // Weak pin: the package currently ships only .html docs, so this can't catch the filter
  // being dropped until a non-html file appears in the package docs/ — but it fails the
  // moment both happen, which the source-grep it replaces couldn't promise either.
  const installed = fs.readdirSync(path.join(fresh, '.claude', 'docs'));
  assert(installed.length > 0 && installed.every(f => f.endsWith('.html')),
    `installed docs/ must contain only .html files, got: ${installed.join(', ')}`);
});

test('dev-only scripts are NOT installed', () => {
  for (const f of ['whats-happening.js', 'plan-progress.js']) {
    assert(!fs.existsSync(path.join(fresh, '.claude', 'scripts', f)), `dev-only script ${f} must not be installed`);
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

test('the version marker is written with the installer version', () => {
  const marker = path.join(fresh, '.claude', '.autoconfig-version');
  assert(fs.existsSync(marker), '.autoconfig-version should be written on install');
  const v = fs.readFileSync(marker, 'utf8').trim();
  assert(v === PKG_VERSION, `version marker should be ${PKG_VERSION}, got ${v}`);
});

test('the run reports itself as a fresh install (not an upgrade)', () => {
  assert(/Install type: fresh/.test(freshResult.out), `expected the fresh-install report line, got:\n${freshResult.out}`);
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
  hooks: {
    Stop: [
      { matcher: '', hooks: [{ type: 'command', command: 'node .claude/hooks/user-own.js' }] },
      { matcher: '', hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/token-guard.js"' }] }
    ],
    PostToolUse: [{ matcher: 'Read|Grep|Glob|Bash|PowerShell|WebFetch|WebSearch|Skill|Agent|TaskOutput|ToolSearch', hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/token-guard.js"' }] }]
  },
  permissions: { allow: ['Read(./**)'], deny: [] }
}, null, 2));
// Leftovers from the un-gated 1.0.224 window (no paid key in cca.config.json) — the
// upgrade must retract the files AND the settings entries above (see cli.js retraction).
writeFile(up, '.claude/hooks/token-guard.js', '// un-gated 1.0.224 leftover — must be removed\n');
writeFile(up, '.claude/commands/cost-control-details.md', '<!-- @description leftover -->\n');
// Retired deprecated aliases left behind by an older install — the upgrade must delete them
// (copyTree no longer writes them, but a stale .md is still a live slash command).
for (const a of RETIRED_COMMANDS) writeFile(up, `.claude/commands/${a}`, '<!-- @description deprecated alias leftover -->\n');
// Dev-gated (not retired) files an older install picked up while they still shipped — the
// upgrade must leave them alone: gating stops NEW installs, it never deletes what a user has.
writeFile(up, '.claude/commands/enable-retro.md', '<!-- @description older shipped copy -->\n');
writeFile(up, '.claude/agents/create-retro-item.md', '<!-- @description older shipped copy -->\n');
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

test('retired command aliases left by an older install are removed on upgrade', () => {
  for (const a of RETIRED_COMMANDS) {
    assert(!fs.existsSync(path.join(upClaude, 'commands', a)), `retired command ${a} must be removed on upgrade`);
  }
  assert(/Removed retired command/.test(upResult.out), 'the upgrade should report the removal');
});

test('dev-gated retro files an older install already holds survive the upgrade', () => {
  assert(fs.existsSync(path.join(upClaude, 'commands', 'enable-retro.md')), 'existing enable-retro.md must be preserved');
  assert(fs.existsSync(path.join(upClaude, 'agents', 'create-retro-item.md')), 'existing create-retro-item.md must be preserved');
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

test('upgrade adds the shipped outputStyle when the project had none', () => {
  const merged = readJson(path.join(upClaude, 'settings.json'));
  assert(merged.outputStyle === 'Concise', `outputStyle should be folded in on upgrade, got ${JSON.stringify(merged.outputStyle)}`);
});

test('whats-new JSON is written on upgrade with the correct from/to and rendered segments', () => {
  const wn = path.join(upClaude, '.autoconfig-whats-new.json');
  assert(fs.existsSync(wn), 'whats-new JSON should be written on upgrade');
  const j = readJson(wn);
  assert(j.from === '1.0.100', `whats-new .from should be the previous version, got ${j.from}`);
  assert(j.to === PKG_VERSION, `whats-new .to should be the current version ${PKG_VERSION}, got ${j.to}`);
  assert(Array.isArray(j.segments) && j.segments.length > 0, 'whats-new should carry the rendered summary segments for /autoconfig-update to display');
  assert(j.segments.every(s => typeof s.kind === 'string' && typeof s.text === 'string'), 'each whats-new segment should be a {kind, text} pair');
});

test('upgrade is detected via the CLAUDE.md marker (and reported)', () => {
  assert(/Upgrade detected: CLAUDE\.md has autoconfig marker/.test(upResult.out),
    `expected the CLAUDE.md-marker detection line, got:\n${upResult.out}`);
});

test('the version marker is advanced to the installer version', () => {
  const v = fs.readFileSync(path.join(upClaude, '.autoconfig-version'), 'utf8').trim();
  assert(v === PKG_VERSION, `version marker should advance 1.0.100 → ${PKG_VERSION}, got ${v}`);
});

test('a routine upgrade of a configured project prints no unsupported-version notice', () => {
  assert(!/no longer supported/.test(upResult.out),
    `the unsupported-version notice must not fire on a configured project, got:\n${upResult.out}`);
});

test('un-gated token-guard leftovers are retracted on upgrade (no paid key)', () => {
  assert(!fs.existsSync(path.join(upClaude, 'hooks', 'token-guard.js')), 'leftover token-guard.js must be removed');
  assert(!fs.existsSync(path.join(upClaude, 'commands', 'cost-control-details.md')), 'leftover cost-control-details.md must be removed');
  const merged = readJson(path.join(upClaude, 'settings.json'));
  assert(!hasCommandContaining(merged, 'Stop', 'token-guard.js'), 'token-guard Stop entry must be stripped');
  assert(!hasCommandContaining(merged, 'PostToolUse', 'token-guard.js'), 'token-guard PostToolUse entry must be stripped');
  assert(hasCommandContaining(merged, 'Stop', 'user-own.js'), "stripping must not touch the user's own hooks");
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

// ── Fixture 2b: a paid activation survives the token-guard retraction ─────────
console.log();
console.log('upgrade with a paid token-guard activation (--bootstrap):');

const paid = makeProject('paid-activation');
cleanups.push(paid);
writeFile(paid, 'CLAUDE.md', '# My Project\n\n<!-- AUTO-GENERATED BY /autoconfig -->\n');
writeFile(paid, '.claude/.autoconfig-version', '1.0.224');
// The paid key marks these files as licensed-path deliveries, not un-gated leftovers.
writeFile(paid, '.claude/cca.config.json', JSON.stringify({ tokenGuard: { verdictServiceKey: 'lic_test' } }, null, 2));
writeFile(paid, '.claude/hooks/token-guard.js', '// licensed copy — must survive\n');
writeFile(paid, '.claude/commands/cost-control-details.md', '<!-- licensed copy — must survive -->\n');
writeFile(paid, '.claude/settings.json', JSON.stringify({
  hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/token-guard.js"' }] }] }
}, null, 2));

const paidResult = runCli(paid, ['--bootstrap'], shimDir);
const paidClaude = path.join(paid, '.claude');

test('exits 0', () => {
  assert(paidResult.code === 0, `expected exit 0, got ${paidResult.code}\n${paidResult.out}`);
});

test('licensed token-guard files and hook entries survive the upgrade', () => {
  assert(fs.existsSync(path.join(paidClaude, 'hooks', 'token-guard.js')), 'licensed token-guard.js must survive');
  assert(fs.existsSync(path.join(paidClaude, 'commands', 'cost-control-details.md')), 'licensed cost-control-details.md must survive');
  const merged = readJson(path.join(paidClaude, 'settings.json'));
  assert(hasCommandContaining(merged, 'Stop', 'token-guard.js'), 'licensed token-guard Stop entry must survive');
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

// ── Fixture 7: preserve-vs-refresh matrix on upgrade (no --force) ────────────
// The per-file-class copy semantics (clean-code 2.1a): user-EDITED copies of shipped files
// are preserved in the user-authorable classes (feedback/ + non-managed hooks/, via
// copyDirIfMissing) but refreshed in the cca-managed classes (commands/ + scripts/, via
// copyDir). Fixture 2 already proves the managed-hook refresh and the user's-own-file
// survival; this one pins the EDITED-shipped-file matrix. CLAUDE.md carries a
// ## Discoveries section so the one-time FEEDBACK.md→Discoveries migration stays out of
// the way — this fixture is about the copy layer, not the migration.
console.log();
console.log('preserve-vs-refresh per file class (--bootstrap upgrade, no --force):');

const USER_EDIT = '// USER EDIT — survives an unforced upgrade\n';
const CONFIGURED_CLAUDE_MD = '# P\n\n<!-- AUTO-GENERATED BY /autoconfig -->\n\n## Discoveries\n';

const matrix = makeProject('matrix');
cleanups.push(matrix);
writeFile(matrix, 'CLAUDE.md', CONFIGURED_CLAUDE_MD);
writeFile(matrix, '.claude/feedback/FEEDBACK.md', USER_EDIT);
writeFile(matrix, '.claude/hooks/format.js', USER_EDIT);
writeFile(matrix, '.claude/commands/continue.md', '<!-- @description old -->\n<!-- @version 1 -->\n\nold body\n');
writeFile(matrix, '.claude/scripts/sync-docs.js', USER_EDIT);

const matrixResult = runCli(matrix, ['--bootstrap'], shimDir);

test('exits 0', () => {
  assert(matrixResult.code === 0, `expected exit 0, got ${matrixResult.code}\n${matrixResult.out}`);
});

test('a user-edited feedback file is preserved (feedback/ is user-authorable)', () => {
  const installed = fs.readFileSync(path.join(matrix, '.claude', 'feedback', 'FEEDBACK.md'), 'utf8');
  assert(installed === USER_EDIT, 'user-edited FEEDBACK.md must survive an unforced upgrade');
});

test('a user-edited non-managed hook (format.js) is preserved', () => {
  const installed = fs.readFileSync(path.join(matrix, '.claude', 'hooks', 'format.js'), 'utf8');
  assert(installed === USER_EDIT, 'user-edited format.js must survive an unforced upgrade (not in MANAGED_HOOKS)');
});

test('a user-edited shipped command is refreshed (commands/ is cca-managed)', () => {
  const shipped = fs.readFileSync(path.join(PKG_DIR, '.claude', 'commands', 'continue.md'), 'utf8');
  const installed = fs.readFileSync(path.join(matrix, '.claude', 'commands', 'continue.md'), 'utf8');
  assert(installed === shipped, 'an edited shipped command must be overwritten with the shipped copy');
});

test('a user-edited shipped script is refreshed (scripts/ is cca-managed)', () => {
  const shipped = fs.readFileSync(path.join(PKG_DIR, '.claude', 'scripts', 'sync-docs.js'), 'utf8');
  const installed = fs.readFileSync(path.join(matrix, '.claude', 'scripts', 'sync-docs.js'), 'utf8');
  assert(installed === shipped, 'an edited shipped script must be overwritten with the shipped copy');
});

// ── Fixture 8: --force refreshes the preserved classes, replaces settings ────
// --force flips the preserve classes to overwrite and REPLACES settings.json with the
// shipped template (no merge) — but it only ever copies what the package ships: the
// user's OWN files (not present in the package) must survive. --bootstrap rides along so
// the run exits before the interactive ENTER prompt.
console.log();
console.log('--force overwrite (--bootstrap --force):');

const forced = makeProject('force');
cleanups.push(forced);
writeFile(forced, 'CLAUDE.md', CONFIGURED_CLAUDE_MD);
writeFile(forced, '.claude/feedback/FEEDBACK.md', USER_EDIT);
writeFile(forced, '.claude/hooks/format.js', USER_EDIT);
writeFile(forced, '.claude/hooks/user-own.js', '// USER HOOK — survives --force\n');
writeFile(forced, '.claude/my-notes.md', 'USER NOTES — survive --force\n');
writeFile(forced, '.claude/settings.json', JSON.stringify({ env: { MY_VAR: 'gone-under-force' } }, null, 2));

const forcedResult = runCli(forced, ['--bootstrap', '--force'], shimDir);

test('exits 0', () => {
  assert(forcedResult.code === 0, `expected exit 0, got ${forcedResult.code}\n${forcedResult.out}`);
});

test('--force refreshes the otherwise-preserved classes (feedback + non-managed hook)', () => {
  for (const rel of [['feedback', 'FEEDBACK.md'], ['hooks', 'format.js']]) {
    const shipped = fs.readFileSync(path.join(PKG_DIR, '.claude', ...rel), 'utf8');
    const installed = fs.readFileSync(path.join(forced, '.claude', ...rel), 'utf8');
    assert(installed === shipped, `${rel.join('/')} must be overwritten with the shipped copy under --force`);
  }
});

test('--force REPLACES settings.json with the shipped template (no merge)', () => {
  const shipped = fs.readFileSync(path.join(PKG_DIR, '.claude', 'settings.json'), 'utf8');
  const installed = fs.readFileSync(path.join(forced, '.claude', 'settings.json'), 'utf8');
  assert(installed === shipped, 'forced settings.json must be byte-identical to the shipped template');
  assert(!installed.includes('MY_VAR'), 'the pre-force user env var must be gone (replaced, not merged)');
});

test("--force never deletes the user's own files", () => {
  const hook = fs.readFileSync(path.join(forced, '.claude', 'hooks', 'user-own.js'), 'utf8');
  assert(hook === '// USER HOOK — survives --force\n', "user's own hook must survive --force verbatim");
  const notes = fs.readFileSync(path.join(forced, '.claude', 'my-notes.md'), 'utf8');
  assert(notes === 'USER NOTES — survive --force\n', "user's own top-level file must survive --force verbatim");
});

// ── Fixture 9: upgrade detection via docs HTML alone ─────────────────────────
// The SECOND upgrade indicator: no CLAUDE.md at all, but .claude/docs/autoconfig.docs.html
// exists (a unique autoconfig artifact). The run must behave as an upgrade — proven by the
// detection report AND by the upgrade-only whats-new artifact appearing. With no version
// marker, whats-new .from is unknown (null) — deliberately not pinned here.
console.log();
console.log('upgrade detection via docs HTML alone (--bootstrap):');

const docsOnly = makeProject('docs-only');
cleanups.push(docsOnly);
writeFile(docsOnly, '.claude/docs/autoconfig.docs.html', '<html>stale docs</html>\n');

const docsOnlyResult = runCli(docsOnly, ['--bootstrap'], shimDir);

test('exits 0', () => {
  assert(docsOnlyResult.code === 0, `expected exit 0, got ${docsOnlyResult.code}\n${docsOnlyResult.out}`);
});

test('upgrade is detected via the docs HTML (and reported)', () => {
  assert(/Upgrade detected: autoconfig\.docs\.html exists/.test(docsOnlyResult.out),
    `expected the docs-html detection line, got:\n${docsOnlyResult.out}`);
});

test('the upgrade-only whats-new artifact is written (proves isUpgrade behaviorally)', () => {
  const wn = path.join(docsOnly, '.claude', '.autoconfig-whats-new.json');
  assert(fs.existsSync(wn), 'whats-new should be written — docs-html detection makes this run an upgrade');
  assert(readJson(wn).to === PKG_VERSION, `whats-new .to should be ${PKG_VERSION}`);
});

// ── Fixture 10: same-version re-run writes no whats-new ──────────────────────
// whats-new is written only when the version actually CHANGES; an upgrade re-run whose
// marker already matches the installer must not fabricate one. Together with Fixture 2
// (old marker → written) this pins the version-changed gate behaviorally.
console.log();
console.log('same-version re-run (--bootstrap upgrade, marker already current):');

const rerun = makeProject('rerun');
cleanups.push(rerun);
writeFile(rerun, 'CLAUDE.md', CONFIGURED_CLAUDE_MD);
writeFile(rerun, '.claude/.autoconfig-version', PKG_VERSION);

const rerunResult = runCli(rerun, ['--bootstrap'], shimDir);

test('exits 0', () => {
  assert(rerunResult.code === 0, `expected exit 0, got ${rerunResult.code}\n${rerunResult.out}`);
});

test('no whats-new is written when the installed version is already current', () => {
  assert(!fs.existsSync(path.join(rerun, '.claude', '.autoconfig-whats-new.json')),
    'a same-version re-run must not write whats-new');
});

// ── Fixture 11: unsupported old explicit install — announced, then swept ─────
// The signature "old version marker + project never configured" means someone explicitly
// installed an old version and /autoconfig hasn't run yet. The CLI must SAY the old version
// is unsupported and that latest is installing instead — and then still proceed (the notice
// never aborts the sweep). Routine upgrades of configured projects skip the notice
// (Fixture 2 asserts its absence).
console.log();
console.log('unsupported old explicit install (--bootstrap, unconfigured project):');

const oldExplicit = makeProject('old-explicit');
cleanups.push(oldExplicit);
writeFile(oldExplicit, '.claude/.autoconfig-version', '1.0.50');

const oldExplicitResult = runCli(oldExplicit, ['--bootstrap'], shimDir);

test('exits 0', () => {
  assert(oldExplicitResult.code === 0, `expected exit 0, got ${oldExplicitResult.code}\n${oldExplicitResult.out}`);
});

test('the old version is announced as unsupported, naming both versions', () => {
  assert(oldExplicitResult.out.includes('claude-code-autoconfig v1.0.50 is no longer supported'),
    `expected the unsupported notice naming v1.0.50, got:\n${oldExplicitResult.out}`);
  assert(oldExplicitResult.out.includes(`installing the latest version (v${PKG_VERSION}) instead`),
    `the notice should name the version being installed (v${PKG_VERSION})`);
});

test('the notice does not abort — the sweep to latest still proceeds', () => {
  for (const c of SHIPPED_COMMANDS) {
    assert(fs.existsSync(path.join(oldExplicit, '.claude', 'commands', c)), `expected shipped command ${c} after the sweep`);
  }
  const v = fs.readFileSync(path.join(oldExplicit, '.claude', '.autoconfig-version'), 'utf8').trim();
  assert(v === PKG_VERSION, `version marker should be swept 1.0.50 → ${PKG_VERSION}, got ${v}`);
});

// ── Fixture 12: interactive READY messaging + launch command ─────────────────
// The full interactive path (no --bootstrap): one ENTER is piped to stdin so the run sails
// through the prompt and "launches Claude" — which resolves to the PATH shim, so the spawn
// is instant and harmless. Pins the isUpgrade fork of the user-facing flow: READY TO
// CONFIGURE + /autoconfig on fresh vs READY TO UPDATE + /autoconfig-update on upgrade.
console.log();
console.log('interactive READY messaging + launch command (fresh vs upgrade):');

function runCliInteractive(projectDir, shimDir) {
  const env = { ...process.env, CLAUDECODE: '' };
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = shimDir + path.delimiter + (env[pathKey] || '');
  try {
    const stdout = execFileSync('node', [CLI_PATH], {
      cwd: projectDir,
      encoding: 'utf8',
      input: '\n', // answer the "Press ENTER to continue..." prompt
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000, // fail loud, never hang, if the prompt flow regresses
      env
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const interFresh = makeProject('inter-fresh');
cleanups.push(interFresh);
const interFreshResult = runCliInteractive(interFresh, shimDir);

test('(fresh) interactive run exits 0', () => {
  assert(interFreshResult.code === 0, `expected exit 0, got ${interFreshResult.code}\n${interFreshResult.out}`);
});

test('(fresh) shows READY TO CONFIGURE and launches /autoconfig', () => {
  const out = interFreshResult.out;
  assert(out.includes('READY TO CONFIGURE'), `expected the READY TO CONFIGURE box, got:\n${out}`);
  // NB: 'auto-run /autoconfig' is a prefix of the upgrade string — exclude it explicitly.
  assert(out.includes('auto-run /autoconfig') && !out.includes('auto-run /autoconfig-update'),
    'the box must offer /autoconfig, not /autoconfig-update');
  assert(out.includes('Launching Claude Code with /autoconfig...'),
    `expected the /autoconfig launch line, got:\n${out}`);
  assert(/approve a few file prompts/.test(out), 'the fresh-only approval hint should print');
});

const interUp = makeProject('inter-upgrade');
cleanups.push(interUp);
writeFile(interUp, 'CLAUDE.md', CONFIGURED_CLAUDE_MD);
writeFile(interUp, '.claude/.autoconfig-version', '1.0.100');
const interUpResult = runCliInteractive(interUp, shimDir);

test('(upgrade) interactive run exits 0', () => {
  assert(interUpResult.code === 0, `expected exit 0, got ${interUpResult.code}\n${interUpResult.out}`);
});

test('(upgrade) shows READY TO UPDATE and launches /autoconfig-update', () => {
  const out = interUpResult.out;
  assert(out.includes('READY TO UPDATE'), `expected the READY TO UPDATE box, got:\n${out}`);
  assert(out.includes('auto-run /autoconfig-update'), 'the box must offer /autoconfig-update');
  assert(out.includes('Launching Claude Code with /autoconfig-update...'),
    `expected the /autoconfig-update launch line, got:\n${out}`);
  assert(!/approve a few file prompts/.test(out), 'the fresh-only approval hint must not print on upgrade');
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

// ── Fixture 13: retired permission rules are scrubbed from settings.local.json ──
// Claude Code warns at session start for every retired Write(...) rule it finds, in
// settings.json AND settings.local.json. CCA never ships or merges into the local file, so
// the scrub there is unconditional (fresh installs too) and must NOT fold shipped hooks in.
console.log();
console.log('retired permission rules are scrubbed from settings.local.json:');

const localScrub = makeProject('local-scrub');
cleanups.push(localScrub);
writeFile(localScrub, '.claude/settings.local.json', JSON.stringify({
  permissions: {
    allow: ['Write(./**)', 'Bash(npm run something)', 'Write(./dist/**)'],
    deny: ['Write(./nul)', 'Edit(./nul)', 'Read(./.env.local)'],
  },
  env: { MY_LOCAL_VAR: '1' },
}, null, 2));

const localScrubResult = runCli(localScrub, ['--bootstrap'], shimDir);

test('exits 0', () => {
  assert(localScrubResult.code === 0, `expected exit 0, got ${localScrubResult.code}\n${localScrubResult.out}`);
});

test('retired rules are scrubbed from settings.local.json on a FRESH install too', () => {
  const local = readJson(path.join(localScrub, '.claude', 'settings.local.json'));
  assert(!local.permissions.allow.includes('Write(./**)'), 'retired allow Write(./**) must be scrubbed');
  assert(!local.permissions.deny.includes('Write(./nul)'), 'retired deny Write(./nul) must be scrubbed');
  assert(!local.permissions.deny.includes('Edit(./nul)'), 'retired deny Edit(./nul) must be scrubbed');
});

test("the user's own local rules and env survive the scrub", () => {
  const local = readJson(path.join(localScrub, '.claude', 'settings.local.json'));
  assert(local.permissions.allow.includes('Bash(npm run something)'), 'user allow rule must survive');
  assert(local.permissions.allow.includes('Write(./dist/**)'), 'a user-authored Write rule must survive');
  assert(local.permissions.deny.includes('Read(./.env.local)'), 'user deny rule must survive');
  assert(local.env && local.env.MY_LOCAL_VAR === '1', 'unrelated local keys must survive');
});

test('the scrub does NOT merge shipped settings into settings.local.json', () => {
  // settings.local.json is user-owned. Folding the shipped fragment in would double every
  // hook (it is already in settings.json) — the scrub must only ever REMOVE.
  const local = readJson(path.join(localScrub, '.claude', 'settings.local.json'));
  assert(!local.hooks, `settings.local.json must gain no hooks, got: ${JSON.stringify(local.hooks)}`);
  assert(!local.permissions.allow.includes('Edit(./**)'), 'shipped allow rules must not be merged in');
});

// A local file with nothing retired must be left BYTE-IDENTICAL — the count gate exists so a
// user's hand-formatted (4-space, comment-free-but-ordered) file is not silently reflowed.
const localClean = makeProject('local-clean');
cleanups.push(localClean);
const CLEAN_LOCAL = '{\n    "permissions": {\n        "allow": ["Bash(git log:*)"]\n    }\n}\n';
writeFile(localClean, '.claude/settings.local.json', CLEAN_LOCAL);
const localCleanResult = runCli(localClean, ['--bootstrap'], shimDir);

test('a settings.local.json with nothing retired is left byte-identical', () => {
  assert(localCleanResult.code === 0, `expected exit 0, got ${localCleanResult.code}\n${localCleanResult.out}`);
  const after = fs.readFileSync(path.join(localClean, '.claude', 'settings.local.json'), 'utf8');
  assert(after === CLEAN_LOCAL, 'an unchanged local file must not be rewritten/reformatted');
});

// Corrupt local file: the install must still succeed, say so, and leave the bytes alone
// (rewriting an unparseable file is the silent data loss d662360 fixed for settings.json).
const localCorrupt = makeProject('local-corrupt');
cleanups.push(localCorrupt);
const BROKEN_LOCAL = '{ "permissions": { "allow": ["Write(./**)",  <-- broken\n';
writeFile(localCorrupt, '.claude/settings.local.json', BROKEN_LOCAL);
const localCorruptResult = runCli(localCorrupt, ['--bootstrap'], shimDir);

test('a corrupt settings.local.json warns but neither breaks the install nor loses data', () => {
  assert(localCorruptResult.code === 0, `expected exit 0, got ${localCorruptResult.code}\n${localCorruptResult.out}`);
  assert(localCorruptResult.out.includes('settings.local.json'),
    `expected a warning naming settings.local.json, got:\n${localCorruptResult.out}`);
  const after = fs.readFileSync(path.join(localCorrupt, '.claude', 'settings.local.json'), 'utf8');
  assert(after === BROKEN_LOCAL, 'a corrupt local file must be left exactly as found');
});

// ── Fixture 14: the backup skips worktrees/node_modules and survives symlinks ─
//
// The shipped 1.0.221 crashed here for real: a project with git worktrees parked under
// .claude/worktrees/ had its whole dependency tree fed to the backup copier, and pnpm's
// symlinked packages hit fs.copyFileSync -> EPERM on Windows, aborting the install and
// leaving 812 MB of half-copied node_modules behind. Two guarantees are pinned below:
// those trees are never copied at all, and a symlink anywhere under .claude/ is skipped
// rather than crashing the run.
console.log();
console.log('backup skips worktrees/node_modules and survives symlinks:');

const wt = makeProject('worktrees');
cleanups.push(wt);

writeFile(wt, 'CLAUDE.md', '# Proj\n\n<!-- AUTO-GENERATED BY /autoconfig -->\n');
writeFile(wt, '.claude/my-notes.md', 'USER NOTES — keep me\n');
// A git worktree's dependency tree, plus a bare node_modules directly under .claude/.
writeFile(wt, '.claude/worktrees/wt-a/src/index.js', '// worktree source\n');
writeFile(wt, '.claude/worktrees/wt-a/node_modules/dep/index.js', '// dependency\n');
writeFile(wt, '.claude/node_modules/dep/index.js', '// dependency\n');
// A symlinked package inside an OTHERWISE-BACKED-UP user directory, so the skip is proven
// on the copy path itself and not merely by the worktrees/ filter short-circuiting first.
writeFile(wt, '.claude/user-dir/real/index.js', '// real file\n');
let symlinkMade = false;
try {
  fs.symlinkSync(
    path.join(wt, '.claude', 'user-dir', 'real'),
    path.join(wt, '.claude', 'user-dir', 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  symlinkMade = true;
} catch { /* unprivileged environment — the other assertions still bind */ }

const wtResult = runCli(wt, ['--bootstrap'], shimDir);
const wtClaude = path.join(wt, '.claude');
const wtStamps = () => {
  const migRoot = path.join(wtClaude, 'migration');
  if (!fs.existsSync(migRoot)) return [];
  return fs.readdirSync(migRoot).filter(e => fs.statSync(path.join(migRoot, e)).isDirectory());
};

test('install exits 0 with a symlinked package under .claude/ (was EPERM in 1.0.221)', () => {
  assert(symlinkMade, 'fixture could not create a symlink — regression is unproven on this machine');
  assert(wtResult.code === 0, `expected exit 0, got ${wtResult.code}\n${wtResult.out}`);
  assert(!/EPERM|copyfile/i.test(wtResult.out), `install must not report a copy error:\n${wtResult.out}`);
});

test('real user content is still backed up', () => {
  const stamps = wtStamps();
  assert(stamps.length === 1, `expected exactly one dated backup folder, found ${stamps.length}`);
  assert(fs.existsSync(path.join(wtClaude, 'migration', stamps[0], 'my-notes.md')),
    'user file should be copied into the backup');
});

test('worktrees/ and node_modules/ are excluded from the backup at every depth', () => {
  const backup = path.join(wtClaude, 'migration', wtStamps()[0]);
  assert(!fs.existsSync(path.join(backup, 'worktrees')),
    'worktrees/ must never be copied into the backup');
  assert(!fs.existsSync(path.join(backup, 'node_modules')),
    'node_modules/ must never be copied into the backup');
});

test('a symlink inside a backed-up directory is skipped, its real sibling copied', () => {
  const backup = path.join(wtClaude, 'migration', wtStamps()[0]);
  assert(fs.existsSync(path.join(backup, 'user-dir', 'real', 'index.js')),
    'the real file must still be backed up');
  assert(!fs.existsSync(path.join(backup, 'user-dir', 'linked')),
    'the symlink must be skipped, not copied or dereferenced');
});

test('the excluded trees are left untouched in .claude/ (backup copies, never moves)', () => {
  assert(fs.existsSync(path.join(wtClaude, 'worktrees', 'wt-a', 'node_modules', 'dep', 'index.js')),
    'the worktree must survive the install');
  assert(fs.existsSync(path.join(wtClaude, 'node_modules', 'dep', 'index.js')),
    '.claude/node_modules must survive the install');
});

// A project whose ONLY non-autoconfig content is an excluded tree must not open a dated
// backup folder at all — hasUserContent honours SKIP_BACKUP, so there is no empty-folder
// churn on every run.
const wtOnly = makeProject('worktrees-only');
cleanups.push(wtOnly);
writeFile(wtOnly, 'CLAUDE.md', '# Proj\n\n<!-- AUTO-GENERATED BY /autoconfig -->\n');
writeFile(wtOnly, '.claude/worktrees/wt-a/node_modules/dep/index.js', '// dependency\n');
const wtOnlyResult = runCli(wtOnly, ['--bootstrap'], shimDir);

test('worktrees alone do not trigger a backup folder', () => {
  assert(wtOnlyResult.code === 0, `expected exit 0, got ${wtOnlyResult.code}\n${wtOnlyResult.out}`);
  const migRoot = path.join(wtOnly, '.claude', 'migration');
  const stamps = fs.existsSync(migRoot)
    ? fs.readdirSync(migRoot).filter(e => fs.statSync(path.join(migRoot, e)).isDirectory())
    : [];
  assert(stamps.length === 0, `expected no dated backup folder, found ${stamps.join(', ')}`);
});

// ── Fixture: a user-chosen output style survives the upgrade ────────────────
console.log('upgrade keeps a user-set outputStyle:');

// The merge keys on the key's PRESENCE, never its value — a user who picked another style
// (or explicitly wrote the default) must keep it, or the upgrade silently changes how every
// session in the project talks.
const ownStyle = makeProject('own-style');
cleanups.push(ownStyle);
writeFile(ownStyle, 'CLAUDE.md', '# Proj\n\n<!-- AUTO-GENERATED BY /autoconfig -->\n');
writeFile(ownStyle, '.claude/.autoconfig-version', '1.0.100\n');
writeFile(ownStyle, '.claude/settings.json', JSON.stringify({ outputStyle: 'Explanatory', env: {} }, null, 2));
const ownStyleResult = runCli(ownStyle, ['--bootstrap'], shimDir);

test("user's own outputStyle is preserved, not overwritten with Concise", () => {
  assert(ownStyleResult.code === 0, `expected exit 0, got ${ownStyleResult.code}\n${ownStyleResult.out}`);
  const merged = readJson(path.join(ownStyle, '.claude', 'settings.json'));
  assert(merged.outputStyle === 'Explanatory', `user's outputStyle must survive the merge, got ${JSON.stringify(merged.outputStyle)}`);
});

// ── Fixture: Claude Code below the minimum version is a hard stop ────────────
console.log('minimum Claude Code version gate:');

// The shipped settings turn on the Concise output style, which Claude Code below the floor
// silently ignores. The installer must refuse BEFORE copying anything — an install that
// lands files and then says "requires a newer Claude Code" leaves a half-configured project behind.
const { MIN_CLAUDE_CODE_VERSION } = require('../bin/lib/claude-version.js');
const oldShim = makeClaudeShim('2.1.100');
cleanups.push(oldShim);
const tooOld = makeProject('too-old');
cleanups.push(tooOld);
const tooOldResult = runCli(tooOld, ['--bootstrap'], oldShim);

test('an old Claude Code exits 1 with the floor, the version found, and the update command', () => {
  assert(tooOldResult.code === 1, `expected exit 1, got ${tooOldResult.code}\n${tooOldResult.out}`);
  assert(tooOldResult.out.includes(`requires Claude Code v${MIN_CLAUDE_CODE_VERSION} or newer`), `message should name the floor\n${tooOldResult.out}`);
  assert(tooOldResult.out.includes('Your environment is running v2.1.100.'), `message should name the version found\n${tooOldResult.out}`);
  assert(tooOldResult.out.includes('claude update'), `message should give the update command\n${tooOldResult.out}`);
});

test('an old Claude Code gets NO files copied (the gate runs before any install step)', () => {
  assert(!fs.existsSync(path.join(tooOld, '.claude')), '.claude/ must not be created when the gate stops the install');
  assert(!fs.existsSync(path.join(tooOld, 'CLAUDE.md')), 'CLAUDE.md must not be created when the gate stops the install');
});

// A banner the parser cannot read does NOT fail the gate: the floor is unknowable, so the install
// proceeds (fail open). The alternative — blocking on a wording change upstream — would lock
// every user out the day Claude Code reworded its banner.
const oddShim = makeClaudeShim('Claude Code (dev build)');
cleanups.push(oddShim);
const unparseable = makeProject('unparseable-version');
cleanups.push(unparseable);
const unparseableResult = runCli(unparseable, ['--bootstrap'], oddShim);

test('an unparseable version banner passes the gate (fail open) and installs normally', () => {
  assert(unparseableResult.code === 0, `expected exit 0, got ${unparseableResult.code}\n${unparseableResult.out}`);
  assert(fs.existsSync(path.join(unparseable, '.claude', 'settings.json')), 'the install should proceed on an unreadable version');
  assert(!unparseableResult.out.includes('requires Claude Code v'), 'no version warning should print when the version could not be read');
});

test('the version found is echoed on the detected line when readable', () => {
  assert(freshResult.out.includes('Claude Code v2.1.257 detected'), `expected the detected line to carry the probed version\n${freshResult.out}`);
});

// ── Cleanup ──────────────────────────────────────────────────────────────────
for (const dir of cleanups) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
}

summary();
