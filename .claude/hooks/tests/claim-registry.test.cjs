'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  claimPath,
  normalizePath,
  writeClaim,
  readLiveClaims,
  claimantsOf,
  getClaimsDir,
  listClaimFiles,
  parseClaimLines,
  DUPE_WINDOW_MS
} = require('../claim-registry.js');

test('claimPath returns path in claims directory', () => {
  const p = claimPath('test-sid-123');
  assert.ok(p.includes('test-sid-123.jsonl'));
  assert.ok(p.includes('.titles'));
  assert.ok(p.includes('claims'));
});

test('normalizePath normalizes slashes and case', () => {
  const norm1 = normalizePath('C:\\CODE\\Project\\File.js');
  const norm2 = normalizePath('c:/code/project/file.js');
  assert.equal(norm1, norm2);
  assert.equal(norm1, 'c:/code/project/file.js');
});

test('writeClaim appends JSON line and handles directory creation', () => {
  const testSid = 'test-session-write-999';
  const targetFile = claimPath(testSid);

  // Clean up if exists
  if (fs.existsSync(targetFile)) {
    fs.unlinkSync(targetFile);
  }

  const success = writeClaim({
    sid: testSid,
    path: 'C:\\CODE\\job-agent-extension\\test-file.js',
    region: 'L10-L20',
    intent: 'testing claim write'
  });

  assert.equal(success, true);
  assert.equal(fs.existsSync(targetFile), true);

  const content = fs.readFileSync(targetFile, 'utf8');
  const lines = content.trim().split('\n');
  assert.equal(lines.length, 1);

  const data = JSON.parse(lines[0]);
  assert.equal(data.sid, testSid);
  assert.ok(data.path.includes('test-file.js'));

  // Clean up
  fs.unlinkSync(targetFile);
});

test('readLiveClaims skips selfSid, malformed JSON, and stale sessions', () => {
  const sid1 = 'test-live-sid-1';
  const sid2 = 'test-stale-sid-2';
  const sidSelf = 'test-self-sid-3';

  const claimsDir = getClaimsDir();
  if (!fs.existsSync(claimsDir)) {
    fs.mkdirSync(claimsDir, { recursive: true });
  }

  const file1 = claimPath(sid1);
  const file2 = claimPath(sid2);
  const fileSelf = claimPath(sidSelf);

  // Write files
  fs.writeFileSync(file1, JSON.stringify({ sid: sid1, path: 'C:/CODE/file1.js' }) + '\nBAD JSON LINE\n');
  fs.writeFileSync(file2, JSON.stringify({ sid: sid2, path: 'C:/CODE/file2.js' }) + '\n');
  fs.writeFileSync(fileSelf, JSON.stringify({ sid: sidSelf, path: 'C:/CODE/file3.js' }) + '\n');

  // Create fake glyph files
  const titlesDir = path.join(os.homedir(), '.claude', 'hooks', '.titles');
  const glyph1 = path.join(titlesDir, `${sid1}.glyph`);
  const glyph2 = path.join(titlesDir, `${sid2}.glyph`);

  fs.writeFileSync(glyph1, '◐');
  fs.writeFileSync(glyph2, '◐');

  const now = Date.now();
  // Touch glyph2 as old (4 minutes ago)
  const oldTime = (now - DUPE_WINDOW_MS - 60000) / 1000;
  fs.utimesSync(glyph2, oldTime, oldTime);

  const claims = readLiveClaims({ selfSid: sidSelf, now });

  // Clean up test files & glyphs
  try { fs.unlinkSync(file1); } catch (e) {}
  try { fs.unlinkSync(file2); } catch (e) {}
  try { fs.unlinkSync(fileSelf); } catch (e) {}
  try { fs.unlinkSync(glyph1); } catch (e) {}
  try { fs.unlinkSync(glyph2); } catch (e) {}

  // Assertions
  const sidsInClaims = claims.map(c => c.sid);
  assert.ok(sidsInClaims.includes(sid1));
  assert.ok(!sidsInClaims.includes(sid2)); // stale
  assert.ok(!sidsInClaims.includes(sidSelf)); // self
});

