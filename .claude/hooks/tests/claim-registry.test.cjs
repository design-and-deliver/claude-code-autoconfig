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
