#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync, spawn } = require('child_process');
const { formatUpdateSummary } = require('./update-summary.js');

const cwd = process.cwd();
const packageDir = path.dirname(__dirname);

// ── Version pin ──────────────────────────────────────────────────────────────
// A project pinned via .claude/cca.config.json { "pinVersion": "1.0.186" } freezes
// SILENT refreshes: /autoconfig's `npx ...@latest --bootstrap` and /autoconfig-update's
// `--pull-updates` hardcode @latest in every shipped command file, so it is always the
// NEWEST cli.js executing those refreshes — this gate ships in new releases yet protects
// old pinned installs from being dragged forward. An EXPLICITLY typed install
// (`npx claude-code-autoconfig@<anything>` in a terminal) expresses intent to move:
// it removes the pin, says so, and proceeds. Primary use: installing an old version
// on purpose to validate the @latest upgrade path (see README).
// Reads .claude/cca.config.json, distinguishing three cases so callers can fail SAFE:
//   • absent / unreadable   → { config: null, corrupt: false } (no pin — proceed normally)
//   • present but not JSON   → { config: null, corrupt: true }  (treat as pinned — a silent
//     refresh must NOT unpin on a parse error; a wrongly-unpinned project can't be
//     un-dragged, whereas a skipped refresh is simply re-runnable once the file is fixed)
//   • valid JSON            → { config: <obj>, corrupt: false }
function readCcaConfigResult() {
  const p = path.join(cwd, '.claude', 'cca.config.json');
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (_) {
    return { config: null, corrupt: false }; // ENOENT / unreadable → no pin in effect
  }
  try {
    return { config: JSON.parse(raw), corrupt: false };
  } catch (_) {
    return { config: null, corrupt: true }; // present but unparseable → fail safe
  }
}
function readCcaConfig() {
  return readCcaConfigResult().config;
}
const ccaConfigResult = readCcaConfigResult();
const ccaConfigCorrupt = ccaConfigResult.corrupt;
const pinnedVersion = (ccaConfigResult.config || {}).pinVersion || null;
const installerVersion = require(path.join(packageDir, 'package.json')).version;

// Cleanup any stray 'nul' file immediately on startup (Windows /dev/null artifact)
function cleanupNulFile() {
  const nulFile = path.join(cwd, 'nul');
  if (fs.existsSync(nulFile)) {
    try {
      fs.unlinkSync(nulFile);
    } catch (_) {
      // Ignore - file might be locked
    }
  }
}
cleanupNulFile();

// Reserved Windows device names - never create files with these names
const WINDOWS_RESERVED = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4',
  'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5',
  'LPT6', 'LPT7', 'LPT8', 'LPT9'];

// Files/folders installed by autoconfig - don't backup these
const AUTOCONFIG_FILES = ['commands', 'docs', 'agents', 'migration', 'hooks', 'scripts', 'sounds', 'rules', 'feedback', 'settings.json', 'settings.local.json', '.mcp.json', '.autoconfig-version', '.autoconfig-plugins.json', 'cca.config.json', '.autoconfig-whats-new.json'];

function isReservedName(name) {
  const baseName = name.replace(/\.[^.]*$/, '').toUpperCase();
  return WINDOWS_RESERVED.includes(baseName);
}

function hasUserContent(claudeDir) {
  // Check if .claude/ has any files beyond what autoconfig installs
  if (!fs.existsSync(claudeDir)) return false;

  const entries = fs.readdirSync(claudeDir);
  for (const entry of entries) {
    if (!AUTOCONFIG_FILES.includes(entry)) {
      // Found something that's not from autoconfig
      return true;
    }
  }
  return false;
}

function formatTimestamp() {
  const now = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[now.getMonth()];
  const day = now.getDate();
  const year = now.getFullYear();
  const hour = now.getHours();
  const min = String(now.getMinutes()).padStart(2, '0');
  const ampm = hour >= 12 ? 'pm' : 'am';
  const hour12 = hour % 12 || 12;

  return `${month}-${day}-${year}_${hour12}-${min}${ampm}`;
}

// --pull-updates: Copy new update files from package to user's project
function parseAppliedUpdates(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/<!-- @applied\r?\n([\s\S]*?)-->/);
  if (!match) return [];

  return match[1].trim().split('\n')
    .filter(line => line.trim())
    .map(line => {
      const idMatch = line.match(/^(\d{3})/);
      return idMatch ? parseInt(idMatch[1], 10) : 0;
    })
    .filter(id => id > 0);
}

function getHighestAppliedId(appliedIds) {
  return appliedIds.length > 0 ? Math.max(...appliedIds) : 0;
}

function pullUpdates() {
  if (ccaConfigCorrupt) {
    // Can't read the pin from a corrupt config — treat as pinned and skip this silent
    // pull rather than risk dragging a pinned project forward (fail safe).
    console.log('\x1b[33m%s\x1b[0m', '⚠️  .claude/cca.config.json is present but not valid JSON — skipping this update pull to stay safe. Fix or delete the file, then re-run.');
    return;
  }
  if (pinnedVersion && pinnedVersion !== installerVersion) {
    console.log('\x1b[90m%s\x1b[0m', `⏸  Pinned to v${pinnedVersion} — skipped the v${installerVersion} update pull (remove "pinVersion" from .claude/cca.config.json to unpin).`);
    return;
  }
  console.log('\x1b[36m%s\x1b[0m', '🔄 Checking for updates...');
  console.log();

  const userCmdPath = path.join(cwd, '.claude', 'commands', 'autoconfig-update.md');
  const packageCmdPath = path.join(packageDir, '.claude', 'commands', 'autoconfig-update.md');
  const packageUpdatesDir = path.join(packageDir, '.claude', 'updates');
  const userUpdatesDir = path.join(cwd, '.claude', 'updates');

  // Ensure .claude/commands/ exists
  fs.mkdirSync(path.join(cwd, '.claude', 'commands'), { recursive: true });

  // Refresh autoconfig-update.md (preserve user's @applied block)
  if (fs.existsSync(packageCmdPath)) {
    if (fs.existsSync(userCmdPath)) {
      const userContent = fs.readFileSync(userCmdPath, 'utf8');
      const packageContent = fs.readFileSync(packageCmdPath, 'utf8');
      const userApplied = userContent.match(/<!-- @applied[\s\S]*?-->/);
      if (userApplied) {
        const merged = packageContent.replace(/<!-- @applied[\s\S]*?-->/, userApplied[0]);
        fs.writeFileSync(userCmdPath, merged);
      } else {
        fs.copyFileSync(packageCmdPath, userCmdPath);
      }
    } else {
      fs.copyFileSync(packageCmdPath, userCmdPath);
    }
  }

  // Check for available updates in package
  if (!fs.existsSync(packageUpdatesDir)) {
    console.log('\x1b[32m%s\x1b[0m', '✅ Already up to date');
    return;
  }

  const appliedIds = parseAppliedUpdates(userCmdPath);
  const highestApplied = getHighestAppliedId(appliedIds);

  const updateFiles = fs.readdirSync(packageUpdatesDir).filter(f => f.endsWith('.md'));
  const newUpdates = updateFiles.filter(file => {
    const match = file.match(/^(\d{3})-/);
    if (!match) return false;
    return parseInt(match[1], 10) > highestApplied;
  });

  if (newUpdates.length === 0) {
    console.log('\x1b[32m%s\x1b[0m', '✅ Already up to date');
    return;
  }

  // Copy new update files
  fs.mkdirSync(userUpdatesDir, { recursive: true });
  for (const file of newUpdates) {
    fs.copyFileSync(
      path.join(packageUpdatesDir, file),
      path.join(userUpdatesDir, file)
    );
  }

  console.log('\x1b[32m%s\x1b[0m', `✅ Copied ${newUpdates.length} new update${newUpdates.length > 1 ? 's' : ''} to .claude/updates/`);
  console.log();
  console.log('Run \x1b[36mclaude /autoconfig-update\x1b[0m to review and install updates.');
}

