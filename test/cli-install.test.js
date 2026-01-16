#!/usr/bin/env node

/**
 * Tests for CLI install process
 * Validates that all expected files are copied to downstream projects
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

function assertCliCopies(pattern, description) {
  const cliCode = fs.readFileSync(CLI_PATH, 'utf8');
  if (!cliCode.includes(pattern)) {
    throw new Error(`CLI should copy ${description}`);
  }
}

// =============================================================================
// TESTS
// =============================================================================

console.log('============================================================');
console.log('CLI INSTALL TESTS');
console.log('============================================================');
console.log();

// -----------------------------------------------------------------------------
// Source Files Exist
// -----------------------------------------------------------------------------

console.log('Source Files Exist:');

test('commands/ directory exists in package', () => {
  assertExists(path.join(PACKAGE_CLAUDE_DIR, 'commands'));
});

test('docs/ directory exists in package', () => {
  assertExists(path.join(PACKAGE_CLAUDE_DIR, 'docs'));
});

test('agents/ directory exists in package', () => {
  assertExists(path.join(PACKAGE_CLAUDE_DIR, 'agents'));
});

test('feedback/ directory exists in package', () => {
  assertExists(path.join(PACKAGE_CLAUDE_DIR, 'feedback'));
});

test('hooks/ directory exists in package', () => {
  assertExists(path.join(PACKAGE_CLAUDE_DIR, 'hooks'));
});

test('settings.json exists in package', () => {
  assertExists(path.join(PACKAGE_CLAUDE_DIR, 'settings.json'));
});

test('format.js exists in hooks/', () => {
  assertExists(path.join(PACKAGE_CLAUDE_DIR, 'hooks', 'format.js'));
});

console.log();

// -----------------------------------------------------------------------------
// CLI Copy Operations
// -----------------------------------------------------------------------------

console.log('CLI Copy Operations:');

test('CLI copies commands/', () => {
  assertCliCopies("copyDir(commandsSrc, path.join(claudeDest, 'commands'))", 'commands/');
});

test('CLI copies docs/', () => {
  assertCliCopies("copyDir(docsSrc, path.join(claudeDest, 'docs'))", 'docs/');
});

test('CLI copies agents/', () => {
  assertCliCopies("copyDir(agentsSrc, path.join(claudeDest, 'agents'))", 'agents/');
});

test('CLI copies feedback/', () => {
  assertCliCopies("copyDir(feedbackSrc, path.join(claudeDest, 'feedback'))", 'feedback/');
});

test('CLI copies hooks/', () => {
  assertCliCopies("copyDir(hooksSrc, path.join(claudeDest, 'hooks'))", 'hooks/');
});

test('CLI copies settings.json', () => {
  assertCliCopies("fs.copyFileSync(settingsSrc, settingsDest)", 'settings.json');
});

console.log();

// -----------------------------------------------------------------------------
// Settings.json Content
// -----------------------------------------------------------------------------

console.log('Settings.json Content:');

test('settings.json has permissions', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(PACKAGE_CLAUDE_DIR, 'settings.json'), 'utf8'));
  assert(settings.permissions, 'settings.json should have permissions key');
  assert(settings.permissions.allow, 'settings.json should have allow permissions');
  assert(settings.permissions.deny, 'settings.json should have deny permissions');
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
