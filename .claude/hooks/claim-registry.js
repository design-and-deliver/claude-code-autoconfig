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

// The claim files in a claims dir. An unreadable dir is EMPTY, not an error: every caller is a
// fail-open hook path, and a claims dir that cannot be listed must not take a turn down with it.
function listClaimFiles(dir) {
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
  } catch (e) {
    return [];
  }
}

function readFileOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    return null;
  }
}

// A session whose glyph stopped moving longer ago than the dupe window is gone; its claims are
// stale and must not gate anybody. No glyph at all (mtime 0) is NOT stale — the session may
// predate the glyph writer, and treating it as dead would drop live claims.
function isStaleSid(sid, now) {
  const glyphMtime = getGlyphMtime(sid);
  return glyphMtime > 0 && (now - glyphMtime > DUPE_WINDOW_MS);
}

function parseClaimLine(line, sid) {
  try {
    const obj = JSON.parse(line);
    if (!obj || !obj.path) return null;
    return {
      sid,
      path: obj.path,
      normPath: normalizePath(obj.path),
      region: obj.region || null,
      intent: obj.intent || null,
      timestamp: obj.timestamp || 0
    };
  } catch (e) {
    return null;                                    // malformed JSON line — skipped silently
  }
}

// One session's file → its claims, keyed by normalized path so a path claimed twice collapses to
// its LATEST line (the file is append-only, so later wins by iteration order).
function parseClaimLines(content, sid) {
  const byPath = new Map();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const claim = parseClaimLine(line, sid);
    if (claim) byPath.set(claim.normPath, claim);
  }
  return [...byPath.values()];
}

// The per-file guard ladder: skip our own session, skip a session whose glyph went cold, skip a
// file that will not read. Every rung yields NO claims rather than an error — one bad file must
// not blank the whole registry.
function claimsOfFile(claimsDir, file, selfSid, now) {
  const sid = file.replace(/\.jsonl$/, '');
  if (selfSid && sid === selfSid) return [];
  if (isStaleSid(sid, now)) return [];

  const content = readFileOrNull(path.join(claimsDir, file));
  if (content == null) return [];

  return parseClaimLines(content, sid);
}

function readLiveClaims(opts = {}) {
  const { selfSid = null, now = Date.now() } = opts;
  const claimsDir = getClaimsDir();
  const result = [];

  if (!fs.existsSync(claimsDir)) {
    return result;
  }

  for (const file of listClaimFiles(claimsDir)) {
    result.push(...claimsOfFile(claimsDir, file, selfSid, now));
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
  claimantsOf,
  // Exported for the suite: the dir-listing and line-parsing seams are where readLiveClaims'
  // fail-open behavior lives, and getClaimsDir() is homedir-fixed — without these the missing /
  // unreadable-dir paths can only be exercised by moving the real claims dir out from under the
  // live fleet. Not part of the hook contract; token-guard and fleet.js use neither.
  listClaimFiles,
  parseClaimLines
};
