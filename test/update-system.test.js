#!/usr/bin/env node

/**
 * Tests for the update system
 * Validates update files, autoconfig-update command, and CLI --pull-updates support
 */

const fs = require('fs');
const path = require('path');

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

test('CLI has pullUpdates function', () => {
  const content = fs.readFileSync(CLI_PATH, 'utf8');
  assert(content.includes('function pullUpdates()'), 'CLI should have pullUpdates function');
});

test('CLI has parseAppliedUpdates function', () => {
  const content = fs.readFileSync(CLI_PATH, 'utf8');
  assert(content.includes('function parseAppliedUpdates('), 'CLI should have parseAppliedUpdates function');
});

test('CLI includes updates in AUTOCONFIG_FILES', () => {
  const content = fs.readFileSync(CLI_PATH, 'utf8');
  assert(content.includes("'updates'"), 'AUTOCONFIG_FILES should include updates');
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
