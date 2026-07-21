'use strict';

const fs = require('fs');
const path = require('path');

// ============================================================================
// Update parsing + --pull-updates (Phase 3 seam 3)
//
// Extracted from bin/cli.js: the @applied-block parser, the highest-applied
// filter, and pullUpdates (which /autoconfig-update's `npx ...@latest --pull-updates`
// runs to copy any NEW .claude/updates/*.md into a user's project).
//
//   - parseAppliedUpdates: read the numeric ids out of autoconfig-update.md's
//     `<!-- @applied ... -->` block. The @applied regexes here are BYTE-VERBATIM
//     with the empty-block marker cli.js writes (CLAUDE.md trap 6 / T2) — never reword.
//   - getHighestAppliedId: the max applied id (0 if none).
//   - pullUpdates: refresh autoconfig-update.md (preserving the user's @applied block)
//     and copy update files newer than the highest applied id.
//
// pullUpdates RECEIVES its pin context (cwd / packageDir / pinnedVersion /
// installerVersion / ccaConfigCorrupt) as a params object — those consts stay
// module-scope in cli.js because the SAME pin also gates the --bootstrap path there
// (the pin check is duplicated by design). Do NOT re-derive them here.
// ============================================================================

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

function pullUpdates({ cwd, packageDir, pinnedVersion, installerVersion, ccaConfigCorrupt }) {
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

module.exports = {
  parseAppliedUpdates,
  getHighestAppliedId,
  pullUpdates
};
