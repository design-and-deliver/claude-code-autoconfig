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

// --- Cleanup ----------------------------------------------------------------
try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}

console.log();
console.log('============================================================');
if (failed === 0) {
  console.log(`ALL TESTS PASSED (${passed} tests)`);
} else {
  console.log(`TESTS FAILED: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
