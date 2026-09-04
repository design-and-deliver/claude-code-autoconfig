#!/usr/bin/env node

/**
 * Package-content and contract tests for the CLI install.
 *
 * What lives here: source-files-exist checks, command-file prose contracts (the .md files
 * Claude executes), shipped settings/package.json content, docs-sync completeness (which
 * parses the DEV_ONLY_FILES literal — a data contract, kept deliberately), and the
 * settings-merge unit tests.
 *
 * What does NOT live here anymore: source-grep assertions on bin/cli.js copy/upgrade
 * behavior — those passed vacuously under refactoring and were replaced 1:1 by the
 * behavioral fixtures in cli-behavior.test.js (clean-code plan substep 2.1). The few
 * remaining cli.js source greps (MANAGED_HOOKS shape, pin gate, alias pruning, insideClaude
 * guard, migrate-before-merge ordering) have no full behavioral twin yet — delete one only
 * when its replacement lands.
 */

const fs = require('fs');
const path = require('path');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');
const PACKAGE_CLAUDE_DIR = path.join(__dirname, '..', '.claude');

const { test, assert, assertExists, summary } = require('./_harness');

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
// Smart Re-install Protection
// -----------------------------------------------------------------------------

console.log('Smart Re-install Protection:');

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

console.log();

// -----------------------------------------------------------------------------
// Auto Permission Mode Opt-in (user-level only — project scope is ignored by
// Claude Code, so shipping defaultMode in project settings would silently no-op)
// -----------------------------------------------------------------------------

console.log('Auto Permission Mode Opt-in:');

test('/autoconfig and /autoconfig-update both carry the asked-once auto-mode opt-in', () => {
  for (const name of ['autoconfig', 'autoconfig-update']) {
    const content = fs.readFileSync(path.join(PACKAGE_CLAUDE_DIR, 'commands', `${name}.md`), 'utf8');
    assert(
      content.includes('"autoModePrompted": true'),
      `${name}.md should gate the auto-mode question on the autoModePrompted flag`
    );
    assert(
      content.includes('~/.claude/settings.json') && content.includes('"defaultMode": "auto"'),
      `${name}.md should write defaultMode "auto" to USER settings (~/.claude/settings.json)`
    );
    assert(
      /never write it into project settings/i.test(content),
      `${name}.md should warn against writing auto mode into project settings (Claude Code ignores it there)`
    );
  }
});

test('auto-guard hook ships, is always refreshed, and is registered in shipped settings', () => {
  assertExists(path.join(PACKAGE_CLAUDE_DIR, 'hooks', 'auto-guard.js'), 'auto-guard.js should exist');
  const cliCode = fs.readFileSync(CLI_PATH, 'utf8');
  assert(
    /MANAGED_HOOKS\s*=\s*\[[^\]]*'auto-guard\.js'[^\]]*\]/.test(cliCode),
    'auto-guard.js should be in MANAGED_HOOKS so fixes reach existing installs'
  );
  const settings = JSON.parse(fs.readFileSync(path.join(PACKAGE_CLAUDE_DIR, 'settings.json'), 'utf8'));
  const pre = settings.hooks.PreToolUse || [];
  assert(
    pre.some(m => m.matcher === 'Bash' && m.hooks.some(h => h.command && h.command.includes('auto-guard.js'))),
    'shipped settings should register auto-guard as a PreToolUse Bash hook'
  );
});

test('/autoconfig and /autoconfig-update both carry the asked-once auto-guard opt-in', () => {
  for (const name of ['autoconfig', 'autoconfig-update']) {
    const content = fs.readFileSync(path.join(PACKAGE_CLAUDE_DIR, 'commands', `${name}.md`), 'utf8');
    assert(
      content.includes('"autoGuardPrompted": true'),
      `${name}.md should gate the auto-guard question on the autoGuardPrompted flag`
    );
    assert(
      content.includes('"autoGuard": { "enabled": true }'),
      `${name}.md should enable the guard via autoGuard.enabled in cca.config.json`
    );
  }
});

test('shipped project settings templates never set defaultMode', () => {
  for (const name of ['settings.json', 'settings.local.json']) {
    const p = path.join(PACKAGE_CLAUDE_DIR, name);
    if (!fs.existsSync(p)) continue;
    assert(
      !fs.readFileSync(p, 'utf8').includes('defaultMode'),
      `${name} template must not set defaultMode — Claude Code ignores auto mode from project scope, so it would silently no-op (and any other mode would override the user's choice)`
    );
  }
});