if (process.argv.includes('--pull-updates')) {
  pullUpdates();
  process.exit(0);
}

// ============================================================================
// Settings merge helpers (shared by the upgrade path and the plugin installer)
// ============================================================================

// Rewrite legacy cwd-relative hook commands ("node .claude/hooks/X.js") to the
// ${CLAUDE_PROJECT_DIR:-.}-anchored form IN PLACE, mutating the given settings object.
// Two reasons, both from the 2026-07-08 stuck-title postmortem:
//   1. cwd-relative commands go MODULE_NOT_FOUND the moment a session cd's away from the
//      project root — every matching tool call then spews a red hook error until cwd returns.
//   2. mergeSettingsInto dedups by EXACT command string, so without this rewrite an upgrade
//      would ADD the anchored template entry alongside the user's old relative one -> the
//      hook runs twice per event.
// Any .claude/hooks/*.js relative command is rewritten — anchored resolution is identical at
// the project root and cd-proof everywhere else — while commands outside .claude/hooks are
// never touched.
function migrateLegacyHookCommands(userSettings) {
  if (!userSettings || !userSettings.hooks) return;
  const LEGACY = /^node \.claude\/hooks\/([\w.-]+\.js)$/;
  for (const matchers of Object.values(userSettings.hooks)) {
    if (!Array.isArray(matchers)) continue;
    for (const matcher of matchers) {
      for (const hook of matcher.hooks || []) {
        const m = typeof hook.command === 'string' && hook.command.match(LEGACY);
        if (m) hook.command = 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/' + m[1] + '"';
      }
    }
  }
}

// Additively fold a settings fragment (hooks / env / permissions) into an existing
// settings object, mutating and returning it.
//   - hooks: add hook commands that don't already exist (dedup by command string, per event)
//   - env:   add keys the user hasn't set (never overwrite an existing value)
//   - permissions.allow/deny: add missing rules (and migrate deprecated :* syntax)
function mergeSettingsInto(userSettings, fragment) {
  if (fragment.hooks) {
    if (!userSettings.hooks) userSettings.hooks = {};
    for (const [event, matchers] of Object.entries(fragment.hooks)) {
      if (!userSettings.hooks[event]) {
        userSettings.hooks[event] = matchers;
      } else {
        // Add any hook commands that don't already exist
        for (const matcher of matchers) {
          for (const hook of matcher.hooks || []) {
            const exists = userSettings.hooks[event].some(m =>
              (m.hooks || []).some(h => h.command === hook.command)
            );
            if (!exists) {
              const existingMatcher = userSettings.hooks[event].find(m => m.matcher === matcher.matcher);
              if (existingMatcher) {
                existingMatcher.hooks = existingMatcher.hooks || [];
                existingMatcher.hooks.push(hook);
              } else {
                userSettings.hooks[event].push(matcher);
              }
            }
          }
        }
      }
    }
  }

  if (fragment.env) {
    if (!userSettings.env) userSettings.env = {};
    for (const [key, value] of Object.entries(fragment.env)) {
      if (!(key in userSettings.env)) userSettings.env[key] = value;
    }
  }

  if (fragment.permissions) {
    if (!userSettings.permissions) userSettings.permissions = {};
    for (const key of ['allow', 'deny']) {
      if (!fragment.permissions[key]) continue;
      if (!userSettings.permissions[key]) {
        userSettings.permissions[key] = fragment.permissions[key];
      } else {
        // Migrate deprecated :* syntax to space-* in existing entries
        userSettings.permissions[key] = userSettings.permissions[key].map(rule =>
          rule.replace(/^(Bash\([^)]*):(\*\))$/, '$1 $2')
        );
        for (const rule of fragment.permissions[key]) {
          if (!userSettings.permissions[key].includes(rule)) {
            userSettings.permissions[key].push(rule);
          }
        }
      }
    }
  }

  return userSettings;
}

// Inverse of mergeSettingsInto: strip a fragment's contributions back out. Only removes
// what the fragment added (dedup-safe), leaving the user's own entries untouched.
function unmergeSettingsFrom(userSettings, fragment) {
  if (fragment.hooks && userSettings.hooks) {
    for (const [event, matchers] of Object.entries(fragment.hooks)) {
      if (!userSettings.hooks[event]) continue;
      const commands = new Set();
      for (const matcher of matchers) {
        for (const hook of matcher.hooks || []) {
          if (hook.command) commands.add(hook.command);
        }
      }
      userSettings.hooks[event] = userSettings.hooks[event]
        .map(m => {
          if (m.hooks) m.hooks = m.hooks.filter(h => !commands.has(h.command));
          return m;
        })
        .filter(m => (m.hooks || []).length > 0);
      if (userSettings.hooks[event].length === 0) delete userSettings.hooks[event];
    }
    if (Object.keys(userSettings.hooks).length === 0) delete userSettings.hooks;
  }

  if (fragment.env && userSettings.env) {
    for (const [key, value] of Object.entries(fragment.env)) {
      if (userSettings.env[key] === value) delete userSettings.env[key];
    }
    if (Object.keys(userSettings.env).length === 0) delete userSettings.env;
  }

  if (fragment.permissions && userSettings.permissions) {
    for (const key of ['allow', 'deny']) {
      if (!fragment.permissions[key] || !userSettings.permissions[key]) continue;
      const remove = new Set(fragment.permissions[key]);
      userSettings.permissions[key] = userSettings.permissions[key].filter(r => !remove.has(r));
    }
  }

  return userSettings;
}

