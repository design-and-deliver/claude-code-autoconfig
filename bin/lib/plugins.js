'use strict';

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
//
// Extracted from bin/cli.js (Phase 3 seam 1). A few module-scope helpers this subsystem
// needs still live in cli.js (cwd, isReservedName, mergeSettingsInto, unmergeSettingsFrom);
// because cli.js runs its whole install flow on require (no main()), this module cannot
// require it back — so cli.js injects those via a `deps` object at the dispatch boundary.
// The .autoconfig-plugins.json ledger shape is frozen (additive-only — trap 1).
// ============================================================================

const fs = require('fs');
const path = require('path');

const PLUGINS_LEDGER = '.autoconfig-plugins.json';

// Build a fresh settings-delta accumulator (BH-1), seeded from a prior install's recorded
// delta so a re-install UNIONS onto it rather than shrinking it to only what the second
// merge happened to add (a re-install adds nothing — everything is already present — so
// without this seed `plugin remove` after a re-install would revert nothing). Normalizes any
// malformed/absent prior shape to the canonical accumulator.
function seedAddedDelta(priorEntry) {
  const prior = (priorEntry && priorEntry.added) || {};
  const perm = prior.permissions || {};
  const hooks = {};
  if (prior.hooks && typeof prior.hooks === 'object') {
    for (const [event, cmds] of Object.entries(prior.hooks)) {
      hooks[event] = Array.isArray(cmds) ? cmds.slice() : [];
    }
  }
  return {
    env: Array.isArray(prior.env) ? prior.env.slice() : [],
    hooks,
    permissions: {
      allow: Array.isArray(perm.allow) ? perm.allow.slice() : [],
      deny: Array.isArray(perm.deny) ? perm.deny.slice() : []
    }
  };
}

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

function pluginAdd(pluginArg, claudeDir, deps) {
  const pluginDir = path.resolve(deps.cwd, pluginArg);
  const manifest = loadManifest(pluginDir);
  console.log('\x1b[36m%s\x1b[0m', `📦 Installing plugin: ${manifest.name}${manifest.version ? ' v' + manifest.version : ''}`);

  // Read the ledger up front: on a re-install its prior `added` delta seeds this run's
  // accumulator so removal still reverts everything this plugin ever added (BH-1).
  const ledger = readPluginsLedger(claudeDir);
  const addedDelta = seedAddedDelta(ledger[manifest.name]);

  // 1. Copy declared files into <project>/.claude/<to>
  const installedFiles = [];
  for (const file of manifest.files) {
    if (!file || !file.from || !file.to) throw new Error('each "files" entry must have "from" and "to"');
    const src = path.resolve(pluginDir, file.from);
    if (!fs.existsSync(src)) throw new Error(`plugin file not found: ${file.from}`);
    const dest = path.join(claudeDir, file.to);
    if (deps.isReservedName(path.basename(dest))) throw new Error(`refusing to write reserved filename: ${file.to}`);
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
    deps.mergeSettingsInto(userSettings, JSON.parse(JSON.stringify(manifest.settings)), addedDelta);
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(userSettings, null, 2));
    console.log('\x1b[90m%s\x1b[0m', '   ✎ merged settings.json (hooks / env / permissions)');
  }

  // 3. Record in the ledger so removal can cleanly undo everything. `added` is the true delta
  //    this install introduced (additive field — trap 1: old ledgers without it fall back to
  //    value-equality on remove); it's what `unmergeSettingsFrom` reverts, never user config.
  ledger[manifest.name] = {
    version: manifest.version || null,
    files: installedFiles,
    settings: manifest.settings || null,
    added: addedDelta,
    installedAt: new Date().toISOString()
  };
  writePluginsLedger(claudeDir, ledger);
  console.log('\x1b[32m%s\x1b[0m', `✅ Installed ${manifest.name}`);
}

function pluginRemove(name, claudeDir, deps) {
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
        // Pass the recorded delta (BH-1): revert only what this plugin added, never a
        // user-owned key/hook/rule it also declared. Absent on pre-fix ledgers → value-equality.
        deps.unmergeSettingsFrom(userSettings, entry.settings, entry.added);
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

function runPluginCommand(argv, deps) {
  const sub = argv[3];
  const arg = argv[4];
  const claudeDir = path.join(deps.cwd, '.claude');
  try {
    if (sub === 'add' || sub === 'install') {
      if (!arg) throw new Error('usage: claude-code-autoconfig plugin add <path-to-plugin-dir>');
      pluginAdd(arg, claudeDir, deps);
    } else if (sub === 'remove' || sub === 'rm' || sub === 'uninstall') {
      if (!arg) throw new Error('usage: claude-code-autoconfig plugin remove <name>');
      pluginRemove(arg, claudeDir, deps);
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

module.exports = {
  PLUGINS_LEDGER,
  readPluginsLedger,
  writePluginsLedger,
  loadManifest,
  pluginAdd,
  pluginRemove,
  pluginList,
  runPluginCommand
};
