#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync, spawn } = require('child_process');

const cwd = process.cwd();
const packageDir = path.dirname(__dirname);

// Cleanup any stray 'nul' file immediately on startup (Windows /dev/null artifact)
function cleanupNulFile() {
  const nulFile = path.join(cwd, 'nul');
  if (fs.existsSync(nulFile)) {
    try {
      fs.unlinkSync(nulFile);
    } catch (e) {
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
const AUTOCONFIG_FILES = ['commands', 'guide', 'agents', 'migration', 'hooks', 'updates'];

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

const forceMode = process.argv.includes('--force');

console.log('\x1b[36m%s\x1b[0m', '🚀 Claude Code Autoconfig');
console.log();

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
  } catch (err) {
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
  const timestamp = formatTimestamp();
  const migrationDir = path.join(claudeDest, 'migration');
  migrationPath = path.join(migrationDir, timestamp);

  fs.mkdirSync(migrationPath, { recursive: true });

  // Copy user files to backup (excluding autoconfig-installed files)
  const existingEntries = fs.readdirSync(claudeDest).filter(e =>
    e !== 'migration' && !AUTOCONFIG_FILES.includes(e)
  );

  for (const entry of existingEntries) {
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

// Detect upgrade vs fresh install (must run BEFORE copying files)
const isUpgrade = (() => {
  // Indicator 1: CLAUDE.md has autoconfig marker
  const claudeMdPath = path.join(cwd, 'CLAUDE.md');
  if (fs.existsSync(claudeMdPath)) {
    const content = fs.readFileSync(claudeMdPath, 'utf8');
    if (content.includes('AUTO-GENERATED BY /autoconfig')) return true;
  }
  // Indicator 2: docs HTML exists (unique autoconfig artifact)
  const docsPath = path.join(claudeDest, 'docs', 'autoconfig.docs.html');
  if (fs.existsSync(docsPath)) return true;
  return false;
})();

// Step 3: Copy minimal bootstrap (commands/, docs/, agents/, feedback/, hooks/)
const commandsSrc = path.join(packageDir, '.claude', 'commands');
const docsSrc = path.join(packageDir, '.claude', 'docs');
const agentsSrc = path.join(packageDir, '.claude', 'agents');
const feedbackSrc = path.join(packageDir, '.claude', 'feedback');
const hooksSrc = path.join(packageDir, '.claude', 'hooks');

// Files that exist in the dev repo but should never be installed to user projects
const DEV_ONLY_FILES = ['publish.md'];

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
// Preserve user's saved @screenshotDir in gls.md across upgrades
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

// Restore saved screenshot dir after commands overwrite
if (savedScreenshotDir && fs.existsSync(glsDest)) {
  const content = fs.readFileSync(glsDest, 'utf8');
  fs.writeFileSync(glsDest, content.replace(
    /<!-- @screenshotDir\s*-->/,
    `<!-- @screenshotDir ${savedScreenshotDir} -->`
  ));
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

// Copy hooks directory (preserve user customizations unless --force)
if (fs.existsSync(hooksSrc)) {
  const copyFn = forceMode ? copyDir : copyDirIfMissing;
  copyFn(hooksSrc, path.join(claudeDest, 'hooks'));
}

// Copy updates directory (new update files only, never overwrite existing)
const updatesSrc = path.join(packageDir, '.claude', 'updates');
if (fs.existsSync(updatesSrc)) {
  copyDirIfMissing(updatesSrc, path.join(claudeDest, 'updates'));
}

// Copy settings.json — fresh install gets full copy, upgrades get hooks merged
const settingsSrc = path.join(packageDir, '.claude', 'settings.json');
const settingsDest = path.join(claudeDest, 'settings.json');
if (fs.existsSync(settingsSrc)) {
  if (forceMode || !fs.existsSync(settingsDest)) {
    fs.copyFileSync(settingsSrc, settingsDest);
  } else {
    // Merge hooks from package into existing settings
    try {
      const pkgSettings = JSON.parse(fs.readFileSync(settingsSrc, 'utf8'));
      const userSettings = JSON.parse(fs.readFileSync(settingsDest, 'utf8'));
      if (pkgSettings.hooks) {
        if (!userSettings.hooks) userSettings.hooks = {};
        for (const [event, matchers] of Object.entries(pkgSettings.hooks)) {
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
                  // Find matching matcher or create new one
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
        fs.writeFileSync(settingsDest, JSON.stringify(userSettings, null, 2));
      }
    } catch (err) {
      // If merge fails, don't break the install
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
    const ver = (oldVersion > 0 && newVersion > 0) ? ` (v${oldVersion} → v${newVersion})` : ' (updated)';
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

const launchCommand = isUpgrade ? '/autoconfig-update' : '/autoconfig';

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
console.log();
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

  claude.on('error', (err) => {
    console.log('\x1b[31m%s\x1b[0m', '❌ Failed to launch Claude Code');
    console.log(`   Run "claude" manually, then run ${launchCommand}`);
  });

  // Cleanup when Claude exits
  claude.on('close', () => {
    cleanupNulFile();
  });
});