// ============================================================================
// Plugin system: install / remove / list drop-in add-on plugins.
//
// A plugin is a folder containing a plugin.json manifest:
//   {
//     "name": "terminal-title",
//     "version": "1.0.0",
//     "description": "...",
//     "files":    [ { "from": "hooks/x.js", "to": "hooks/x.js" } ],  // "to" is relative to <project>/.claude
//     "settings": { "env": {...}, "hooks": {...}, "permissions": {...} }  // folded into .claude/settings.json
//   }
//
// Installed plugins are tracked in .claude/.autoconfig-plugins.json so `plugin remove`
// cleanly undoes both the copied files and the settings contributions. The free core
// ships only this generic loader — paid/closed plugins live and are delivered separately.
// ============================================================================

const PLUGINS_LEDGER = '.autoconfig-plugins.json';

function readPluginsLedger(claudeDir) {
  const p = path.join(claudeDir, PLUGINS_LEDGER);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    // Don't let a corrupt ledger masquerade as "no plugins installed" — say so, so a
    // failed `plugin remove` / `plugin list` is diagnosable instead of silently wrong.
    console.log('\x1b[33m%s\x1b[0m', `⚠️  ${PLUGINS_LEDGER} is not valid JSON (${e.message}) — treating it as empty; installed plugins may not be listed or cleanly removable until you fix it.`);
    return {};
  }
}

function writePluginsLedger(claudeDir, ledger) {
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, PLUGINS_LEDGER), JSON.stringify(ledger, null, 2));
}

function loadManifest(pluginDir) {
  const manifestPath = path.join(pluginDir, 'plugin.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`no plugin.json found in ${pluginDir}`);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    throw new Error(`plugin.json is not valid JSON: ${e.message}`);
  }
  if (!manifest.name || typeof manifest.name !== 'string') {
    throw new Error('plugin.json must declare a string "name"');
  }
  if (manifest.files && !Array.isArray(manifest.files)) {
    throw new Error('plugin.json "files" must be an array');
  }
  if (!manifest.files) manifest.files = [];
  return manifest;
}