test('/autoconfig-update renders + consumes the what\'s-new file (one-shot)', () => {
  // The cli.js half (whats-new written only when the version changes) lives behaviorally
  // in cli-behavior.test.js Fixtures 2, 9, and 10.
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

test('/autoconfig relays the unsupported-version warning to the user', () => {
  // The cli.js halves (notice prints on an old marker + the sweep still proceeds) live
  // behaviorally in cli-behavior.test.js Fixtures 11 and 2 (no-notice-on-configured).
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
  // The --pull-updates pin-respect moved to bin/lib/updates.js (Phase 3 seam 3); its
  // behavior is covered end-to-end by cli-behavior.test.js Fixture 6 (a pinned project
  // copies nothing). Only the --bootstrap gate and the explicit-unpin below stay in cli.js.
  assert(
    /delete cfg\.pinVersion/.test(cliCode),
    'an explicit interactive install must remove the pin and proceed'
  );
});

test('CLI removes retired commands from upgraded installs and never ships them', () => {
  const cliCode = fs.readFileSync(CLI_PATH, 'utf8');
  assert(
    /RETIRED_COMMANDS\s*=\s*\[[^\]]*'enable-arcade-beeps\.md'[^\]]*'disable-arcade-beeps\.md'[^\]]*\]/.test(cliCode),
    'CLI should list both retired arcade-beeps aliases in RETIRED_COMMANDS'
  );
  assert(
    /for \(const f of RETIRED_COMMANDS\)[\s\S]*?unlinkSync/.test(cliCode),
    'CLI should unlink each retired command it finds in the installed commands dir'
  );
  for (const name of ['enable-arcade-beeps.md', 'disable-arcade-beeps.md']) {
    assert(!fs.existsSync(path.join(PACKAGE_CLAUDE_DIR, 'commands', name)), `${name} must no longer ship`);
  }
});

console.log();

