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
    /MANAGED_HOOKS\s*=\s*\[[^\]]*'terminal-title\.js'[^\]]*'terminal-title\.directive\.md'[^\]]*'arcade-beeps\.js'[^\]]*\]/.test(cliCode),
    'CLI should define MANAGED_HOOKS (cca-managed title + arcade-beeps hooks)'
  );
  assert(
    /for \(const name of MANAGED_HOOKS\)[\s\S]*?copyFileSync/.test(cliCode),
    'CLI should copyFileSync (always overwrite) the managed hooks, even on upgrade'
  );
});

console.log();

// -----------------------------------------------------------------------------
// Status Beeps Opt-in (no beeps by default in a fresh install)
// -----------------------------------------------------------------------------

console.log('Status Beeps Opt-in:');

test('status-beeps hook gates on the install-local flag, not a homedir-global one', () => {
  const hookCode = fs.readFileSync(path.join(PACKAGE_CLAUDE_DIR, 'hooks', 'arcade-beeps.js'), 'utf8');
  assert(
    /const FLAG = path\.join\(ASSET_DIR, 'status-beeps\.enabled'\)/.test(hookCode),
    'FLAG should resolve beside the install\'s own sounds dir (per-project opt-in)'
  );
  assert(
    /const LEGACY_FLAG = path\.join\(ASSET_DIR, 'arcade-beeps\.enabled'\)/.test(hookCode) &&
      /fs\.existsSync\(FLAG\) \|\| fs\.existsSync\(LEGACY_FLAG\)/.test(hookCode),
    'hook must still honor the legacy arcade-beeps.enabled flag so pre-rename installs keep beeping'
  );
  assert(
    !/FLAG = path\.join\(os\.homedir\(\)/.test(hookCode),
    'FLAG must not key off os.homedir() — a global flag makes every new install beep by default'
  );
});

test('enable/disable toggle commands ship and target the project flag', () => {
  const enablePath = path.join(PACKAGE_CLAUDE_DIR, 'commands', 'enable-status-beeps.md');
  const disablePath = path.join(PACKAGE_CLAUDE_DIR, 'commands', 'disable-status-beeps.md');
  assertExists(enablePath, 'enable-status-beeps command should exist');
  assertExists(disablePath, 'disable-status-beeps command should exist');
  const enable = fs.readFileSync(enablePath, 'utf8');
  const disable = fs.readFileSync(disablePath, 'utf8');
  assert(
    enable.includes('${CLAUDE_PROJECT_DIR:-.}/.claude/sounds/status-beeps.enabled'),
    'enable command should create the PROJECT flag'
  );
  assert(
    !enable.includes('~/.claude/sounds/status-beeps.enabled'),
    'enable command must not set a homedir-global flag'
  );
  assert(
    disable.includes('${CLAUDE_PROJECT_DIR:-.}/.claude/sounds/status-beeps.enabled') &&
      disable.includes('${CLAUDE_PROJECT_DIR:-.}/.claude/sounds/arcade-beeps.enabled') &&
      disable.includes('~/.claude/sounds/status-beeps.enabled') &&
      disable.includes('~/.claude/sounds/arcade-beeps.enabled'),
    'disable command should remove the project flags AND the legacy global flags (both names)'
  );
});

test('deprecated arcade-beeps aliases still ship and delegate to the new flag', () => {
  for (const name of ['enable-arcade-beeps', 'disable-arcade-beeps']) {
    const p = path.join(PACKAGE_CLAUDE_DIR, 'commands', `${name}.md`);
    assertExists(p, `${name} deprecated alias should still exist (renamed commands must not break existing users)`);
    const content = fs.readFileSync(p, 'utf8');
    assert(
      /deprecated/i.test(content) && content.includes(name.replace('arcade', 'status')),
      `${name} should be marked deprecated and point at the status-beeps replacement`
    );
  }
  const enableAlias = fs.readFileSync(path.join(PACKAGE_CLAUDE_DIR, 'commands', 'enable-arcade-beeps.md'), 'utf8');
  assert(
    enableAlias.includes('${CLAUDE_PROJECT_DIR:-.}/.claude/sounds/status-beeps.enabled'),
    'deprecated enable alias should create the NEW flag so installs converge on status-beeps.enabled'
  );
});

test('upgrades persist a what\'s-new summary and /autoconfig-update renders + consumes it', () => {
  const cliCode = fs.readFileSync(CLI_PATH, 'utf8');
  assert(
    /isUpgrade && previousVersion !== currentVersion[\s\S]*?\.autoconfig-whats-new\.json[\s\S]*?formatUpdateSummary/.test(cliCode),
    'CLI should write .autoconfig-whats-new.json (via formatUpdateSummary) when the version changes'
  );
  const updateCmd = fs.readFileSync(path.join(PACKAGE_CLAUDE_DIR, 'commands', 'autoconfig-update.md'), 'utf8');
  assert(
    updateCmd.includes('.autoconfig-whats-new.json') && /delete `.claude\/\.autoconfig-whats-new\.json`/i.test(updateCmd),
    '/autoconfig-update should render the what\'s-new file and delete it (one-shot)'
  );
});

test('autoconfig finale offers the status-beeps opt-in but never defaults it on', () => {
  const autoconfig = fs.readFileSync(path.join(PACKAGE_CLAUDE_DIR, 'commands', 'autoconfig.md'), 'utf8');
  assert(
    autoconfig.includes('### Status Beeps Opt-in') &&
      autoconfig.includes('.claude/sounds/status-beeps.enabled'),
    'autoconfig should ask about status beeps before opening the docs'
  );
  assert(
    /Only if the user picks yes/.test(autoconfig) && /do NOT create the flag/.test(autoconfig),
    'the opt-in must be consent-gated: no flag on decline, skip, or headless runs'
  );
  assert(
    /statusBeepsPrompted/.test(autoconfig),
    'autoconfig must record statusBeepsPrompted so upgrades never re-ask'
  );
});

test('autoconfig-update offers the status-beeps opt-in exactly once', () => {
  const updateCmd = fs.readFileSync(path.join(PACKAGE_CLAUDE_DIR, 'commands', 'autoconfig-update.md'), 'utf8');
  assert(
    updateCmd.includes('Status Beeps Opt-in') &&
      updateCmd.includes('.claude/sounds/status-beeps.enabled'),
    'autoconfig-update should offer beeps to upgraded projects'
  );
  assert(
    /statusBeepsPrompted/.test(updateCmd) &&
      /arcade-beeps\.enabled/.test(updateCmd),
    'the update-path ask must skip when already enabled (either flag) or already prompted'
  );
});

test('local opt-in flags can never ship in the npm tarball', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert(
    pkg.files.includes('!.claude/sounds/*.enabled'),
    'package.json files must negate .claude/sounds/*.enabled — shipping this repo\'s own beep flag would turn beeps ON for every fresh install'
  );
});