function pluginAdd(pluginArg, claudeDir) {
  const pluginDir = path.resolve(cwd, pluginArg);
  const manifest = loadManifest(pluginDir);
  console.log('\x1b[36m%s\x1b[0m', `📦 Installing plugin: ${manifest.name}${manifest.version ? ' v' + manifest.version : ''}`);

  // 1. Copy declared files into <project>/.claude/<to>
  const installedFiles = [];
  for (const file of manifest.files) {
    if (!file || !file.from || !file.to) throw new Error('each "files" entry must have "from" and "to"');
    const src = path.resolve(pluginDir, file.from);
    if (!fs.existsSync(src)) throw new Error(`plugin file not found: ${file.from}`);
    const dest = path.join(claudeDir, file.to);
    if (isReservedName(path.basename(dest))) throw new Error(`refusing to write reserved filename: ${file.to}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    installedFiles.push(file.to);
    console.log('\x1b[90m%s\x1b[0m', `   + .claude/${file.to}`);
  }

  // 2. Fold the settings fragment into .claude/settings.json (clone first to avoid aliasing the ledger copy)
  if (manifest.settings) {
    const settingsPath = path.join(claudeDir, 'settings.json');
    let userSettings = {};
    if (fs.existsSync(settingsPath)) {
      try {
        userSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      } catch (e) {
        // A corrupt settings.json must NOT be treated as {} — that would merge the plugin
        // fragment over an empty object and overwrite the user's entire config. Back it up
        // and refuse (mirrors pluginRemove's leave-intact behavior).
        const backupPath = settingsPath + '.corrupt-' + Date.now() + '.bak';
        try { fs.copyFileSync(settingsPath, backupPath); } catch (_) { /* best effort */ }
        throw new Error(`.claude/settings.json is not valid JSON (${e.message}) — refusing to overwrite it. A backup was saved to ${path.basename(backupPath)}. Fix or delete settings.json, then re-run.`);
      }
    }
    mergeSettingsInto(userSettings, JSON.parse(JSON.stringify(manifest.settings)));
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(userSettings, null, 2));
    console.log('\x1b[90m%s\x1b[0m', '   ✎ merged settings.json (hooks / env / permissions)');
  }

  // 3. Record in the ledger so removal can cleanly undo everything
  const ledger = readPluginsLedger(claudeDir);
  ledger[manifest.name] = {
    version: manifest.version || null,
    files: installedFiles,
    settings: manifest.settings || null,
    installedAt: new Date().toISOString()
  };
  writePluginsLedger(claudeDir, ledger);
  console.log('\x1b[32m%s\x1b[0m', `✅ Installed ${manifest.name}`);
}

function pluginRemove(name, claudeDir) {
  const ledger = readPluginsLedger(claudeDir);
  const entry = ledger[name];
  if (!entry) throw new Error(`plugin "${name}" is not installed`);
  console.log('\x1b[36m%s\x1b[0m', `🗑  Removing plugin: ${name}`);

  // 1. Delete the files the plugin installed
  for (const rel of entry.files || []) {
    const p = path.join(claudeDir, rel);
    if (fs.existsSync(p)) {
      fs.rmSync(p, { force: true });
      console.log('\x1b[90m%s\x1b[0m', `   - .claude/${rel}`);
    }
  }

  // 2. Revert the settings contributions
  if (entry.settings) {
    const settingsPath = path.join(claudeDir, 'settings.json');
    if (fs.existsSync(settingsPath)) {
      try {
        const userSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        unmergeSettingsFrom(userSettings, entry.settings);
        fs.writeFileSync(settingsPath, JSON.stringify(userSettings, null, 2));
        console.log('\x1b[90m%s\x1b[0m', '   ✎ reverted settings.json contributions');
      } catch { /* leave settings intact if unparsable */ }
    }
  }

  // 3. Drop it from the ledger
  delete ledger[name];
  writePluginsLedger(claudeDir, ledger);
  console.log('\x1b[32m%s\x1b[0m', `✅ Removed ${name}`);
}

function pluginList(claudeDir) {
  const ledger = readPluginsLedger(claudeDir);
  const names = Object.keys(ledger);
  if (names.length === 0) {
    console.log('\x1b[90m%s\x1b[0m', 'No plugins installed.');
    return;
  }
  console.log('\x1b[36m%s\x1b[0m', 'Installed plugins:');
  for (const name of names) {
    const e = ledger[name];
    const n = (e.files || []).length;
    console.log(`   • ${name}${e.version ? ' v' + e.version : ''}  (${n} file${n === 1 ? '' : 's'})`);
  }
}

function runPluginCommand(argv) {
  const sub = argv[3];
  const arg = argv[4];
  const claudeDir = path.join(cwd, '.claude');
  try {
    if (sub === 'add' || sub === 'install') {
      if (!arg) throw new Error('usage: claude-code-autoconfig plugin add <path-to-plugin-dir>');
      pluginAdd(arg, claudeDir);
    } else if (sub === 'remove' || sub === 'rm' || sub === 'uninstall') {
      if (!arg) throw new Error('usage: claude-code-autoconfig plugin remove <name>');
      pluginRemove(arg, claudeDir);
    } else if (sub === 'list' || sub === 'ls') {
      pluginList(claudeDir);
    } else {
      console.log('Usage:');
      console.log('  claude-code-autoconfig plugin add <dir>      Install a plugin from a folder');
      console.log('  claude-code-autoconfig plugin remove <name>  Uninstall a plugin');
      console.log('  claude-code-autoconfig plugin list           List installed plugins');
      process.exit(sub ? 1 : 0);
    }
  } catch (err) {
    console.log('\x1b[31m%s\x1b[0m', `❌ ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[2] === 'plugin') {
  runPluginCommand(process.argv);
  process.exit(0);
}

const forceMode = process.argv.includes('--force');

// Detect if running inside Claude Code session.
// CLAUDECODE=1 alone is not reliable: env vars inherit into every descendant
// process (e.g. VS Code launched from a Claude session, and any terminal it
// spawns). A genuine in-agent run has piped stdio (isTTY falsy), while a human
// terminal has a real TTY — so require both signals before blocking.
const insideClaude = process.env.CLAUDECODE === '1' && !process.stdout.isTTY;

console.log('\x1b[36m%s\x1b[0m', '🚀 Claude Code Autoconfig');
console.log();

// Block early if running inside Claude Code (unless --bootstrap)
if (insideClaude && !process.argv.includes('--bootstrap')) {
  console.log('\x1b[31m%s\x1b[0m', '● The tool needs to be run from a regular terminal, not from within Claude Code.');
  console.log();
  console.log('   Open a separate terminal window and run:');
  console.log();
  console.log('   \x1b[36mnpx claude-code-autoconfig@latest\x1b[0m');
  console.log();
  process.exit(0);
}

// Corrupt-config fail-safe — must run BEFORE any file copying. A present-but-unparseable
// cca.config.json means we can't read the pin, so a SILENT refresh (--bootstrap) must not
// drag the project forward; skip it (re-runnable once fixed). An EXPLICIT interactive
// install expresses intent to move, so it proceeds — but says the file was ignored.
if (ccaConfigCorrupt) {
  if (process.argv.includes('--bootstrap')) {
    console.log('\x1b[33m%s\x1b[0m', '⚠️  .claude/cca.config.json is present but not valid JSON — skipping this refresh to stay safe. Fix or delete the file, then re-run.');
    process.exit(0);
  }
  console.log('\x1b[33m%s\x1b[0m', '⚠️  .claude/cca.config.json is not valid JSON — ignoring it for this explicit install.');
  console.log();
}

// Version pin gate — must run BEFORE any file copying. Bootstrap (silent refresh)
// honors the pin and leaves the project untouched; an explicit interactive install
// removes the pin and proceeds.
if (pinnedVersion && pinnedVersion !== installerVersion) {
  if (process.argv.includes('--bootstrap')) {
    console.log('\x1b[90m%s\x1b[0m', `⏸  Pinned to v${pinnedVersion} — skipped the v${installerVersion} refresh (remove "pinVersion" from .claude/cca.config.json to unpin).`);
    process.exit(0);
  }
  const cfg = readCcaConfig();
  delete cfg.pinVersion;
  try {
    fs.writeFileSync(path.join(cwd, '.claude', 'cca.config.json'), JSON.stringify(cfg, null, 2));
  } catch (_) { /* proceed regardless — an explicit install must not be blocked by the pin file */ }
  console.log('\x1b[33m%s\x1b[0m', `📌 This project was pinned to v${pinnedVersion} — removing the pin and installing v${installerVersion}, since you ran this install explicitly.`);
  console.log();
}

// Explicit old-version installs are NOT preserved — the bootstrap sweeps the project
// to this (latest) version. (Preserving them proved a rabbit hole; the pinVersion gate
// above remains as an undocumented escape hatch if we revisit.) Sweeping silently is
// confusing though, so detect the signature of "an older version was explicitly
// installed and /autoconfig hasn't configured it yet" and say what's happening.
// Routine upgrades of already-configured projects skip the notice.
(function noticeUnsupportedOldInstall() {
  try {
    const marker = path.join(cwd, '.claude', '.autoconfig-version');
    if (!fs.existsSync(marker)) return;
    const installed = fs.readFileSync(marker, 'utf8').trim();
    if (!installed || installed === installerVersion) return;
    const claudeMd = path.join(cwd, 'CLAUDE.md');
    const configured = fs.existsSync(claudeMd) &&
      fs.readFileSync(claudeMd, 'utf8').includes('AUTO-GENERATED BY /autoconfig');
    if (configured) return;
    console.log('\x1b[33m%s\x1b[0m', `⚠️  claude-code-autoconfig v${installed} is no longer supported — installing the latest version (v${installerVersion}) instead.`);
    console.log();
  } catch (_) { /* cosmetic only — never block the install */ }
})();

// Step 1: Check if Claude Code is installed
function isClaudeInstalled() {
  try {
    execSync('claude --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function installClaude() {
  console.log('\x1b[33m%s\x1b[0m', '⚠️  Claude Code not found. Installing...');
  console.log();
  try {
    execSync('npm install -g @anthropic-ai/claude-code', { stdio: 'inherit' });
    console.log();
    console.log('\x1b[32m%s\x1b[0m', '✅ Claude Code installed');
    return true;
  } catch (_) {
    console.log('\x1b[31m%s\x1b[0m', '❌ Failed to install Claude Code');
    console.log('   Install manually: npm install -g @anthropic-ai/claude-code');
    return false;
  }
}

if (!isClaudeInstalled()) {
  if (!installClaude()) {
    process.exit(1);
  }
}

console.log('\x1b[32m%s\x1b[0m', '✅ Claude Code detected');

// Step 2: Backup existing .claude/ if it has user content
const claudeDest = path.join(cwd, '.claude');
const SKIP_BACKUP = ['migration']; // Don't backup the migration folder itself
let migrationPath = null;

// Diagnostic: log pre-install state
console.log();
console.log('\x1b[90m%s\x1b[0m', '── Pre-install state ──');
console.log('\x1b[90m%s\x1b[0m', `   Working dir: ${cwd}`);
const claudeMdExists = fs.existsSync(path.join(cwd, 'CLAUDE.md'));
console.log('\x1b[90m%s\x1b[0m', `   CLAUDE.md: ${claudeMdExists ? 'exists' : 'not found'}`);
if (claudeMdExists) {
  const claudeMdContent = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8');
  const hasMarker = claudeMdContent.includes('AUTO-GENERATED BY /autoconfig');
  console.log('\x1b[90m%s\x1b[0m', `   CLAUDE.md autoconfig marker: ${hasMarker ? 'yes' : 'no'}`);
}
if (fs.existsSync(claudeDest)) {
  const entries = fs.readdirSync(claudeDest);
  console.log('\x1b[90m%s\x1b[0m', `   .claude/ exists: yes (${entries.length} entries)`);
  for (const e of entries) {
    const isAutoconfig = AUTOCONFIG_FILES.includes(e);
    console.log('\x1b[90m%s\x1b[0m', `     ${isAutoconfig ? '·' : '▸'} ${e}${isAutoconfig ? '' : ' (user content)'}`);
  }
  const docsHtml = path.join(claudeDest, 'docs', 'autoconfig.docs.html');
  console.log('\x1b[90m%s\x1b[0m', `   autoconfig.docs.html: ${fs.existsSync(docsHtml) ? 'exists' : 'not found'}`);
} else {
  console.log('\x1b[90m%s\x1b[0m', '   .claude/ exists: no');
}
console.log('\x1b[90m%s\x1b[0m', '───────────────────────');
console.log();

function copyDirForBackup(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP_BACKUP.includes(entry.name)) continue;
    if (AUTOCONFIG_FILES.includes(entry.name)) continue; // Skip autoconfig-installed files
    if (isReservedName(entry.name)) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirForBackup(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function collectFiles(dir, prefix = '') {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectFiles(path.join(dir, entry.name), relPath));
    } else {
      files.push(relPath);
    }
  }
  return files;
}

if (fs.existsSync(claudeDest) && hasUserContent(claudeDest)) {
  const userEntries = fs.readdirSync(claudeDest).filter(e =>
    e !== 'migration' && !AUTOCONFIG_FILES.includes(e)
  );
  console.log('\x1b[90m%s\x1b[0m', `   Backup triggered by user content: ${userEntries.join(', ')}`);

  const timestamp = formatTimestamp();
  const migrationDir = path.join(claudeDest, 'migration');
  migrationPath = path.join(migrationDir, timestamp);

  fs.mkdirSync(migrationPath, { recursive: true });

  // Copy user files to backup (excluding autoconfig-installed files)
  for (const entry of userEntries) {
    const srcPath = path.join(claudeDest, entry);
    const destPath = path.join(migrationPath, entry);

    if (fs.statSync(srcPath).isDirectory()) {
      copyDirForBackup(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }

  // Collect backed up files for metadata
  const backedUpFiles = collectFiles(migrationPath);

  if (backedUpFiles.length > 0) {
    // Write latest.json for the guide
    fs.writeFileSync(path.join(migrationDir, 'latest.json'), JSON.stringify({
      timestamp: timestamp,
      backedUpFiles: backedUpFiles
    }, null, 2));

    // Create README inside the dated backup folder
    const backupReadme = `# Migration Backup: ${timestamp}

This folder contains a backup of your previous .claude/ configuration.

## Why This Backup Exists

You ran \`npx claude-code-autoconfig\` on a project that already had Claude Code configured.
Your previous files were backed up here before the new configuration was applied.

## Backed Up Files

${backedUpFiles.map(f => `- ${f}`).join('\n')}

## Restoring Files

To restore any file, copy it from this folder back to \`.claude/\`.

For example:
\`\`\`bash
cp .claude/migration/${timestamp}/settings.json .claude/settings.json
\`\`\`
`;
    fs.writeFileSync(path.join(migrationPath, 'README.md'), backupReadme);

    console.log('\x1b[33m%s\x1b[0m', `⚠️  Backed up existing config to .claude/migration/${timestamp}/`);
  } else {
    // No user files to backup, remove the empty migration folder
    fs.rmdirSync(migrationPath, { recursive: true });
  }
}

// Read previous installed version (before copying overwrites it)
const versionFile = path.join(claudeDest, '.autoconfig-version');
const previousVersion = fs.existsSync(versionFile)
  ? fs.readFileSync(versionFile, 'utf8').trim()
  : null;
const currentVersion = require(path.join(packageDir, 'package.json')).version;

// Detect upgrade vs fresh install (must run BEFORE copying files)
const isUpgrade = (() => {
  // Indicator 1: CLAUDE.md has autoconfig marker
  const claudeMdPath = path.join(cwd, 'CLAUDE.md');
  if (fs.existsSync(claudeMdPath)) {
    const content = fs.readFileSync(claudeMdPath, 'utf8');
    if (content.includes('AUTO-GENERATED BY /autoconfig')) {
      console.log('\x1b[90m%s\x1b[0m', '   Upgrade detected: CLAUDE.md has autoconfig marker');
      return true;
    }
  }
  // Indicator 2: docs HTML exists (unique autoconfig artifact)
  const docsPath = path.join(claudeDest, 'docs', 'autoconfig.docs.html');
  if (fs.existsSync(docsPath)) {
    console.log('\x1b[90m%s\x1b[0m', '   Upgrade detected: autoconfig.docs.html exists');
    return true;
  }
  console.log('\x1b[90m%s\x1b[0m', '   Install type: fresh (no previous autoconfig found)');
  return false;
})();

// Step 3: Copy minimal bootstrap (commands/, docs/, agents/, feedback/, hooks/)
const commandsSrc = path.join(packageDir, '.claude', 'commands');
const docsSrc = path.join(packageDir, '.claude', 'docs');
const agentsSrc = path.join(packageDir, '.claude', 'agents');
const feedbackSrc = path.join(packageDir, '.claude', 'feedback');
const hooksSrc = path.join(packageDir, '.claude', 'hooks');
const scriptsSrc = path.join(packageDir, '.claude', 'scripts');

// Files that exist in the dev repo but should never be installed to user projects.
// token-guard.js + its commands are staged in-repo (dogfooded via settings.local.json) but
// gated OUT of user installs until R6/R8/R9/R10 are live-baked — see CLAUDE.md "Invariants & Landmines".
// THIS list (not package.json "files") is what gates installs — new dev-only commands/hooks
// must be added here. Keep the literal on one line: tests parse it by regex.
const DEV_ONLY_FILES = ['deploy-to-npmjs.md', 'usage-report.md', 'analyze-session.md', 'eval-new-session.md', 'migrate-new-session.md', 'token-guard.js', 'plan-progress.md', 'plan-progress.js'];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (isReservedName(entry.name)) continue;
    if (DEV_ONLY_FILES.includes(entry.name)) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyDirIfMissing(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (isReservedName(entry.name)) continue;
    if (DEV_ONLY_FILES.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirIfMissing(srcPath, destPath);
    } else if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Parse @version from command file content
function parseCommandVersion(content) {
  const match = content.match(/<!-- @version (\d+) -->/);
  return match ? parseInt(match[1], 10) : 0;
}

// Track what commands are new/updated for summary
const commandsDest = path.join(claudeDest, 'commands');
const existingCommandContents = new Map();
if (fs.existsSync(commandsDest)) {
  for (const f of fs.readdirSync(commandsDest).filter(f => f.endsWith('.md'))) {
    existingCommandContents.set(f, fs.readFileSync(path.join(commandsDest, f), 'utf8'));
  }
}

// Copy commands (required for /autoconfig to work)
// Preserve a legacy gls @screenshotDir marker across upgrades: read it here (pre-copy, from the
// OLD gls.md's first line), then migrate it into cca.config.json below (post-copy). Shipped
// gls.md (v5+) no longer carries the marker — the value now lives at cca.config.json
// gls.screenshotDir — so the old in-file re-insert silently dropped it for these legacy users.
const glsDest = path.join(claudeDest, 'commands', 'gls.md');
let savedScreenshotDir = null;
if (fs.existsSync(glsDest)) {
  const firstLine = fs.readFileSync(glsDest, 'utf8').split(/\r?\n/)[0];
  const match = firstLine.match(/<!-- @screenshotDir (.+?) -->/);
  if (match) savedScreenshotDir = match[1].trim();
}

if (fs.existsSync(commandsSrc)) {
  copyDir(commandsSrc, path.join(claudeDest, 'commands'));
} else {
  console.log('\x1b[31m%s\x1b[0m', '❌ Error: commands directory not found');
  process.exit(1);
}

// Deprecated command aliases (old names kept as shims after a rename) REPLACE an existing
// command but are never introduced: a fresh install — or any project that never had the
// old name — must not gain a deprecated alias, so drop the just-copied file unless the
// destination already had it before this run (existingCommandContents snapshots pre-copy).
const DEPRECATED_COMMAND_ALIASES = ['enable-arcade-beeps.md', 'disable-arcade-beeps.md'];
for (const f of DEPRECATED_COMMAND_ALIASES) {
  if (!existingCommandContents.has(f)) {
    try { fs.unlinkSync(path.join(commandsDest, f)); } catch (_) { /* never copied */ }
  }
}

// Detect new and updated commands (with version tracking)
const newCommands = [];
const updatedCommands = []; // { file, oldVersion, newVersion }
for (const f of fs.readdirSync(commandsDest).filter(f => f.endsWith('.md') && !DEV_ONLY_FILES.includes(f))) {
  const newContent = fs.readFileSync(path.join(commandsDest, f), 'utf8');
  if (!existingCommandContents.has(f)) {
    newCommands.push({ file: f, version: parseCommandVersion(newContent) });
  } else if (newContent !== existingCommandContents.get(f)) {
    const oldVersion = parseCommandVersion(existingCommandContents.get(f));
    const newVersion = parseCommandVersion(newContent);
    updatedCommands.push({ file: f, oldVersion, newVersion });
  }
}

// Migrate a legacy gls @screenshotDir into cca.config.json (the current home for the value).
// Only when the config isn't already tracking it (never clobber a newer value), never when the
// config is corrupt (fail safe — a wrongly-overwritten config can't be un-broken), and
// round-trip every existing key so nothing else is lost (additive-only, trap 1).
if (savedScreenshotDir && !ccaConfigCorrupt) {
  const cfg = readCcaConfig() || {};
  if (!(cfg.gls && cfg.gls.screenshotDir)) {
    cfg.gls = cfg.gls || {};
    cfg.gls.screenshotDir = savedScreenshotDir;
    try {
      fs.writeFileSync(path.join(cwd, '.claude', 'cca.config.json'), JSON.stringify(cfg, null, 2));
      console.log('\x1b[90m%s\x1b[0m', `📁 Preserved your saved /gls screenshot folder (${savedScreenshotDir}) in cca.config.json.`);
    } catch (_) { /* non-fatal — a dropped legacy path just means /gls re-detects once */ }
  }
}

// Copy docs (only .html files — skip internal planning docs)
if (fs.existsSync(docsSrc)) {
  const docsDestDir = path.join(claudeDest, 'docs');
  fs.mkdirSync(docsDestDir, { recursive: true });
  for (const file of fs.readdirSync(docsSrc)) {
    if (file.endsWith('.html')) {
      fs.copyFileSync(path.join(docsSrc, file), path.join(docsDestDir, file));
    }
  }
}

// Copy agents if exists
if (fs.existsSync(agentsSrc)) {
  copyDir(agentsSrc, path.join(claudeDest, 'agents'));
}

// Copy feedback template (preserve user customizations unless --force)
if (fs.existsSync(feedbackSrc)) {
  const copyFn = forceMode ? copyDir : copyDirIfMissing;
  copyFn(feedbackSrc, path.join(claudeDest, 'feedback'));
}

// Copy hooks directory. Genuinely user-authorable hooks are preserved on upgrade
// (copyDirIfMissing), BUT the cca-managed title-hook files are ALWAYS refreshed so bug-fixes
// reach existing installs — without this, copyDirIfMissing leaves stale hooks in place forever
// (same always-overwrite rationale as scripts/ below). --force already overwrites everything.
const MANAGED_HOOKS = ['terminal-title.js', 'terminal-title.directive.md', 'arcade-beeps.js', 'mark-commit-active.js', 'auto-guard.js'];
if (fs.existsSync(hooksSrc)) {
  const copyFn = forceMode ? copyDir : copyDirIfMissing;
  copyFn(hooksSrc, path.join(claudeDest, 'hooks'));
  if (!forceMode) {
    const hooksDestDir = path.join(claudeDest, 'hooks');
    for (const name of MANAGED_HOOKS) {
      const src = path.join(hooksSrc, name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(hooksDestDir, name));
    }
  }
}

// Copy scripts directory (always overwrite — these are utility scripts, not user-customizable)
if (fs.existsSync(scriptsSrc)) {
  copyDir(scriptsSrc, path.join(claudeDest, 'scripts'));
}

// Copy sounds directory (binary status-cue assets for arcade-beeps; always overwrite)
const soundsSrc = path.join(packageDir, '.claude', 'sounds');
if (fs.existsSync(soundsSrc)) {
  copyDir(soundsSrc, path.join(claudeDest, 'sounds'));
}

// Note: updates directory is no longer copied to user projects.
// Update files are only used by --pull-updates (for /autoconfig-update).
// On fresh install, all updates are pre-marked as applied and the content
// is already baked into /autoconfig itself, so the files are unnecessary.

// Copy settings.json — fresh install gets full copy, upgrades get hooks + permissions merged
const settingsSrc = path.join(packageDir, '.claude', 'settings.json');
const settingsDest = path.join(claudeDest, 'settings.json');
if (fs.existsSync(settingsSrc)) {
  if (forceMode || !fs.existsSync(settingsDest)) {
    fs.copyFileSync(settingsSrc, settingsDest);
  } else {
    // Merge hooks and permissions from package into existing settings
    try {
      const pkgSettings = JSON.parse(fs.readFileSync(settingsSrc, 'utf8'));
      const userSettings = JSON.parse(fs.readFileSync(settingsDest, 'utf8'));

      // Upgrade legacy relative hook commands FIRST so the anchored template entries below
      // dedupe against them instead of doubling up (see migrateLegacyHookCommands).
      migrateLegacyHookCommands(userSettings);

      // Additively fold package hooks/env/permissions into the user's settings
      // (shared with the plugin installer — see mergeSettingsInto).
      mergeSettingsInto(userSettings, pkgSettings);

      fs.writeFileSync(settingsDest, JSON.stringify(userSettings, null, 2));
    } catch (err) {
      // Don't break the install if the merge fails — but don't hide it either. A silent
      // failure here means every future upgrade stops delivering new hooks/permissions/env
      // while installs keep reporting success.
      console.log('\x1b[33m%s\x1b[0m', `⚠️  Could not merge updated settings into .claude/settings.json (${err.message}) — left your settings as-is; new hooks/permissions may not have been applied.`);
    }
  }
}

console.log('\x1b[32m%s\x1b[0m', '✅ Prepared /autoconfig command');

// Show what was installed/updated
if (isUpgrade && (newCommands.length > 0 || updatedCommands.length > 0)) {
  console.log();
  for (const { file, version } of newCommands) {
    const name = file.replace('.md', '');
    const ver = version > 0 ? ` v${version}` : '';
    console.log('\x1b[36m%s\x1b[0m', `   + /${name}${ver} (new)`);
  }
  for (const { file, oldVersion, newVersion } of updatedCommands) {
    const name = file.replace('.md', '');
    // A content change with no @version bump (oldVersion === newVersion) used to be dropped
    // here — trap T6: the edit shipped but never surfaced on the upgrade report. Show it as
    // "(updated)" so an unbumped change is still visible to the user.
    const bumped = oldVersion > 0 && newVersion > 0 && oldVersion !== newVersion;
    const ver = bumped ? ` (v${oldVersion} → v${newVersion})` : ' (updated)';
    console.log('\x1b[33m%s\x1b[0m', `   ↑ /${name}${ver}`);
  }
}


// Pre-mark all bundled updates as applied when the @applied block is empty.
// On fresh installs, /autoconfig handles their content (e.g., debug methodology in MEMORY.md).
// On upgrades from pre-update-system versions, these updates are already baked in.
// The regex only matches an empty @applied block, so this is safe to run unconditionally.
{
  const userCmdPath = path.join(claudeDest, 'commands', 'autoconfig-update.md');
  const packageUpdatesDir = path.join(packageDir, '.claude', 'updates');
  if (fs.existsSync(userCmdPath) && fs.existsSync(packageUpdatesDir)) {
    const updateFiles = fs.readdirSync(packageUpdatesDir)
      .filter(f => f.endsWith('.md') && /^\d{3}-/.test(f))
      .sort();
    if (updateFiles.length > 0) {
      const appliedLines = updateFiles.map(file => {
        const id = file.match(/^(\d{3})-/)[1];
        const content = fs.readFileSync(path.join(packageUpdatesDir, file), 'utf8');
        const titleMatch = content.match(/<!-- @title (.+?) -->/);
        const title = titleMatch ? titleMatch[1] : file.replace(/^\d{3}-/, '').replace(/\.md$/, '');
        return `${id} - ${title}`;
      });
      const cmdContent = fs.readFileSync(userCmdPath, 'utf8');
      const updated = cmdContent.replace(
        /<!-- @applied\r?\n-->/,
        `<!-- @applied\n${appliedLines.join('\n')}\n-->`
      );
      fs.writeFileSync(userCmdPath, updated);
    }
  }
}

// Clean up updates directory — updates are tracked in the @applied block,
// so the .md files don't need to stay in the user's project
const userUpdatesDir = path.join(claudeDest, 'updates');
if (fs.existsSync(userUpdatesDir)) {
  fs.rmSync(userUpdatesDir, { recursive: true });
}

// Migrate FEEDBACK.md content to CLAUDE.md Discoveries section (one-time, on upgrade)
if (isUpgrade) {
  const claudeMdPath = path.join(cwd, 'CLAUDE.md');
  const feedbackPath = path.join(claudeDest, 'feedback', 'FEEDBACK.md');

  if (fs.existsSync(claudeMdPath) && fs.existsSync(feedbackPath)) {
    const feedbackContent = fs.readFileSync(feedbackPath, 'utf8');

    // Extract custom content (everything after the first --- separator following the header)
    const feedbackLines = feedbackContent.split(/\r?\n/);
    let firstSeparatorIdx = -1;
    for (let i = 0; i < feedbackLines.length; i++) {
      if (feedbackLines[i].trim() === '---') {
        firstSeparatorIdx = i;
        break;
      }
    }

    if (firstSeparatorIdx >= 0) {
      const customContent = feedbackLines.slice(firstSeparatorIdx + 1).join('\n').trim();

      // Only migrate if there's custom content and it hasn't already been migrated
      const claudeMdContent = fs.readFileSync(claudeMdPath, 'utf8');
      const hasDiscoveries = claudeMdContent.includes('## Discoveries');

      if (customContent.length > 0 && !hasDiscoveries) {
        // Add Discoveries section to CLAUDE.md
        const discoveriesSection = `\n\n## Discoveries\n<!-- Claude: append project-specific learnings, gotchas, and context below. This section persists across /autoconfig runs. -->\n\n${customContent}\n`;
        fs.writeFileSync(claudeMdPath, claudeMdContent + discoveriesSection);

        // Reset FEEDBACK.md to clean template
        const cleanTemplate = `<!-- @description Human-authored corrections and guidance for Claude. Reserved for team feedback only — Claude must not write here. This directory persists across /autoconfig runs. -->\n\n# Team Feedback\n\n**This file is for human-authored corrections and guidance only.**\nClaude reads this file but must never write to it. When Claude discovers project context, gotchas, or learnings, it should append to the \`## Discoveries\` section in CLAUDE.md instead.\n\n---\n\n`;
        fs.writeFileSync(feedbackPath, cleanTemplate);

        // Count migrated sections
        const sectionCount = (customContent.match(/^## /gm) || []).length || 1;
        console.log('\x1b[36m%s\x1b[0m', `   📋 Migrated ${sectionCount} section${sectionCount > 1 ? 's' : ''} from FEEDBACK.md → CLAUDE.md Discoveries`);
      }
    }
  }
}

// Write current version marker
fs.writeFileSync(versionFile, currentVersion);

// On upgrade, persist the what's-new summary for /autoconfig-update to render as the
// flow's finale. The same summary is printed to the terminal below, but Claude's
// fullscreen UI takes over right after — the scrollback is gone by the time the flow
// ends, so the last thing users see is "no pending updates" with no hint of what came
// down. One-shot: /autoconfig-update deletes the file after displaying it. Written
// before the --bootstrap early-exit so in-Claude upgrades produce it too.
if (isUpgrade && previousVersion !== currentVersion) {
  const changelogPath = path.join(packageDir, 'CHANGELOG.md');
  const changelogText = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '';
  try {
    fs.writeFileSync(
      path.join(claudeDest, '.autoconfig-whats-new.json'),
      JSON.stringify({
        from: previousVersion,
        to: currentVersion,
        segments: formatUpdateSummary(previousVersion, currentVersion, changelogText)
      }, null, 2)
    );
  } catch (_) { /* cosmetic — never block the install */ }
}

const launchCommand = isUpgrade ? '/autoconfig-update' : '/autoconfig';

// --bootstrap: copy files only, exit silently (used by /autoconfig inside Claude)
const bootstrapMode = process.argv.includes('--bootstrap');
if (bootstrapMode) {
  process.exit(0);
}

// Step 4: Show "READY" message
console.log();
if (isUpgrade) {
  console.log('\x1b[33m╔════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[33m║                                            ║\x1b[0m');
  console.log('\x1b[33m║\x1b[0m           \x1b[33;1mREADY TO UPDATE\x1b[0m                  \x1b[33m║\x1b[0m');
  console.log('\x1b[33m║                                            ║\x1b[0m');
  console.log('\x1b[33m║\x1b[0m   \x1b[36mPress ENTER to launch Claude and\x1b[0m         \x1b[33m║\x1b[0m');
  console.log('\x1b[33m║\x1b[0m   \x1b[36mauto-run /autoconfig-update\x1b[0m              \x1b[33m║\x1b[0m');
  console.log('\x1b[33m║                                            ║\x1b[0m');
  console.log('\x1b[33m╚════════════════════════════════════════════╝\x1b[0m');
} else {
  console.log('\x1b[33m╔════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[33m║                                            ║\x1b[0m');
  console.log('\x1b[33m║\x1b[0m           \x1b[33;1mREADY TO CONFIGURE\x1b[0m               \x1b[33m║\x1b[0m');
  console.log('\x1b[33m║                                            ║\x1b[0m');
  console.log('\x1b[33m║\x1b[0m   \x1b[36mPress ENTER to launch Claude and\x1b[0m         \x1b[33m║\x1b[0m');
  console.log('\x1b[33m║\x1b[0m   \x1b[36mauto-run /autoconfig\x1b[0m                     \x1b[33m║\x1b[0m');
  console.log('\x1b[33m║                                            ║\x1b[0m');
  console.log('\x1b[33m╚════════════════════════════════════════════╝\x1b[0m');
}
// Show what changed on the upgrade path so a re-run never looks like "nothing came down":
// grouped features/fixes since the installed version, or a single confirmation line when
// already on the latest. Rendered here so it lands right before the ENTER prompt.
// Logic lives in update-summary.js (pure + unit-tested).
if (isUpgrade) {
  const changelogPath = path.join(packageDir, 'CHANGELOG.md');
  const changelogText = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '';
  console.log();
  for (const seg of formatUpdateSummary(previousVersion, currentVersion, changelogText)) {
    if (seg.kind === 'latest')       console.log(`\x1b[32m  ✓ ${seg.text}\x1b[0m`);
    else if (seg.kind === 'heading') console.log(`\x1b[36m  ${seg.text}\x1b[0m`);
    else if (seg.kind === 'group')   console.log(`\x1b[33m    ${seg.text}:\x1b[0m`);
    else if (seg.kind === 'item')    console.log(`\x1b[90m      • ${seg.text}\x1b[0m`);
    else if (seg.kind === 'more')    console.log(`\x1b[90m    ${seg.text}\x1b[0m`);
  }
  console.log();
}
if (!isUpgrade) {
  console.log('\x1b[90m%s\x1b[0m', "You'll need to approve a few file prompts to complete the installation.");
  console.log();
}

// Step 5: Wait for Enter, then launch Claude Code
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('\x1b[90mPress ENTER to continue...\x1b[0m', () => {
  rl.close();

  console.log();
  console.log('\x1b[36m%s\x1b[0m', `🚀 Launching Claude Code with ${launchCommand}...`);
  console.log();
  console.log('\x1b[90m%s\x1b[0m', '   Heads up: Claude Code can take 30+ seconds to initialize.');
  console.log('\x1b[90m%s\x1b[0m', '   Please be patient while it loads.');
  console.log();

  // Spawn claude with the appropriate command
  const claude = spawn('claude', [launchCommand], {
    cwd: cwd,
    stdio: 'inherit',
    shell: true
  });

  claude.on('error', (_) => {
    console.log('\x1b[31m%s\x1b[0m', '❌ Failed to launch Claude Code');
    console.log(`   Run "claude" manually, then run ${launchCommand}`);
  });

  // Cleanup when Claude exits
  claude.on('close', () => {
    cleanupNulFile();
  });
});
