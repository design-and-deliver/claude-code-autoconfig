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

test('updates/ directory exists in package', () => {
  assertExists(path.join(PACKAGE_CLAUDE_DIR, 'updates'));
});

test('autoconfig-update.md exists in commands/', () => {
  assertExists(path.join(PACKAGE_CLAUDE_DIR, 'commands', 'autoconfig-update.md'));
});

console.log();

// -----------------------------------------------------------------------------
// CLI Copy Operations
// -----------------------------------------------------------------------------

console.log('CLI Copy Operations:');

test('CLI copies commands/', () => {
  assertCliCopies("copyDir(commandsSrc, path.join(claudeDest, 'commands'))", 'commands/');
});

test('CLI copies docs/ (html only)', () => {
  const content = fs.readFileSync(CLI_PATH, 'utf8');
  assert(content.includes("file.endsWith('.html')"), 'CLI should filter docs to .html files only');
});

test('CLI copies agents/', () => {
  assertCliCopies("copyDir(agentsSrc, path.join(claudeDest, 'agents'))", 'agents/');
});

test('CLI copies feedback/', () => {
  assertCliCopies("copyFn(feedbackSrc, path.join(claudeDest, 'feedback'))", 'feedback/');
});

test('CLI copies hooks/', () => {
  assertCliCopies("copyFn(hooksSrc, path.join(claudeDest, 'hooks'))", 'hooks/');
});

test('CLI copies settings.json', () => {
  assertCliCopies("fs.copyFileSync(settingsSrc, settingsDest)", 'settings.json');
});

console.log();

// -----------------------------------------------------------------------------
// Settings.json Content
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Smart Re-install Protection
// -----------------------------------------------------------------------------

console.log('Smart Re-install Protection:');

test('CLI has copyDirIfMissing function', () => {
  const cliCode = fs.readFileSync(CLI_PATH, 'utf8');
  assert(cliCode.includes('function copyDirIfMissing('), 'CLI should have copyDirIfMissing function');
});

test('CLI uses copyDirIfMissing for feedback/', () => {
  const cliCode = fs.readFileSync(CLI_PATH, 'utf8');
  assert(cliCode.includes("forceMode ? copyDir : copyDirIfMissing") && cliCode.includes("copyFn(feedbackSrc"), 'CLI should use copyDirIfMissing for feedback');
});

test('CLI uses copyDirIfMissing for hooks/', () => {
  const cliCode = fs.readFileSync(CLI_PATH, 'utf8');
  assert(cliCode.includes("forceMode ? copyDir : copyDirIfMissing") && cliCode.includes("copyFn(hooksSrc"), 'CLI should use copyDirIfMissing for hooks');
});

test('CLI always refreshes the managed title hooks (so fixes reach existing installs)', () => {
  const cliCode = fs.readFileSync(CLI_PATH, 'utf8');
  assert(
    cliCode.includes("MANAGED_HOOKS = ['terminal-title.js', 'terminal-title.directive.md']"),
    'CLI should define MANAGED_HOOKS (cca-managed title-hook files)'
  );
  assert(
    /for \(const name of MANAGED_HOOKS\)[\s\S]*?copyFileSync/.test(cliCode),
    'CLI should copyFileSync (always overwrite) the managed hooks, even on upgrade'
  );
});

test('CLI supports --force flag', () => {
  const cliCode = fs.readFileSync(CLI_PATH, 'utf8');
  assert(cliCode.includes("'--force'"), 'CLI should support --force flag');
});

test('CLI detects upgrade via CLAUDE.md marker', () => {
  const cliCode = fs.readFileSync(CLI_PATH, 'utf8');
  assert(cliCode.includes("AUTO-GENERATED BY /autoconfig"), 'CLI should check for autoconfig marker in CLAUDE.md');
});

test('CLI detects upgrade via docs HTML', () => {
  const cliCode = fs.readFileSync(CLI_PATH, 'utf8');
  assert(cliCode.includes("autoconfig.docs.html"), 'CLI should check for docs HTML as upgrade indicator');
});

test('CLI launches /autoconfig-update for upgrades', () => {
  const cliCode = fs.readFileSync(CLI_PATH, 'utf8');
  assert(cliCode.includes("isUpgrade ? '/autoconfig-update' : '/autoconfig'"), 'CLI should launch /autoconfig-update for upgrades');
});

console.log();

// -----------------------------------------------------------------------------
// Settings.json Content
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Docs Sync — every shipped command must appear in the docs HTML
// -----------------------------------------------------------------------------

console.log('Docs Sync:');

test('all shipped commands appear in docs HTML file tree', () => {
  const cliCode = fs.readFileSync(CLI_PATH, 'utf8');
  const devOnlyMatch = cliCode.match(/const DEV_ONLY_FILES = \[([^\]]+)\]/);
  const devOnly = devOnlyMatch
    ? devOnlyMatch[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''))
    : [];

  const commandsDir = path.join(PACKAGE_CLAUDE_DIR, 'commands');
  const commands = fs.readdirSync(commandsDir)
    .filter(f => f.endsWith('.md') && !devOnly.includes(f));

  const docsHtml = fs.readFileSync(path.join(PACKAGE_CLAUDE_DIR, 'docs', 'autoconfig.docs.html'), 'utf8');

  const missing = commands.filter(cmd => {
    return !docsHtml.includes(`<span class="file">${cmd}</span>`);
  });

  assert(missing.length === 0,
    `Commands missing from docs file tree: ${missing.join(', ')}`);
});

