'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DUPE_WINDOW_MS = 180000; // 3 minutes
// A session with NO glyph can't be aged by its glyph, so its claim file's own mtime ages it.
const GLYPHLESS_STALE_MS = 30 * 60 * 1000;

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

function slashed(p) {
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => d.toLowerCase() + ':');
}

// The repo that owns a `.git` FILE (a linked worktree): gitdir: X, then X/commondir names the
// shared .git dir, whose parent is the main checkout. No commondir (a submodule) → the dir that
// holds the .git file is the repo.
function repoOfGitFile(dir, gitFile) {
  const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(gitFile, 'utf8'));
  if (!m) return null;
  const gitdir = path.resolve(dir, m[1].trim());
  const commonFile = path.join(gitdir, 'commondir');
  if (!fs.existsSync(commonFile)) return dir;
  return path.dirname(path.resolve(gitdir, fs.readFileSync(commonFile, 'utf8').trim()));
}

// Walk up from a directory to the first `.git` and name the repo it belongs to. fs only — this
// runs on hook paths, where spawning git per claim is too slow.
function findRepoRoot(startDir) {
  let dir = startDir;
  for (;;) {
    const git = path.join(dir, '.git');
    if (fs.existsSync(git)) {
      return { top: dir, repo: fs.statSync(git).isDirectory() ? dir : repoOfGitFile(dir, git) };
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// {repo, rel} for a file: the SAME file in the main checkout and in any linked worktree gets the
// same key, which a plain path can never do. null outside a repo, or on any fs error.
function repoKeyOf(absPath) {
  try {
    if (!absPath) return null;
    const abs = path.resolve(absPath);
    const root = findRepoRoot(path.dirname(abs));
    if (!root || !root.repo) return null;
    return { repo: slashed(root.repo), rel: slashed(path.relative(root.top, abs)) };
  } catch (_) {
    return null;
  }
}

// The key two claims are compared on: repo + rel when the record carries both, else the
// normalized path (records written before repo keys existed).
function matchKeyOf(repo, rel, normPath) {
  return repo && rel ? `${repo.toLowerCase()}|${rel.toLowerCase()}` : normPath;
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
    const key = repoKeyOf(filePath) || {};
    const line = JSON.stringify({
      sid,
      path: path.resolve(filePath),
      repo: key.repo,
      rel: key.rel,
      region,
      intent,
      timestamp: Date.now()
    }) + '\n';

    fs.appendFileSync(targetFile, line, 'utf8');
    return true;
  } catch (_) {
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
  } catch (_) { /* no glyph, or an unreadable titles dir — 0 reads as "not stale" */ }
  return 0;
}

// The claim files in a claims dir. An unreadable dir is EMPTY, not an error: every caller is a
// fail-open hook path, and a claims dir that cannot be listed must not take a turn down with it.
function listClaimFiles(dir) {
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
  } catch (_) {
    return [];
  }
}

function readFileOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (_) {
    return null;
  }
}

function mtimeOrZero(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch (_) {
    return 0;
  }
}

// A session whose glyph stopped moving longer ago than the dupe window is gone; its claims are
// stale and must not gate anybody. With no glyph, the claim file's mtime decides, on a longer
// window: the session may predate the glyph writer, but a claim file nobody has appended to in
// half an hour belongs to a dead session.
function isStaleSid(sid, now, claimFile) {
  const glyphMtime = getGlyphMtime(sid);
  if (glyphMtime > 0) return now - glyphMtime > DUPE_WINDOW_MS;
  const fileMtime = mtimeOrZero(claimFile);
  return fileMtime > 0 && now - fileMtime > GLYPHLESS_STALE_MS;
}

function parseClaimLine(line, sid) {
  try {
    const obj = JSON.parse(line);
    if (!obj || !obj.path) return null;
    const normPath = normalizePath(obj.path);
    return {
      sid,
      path: obj.path,
      normPath,
      repo: obj.repo || null,
      rel: obj.rel || null,
      key: matchKeyOf(obj.repo, obj.rel, normPath),
      region: obj.region || null,
      intent: obj.intent || null,
      timestamp: obj.timestamp || 0
    };
  } catch (_) {
    return null;                                    // malformed JSON line — skipped silently
  }
}

// One session's file → its claims, keyed by match key so a file claimed twice collapses to
// its LATEST line (the file is append-only, so later wins by iteration order).
function parseClaimLines(content, sid) {
  const byPath = new Map();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const claim = parseClaimLine(line, sid);
    if (claim) byPath.set(claim.key, claim);
  }
  return [...byPath.values()];
}

// The per-file guard ladder: skip our own session, skip a session whose glyph went cold, skip a
// file that will not read. Every rung yields NO claims rather than an error — one bad file must
// not blank the whole registry.
function claimsOfFile(claimsDir, file, selfSid, now) {
  const sid = file.replace(/\.jsonl$/, '');
  if (selfSid && sid === selfSid) return [];
  const claimFile = path.join(claimsDir, file);
  if (isStaleSid(sid, now, claimFile)) return [];

  const content = readFileOrNull(claimFile);
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

// A repo-keyed claim matches on repo + rel, so a sibling editing the same file from another
// worktree is found; a claim without a repo key falls back to the normalized path.
function claimantsOf(absPath, claims = []) {
  if (!absPath) return [];
  const targetNorm = normalizePath(absPath);
  const target = repoKeyOf(absPath);
  if (!target) return claims.filter(c => c.normPath === targetNorm);
  const targetKey = matchKeyOf(target.repo, target.rel, targetNorm);
  return claims.filter(c => (c.repo && c.rel ? c.key === targetKey : c.normPath === targetNorm));
}

module.exports = {
  DUPE_WINDOW_MS,
  getClaimsDir,
  claimPath,
  normalizePath,
  writeClaim,
  readLiveClaims,
  claimantsOf,
  repoKeyOf,
  isStaleSid,
  // Exported for the suite: the dir-listing and line-parsing seams are where readLiveClaims'
  // fail-open behavior lives, and getClaimsDir() is homedir-fixed — without these the missing /
  // unreadable-dir paths can only be exercised by moving the real claims dir out from under the
  // live fleet. Not part of the hook contract; token-saver and fleet.js use neither.
  listClaimFiles,
  parseClaimLines
};
