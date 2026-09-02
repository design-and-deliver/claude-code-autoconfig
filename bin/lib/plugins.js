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
// Extracted from bin/cli.js (Phase 3 seam 1). A few helpers this subsystem needs still
// live in cli.js (cwd, isReservedName, mergeSettingsInto, unmergeSettingsFrom); cli.js
// requires this module at the top, so requiring it back would be circular (partial
// exports) — cli.js instead injects those via a `deps` object at the dispatch boundary.
// The .autoconfig-plugins.json ledger shape is frozen (additive-only — trap 1).
// ============================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGINS_LEDGER = '.autoconfig-plugins.json';

// Licensed-delivery endpoint base. Matches token-guard.js's `verdictService` convention:
// the base ends at /api/cca and each consumer appends its own route. Tests override via
// deps.apiBase / deps.fetch in-process; the env var lets a manual run target a local or
// staging service (the pre-deploy E2E path).
const CCA_API_BASE = process.env.CCA_API_BASE || 'https://api.proswitch.ai/api/cca';
const TOKEN_SAVER = 'token-saver';

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
  // accumulator so removal still reverts everything this plugin ever added (BH-1), and its
  // prior file list drives the dropped-file cleanup below (BH-10).
  const ledger = readPluginsLedger(claudeDir);
  const priorEntry = ledger[manifest.name];
  const addedDelta = seedAddedDelta(priorEntry);
  const priorFiles = (priorEntry && Array.isArray(priorEntry.files)) ? priorEntry.files : [];

  // 1. Validate every declared file — and that settings.json is parseable — BEFORE touching
  //    the project: a mid-loop throw used to leave already-copied files behind as orphans no
  //    ledger entry tracked (BH-10).
  const copies = [];
  for (const file of manifest.files) {
    if (!file || !file.from || !file.to) throw new Error('each "files" entry must have "from" and "to"');
    const src = path.resolve(pluginDir, file.from);
    if (!fs.existsSync(src)) throw new Error(`plugin file not found: ${file.from}`);
    const dest = path.join(claudeDir, file.to);
    if (deps.isReservedName(path.basename(dest))) throw new Error(`refusing to write reserved filename: ${file.to}`);
    copies.push({ src, dest, to: file.to });
  }

  const settingsPath = path.join(claudeDir, 'settings.json');
  let userSettings = {};
  if (manifest.settings && fs.existsSync(settingsPath)) {
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

  // 2. Record intent before copying: files = union(prior, incoming), so a genuine I/O
  //    failure mid-copy still leaves every possibly-on-disk file tracked and removable via
  //    `plugin remove`. Same entry shape (trap 1: the ledger is additive-only); the success
  //    path overwrites this with the final snapshot below. The pre-merge `added` seed is
  //    safe to record: it reverts only what a PRIOR install merged (nothing, on a first
  //    install), matching what is actually in settings.json if this run aborts.
  if (copies.length > 0) {
    ledger[manifest.name] = {
      version: manifest.version || null,
      files: [...new Set([...priorFiles, ...copies.map(c => c.to)])],
      settings: priorEntry ? priorEntry.settings : (manifest.settings || null),
      added: addedDelta,
      installedAt: priorEntry ? priorEntry.installedAt : new Date().toISOString()
    };
    writePluginsLedger(claudeDir, ledger);
  }

  // 3. Copy declared files into <project>/.claude/<to>
  const installedFiles = [];
  for (const c of copies) {
    fs.mkdirSync(path.dirname(c.dest), { recursive: true });
    fs.copyFileSync(c.src, c.dest);
    installedFiles.push(c.to);
    console.log('\x1b[90m%s\x1b[0m', `   + .claude/${c.to}`);
  }

  // 3b. A re-install deletes files the previous version shipped and this one doesn't
  //     (BH-10) — left in place, they would outlive every future `plugin remove`.
  for (const rel of priorFiles) {
    if (installedFiles.includes(rel)) continue;
    const stale = path.join(claudeDir, rel);
    if (fs.existsSync(stale)) {
      fs.rmSync(stale, { force: true });
      console.log('\x1b[90m%s\x1b[0m', `   - .claude/${rel} (no longer shipped by this version)`);
    }
  }

  // 4. Fold the settings fragment into .claude/settings.json (clone first to avoid aliasing the ledger copy)
  if (manifest.settings) {
    deps.mergeSettingsInto(userSettings, JSON.parse(JSON.stringify(manifest.settings)), addedDelta);
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(userSettings, null, 2));
    console.log('\x1b[90m%s\x1b[0m', '   ✎ merged settings.json (hooks / env / permissions)');
  }

  // 5. Record in the ledger so removal can cleanly undo everything. `added` is the true delta
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
      } catch (e) {
        // Settings could not be reverted (unparsable/unwritable settings.json). Leave the
        // ledger entry in place so the removal stays retryable — dropping it here would
        // strand the plugin's hooks in settings.json forever while reporting success.
        // The file deletions above are idempotent, so a retry is safe.
        console.log('\x1b[33m%s\x1b[0m', `⚠️  Could not revert settings.json contributions (${e.message}).`);
        console.log('\x1b[33m%s\x1b[0m', `   ${name}'s files were deleted, but its settings entries remain. Fix .claude/settings.json, then re-run: claude-code-autoconfig plugin remove ${name}`);
        throw new Error(`"${name}" is only partially removed — settings.json could not be updated (retry after fixing it)`);
      }
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