test('all shipped commands have info cards in docs', () => {
  const cliCode = fs.readFileSync(CLI_PATH, 'utf8');
  const devOnlyMatch = cliCode.match(/const DEV_ONLY_FILES = \[([^\]]+)\]/);
  const devOnly = devOnlyMatch
    ? devOnlyMatch[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''))
    : [];

  const commandsDir = path.join(PACKAGE_CLAUDE_DIR, 'commands');
  const commands = fs.readdirSync(commandsDir)
    .filter(f => f.endsWith('.md') && !devOnly.includes(f));

  const docsHtml = fs.readFileSync(path.join(PACKAGE_CLAUDE_DIR, 'docs', 'autoconfig.docs.html'), 'utf8');

  const missing = commands.filter(cmd => {
    const name = cmd.replace('.md', '');
    return !docsHtml.includes(`trigger: '/${name}'`);
  });

  assert(missing.length === 0,
    `Commands missing info cards in docs: ${missing.join(', ')}`);
});

test('all shipped hooks appear in docs HTML file tree', () => {
  const hooksDir = path.join(PACKAGE_CLAUDE_DIR, 'hooks');
  const hooks = fs.readdirSync(hooksDir).filter(f => f.endsWith('.js'));

  const docsHtml = fs.readFileSync(path.join(PACKAGE_CLAUDE_DIR, 'docs', 'autoconfig.docs.html'), 'utf8');

  const missing = hooks.filter(hook => {
    return !docsHtml.includes(`<span class="file">${hook}</span>`);
  });

  assert(missing.length === 0,
    `Hooks missing from docs file tree: ${missing.join(', ')}`);
});

test('all shipped agents appear in docs HTML file tree', () => {
  const agentsDir = path.join(PACKAGE_CLAUDE_DIR, 'agents');
  const agents = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));

  const docsHtml = fs.readFileSync(path.join(PACKAGE_CLAUDE_DIR, 'docs', 'autoconfig.docs.html'), 'utf8');

  const missing = agents.filter(agent => {
    return !docsHtml.includes(`<span class="file">${agent}</span>`);
  });

  assert(missing.length === 0,
    `Agents missing from docs file tree: ${missing.join(', ')}`);
});

console.log();

console.log('Docs Table Alignment:');

// Test the sync-docs.js output (parameter/response tables) for tight column alignment
const syncDocsCode = fs.readFileSync(path.join(PACKAGE_CLAUDE_DIR, 'scripts', 'sync-docs.js'), 'utf8');

test('parameter table must not use width: 100%', () => {
  // Extract the parameter table <table> tag from sync-docs.js
  const paramTableMatch = syncDocsCode.match(/Parameters[\s\S]*?<table style="([^"]+)"/);
  assert(paramTableMatch, 'should find parameter table in sync-docs.js');
  assert(!paramTableMatch[1].includes('width: 100%'),
    'parameter table should not use width: 100% (causes even column distribution instead of content-fit)');
});

test('parameter th/td columns use white-space: nowrap', () => {
  // Check that Name, Type, Required th cells have nowrap
  const thMatches = syncDocsCode.match(/<th[^>]*>Name<\/th>/);
  assert(thMatches, 'should find Name th');
  assert(thMatches[0].includes('white-space: nowrap'),
    'Name th should have white-space: nowrap');
});

test('parameter td padding-right is 8px or less for tight columns', () => {
  // Extract td style for param name cells — look for the first td in param rows
  const tdMatch = syncDocsCode.match(/\$\{p\.name\}[\s\S]*?padding:\s*([^"]+?)"/);
  assert(tdMatch, 'should find param name td padding');
  const paddingRight = tdMatch[1].match(/\d+px\s+(\d+)px/);
  assert(paddingRight, 'should parse padding values');
  assert(parseInt(paddingRight[1]) <= 8,
    `param name td padding-right should be <= 8px for tight alignment, got ${paddingRight[1]}px`);
});

test('docs HTML td code padding is tight (4px or less horizontal)', () => {
  const docsHtml = fs.readFileSync(path.join(PACKAGE_CLAUDE_DIR, 'docs', 'autoconfig.docs.html'), 'utf8');
  const tdCodeMatch = docsHtml.match(/td code\s*\{[^}]*padding:\s*(\d+)px\s+(\d+)px/);
  assert(tdCodeMatch, 'should find td code padding in docs HTML');
  assert(parseInt(tdCodeMatch[2]) <= 4,
    `td code horizontal padding should be <= 4px, got ${tdCodeMatch[2]}px`);
});

console.log();

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
