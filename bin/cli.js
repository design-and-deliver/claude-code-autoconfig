#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync, spawn } = require('child_process');
const { formatUpdateSummary } = require('./update-summary.js');
const { runPluginCommand } = require('./lib/plugins.js');
const { migrateLegacyHookCommands, mergeSettingsInto, unmergeSettingsFrom } = require('./lib/settings-merge.js');
const { pullUpdates } = require('./lib/updates.js');
const { cleanupNulFile } = require('./lib/nul-cleanup.js');

const cwd = process.cwd();
const packageDir = path.dirname(__dirname);

// ── Phase timings ────────────────────────────────────────────────────────────
// mark(label) records the ms since the previous mark, partitioning the run into named
// sequential phases. Rendered as one dim Timings line right before the READY box; the
// --bootstrap path exits before that render, so it never prints there. Cosmetic-only:
// a timing failure must never affect the install.
const timings = [];
let lastMark = process.hrtime.bigint();
function mark(label) {
  try {
    const now = process.hrtime.bigint();
    timings.push({ label, ms: Number(now - lastMark) / 1e6 });
    lastMark = now;
  } catch (_) { /* cosmetic only */ }
}

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

// Cleanup any stray 'nul' file immediately on startup (Windows '> nul' redirect artifact only)
cleanupNulFile(cwd);

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

// ── Update parsing + --pull-updates ──────────────────────────────────────────
// Extracted to bin/lib/updates.js (Phase 3 seam 3): parseAppliedUpdates, the @applied
// regexes (byte-verbatim — trap 6), highest-applied filtering, and pullUpdates. The
// --pull-updates dispatch (below) and its exit stay here. pullUpdates receives its pin
// context (cwd / packageDir / pinnedVersion / installerVersion / ccaConfigCorrupt) as a
// params object — those consts stay module-scope here because the SAME pin also gates the
// --bootstrap path below (the pin check is duplicated by design); do not re-derive them
// in the module.
if (process.argv.includes('--pull-updates')) {
  pullUpdates({ cwd, packageDir, pinnedVersion, installerVersion, ccaConfigCorrupt });
  process.exit(0);
}

// ── Settings merge helpers ───────────────────────────────────────────────────
// Extracted to bin/lib/settings-merge.js (Phase 3 seam 2). Pure functions (no cli.js
// module-scope deps) shared by the upgrade path (migrate-then-merge, below) and the
// plugin installer (via the deps object injected at the plugin dispatch boundary).
// migrateLegacyHookCommands / mergeSettingsInto / unmergeSettingsFrom are imported at
// the top of this file.

// ── Plugin subsystem ─────────────────────────────────────────────────────────
// Extracted to bin/lib/plugins.js (Phase 3 seam 1). This file runs its whole install
// flow on require (no main()), so plugins.js cannot require it back — cli.js instead
// injects the module-scope helpers plugins.js needs (cwd, isReservedName,
// mergeSettingsInto, unmergeSettingsFrom) at the dispatch boundary below.
if (process.argv[2] === 'plugin') {
  runPluginCommand(process.argv, { cwd, isReservedName, mergeSettingsInto, unmergeSettingsFrom });
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
  mark('claude-check');
  if (!installClaude()) {
    process.exit(1);
  }
  mark('claude-install');
} else {
  mark('claude-check');
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
mark('backup');

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
const DEV_ONLY_FILES = ['deploy-to-npmjs.md', 'usage-report.md', 'analyze-session.md', 'migrate-new-session.md', 'token-guard.js', 'plan-progress.md', 'plan-progress.js'];

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

// Preserve the user's @applied block across the copy (BH-3): copyDir overwrites
// autoconfig-update.md with the shipped empty-@applied copy, and the pre-mark pass below
// would then refill it with ALL bundled ids — silently marking never-run (pending/skipped)
// updates as applied. Snapshot pre-copy, re-inject post-copy, mirroring the --pull-updates
// path (bin/lib/updates.js pullUpdates), which already preserves the block this way.
const updateCmdDest = path.join(claudeDest, 'commands', 'autoconfig-update.md');
let savedAppliedBlock = null;
if (fs.existsSync(updateCmdDest)) {
  const appliedMatch = fs.readFileSync(updateCmdDest, 'utf8').match(/<!-- @applied[\s\S]*?-->/);
  if (appliedMatch) savedAppliedBlock = appliedMatch[0];
}

if (fs.existsSync(commandsSrc)) {
  copyDir(commandsSrc, path.join(claudeDest, 'commands'));
} else {
  console.log('\x1b[31m%s\x1b[0m', '❌ Error: commands directory not found');
  process.exit(1);
}

if (savedAppliedBlock && fs.existsSync(updateCmdDest)) {
  const shippedCmd = fs.readFileSync(updateCmdDest, 'utf8');
  fs.writeFileSync(updateCmdDest, shippedCmd.replace(/<!-- @applied[\s\S]*?-->/, () => savedAppliedBlock));
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
mark('copy');

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
mark('settings');

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
// The regex only matches an empty @applied block — and the copy above re-injects a user's
// populated block (BH-3) — so an empty block here genuinely means fresh/pre-update-system,
// never an upgrade that blanked a user's real applied state.
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

// Timings line — dim diagnostic, same style as the pre-install block above. Placed after
// the --bootstrap exit so bootstrap runs never print it. Total is measured from process
// start (uptime), so Node boot + module loading are included; phase buckets partition
// only the marked installer work.
try {
  const phases = timings.map(t => `${t.label} ${Math.round(t.ms)}ms`).join(' · ');
  console.log();
  console.log('\x1b[90m%s\x1b[0m', `⏱  total ${process.uptime().toFixed(1)}s  (${phases})`);
} catch (_) { /* cosmetic only — never block the install */ }

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
    cleanupNulFile(cwd);
  });
});
