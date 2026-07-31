'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DUPE_WINDOW_MS = 180000; // 3 minutes

function getClaimsDir() {
  return path.join(os.homedir(), '.claude', 'hooks', '.titles', 'claims');
}

function claimPath(sid) {
  if (!sid) return null;
  return path.join(getClaimsDir(), `${sid}.jsonl`);
}

function normalizePath(filePath) {
  if (!filePath) return '';
  return path.normalize(filePath).toLowerCase().replace(/\\/g, '/');
}

function writeClaim(opts) {
  try {
    const { sid, path: filePath, region = null, intent = null } = opts || {};
    if (!sid || !filePath) return false;

    const claimsDir = getClaimsDir();
    if (!fs.existsSync(claimsDir)) {
      fs.mkdirSync(claimsDir, { recursive: true });
    }

    const targetFile = claimPath(sid);
    const line = JSON.stringify({
      sid,
      path: path.resolve(filePath),
      region,
      intent,
      timestamp: Date.now()
    }) + '\n';

    fs.appendFileSync(targetFile, line, 'utf8');
    return true;
  } catch (err) {
    return false;
  }
}

function getGlyphMtime(sid) {
  try {
    const titlesDir = path.join(os.homedir(), '.claude', 'hooks', '.titles');
    const glyphPath = path.join(titlesDir, `${sid}.glyph`);
    if (fs.existsSync(glyphPath)) {
      return fs.statSync(glyphPath).mtimeMs;
    }
  } catch (e) {}
  return 0;
}

function readLiveClaims(opts = {}) {
  const { selfSid = null, now = Date.now() } = opts;
  const claimsDir = getClaimsDir();
  const result = [];

  if (!fs.existsSync(claimsDir)) {
    return result;
  }

  let files = [];
  try {
    files = fs.readdirSync(claimsDir).filter(f => f.endsWith('.jsonl'));
  } catch (e) {
    return result;
  }

  for (const file of files) {
    const sid = file.replace(/\.jsonl$/, '');
    if (selfSid && sid === selfSid) {
      continue;
    }

    const glyphMtime = getGlyphMtime(sid);
    if (glyphMtime > 0 && (now - glyphMtime > DUPE_WINDOW_MS)) {
      continue;
    }

    const filePath = path.join(claimsDir, file);
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      continue;
    }

    const lines = content.split(/\r?\n/);
    const sessionClaimsByPath = new Map();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj && obj.path) {
          const norm = normalizePath(obj.path);
          sessionClaimsByPath.set(norm, {
            sid,
            path: obj.path,
            normPath: norm,
            region: obj.region || null,
            intent: obj.intent || null,
            timestamp: obj.timestamp || 0
          });
        }
      } catch (e) {
        // Skip malformed JSON lines silently
      }
    }

    for (const claim of sessionClaimsByPath.values()) {
      result.push(claim);
    }
  }

  return result;
}

function claimantsOf(absPath, claims = []) {
  if (!absPath) return [];
  const targetNorm = normalizePath(absPath);
  return claims.filter(c => c.normPath === targetNorm);
}

module.exports = {
  DUPE_WINDOW_MS,
  getClaimsDir,
  claimPath,
  normalizePath,
  writeClaim,
  readLiveClaims,
  claimantsOf
};