// ── Licensed delivery: activate / verify ─────────────────────────────────────

// POST the key to the module-bundle endpoint. 200 → the bundle's plugin object;
// 204 → null (invalid key — the API's no-oracle convention, never a 401/403 with reasons).
async function fetchModuleBundle(apiBase, key, fetchFn) {
  const res = await fetchFn(`${apiBase.replace(/\/+$/, '')}/module-bundle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key })
  });
  if (res.status === 204) return null;
  if (res.status !== 200) throw new Error(`licensing service returned HTTP ${res.status} — try again in a minute`);
  const body = await res.json();
  const plugin = body && body.plugin;
  if (!plugin || typeof plugin.name !== 'string' || !Array.isArray(plugin.files)) {
    throw new Error('licensing service returned an unexpected bundle shape');
  }
  return plugin;
}

// Write the fetched bundle to a temp dir shaped like a local plugin folder, so the
// EXISTING pluginAdd path (validation, ledger, settings merge, clean remove) installs it.
function materializeBundle(plugin) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-bundle-'));
  const files = [];
  for (const f of plugin.files) {
    if (!f || typeof f.to !== 'string' || typeof f.content !== 'string') {
      throw new Error('each bundle "files" entry must have "to" and "content"');
    }
    const dest = path.join(tempDir, f.to);
    if (!dest.startsWith(tempDir + path.sep)) throw new Error(`refusing bundle path outside the staging dir: ${f.to}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content);
    files.push({ from: f.to, to: f.to });
  }
  fs.writeFileSync(path.join(tempDir, 'plugin.json'), JSON.stringify({
    name: plugin.name,
    version: plugin.version || null,
    description: plugin.description || '',
    files,
    settings: plugin.settings || null
  }, null, 2));
  return tempDir;
}