test('explicitly installed old versions are announced as unsupported, then swept to latest', () => {
  const cliCode = fs.readFileSync(CLI_PATH, 'utf8');
  assert(
    /noticeUnsupportedOldInstall[\s\S]*?\.autoconfig-version[\s\S]*?AUTO-GENERATED BY \/autoconfig[\s\S]*?no longer supported/.test(cliCode),
    'CLI should print the "no longer supported" notice when an old version marker exists on a not-yet-configured project'
  );
  assert(
    !/process\.exit\(0\)[\s\S]{0,200}$/.test(cliCode.match(/function noticeUnsupportedOldInstall[\s\S]*?\}\)\(\);/)[0]),
    'the notice must not abort the install — the sweep to latest still proceeds'
  );
  const autoconfig = fs.readFileSync(path.join(PACKAGE_CLAUDE_DIR, 'commands', 'autoconfig.md'), 'utf8');
  assert(
    /no longer supported/.test(autoconfig),
    '/autoconfig should relay the unsupported-version warning to the user'
  );
});

test('version pin freezes silent refreshes but yields to an explicit install', () => {
  const cliCode = fs.readFileSync(CLI_PATH, 'utf8');
  assert(
    /pinnedVersion && pinnedVersion !== installerVersion[\s\S]*?--bootstrap[\s\S]*?process\.exit\(0\)/.test(cliCode),
    'a pinned project must exit the --bootstrap refresh before any file copying'
  );
  assert(
    /function pullUpdates\(\)[\s\S]{0,400}pinnedVersion && pinnedVersion !== installerVersion/.test(cliCode),
    '--pull-updates must respect the pin (return before refreshing anything)'
  );
  assert(
    /delete cfg\.pinVersion/.test(cliCode),
    'an explicit interactive install must remove the pin and proceed'
  );
});

test('CLI never introduces deprecated aliases — they only replace a pre-existing command', () => {
  const cliCode = fs.readFileSync(CLI_PATH, 'utf8');
  assert(
    /DEPRECATED_COMMAND_ALIASES\s*=\s*\[[^\]]*'enable-arcade-beeps\.md'[^\]]*'disable-arcade-beeps\.md'[^\]]*\]/.test(cliCode),
    'CLI should define DEPRECATED_COMMAND_ALIASES with both arcade-beeps files'
  );
  assert(
    /for \(const f of DEPRECATED_COMMAND_ALIASES\)[\s\S]*?existingCommandContents\.has\(f\)[\s\S]*?unlinkSync/.test(cliCode),
    'CLI should unlink a deprecated alias after the commands copy unless it pre-existed (fresh installs stay alias-free)'
  );
});