// Characterization (added 2026-08-07, before 4.2's decompose): a session that claims the same
// path twice is ONE claimant, and the surviving record is the later write — the whole reason the
// per-file loop builds a Map keyed by normalized path instead of pushing every line. Nothing
// asserted this, so a decompose could have collapsed the Map to a flat push and stayed green.
test('readLiveClaims dedups per path within a session — last write wins', () => {
  const sid = 'test-dedup-sid-4';

  const claimsDir = getClaimsDir();
  if (!fs.existsSync(claimsDir)) {
    fs.mkdirSync(claimsDir, { recursive: true });
  }

  const file = claimPath(sid);
  const titlesDir = path.join(os.homedir(), '.claude', 'hooks', '.titles');
  const glyph = path.join(titlesDir, `${sid}.glyph`);

  // Same path twice (different slash style, so the dedup must be on the NORMALIZED path), plus
  // an unrelated path that must survive alongside it.
  fs.writeFileSync(file, [
    JSON.stringify({ sid, path: 'C:\\CODE\\dedupe.js', intent: 'first', timestamp: 1000 }),
    JSON.stringify({ sid, path: 'C:/CODE/other.js', intent: 'other', timestamp: 1500 }),
    JSON.stringify({ sid, path: 'C:/code/Dedupe.js', intent: 'second', timestamp: 2000 }),
    ''
  ].join('\n'));
  fs.writeFileSync(glyph, '◐');

  const claims = readLiveClaims({ now: Date.now() }).filter(c => c.sid === sid);

  try { fs.unlinkSync(file); } catch (e) {}
  try { fs.unlinkSync(glyph); } catch (e) {}

  assert.equal(claims.length, 2);
  const deduped = claims.find(c => c.normPath === 'c:/code/dedupe.js');
  assert.ok(deduped, 'the twice-claimed path is present');
  assert.equal(deduped.intent, 'second');
  assert.equal(deduped.timestamp, 2000);
  assert.ok(claims.some(c => c.normPath === 'c:/code/other.js'));
});

// The fail-open dir seams. getClaimsDir() is homedir-fixed, so these are unreachable through
// readLiveClaims without moving the live fleet's claims dir aside — hence the direct calls.
test('listClaimFiles is empty for a missing or unreadable dir', () => {
  const missing = path.join(os.tmpdir(), 'cca-claims-does-not-exist-4f2a');
  assert.deepEqual(listClaimFiles(missing), []);

  // A regular file where a directory is expected: readdirSync throws ENOTDIR, and the caller
  // must see "no claims", never the throw.
  const notADir = path.join(os.tmpdir(), 'cca-claims-not-a-dir-4f2a');
  fs.writeFileSync(notADir, 'not a directory');
  try {
    assert.deepEqual(listClaimFiles(notADir), []);
  } finally {
    try { fs.unlinkSync(notADir); } catch (e) {}
  }
});

test('listClaimFiles keeps only .jsonl entries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-claims-'));
  fs.writeFileSync(path.join(dir, 'a.jsonl'), '');
  fs.writeFileSync(path.join(dir, 'b.txt'), '');
  fs.writeFileSync(path.join(dir, 'c.jsonl.bak'), '');
  try {
    assert.deepEqual(listClaimFiles(dir), ['a.jsonl']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseClaimLines skips blanks and malformed lines, and defaults the optional fields', () => {
  const claims = parseClaimLines(
    [
      '',
      '   ',
      'BAD JSON LINE',
      JSON.stringify({ path: 'C:/CODE/a.js' }),          // no region/intent/timestamp
      JSON.stringify({ region: 'L1-L2' }),               // no path — not a claim
      'null',
      JSON.stringify({ path: 'C:/CODE/b.js', region: 'L5-L9', intent: 'edit', timestamp: 7 })
    ].join('\n'),
    'sid-x'
  );

  assert.equal(claims.length, 2);
  assert.deepEqual(claims[0], {
    sid: 'sid-x',
    path: 'C:/CODE/a.js',
    normPath: 'c:/code/a.js',
    region: null,
    intent: null,
    timestamp: 0
  });
  assert.equal(claims[1].region, 'L5-L9');
  assert.equal(claims[1].timestamp, 7);
});

test('claimantsOf finds matching normalized paths', () => {
  const claims = [
    { sid: 's1', path: 'C:\\CODE\\app.js', normPath: 'c:/code/app.js' },
    { sid: 's2', path: 'C:/CODE/app.js', normPath: 'c:/code/app.js' },
    { sid: 's3', path: 'C:/CODE/other.js', normPath: 'c:/code/other.js' }
  ];

  const claimants = claimantsOf('C:\\CODE\\app.js', claims);
  assert.equal(claimants.length, 2);
  assert.equal(claimants[0].sid, 's1');
  assert.equal(claimants[1].sid, 's2');
});