test('autoconfig + sync-claude-md preserve flavor-package cca- blocks', () => {
  for (const cmd of ['autoconfig.md', 'sync-claude-md.md']) {
    const cmdCode = fs.readFileSync(path.join(PACKAGE_CLAUDE_DIR, 'commands', cmd), 'utf8');
    assert(cmdCode.includes('cca-<name>:begin'), `${cmd} should document the cca- managed-block protocol`);
    assert(/never edit, move, or delete/i.test(cmdCode), `${cmd} should forbid touching cca- blocks`);
  }
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

// The settings-merge helpers live in bin/lib/settings-merge.js (Phase 3 seam 2) — require
// them directly (a real module under test) instead of source-extracting them from cli.js.
const { migrateLegacyHookCommands, migrateRenamedToolMatchers, migrateRetiredPermissionRules, mergeSettingsInto } = require('../bin/lib/settings-merge.js');

test('migrateLegacyHookCommands rewrites managed relative commands, leaves user commands alone', () => {
  const migrate = migrateLegacyHookCommands;
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
  const migrate = migrateLegacyHookCommands;
  const merge = mergeSettingsInto;
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

test('merge under a NEW matcher adds only genuinely-new hooks, never a re-add (BH-4)', () => {
  const merge = mergeSettingsInto;
  const TT = 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/terminal-title.js"';
  const TT_IDLE = 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/terminal-title.js" --idle-rescue';
  const AB = 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/arcade-beeps.js"';
  // User already runs terminal-title under the catch-all matcher.
  const userSettings = {
    hooks: { Notification: [
      { matcher: '', hooks: [{ type: 'command', command: TT }] },
    ] },
  };
  // Fragment ships a NEW matcher carrying that same command plus two genuinely-new ones
  // (the --idle-rescue variant is a DIFFERENT exact string — it must still be added).
  const pkgFragment = {
    hooks: { Notification: [
      { matcher: 'permission_prompt', hooks: [
        { type: 'command', command: TT },
        { type: 'command', command: AB },
        { type: 'command', command: TT_IDLE },
      ] },
    ] },
  };
  merge(userSettings, pkgFragment);
  const count = (cmd) => userSettings.hooks.Notification
    .reduce((n, m) => n + (m.hooks || []).filter(h => h.command === cmd).length, 0);
  assert(count(TT) === 1, `existing hook re-added under the new matcher: ${count(TT)} copies of terminal-title`);
  assert(count(AB) === 1, `genuinely-new hook must be added exactly once, got ${count(AB)}`);
  assert(count(TT_IDLE) === 1, `distinct --idle-rescue command must still be added (exact-string dedup), got ${count(TT_IDLE)}`);
  const pp = userSettings.hooks.Notification.find(m => m.matcher === 'permission_prompt');
  assert(pp, 'the new matcher itself must land');
  const ppCmds = (pp.hooks || []).map(h => h.command);
  assert(
    ppCmds.length === 2 && ppCmds.includes(AB) && ppCmds.includes(TT_IDLE),
    `new matcher must carry ONLY its genuinely-new hooks, got: ${ppCmds.join(' | ')}`
  );
});

test('cli.js migrates BEFORE merging on the settings upgrade path (ordering guard)', () => {
  const src = fs.readFileSync(CLI_PATH, 'utf8');
  const migrateAt = src.indexOf('migrateLegacyHookCommands(userSettings);');
  const mergeAt = src.indexOf('mergeSettingsInto(userSettings, pkgSettings);');
  assert(migrateAt !== -1, 'upgrade path must call migrateLegacyHookCommands');
  assert(mergeAt !== -1, 'upgrade path must call mergeSettingsInto');
  assert(migrateAt < mergeAt, 'migration must run before the merge or upgrades double the hooks');
});

test('migrateRenamedToolMatchers adds Agent beside Task on CCA-managed matchers only', () => {
  const TT = 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/terminal-title.js"';
  const OLD = 'Bash|Write|Edit|MultiEdit|NotebookEdit|WebFetch|WebSearch|Task|AskUserQuestion';
  const NEW = 'Bash|Write|Edit|MultiEdit|NotebookEdit|WebFetch|WebSearch|Task|Agent|AskUserQuestion';
  const s = {
    hooks: {
      PostToolUse: [
        { matcher: OLD, hooks: [{ type: 'command', command: TT }] },
        { matcher: 'Task', hooks: [{ type: 'command', command: 'node my-own-hook.js' }] },
        { matcher: 'Task|Agent', hooks: [{ type: 'command', command: TT }] },
        { matcher: 'TaskOutput|Bash', hooks: [{ type: 'command', command: TT }] },
      ],
    },
  };
  migrateRenamedToolMatchers(s);
  const m = s.hooks.PostToolUse.map(x => x.matcher);
  assert(m[0] === NEW, `managed Task matcher must gain Agent right after Task, got: ${m[0]}`);
  assert(m[1] === 'Task', `a user-owned matcher must be left alone, got: ${m[1]}`);
  assert(m[2] === 'Task|Agent', `an already-migrated matcher must not double up, got: ${m[2]}`);
  assert(m[3] === 'TaskOutput|Bash', `TaskOutput is not Task — must be untouched, got: ${m[3]}`);
  migrateRenamedToolMatchers(s);
  assert(s.hooks.PostToolUse[0].matcher === NEW, 'migration must be idempotent');
  assert(migrateRenamedToolMatchers(null) === undefined, 'null settings must be a no-op');
});

test('upgrade path: migrate-then-merge lands the shipped Task|Agent matcher as ONE entry', () => {
  const TT = 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/terminal-title.js"';
  const OLD = 'Bash|Write|Edit|MultiEdit|NotebookEdit|WebFetch|WebSearch|Task|AskUserQuestion';
  const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude', 'settings.json'), 'utf8'));
  const shippedTT = shipped.hooks.PostToolUse.find(m => (m.hooks || []).some(h => h.command === TT));
  assert(shippedTT, 'shipped settings.json must register terminal-title under PostToolUse');
  assert(shippedTT.matcher.split('|').includes('Agent'),
    `shipped PostToolUse terminal-title matcher must name Agent, got: ${shippedTT.matcher}`);
  const user = { hooks: { PostToolUse: [{ matcher: OLD, hooks: [{ type: 'command', command: TT }] }] } };
  migrateRenamedToolMatchers(user);
  mergeSettingsInto(user, { hooks: { PostToolUse: shipped.hooks.PostToolUse } });
  const ttEntries = user.hooks.PostToolUse.filter(m => (m.hooks || []).some(h => h.command === TT));
  assert(ttEntries.length === 1, `terminal-title must run under exactly one matcher after upgrade, got ${ttEntries.length}`);
  assert(ttEntries[0].matcher === shippedTT.matcher,
    `upgraded matcher must equal the shipped one, got: ${ttEntries[0].matcher}`);
});

test('cli.js migrates renamed tool matchers BEFORE merging (ordering guard)', () => {
  const src = fs.readFileSync(CLI_PATH, 'utf8');
  const migrateAt = src.indexOf('migrateRenamedToolMatchers(userSettings);');
  const mergeAt = src.indexOf('mergeSettingsInto(userSettings, pkgSettings);');
  assert(migrateAt !== -1, 'upgrade path must call migrateRenamedToolMatchers');
  assert(migrateAt < mergeAt, 'matcher migration must run before the merge or the old matcher is kept');
});

test('migrateRetiredPermissionRules strips retired rules, leaves user rules alone', () => {
  const s = {
    permissions: {
      allow: ['Read(./**)', 'Edit(./**)', 'Write(./**)', 'Write(./dist/**)'],
      deny: ['Write(./nul)', 'Edit(./nul)', 'Read(./.env)'],
    },
  };
  migrateRetiredPermissionRules(s);
  assert(!s.permissions.allow.includes('Write(./**)'), 'retired allow Write(./**) must be scrubbed');
  assert(!s.permissions.deny.includes('Write(./nul)'), 'retired deny Write(./nul) must be scrubbed');
  assert(!s.permissions.deny.includes('Edit(./nul)'), 'retired deny Edit(./nul) must be scrubbed');
  assert(s.permissions.allow.includes('Write(./dist/**)'), 'a user-authored Write rule must survive');
  assert(s.permissions.allow.includes('Edit(./**)'), 'Edit(./**) must survive');
  assert(s.permissions.deny.includes('Read(./.env)'), 'user deny rules must survive');
  migrateRetiredPermissionRules({});
  migrateRetiredPermissionRules({ permissions: {} });
});

test('migrateRetiredPermissionRules returns the count removed (the local-file rewrite gate)', () => {
  // The settings.local.json scrub rewrites ONLY on a non-zero return, so a wrong count here
  // either reformats every user's local file on every install or never fixes any of them.
  assert(migrateRetiredPermissionRules({}) === 0, 'no permissions block -> 0');
  assert(migrateRetiredPermissionRules({ permissions: {} }) === 0, 'empty permissions -> 0');
  assert(migrateRetiredPermissionRules({ permissions: { allow: ['Edit(./**)'] } }) === 0,
    'nothing retired -> 0 (must not trigger a rewrite)');
  assert(migrateRetiredPermissionRules({
    permissions: { allow: ['Write(./**)'], deny: ['Write(./nul)', 'Edit(./nul)'] }
  }) === 3, 'all three retired literals -> 3');
});

test('cli.js scrubs retired permission rules on the settings upgrade path', () => {
  const src = fs.readFileSync(CLI_PATH, 'utf8');
  const scrubAt = src.indexOf('migrateRetiredPermissionRules(userSettings);');
  const mergeAt = src.indexOf('mergeSettingsInto(userSettings, pkgSettings);');
  assert(scrubAt !== -1, 'upgrade path must call migrateRetiredPermissionRules');
  assert(scrubAt < mergeAt, 'scrub must run before the merge (parallel to the legacy-hook ordering)');
});

test('shipped settings.json contains no retired permission rule (would be re-merged forever)', () => {
  const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude', 'settings.json'), 'utf8'));
  const all = [...(shipped.permissions.allow || []), ...(shipped.permissions.deny || [])];
  for (const rule of ['Write(./**)', 'Write(./nul)', 'Edit(./nul)']) {
    assert(!all.includes(rule), `retired rule ${rule} must not ship in .claude/settings.json`);
  }
});

console.log();

// -----------------------------------------------------------------------------
// Concise output style + the Claude Code minimum-version gate
// -----------------------------------------------------------------------------

console.log('Concise output style + version gate:');

const { MIN_CLAUDE_CODE_VERSION, parseVersion, compareVersions, checkClaudeVersion } = require('../bin/lib/claude-version.js');

test('shipped settings.json turns on the Concise output style', () => {
  const shipped = JSON.parse(fs.readFileSync(path.join(PACKAGE_CLAUDE_DIR, 'settings.json'), 'utf8'));
  assert(shipped.outputStyle === 'Concise', `shipped settings.json should set outputStyle Concise, got ${JSON.stringify(shipped.outputStyle)}`);
});

test('the version floor is the release that added the Concise style', () => {
  assert(MIN_CLAUDE_CODE_VERSION === '2.1.237', `MIN_CLAUDE_CODE_VERSION is ${MIN_CLAUDE_CODE_VERSION}; raise it only for a newer shipped dependency, and update README + this test together`);
});

test('parseVersion reads the real banner shape and tolerates junk', () => {
  assert(JSON.stringify(parseVersion('2.1.257 (Claude Code)')) === '[2,1,257]', 'real banner');
  assert(JSON.stringify(parseVersion('claude 1.0.0')) === '[1,0,0]', 'legacy "claude x.y.z" shape');
  assert(parseVersion('Claude Code (dev build)') === null, 'no version → null');
  assert(parseVersion('') === null && parseVersion(null) === null, 'empty / null → null');
});

test('compareVersions orders numerically, not lexically', () => {
  assert(compareVersions([2, 1, 237], [2, 1, 237]) === 0, 'equal');
  assert(compareVersions([2, 1, 99], [2, 1, 237]) < 0, '99 < 237 (lexical would say otherwise)');
  assert(compareVersions([2, 10, 0], [2, 9, 0]) > 0, '10 > 9');
  assert(compareVersions([1, 99, 99], [2, 0, 0]) < 0, 'major wins');
});

test('checkClaudeVersion: below the floor is too old, at/above passes, unreadable passes (fail open)', () => {
  assert(checkClaudeVersion('2.1.236 (Claude Code)').tooOld === true, 'one patch below the floor is too old');
  assert(checkClaudeVersion('2.1.237 (Claude Code)').tooOld === false, 'exactly the floor passes');
  assert(checkClaudeVersion('2.1.257 (Claude Code)').tooOld === false, 'above the floor passes');
  assert(checkClaudeVersion('1.0.0').tooOld === true, 'a 1.x binary is too old');
  const odd = checkClaudeVersion('Claude Code (dev build)');
  assert(odd.tooOld === false && odd.found === null, 'unreadable output must not block');
  assert(checkClaudeVersion('2.1.257 (Claude Code)').found === '2.1.257', 'the found version is reported as a string');
});

test('mergeSettingsInto adds outputStyle only when absent, and records it in the delta', () => {
  const { mergeSettingsInto, unmergeSettingsFrom } = require('../bin/lib/settings-merge.js');
  const fragment = { outputStyle: 'Concise' };

  const added = { env: [], hooks: {}, permissions: { allow: [], deny: [] } };
  const bare = mergeSettingsInto({}, fragment, added);
  assert(bare.outputStyle === 'Concise', 'absent → set');
  assert(JSON.stringify(added.topLevel) === '["outputStyle"]', 'the delta records the key it added');

  const own = mergeSettingsInto({ outputStyle: 'Explanatory' }, fragment, { env: [], hooks: {}, permissions: { allow: [], deny: [] } });
  assert(own.outputStyle === 'Explanatory', "user's value is never overwritten");

  const explicitDefault = mergeSettingsInto({ outputStyle: 'default' }, fragment);
  assert(explicitDefault.outputStyle === 'default', 'an explicit default is a user choice too (presence, not value)');

  // Unmerge: the recorded delta takes back exactly what was added; a user-changed value survives.
  unmergeSettingsFrom(bare, fragment, added);
  assert(!('outputStyle' in bare), 'recorded delta → key removed');
  const changed = { outputStyle: 'Learning' };
  unmergeSettingsFrom(changed, fragment);
  assert(changed.outputStyle === 'Learning', 'no delta + value differs from the fragment → left alone');
  const same = { outputStyle: 'Concise' };
  unmergeSettingsFrom(same, fragment);
  assert(!('outputStyle' in same), 'no delta (old ledger) + value equals the fragment → removed');
});

test('/autoconfig relays the version-floor hard stop and does not continue past it', () => {
  const autoconfig = fs.readFileSync(path.join(PACKAGE_CLAUDE_DIR, 'commands', 'autoconfig.md'), 'utf8');
  assert(/requires Claude Code v/.test(autoconfig) && /claude update/.test(autoconfig), '/autoconfig should show the version-floor block and the update command');
  assert(/STOP/.test(autoconfig), '/autoconfig must stop rather than configure on an old Claude Code');
});

summary();