console.log();

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
  const cliCode = fs.readFileSync(CLI_PATH, 'utf8');
  const devOnlyMatch = cliCode.match(/const DEV_ONLY_FILES = \[([^\]]+)\]/);
  const devOnly = devOnlyMatch
    ? devOnlyMatch[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''))
    : [];

  const hooksDir = path.join(PACKAGE_CLAUDE_DIR, 'hooks');
  const hooks = fs.readdirSync(hooksDir).filter(f => f.endsWith('.js') && !devOnly.includes(f));

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

console.log('Inside-Claude Detection:');

test('guard requires BOTH CLAUDECODE=1 and non-TTY stdout', () => {
  // CLAUDECODE=1 inherits into descendants (e.g. VS Code launched from a
  // Claude session), so the env var alone must never trigger the block.
  const cliCode = fs.readFileSync(CLI_PATH, 'utf8');
  assert(
    cliCode.includes("process.env.CLAUDECODE === '1' && !process.stdout.isTTY"),
    'insideClaude should check CLAUDECODE === 1 AND !process.stdout.isTTY'
  );
});

test('CLI blocks when run in-agent (CLAUDECODE=1, piped stdio)', () => {
  const { spawnSync } = require('child_process');
  const result = spawnSync(process.execPath, [CLI_PATH], {
    env: { ...process.env, CLAUDECODE: '1' },
    encoding: 'utf8',
    timeout: 30000,
  });
  assert(
    result.stdout.includes('regular terminal'),
    `CLI should print the regular-terminal block message, got: ${result.stdout}`
  );
  assert(result.status === 0, `CLI should exit 0 when blocked, got ${result.status}`);
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
// Legacy hook-command migration (cd-proof upgrade path, 2026-07-08)
// -----------------------------------------------------------------------------

console.log('Legacy Hook-Command Migration:');

// cli.js is a script, not a module — extract the pure helpers by source for a functional check
// (same source-level testing approach as assertCliCopies above).
function extractCliFn(name) {
  const src = fs.readFileSync(CLI_PATH, 'utf8');
  const m = src.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n}'));
  if (!m) throw new Error(`${name}() not found in cli.js`);
  return eval('(' + m[0] + ')');
}

test('migrateLegacyHookCommands rewrites managed relative commands, leaves user commands alone', () => {
  const migrate = extractCliFn('migrateLegacyHookCommands');
  const s = {
    hooks: {
      Stop: [{ matcher: '', hooks: [
        { type: 'command', command: 'node .claude/hooks/terminal-title.js' },
        { type: 'command', command: 'node scripts/my-own-hook.js' },
      ] }],
    },
  };
  migrate(s);
  assert(
    s.hooks.Stop[0].hooks[0].command === 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/terminal-title.js"',
    `managed command not anchored: ${s.hooks.Stop[0].hooks[0].command}`
  );
  assert(
    s.hooks.Stop[0].hooks[1].command === 'node scripts/my-own-hook.js',
    'user-authored commands must never be rewritten'
  );
});

test('upgrade path: migrate-then-merge yields ONE anchored entry, not a legacy+anchored double', () => {
  const migrate = extractCliFn('migrateLegacyHookCommands');
  const merge = extractCliFn('mergeSettingsInto');
  const userSettings = {
    hooks: { Stop: [{ matcher: '', hooks: [
      { type: 'command', command: 'node .claude/hooks/terminal-title.js' },
    ] }] },
  };
  const pkgFragment = {
    hooks: { Stop: [{ matcher: '', hooks: [
      { type: 'command', command: 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/terminal-title.js"' },
    ] }] },
  };
  migrate(userSettings);
  merge(userSettings, pkgFragment);
  const cmds = userSettings.hooks.Stop.flatMap(m => m.hooks.map(h => h.command))
    .filter(c => c.includes('terminal-title.js'));
  assert(cmds.length === 1, `expected exactly 1 terminal-title entry after upgrade, got ${cmds.length}: ${cmds.join(' | ')}`);
  assert(cmds[0].includes('${CLAUDE_PROJECT_DIR:-.}'), `surviving entry must be the anchored one: ${cmds[0]}`);
});

test('cli.js migrates BEFORE merging on the settings upgrade path (ordering guard)', () => {
  const src = fs.readFileSync(CLI_PATH, 'utf8');
  const migrateAt = src.indexOf('migrateLegacyHookCommands(userSettings);');
  const mergeAt = src.indexOf('mergeSettingsInto(userSettings, pkgSettings);');
  assert(migrateAt !== -1, 'upgrade path must call migrateLegacyHookCommands');
  assert(mergeAt !== -1, 'upgrade path must call mergeSettingsInto');
  assert(migrateAt < mergeAt, 'migration must run before the merge or upgrades double the hooks');
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