function readActivationConfig(claudeDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(claudeDir, 'cca.config.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

// MERGE the activation keys into .claude/cca.config.json — preserve every other key, and
// nest under "tokenGuard" (top-level placement is a dead key AND makes cli.js's paid check
// treat the project as unpaid and retract its files — the exact bug fixed 2026-08-31).
function writeActivationConfig(claudeDir, key, apiBase) {
  const p = path.join(claudeDir, 'cca.config.json');
  let cfg = {};
  if (fs.existsSync(p)) {
    try {
      cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      throw new Error(`.claude/cca.config.json is not valid JSON (${e.message}) — refusing to overwrite it. Fix or delete it, then re-run activation.`);
    }
  }
  cfg.tokenGuard = Object.assign({}, cfg.tokenGuard, {
    verdictService: apiBase,
    verdictServiceKey: key
  });
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  console.log('\x1b[90m%s\x1b[0m', '   ✎ wrote tokenGuard.verdictService + verdictServiceKey to .claude/cca.config.json');
}

function collectHookCommands(hooksObj, event) {
  const out = new Set();
  for (const m of (hooksObj && hooksObj[event]) || []) {
    for (const h of m.hooks || []) out.add(h.command);
  }
  return out;
}

function missingHookEvents(userSettings, fragmentHooks) {
  const missing = [];
  for (const event of Object.keys(fragmentHooks)) {
    const installed = collectHookCommands(userSettings.hooks, event);
    const wanted = collectHookCommands(fragmentHooks, event);
    if ([...wanted].some(c => !installed.has(c))) missing.push(event);
  }
  return missing;
}

// Check (a): every file the plugins ledger says token-saver installed is on disk.
function checkBundleFiles(claudeDir) {
  const entry = readPluginsLedger(claudeDir)[TOKEN_SAVER];
  if (!entry || !Array.isArray(entry.files) || entry.files.length === 0) {
    return { ok: false, msg: `${TOKEN_SAVER} is not installed (no ${PLUGINS_LEDGER} entry)` };
  }
  const missing = entry.files.filter(rel => !fs.existsSync(path.join(claudeDir, rel)));
  if (missing.length > 0) return { ok: false, msg: `bundle files missing: ${missing.join(', ')}` };
  return { ok: true, msg: `bundle files present (${entry.files.map(f => '.claude/' + f).join(', ')})` };
}

// Check (b): the token-guard settings fragment the install recorded is merged into
// .claude/settings.json — all four hook events. The ledger entry is the source of truth
// for WHAT should be merged (never a second copy of cli.js's fragment literal — trap 3).
function checkSettingsFragment(claudeDir) {
  const entry = readPluginsLedger(claudeDir)[TOKEN_SAVER];
  const fragmentHooks = entry && entry.settings && entry.settings.hooks;
  if (!fragmentHooks) return { ok: false, msg: 'no recorded settings fragment to check (not installed)' };
  let userSettings;
  try {
    userSettings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
  } catch (e) {
    return { ok: false, msg: `.claude/settings.json unreadable (${e.message})` };
  }
  const missing = missingHookEvents(userSettings, fragmentHooks);
  if (missing.length > 0) return { ok: false, msg: `hook events not merged into settings.json: ${missing.join(', ')}` };
  return { ok: true, msg: `token-guard hooks merged into settings.json (${Object.keys(fragmentHooks).join(', ')})` };
}

// Check (c): the configured key is still accepted by the licensing service.
async function checkLicenseKey(claudeDir, deps) {
  const cfg = readActivationConfig(claudeDir);
  const tg = (cfg && cfg.tokenGuard) || {};
  if (!tg.verdictServiceKey) return { ok: false, msg: 'no license key in .claude/cca.config.json (tokenGuard.verdictServiceKey)' };
  const apiBase = deps.apiBase || tg.verdictService || CCA_API_BASE;
  try {
    const plugin = await fetchModuleBundle(apiBase, tg.verdictServiceKey, deps.fetch || global.fetch);
    if (!plugin) return { ok: false, msg: 'key not recognized by the licensing service' };
    return { ok: true, msg: 'license key accepted by the licensing service' };
  } catch (e) {
    return { ok: false, msg: `could not reach the licensing service (${e.message})` };
  }
}

// Read-only three-check verification; prints one ✓/✗ line per check, returns overall pass.
async function verifyTokenSaver(claudeDir, deps) {
  const checks = [checkBundleFiles(claudeDir), checkSettingsFragment(claudeDir), await checkLicenseKey(claudeDir, deps)];
  for (const c of checks) {
    console.log(c.ok ? '\x1b[32m%s\x1b[0m' : '\x1b[31m%s\x1b[0m', `   ${c.ok ? '✓' : '✗'} ${c.msg}`);
  }
  return checks.every(c => c.ok);
}

async function pluginActivate(key, claudeDir, deps) {
  console.log('\x1b[36m%s\x1b[0m', '🔑 Activating TokenSaver…');
  const plugin = await fetchModuleBundle(deps.apiBase || CCA_API_BASE, key, deps.fetch || global.fetch);
  if (!plugin) throw new Error('key not recognized — check the license key from your purchase email');
  const tempDir = materializeBundle(plugin);
  try {
    pluginAdd(tempDir, claudeDir, deps);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  writeActivationConfig(claudeDir, key, deps.apiBase || CCA_API_BASE);
  console.log('\x1b[90m%s\x1b[0m', `   (later, "plugin remove ${TOKEN_SAVER}" reverts the files and hooks; it leaves the license key in cca.config.json, which is harmless)`);
  console.log('\x1b[36m%s\x1b[0m', '🔎 Verifying the install:');
  const ok = await verifyTokenSaver(claudeDir, deps);
  if (!ok) throw new Error('activation finished but verification failed — see the ✗ lines above');
  console.log('\x1b[32m%s\x1b[0m', '✅ TokenSaver is activated and verified');
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

function requireArg(arg, usage) {
  if (!arg) throw new Error(`usage: claude-code-autoconfig ${usage}`);
  return arg;
}

async function runVerifyCommand(arg, claudeDir, deps) {
  if (arg !== TOKEN_SAVER) throw new Error(`usage: claude-code-autoconfig plugin verify ${TOKEN_SAVER}`);
  const ok = await verifyTokenSaver(claudeDir, deps);
  if (!ok) {
    console.log('\x1b[33m%s\x1b[0m', '   Fix: npx claude-code-autoconfig@latest plugin activate <key>  (the key is in your purchase email)');
    process.exit(1);
  }
}

const addCmd = (arg, claudeDir, deps) => pluginAdd(requireArg(arg, 'plugin add <path-to-plugin-dir>'), claudeDir, deps);
const removeCmd = (arg, claudeDir, deps) => pluginRemove(requireArg(arg, 'plugin remove <name>'), claudeDir, deps);
const listCmd = (_arg, claudeDir) => pluginList(claudeDir);
const activateCmd = (arg, claudeDir, deps) => pluginActivate(requireArg(arg, 'plugin activate <key>'), claudeDir, deps);

const PLUGIN_SUBCOMMANDS = {
  add: addCmd, install: addCmd,
  remove: removeCmd, rm: removeCmd, uninstall: removeCmd,
  list: listCmd, ls: listCmd,
  activate: activateCmd,
  verify: runVerifyCommand
};

async function runPluginCommand(argv, deps) {
  const handler = PLUGIN_SUBCOMMANDS[argv[3]];
  if (!handler) {
    console.log('Usage:');
    console.log('  claude-code-autoconfig plugin add <dir>           Install a plugin from a folder');
    console.log('  claude-code-autoconfig plugin remove <name>       Uninstall a plugin');
    console.log('  claude-code-autoconfig plugin list                List installed plugins');
    // `activate <key>` and `verify token-saver` still work but are deliberately unlisted:
    // TokenSaver is in local testing and not yet advertised to users (2026-09-02).
    process.exit(argv[3] ? 1 : 0);
  }
  try {
    await handler(argv[4], path.join(deps.cwd, '.claude'), deps);
  } catch (err) {
    console.log('\x1b[31m%s\x1b[0m', `❌ ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  PLUGINS_LEDGER,
  CCA_API_BASE,
  readPluginsLedger,
  writePluginsLedger,
  loadManifest,
  pluginAdd,
  pluginRemove,
  pluginList,
  pluginActivate,
  verifyTokenSaver,
  fetchModuleBundle,
  materializeBundle,
  writeActivationConfig,
  readActivationConfig,
  runPluginCommand
};
