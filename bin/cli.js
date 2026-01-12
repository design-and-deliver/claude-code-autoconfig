#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync, spawn } = require('child_process');

const cwd = process.cwd();
const packageDir = path.dirname(__dirname);

// Reserved Windows device names - never create files with these names
const WINDOWS_RESERVED = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4',
  'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5',
  'LPT6', 'LPT7', 'LPT8', 'LPT9'];

// Files/folders installed by autoconfig - don't backup these
const AUTOCONFIG_FILES = ['commands', 'guide', 'agents', 'migration'];

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

// Step 3: Copy minimal bootstrap (commands/, guide/, agents/)
const commandsSrc = path.join(packageDir, '.claude', 'commands');
const guideSrc = path.join(packageDir, '.claude', 'guide');
const agentsSrc = path.join(packageDir, '.claude', 'agents');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (isReservedName(entry.name)) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy commands (required for /autoconfig to work)
if (fs.existsSync(commandsSrc)) {
  copyDir(commandsSrc, path.join(claudeDest, 'commands'));
} else {
  console.log('\x1b[31m%s\x1b[0m', '❌ Error: commands directory not found');
  process.exit(1);
}

// Copy guide (too large to generate)
if (fs.existsSync(guideSrc)) {
  copyDir(guideSrc, path.join(claudeDest, 'guide'));
}

// Copy agents if exists
if (fs.existsSync(agentsSrc)) {
  copyDir(agentsSrc, path.join(claudeDest, 'agents'));
}

console.log('\x1b[32m%s\x1b[0m', '✅ Prepared /autoconfig command');

// Step 4: Show "READY TO CONFIGURE" message
console.log();
console.log('\x1b[33m╔════════════════════════════════════════════╗');
console.log('║                                            ║');
console.log('║           \x1b[1mREADY TO CONFIGURE\x1b[22m               ║');
console.log('║                                            ║');
console.log('║\x1b[0m   Press ENTER to launch Claude and         \x1b[33m║');
console.log('║\x1b[0m   auto-run \x1b[36m/autoconfig\x1b[33m                      \x1b[33m║');
console.log('║                                            ║');
console.log('║\x1b[0m   \x1b[90mFirst run: approve 2-3 file prompts\x1b[33m       ║');
console.log('║\x1b[0m   \x1b[90mSubsequent runs: fully automated\x1b[33m          ║');
console.log('║                                            ║');
console.log('╚════════════════════════════════════════════╝\x1b[0m');
console.log();

// Step 5: Wait for Enter, then launch Claude Code
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('\x1b[90mPress ENTER to continue...\x1b[0m', () => {
  rl.close();

  console.log();
  console.log('\x1b[36m%s\x1b[0m', '🚀 Launching Claude Code with /autoconfig...');
  console.log();
  console.log('\x1b[90m%s\x1b[0m', '   Heads up: Claude Code can take 30+ seconds to initialize.');
  console.log('\x1b[90m%s\x1b[0m', '   Please be patient while it loads.');
  console.log();

  // Spawn claude with /autoconfig - settings.json has pre-approved permissions
  const claude = spawn('claude', ['/autoconfig'], {
    cwd: cwd,
    stdio: 'inherit',
    shell: true
  });

  claude.on('error', (err) => {
    console.log('\x1b[31m%s\x1b[0m', '❌ Failed to launch Claude Code');
    console.log('   Run "claude" manually, then run /autoconfig');
  });

  // Cleanup when Claude exits
  claude.on('close', () => {
    // Remove 'nul' file if accidentally created on Windows
    const nulFile = path.join(cwd, 'nul');
    if (fs.existsSync(nulFile)) {
      try {
        fs.unlinkSync(nulFile);
      } catch (e) {
        // Ignore errors - file might be locked or already gone
      }
    }
  });
});
