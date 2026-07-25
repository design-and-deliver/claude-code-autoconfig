#!/usr/bin/env node

/**
 * Tests for the drop-in plugin system (`plugin add` / `list` / `remove`).
 *
 * Behavioral: drives the REAL bin/cli.js against throwaway temp dirs and asserts
 * on the actual files / settings.json / ledger it produces — not on source text.
 * Covers: file copy, additive settings merge, dedup on re-install (idempotency),
 * and clean removal (files deleted + settings contributions reverted, user entries kept).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');

const { test, assert, summary } = require('./_harness');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function runCli(projectDir, args) {
  // Returns stdout; throws (with stderr/stdout attached) on non-zero exit.
  return execFileSync('node', [CLI_PATH, ...args], {
    cwd: projectDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

// Count how many hook entries in an event reference a given command
function countCommand(settings, event, command) {
  const matchers = (settings.hooks && settings.hooks[event]) || [];
  let n = 0;
  for (const m of matchers) for (const h of m.hooks || []) if (h.command === command) n++;
  return n;
}

console.log('============================================================');
console.log('PLUGIN SYSTEM TESTS');
console.log('============================================================');
console.log();

// --- Fixtures ---------------------------------------------------------------
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-plugin-'));
const projectDir = path.join(tmpRoot, 'project');
const claudeDir = path.join(projectDir, '.claude');
const pluginDir = path.join(tmpRoot, 'myplugin');

const PLUGIN_CMD = 'node .claude/hooks/myplugin.js';
const OTHER_CMD = 'node .claude/hooks/other.js';

// A baseline project that already ran autoconfig: has its own Stop hook, env, and perms.
fs.mkdirSync(claudeDir, { recursive: true });
fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({
  env: { EXISTING_VAR: 'keep' },
  hooks: {
    Stop: [{ matcher: '', hooks: [{ type: 'command', command: OTHER_CMD }] }]
  },
  permissions: { allow: ['Read(./**)'], deny: [] }
}, null, 2));

// A plugin that contributes a hook to the existing Stop event, a brand-new event,
// an env var, and an allow rule — plus one file to install.
fs.mkdirSync(path.join(pluginDir, 'hooks'), { recursive: true });
fs.writeFileSync(path.join(pluginDir, 'hooks', 'myplugin.js'), '// myplugin hook\n');
fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
  name: 'myplugin',
  version: '1.0.0',
  description: 'test plugin',
  files: [{ from: 'hooks/myplugin.js', to: 'hooks/myplugin.js' }],
  settings: {
    env: { PLUGIN_VAR: '1' },
    hooks: {
      Stop: [{ matcher: '', hooks: [{ type: 'command', command: PLUGIN_CMD }] }],
      UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: PLUGIN_CMD }] }]
    },
    permissions: { allow: ['WebSearch'] }
  }
}, null, 2));

// --- Install ----------------------------------------------------------------
console.log('plugin add:');

test('add exits cleanly and reports the plugin', () => {
  const out = runCli(projectDir, ['plugin', 'add', pluginDir]);
  assert(out.includes('Installed myplugin'), 'should report install');
});

test('declared file is copied into .claude/hooks/', () => {
  assert(fs.existsSync(path.join(claudeDir, 'hooks', 'myplugin.js')), 'myplugin.js should exist');
});

test('plugin hook merged into the EXISTING Stop event without dropping the user hook', () => {
  const s = readJson(path.join(claudeDir, 'settings.json'));
  assert(countCommand(s, 'Stop', PLUGIN_CMD) === 1, 'plugin Stop hook present once');
  assert(countCommand(s, 'Stop', OTHER_CMD) === 1, "user's existing Stop hook preserved");
});

test('plugin hook added to a brand-new event', () => {
  const s = readJson(path.join(claudeDir, 'settings.json'));
  assert(countCommand(s, 'UserPromptSubmit', PLUGIN_CMD) === 1, 'UserPromptSubmit hook present');
});

test('env and permissions merged additively', () => {
  const s = readJson(path.join(claudeDir, 'settings.json'));
  assert(s.env.PLUGIN_VAR === '1', 'plugin env added');
  assert(s.env.EXISTING_VAR === 'keep', 'existing env preserved');
  assert(s.permissions.allow.includes('WebSearch'), 'plugin allow rule added');
  assert(s.permissions.allow.includes('Read(./**)'), 'existing allow rule preserved');
});

test('ledger records the install', () => {
  const ledger = readJson(path.join(claudeDir, '.autoconfig-plugins.json'));
  assert(ledger.myplugin, 'ledger has myplugin entry');
  assert(ledger.myplugin.version === '1.0.0', 'ledger records version');
  assert(Array.isArray(ledger.myplugin.files) && ledger.myplugin.files.includes('hooks/myplugin.js'), 'ledger records files');
});

console.log();
console.log('plugin list:');

test('list shows the installed plugin', () => {
  const out = runCli(projectDir, ['plugin', 'list']);
  assert(out.includes('myplugin'), 'list output names the plugin');
});

console.log();
console.log('idempotency:');

test('re-installing does NOT duplicate the merged hooks', () => {
  runCli(projectDir, ['plugin', 'add', pluginDir]);
  const s = readJson(path.join(claudeDir, 'settings.json'));
  assert(countCommand(s, 'Stop', PLUGIN_CMD) === 1, 'Stop hook still present exactly once');
  assert(countCommand(s, 'UserPromptSubmit', PLUGIN_CMD) === 1, 'UserPromptSubmit hook still once');
});

console.log();
console.log('plugin remove:');

test('remove exits cleanly', () => {
  const out = runCli(projectDir, ['plugin', 'remove', 'myplugin']);
  assert(out.includes('Removed myplugin'), 'should report removal');
});

test('installed file is deleted', () => {
  assert(!fs.existsSync(path.join(claudeDir, 'hooks', 'myplugin.js')), 'myplugin.js should be gone');
});

test('plugin contributions reverted, user entries untouched', () => {
  const s = readJson(path.join(claudeDir, 'settings.json'));
  // plugin hook gone from Stop, but the user's own Stop hook remains
  assert(countCommand(s, 'Stop', PLUGIN_CMD) === 0, 'plugin Stop hook removed');
  assert(countCommand(s, 'Stop', OTHER_CMD) === 1, "user's Stop hook still there");
  // the brand-new event the plugin created is fully pruned
  assert(!s.hooks.UserPromptSubmit, 'empty UserPromptSubmit event pruned');
  // env: plugin var gone, user var kept
  assert(!('PLUGIN_VAR' in (s.env || {})), 'plugin env removed');
  assert(s.env.EXISTING_VAR === 'keep', 'existing env preserved');
  // permissions: plugin rule gone, user rule kept
  assert(!s.permissions.allow.includes('WebSearch'), 'plugin allow rule removed');
  assert(s.permissions.allow.includes('Read(./**)'), 'existing allow rule preserved');
});

test('ledger no longer lists the plugin', () => {
  const ledger = readJson(path.join(claudeDir, '.autoconfig-plugins.json'));
  assert(!ledger.myplugin, 'ledger entry removed');
});

test('removing an unknown plugin fails with a clear error', () => {
  let threw = false;
  try { runCli(projectDir, ['plugin', 'remove', 'nope']); }
  catch (e) { threw = true; assert(/not installed/.test(e.stdout || e.message), 'error mentions not installed'); }
  assert(threw, 'should exit non-zero for unknown plugin');
});

console.log();
console.log('BH-1 — remove must not delete config the user set themselves:');

// A fresh project whose settings.json contains an env key, a hook command, and a permission
// rule the USER added by hand. A plugin then declares the exact same three. mergeSettingsInto
// is dedup-safe (adds none of them — they're already there), so `plugin remove` must leave all
// three intact. The pre-fix unmerge, which removed anything value-equal to the fragment, wrongly
// deleted the user's own entries. (Red on HEAD, green after — see the plan's Ledger.)
const proj2 = path.join(tmpRoot, 'project2');
const claude2 = path.join(proj2, '.claude');
fs.mkdirSync(claude2, { recursive: true });

const USER_CMD = 'node .claude/hooks/user-owned.js'; // user hand-added; the plugin also declares it

fs.writeFileSync(path.join(claude2, 'settings.json'), JSON.stringify({
  env: { SHARED_KEY: '1' },
  hooks: {
    Stop: [{ matcher: '', hooks: [{ type: 'command', command: USER_CMD }] }]
  },
  permissions: { allow: ['WebSearch'], deny: [] }
}, null, 2));

const overlapPlugin = path.join(tmpRoot, 'overlap-plugin');
fs.mkdirSync(path.join(overlapPlugin, 'hooks'), { recursive: true });
fs.writeFileSync(path.join(overlapPlugin, 'hooks', 'ov.js'), '// overlap hook\n');
fs.writeFileSync(path.join(overlapPlugin, 'plugin.json'), JSON.stringify({
  name: 'overlap',
  version: '1.0.0',
  description: 'declares config the user already has',
  files: [{ from: 'hooks/ov.js', to: 'hooks/ov.js' }],
  settings: {
    env: { SHARED_KEY: '1' },
    hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: USER_CMD }] }] },
    permissions: { allow: ['WebSearch'] }
  }
}, null, 2));

runCli(proj2, ['plugin', 'add', overlapPlugin]);
runCli(proj2, ['plugin', 'remove', 'overlap']);

test("user's own env key a plugin also declared survives remove", () => {
  const s = readJson(path.join(claude2, 'settings.json'));
  assert(s.env && s.env.SHARED_KEY === '1', "user's own SHARED_KEY must not be deleted on plugin remove");
});

test("user's own hook a plugin also declared survives remove", () => {
  const s = readJson(path.join(claude2, 'settings.json'));
  assert(countCommand(s, 'Stop', USER_CMD) === 1, "user's own Stop hook must not be deleted on plugin remove");
});

test("user's own permission rule a plugin also declared survives remove", () => {
  const s = readJson(path.join(claude2, 'settings.json'));
  assert(s.permissions && s.permissions.allow.includes('WebSearch'), "user's own WebSearch allow rule must not be deleted on plugin remove");
});

console.log();
console.log('BH-10 — re-install cleans up files the old version left behind:');

// v1 ships [keep.js, dropped.js]; v2 ships only [keep.js]. Pre-fix, re-install replaced the
// ledger's file list with v2's snapshot, so dropped.js became an orphan that `plugin remove`
// could never delete. (Red on HEAD, green after — see the plan's Ledger.)
const proj3 = path.join(tmpRoot, 'project3');
const claude3 = path.join(proj3, '.claude');
fs.mkdirSync(claude3, { recursive: true });

const shrinking = path.join(tmpRoot, 'shrinking-plugin');
fs.mkdirSync(path.join(shrinking, 'hooks'), { recursive: true });
fs.writeFileSync(path.join(shrinking, 'hooks', 'keep.js'), '// kept in v2\n');
fs.writeFileSync(path.join(shrinking, 'hooks', 'dropped.js'), '// gone in v2\n');
function writeShrinkingManifest(version, files) {
  fs.writeFileSync(path.join(shrinking, 'plugin.json'), JSON.stringify({
    name: 'shrinking', version, description: 'file list shrinks in v2', files
  }, null, 2));
}

writeShrinkingManifest('1.0.0', [
  { from: 'hooks/keep.js', to: 'hooks/keep.js' },
  { from: 'hooks/dropped.js', to: 'hooks/dropped.js' }
]);
runCli(proj3, ['plugin', 'add', shrinking]);

writeShrinkingManifest('2.0.0', [
  { from: 'hooks/keep.js', to: 'hooks/keep.js' }
]);
runCli(proj3, ['plugin', 'add', shrinking]);

test('re-install deletes a file the new version no longer ships', () => {
  assert(!fs.existsSync(path.join(claude3, 'hooks', 'dropped.js')), 'dropped.js must be cleaned up when v2 stops shipping it');
  assert(fs.existsSync(path.join(claude3, 'hooks', 'keep.js')), 'keep.js must survive the re-install');
});

runCli(proj3, ['plugin', 'remove', 'shrinking']);

test('after re-install + remove, no file from ANY version remains', () => {
  assert(!fs.existsSync(path.join(claude3, 'hooks', 'keep.js')), 'keep.js should be removed');
  assert(!fs.existsSync(path.join(claude3, 'hooks', 'dropped.js')), 'dropped.js must not be an undeletable orphan (BH-10)');
});

test('a failing add copies nothing (no untracked orphan from a mid-copy abort)', () => {
  const proj4 = path.join(tmpRoot, 'project4');
  fs.mkdirSync(path.join(proj4, '.claude'), { recursive: true });
  const badPlugin = path.join(tmpRoot, 'bad-plugin');
  fs.mkdirSync(path.join(badPlugin, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(badPlugin, 'hooks', 'first.js'), '// pre-fix: copied before the throw\n');
  fs.writeFileSync(path.join(badPlugin, 'plugin.json'), JSON.stringify({
    name: 'bad', version: '1.0.0',
    files: [
      { from: 'hooks/first.js', to: 'hooks/first.js' },
      { from: 'hooks/missing.js', to: 'hooks/missing.js' }
    ]
  }, null, 2));
  let threw = false;
  try { runCli(proj4, ['plugin', 'add', badPlugin]); }
  catch (e) { threw = true; assert(/not found/.test(e.stdout || e.message), 'error names the missing file'); }
  assert(threw, 'add should exit non-zero when a declared file is missing');
  assert(!fs.existsSync(path.join(proj4, '.claude', 'hooks', 'first.js')), 'no file may be copied before validation completes (orphan with no ledger record)');
});

console.log();
console.log('remove with a corrupt settings.json must not pretend success:');

// 2026-07-24 review: pluginRemove swallowed a settings-revert failure, deleted the ledger
// entry anyway, and printed "✅ Removed" — leaving the plugin's hooks live in settings.json
// with no undo record and a green checkmark. It must fail loudly, keep the ledger entry,
// and stay retryable once settings.json is fixed. (Red on HEAD, green after.)
const proj5 = path.join(tmpRoot, 'project5');
const claude5 = path.join(proj5, '.claude');
fs.mkdirSync(claude5, { recursive: true });
fs.writeFileSync(path.join(claude5, 'settings.json'), JSON.stringify({ env: {} }, null, 2));
runCli(proj5, ['plugin', 'add', pluginDir]);
const mergedSettings = fs.readFileSync(path.join(claude5, 'settings.json'), 'utf8');
fs.writeFileSync(path.join(claude5, 'settings.json'), '{ this is not JSON');

test('remove exits non-zero and does NOT claim success when settings cannot be reverted', () => {
  let threw = false, out = '';
  try { runCli(proj5, ['plugin', 'remove', 'myplugin']); }
  catch (e) { threw = true; out = (e.stdout || '') + (e.stderr || ''); }
  assert(threw, 'remove must exit non-zero when settings.json is unparsable');
  assert(!out.includes('✅ Removed'), 'must not print the success line after a failed revert');
});

test('the ledger entry survives a failed remove (so the removal can be retried)', () => {
  const ledger = readJson(path.join(claude5, '.autoconfig-plugins.json'));
  assert(ledger.myplugin, 'ledger must still list myplugin after the failed remove');
});

test('after fixing settings.json, retrying the remove succeeds and reverts everything', () => {
  fs.writeFileSync(path.join(claude5, 'settings.json'), mergedSettings);
  const out = runCli(proj5, ['plugin', 'remove', 'myplugin']);
  assert(out.includes('Removed myplugin'), 'retry should succeed');
  const s = readJson(path.join(claude5, 'settings.json'));
  assert(countCommand(s, 'Stop', PLUGIN_CMD) === 0, 'plugin Stop hook reverted on retry');
  const ledger = readJson(path.join(claude5, '.autoconfig-plugins.json'));
  assert(!ledger.myplugin, 'ledger entry removed after the successful retry');
});

// --- Cleanup ----------------------------------------------------------------
try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }

summary();
