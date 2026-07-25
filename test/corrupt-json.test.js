#!/usr/bin/env node

/**
 * Tests for the malformed-JSON fail-safe paths (audit 02-1.2, 02-1.3).
 *
 * Behavioral: drives the REAL bin/cli.js against throwaway temp dirs with deliberately
 * corrupt JSON on disk, and asserts on what the CLI does — not on source text. Each of
 * these paths used to turn a corrupt-but-recoverable file into silent data loss or a
 * silently-disabled protection; every test here pins the loud-and-safe behavior:
 *
 *   1. `plugin add` with a corrupt settings.json → refuses + backs up (was: wipes settings)
 *   2. `plugin remove` with a corrupt ledger → warns (was: silent "not installed")
 *   3. `--pull-updates` with a corrupt cca.config.json → skips (fail safe, was: silent unpin)
 *   4. `--bootstrap` with a corrupt cca.config.json → skips the refresh (fail safe)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');

const { test, assert, summary } = require('./_harness');

// Run the CLI without ever throwing. Returns { code, out } where `out` is stdout+stderr
// combined, so assertions don't depend on which stream a message lands on. CLAUDECODE is
// cleared so the inside-Claude block never fires for --bootstrap when the suite itself
// runs inside a Claude session.
function runCli(projectDir, args) {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: '' }
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

// Make a fresh isolated project dir with a .claude/ folder.
function makeProject(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `cca-corrupt-${label}-`));
  const claudeDir = path.join(root, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  return { root, claudeDir };
}

const CORRUPT = '{ "env": { "KEEP": "yes" }  <<<NOT VALID JSON';
const cleanups = [];

console.log('============================================================');
console.log('MALFORMED-JSON FAIL-SAFE TESTS');
console.log('============================================================');
console.log();

// --- 1. plugin add refuses to overwrite a corrupt settings.json ------------
console.log('plugin add — corrupt settings.json:');

test('refuses (non-zero exit), preserves settings.json, and backs it up', () => {
  const { root, claudeDir } = makeProject('add');
  cleanups.push(root);
  const settingsPath = path.join(claudeDir, 'settings.json');
  fs.writeFileSync(settingsPath, CORRUPT);

  // A plugin that only contributes settings (no files) — isolates the merge path.
  const pluginDir = path.join(root, 'plug');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
    name: 'plug', version: '1.0.0', files: [],
    settings: { env: { PLUGIN_VAR: '1' } }
  }, null, 2));

  const r = runCli(root, ['plugin', 'add', pluginDir]);
  assert(r.code !== 0, 'plugin add should exit non-zero on corrupt settings');
  assert(/not valid JSON/i.test(r.out), 'output should name the parse failure');
  assert(/settings\.json/.test(r.out), 'output should name settings.json');

  // The user's file must be byte-for-byte intact (the whole point).
  assert(fs.readFileSync(settingsPath, 'utf8') === CORRUPT, 'settings.json must be left untouched');
  // A backup must exist.
  const backups = fs.readdirSync(claudeDir).filter(f => /^settings\.json\.corrupt-\d+\.bak$/.test(f));
  assert(backups.length === 1, 'exactly one .corrupt-*.bak backup should be written');
  assert(fs.readFileSync(path.join(claudeDir, backups[0]), 'utf8') === CORRUPT, 'backup captures the original bytes');
  // The ledger must NOT have been written (install aborted).
  assert(!fs.existsSync(path.join(claudeDir, '.autoconfig-plugins.json')), 'no ledger written on abort');
});

// --- 2. plugin remove warns on a corrupt ledger ----------------------------
console.log();
console.log('plugin remove — corrupt ledger:');

test('warns about the corrupt ledger instead of silently reporting "not installed"', () => {
  const { root, claudeDir } = makeProject('ledger');
  cleanups.push(root);
  fs.writeFileSync(path.join(claudeDir, '.autoconfig-plugins.json'), CORRUPT);

  const r = runCli(root, ['plugin', 'remove', 'anything']);
  assert(/not valid JSON/i.test(r.out), 'output should warn the ledger is corrupt');
  assert(/autoconfig-plugins\.json/.test(r.out), 'warning should name the ledger file');
});

// --- 3. --pull-updates treats a corrupt cca.config.json as pinned ----------
console.log();
console.log('--pull-updates — corrupt cca.config.json:');

test('skips the pull (fail safe) and does not write autoconfig-update.md or updates/', () => {
  const { root, claudeDir } = makeProject('pull');
  cleanups.push(root);
  fs.writeFileSync(path.join(claudeDir, 'cca.config.json'), CORRUPT);

  const r = runCli(root, ['--pull-updates']);
  assert(r.code === 0, '--pull-updates should exit 0');
  assert(/not valid JSON/i.test(r.out), 'output should name the parse failure');
  assert(/skipping/i.test(r.out), 'output should say it is skipping');
  // The guard returns before any refresh work happens.
  assert(!fs.existsSync(path.join(claudeDir, 'commands', 'autoconfig-update.md')), 'no command refresh on skip');
  assert(!fs.existsSync(path.join(claudeDir, 'updates')), 'no updates copied on skip');
});

// --- 4. --bootstrap treats a corrupt cca.config.json as fail-safe ----------
console.log();
console.log('--bootstrap — corrupt cca.config.json:');

test('skips the refresh (fail safe) and copies nothing into the project', () => {
  const { root, claudeDir } = makeProject('bootstrap');
  cleanups.push(root);
  fs.writeFileSync(path.join(claudeDir, 'cca.config.json'), CORRUPT);

  const r = runCli(root, ['--bootstrap']);
  assert(r.code === 0, '--bootstrap should exit 0');
  assert(/not valid JSON/i.test(r.out), 'output should name the parse failure');
  assert(/skipping this refresh/i.test(r.out), 'output should say it is skipping the refresh');
  // The guard exits before any copy — the project stays as we left it.
  assert(!fs.existsSync(path.join(claudeDir, 'commands')), 'no commands copied on skip');
  assert(!fs.existsSync(path.join(root, 'CLAUDE.md')), 'no CLAUDE.md written on skip');
});

// --- Cleanup ---------------------------------------------------------------
for (const dir of cleanups) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
}

summary();
