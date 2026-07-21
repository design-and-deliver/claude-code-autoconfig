'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Remove the stray `nul` file that a Windows `> nul` redirect can leave in the project root.
 *
 * This is a WINDOWS-ONLY artifact. On POSIX (Linux/macOS) `nul` is not special — a file named
 * `nul` there is a real file the user created, so it must never be deleted (BH-8: the unguarded
 * version silently `unlinkSync`'d it with no backup). `platform` is injectable so the guard is
 * unit-testable on any OS.
 *
 * @param {string} cwd       project root to look in
 * @param {string} [platform=process.platform]  platform string (injectable for tests)
 */
function cleanupNulFile(cwd, platform = process.platform) {
  if (platform !== 'win32') return; // 'nul' is only a Windows redirect artifact; leave real POSIX files alone
  const nulFile = path.join(cwd, 'nul');
  if (fs.existsSync(nulFile)) {
    try {
      fs.unlinkSync(nulFile);
    } catch (_) {
      // Ignore - file might be locked
    }
  }
}

module.exports = { cleanupNulFile };
