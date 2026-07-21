#!/usr/bin/env node

/**
 * Tests for the update system
 * Validates update files, autoconfig-update command, and CLI --pull-updates support
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');
const PACKAGE_CLAUDE_DIR = path.join(__dirname, '..', '.claude');

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

function assertExists(filePath, msg) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${msg || 'File should exist'}: ${filePath}`);
  }
}

// =============================================================================
// TESTS
// =============================================================================

console.log('============================================================');
console.log('UPDATE SYSTEM TESTS');
console.log('============================================================');
console.log();

// -----------------------------------------------------------------------------
// autoconfig-update.md Command
// -----------------------------------------------------------------------------

console.log('autoconfig-update.md Command:');

test('autoconfig-update.md exists in commands/', () => {
  assertExists(path.join(PACKAGE_CLAUDE_DIR, 'commands', 'autoconfig-update.md'));
});

test('autoconfig-update.md has @description header', () => {
  const content = fs.readFileSync(
    path.join(PACKAGE_CLAUDE_DIR, 'commands', 'autoconfig-update.md'), 'utf8'
  );
  assert(content.includes('<!-- @description'), 'Should have @description header');
});

test('autoconfig-update.md has @applied block', () => {
  const content = fs.readFileSync(
    path.join(PACKAGE_CLAUDE_DIR, 'commands', 'autoconfig-update.md'), 'utf8'
  );
  assert(content.includes('<!-- @applied'), 'Should have @applied block');
});

test('autoconfig-update.md @applied block is initially empty', () => {
  const content = fs.readFileSync(
    path.join(PACKAGE_CLAUDE_DIR, 'commands', 'autoconfig-update.md'), 'utf8'
  );
  const match = content.match(/<!-- @applied\r?\n([\s\S]*?)-->/);
  assert(match, 'Should have parseable @applied block');
  assert(match[1].trim() === '', '@applied block should be empty in package');
});

console.log();

// -----------------------------------------------------------------------------
// Updates Directory
// -----------------------------------------------------------------------------

console.log('Updates Directory:');

test('updates/ directory exists in package', () => {
  assertExists(path.join(PACKAGE_CLAUDE_DIR, 'updates'));
});

test('001-debug-methodology.md exists', () => {
  assertExists(path.join(PACKAGE_CLAUDE_DIR, 'updates', '001-debug-methodology.md'));
});

console.log();

// -----------------------------------------------------------------------------
// Update File Format
// -----------------------------------------------------------------------------

console.log('Update File Format:');

const UPDATE_FILE = path.join(PACKAGE_CLAUDE_DIR, 'updates', '001-debug-methodology.md');

test('update file has @title header', () => {
  const content = fs.readFileSync(UPDATE_FILE, 'utf8');
  const match = content.match(/<!-- @title (.+?) -->/);
  assert(match, 'Should have @title header');
  assert(match[1].length > 0, '@title should not be empty');
});

test('update file has @type header', () => {
  const content = fs.readFileSync(UPDATE_FILE, 'utf8');
  const match = content.match(/<!-- @type (.+?) -->/);
  assert(match, 'Should have @type header');
  assert(['feature', 'patch'].includes(match[1]), '@type should be "feature" or "patch"');
});

test('update file has @description header', () => {
  const content = fs.readFileSync(UPDATE_FILE, 'utf8');
  const match = content.match(/<!-- @description (.+?) -->/);
  assert(match, 'Should have @description header');
  assert(match[1].length > 0, '@description should not be empty');
});

test('update file has @files header', () => {
  const content = fs.readFileSync(UPDATE_FILE, 'utf8');
  const match = content.match(/<!-- @files (.+?) -->/);
  assert(match, 'Should have @files header');
  assert(match[1].length > 0, '@files should not be empty');
});

test('update filename matches NNN-*.md pattern', () => {
  const files = fs.readdirSync(path.join(PACKAGE_CLAUDE_DIR, 'updates'));
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    // README.md documents the numbering rules; pullUpdates ignores it (filters ^\d{3}-).
    if (file === 'README.md') continue;
    assert(/^\d{3}-/.test(file), `"${file}" should match NNN-*.md pattern`);
  }
});

console.log();

// -----------------------------------------------------------------------------
// CLI --pull-updates Support
// -----------------------------------------------------------------------------

console.log('CLI --pull-updates Support:');

test('CLI handles --pull-updates flag', () => {
  const content = fs.readFileSync(CLI_PATH, 'utf8');
  assert(content.includes('--pull-updates'), 'CLI should check for --pull-updates flag');
});

// pullUpdates / parseAppliedUpdates live in bin/lib/updates.js (Phase 3 seam 3). These
// were `cliCode.includes('function pullUpdates()')` source-greps; converted to require the
// module directly so they survive the extraction and get stronger (they exercise the real
// export, and the pin-respect behavior is covered end-to-end by cli-behavior.test.js Fixture 6).
test('bin/lib/updates.js exports pullUpdates', () => {
  const updates = require('../bin/lib/updates.js');
  assert(typeof updates.pullUpdates === 'function', 'updates.js should export a pullUpdates function');
});

test('bin/lib/updates.js exports parseAppliedUpdates and it reads @applied ids', () => {
  const { parseAppliedUpdates } = require('../bin/lib/updates.js');
  assert(typeof parseAppliedUpdates === 'function', 'updates.js should export a parseAppliedUpdates function');
  const tmp = path.join(os.tmpdir(), `cca-updates-parse-${process.pid}.md`);
  fs.writeFileSync(tmp, '<!-- @applied\n001 - Debug Methodology\n003 - Something Newer\n-->\n');
  try {
    const ids = parseAppliedUpdates(tmp);
    assert(JSON.stringify(ids) === JSON.stringify([1, 3]), `expected [1, 3] applied ids, got ${JSON.stringify(ids)}`);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('CLI deliberately excludes updates from AUTOCONFIG_FILES', () => {
  const content = fs.readFileSync(CLI_PATH, 'utf8');
  const m = content.match(/const AUTOCONFIG_FILES = \[([^\]]*)\]/);
  assert(m, 'AUTOCONFIG_FILES array literal should exist on one line');
  // 'updates' was removed on purpose (commit 05a567b: the updates dir is never copied to
  // user projects — updates arrive only via --pull-updates). Do NOT re-add it.
  assert(!m[1].includes("'updates'"), "AUTOCONFIG_FILES must NOT include 'updates' (deliberately removed in 05a567b)");
});

console.log();

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

console.log('============================================================');
if (failed === 0) {
  console.log(`ALL TESTS PASSED (${passed} tests)`);
} else {
  console.log(`TESTS FAILED: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
