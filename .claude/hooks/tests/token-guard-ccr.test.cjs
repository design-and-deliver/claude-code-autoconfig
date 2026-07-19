// R4 idle-return `ccr` handoff: the hook writes a recover pointer; the ccr bin reads it
// back and builds the relaunch command. Run: node --test token-guard-ccr.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { writeRecoverPointer } = require(path.resolve(__dirname, '..', 'token-guard.js'));
const CCR = path.resolve(__dirname, '..', '..', '..', 'bin', 'ccr.js');
const { readPointer, buildLaunch } = require(CCR);

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ccr-'));
}

// ---------- writeRecoverPointer (hook side) ----------

test('writeRecoverPointer creates the state dir and a well-formed pointer', () => {
  const proj = tmpProject();
  const cmd = '/recover-context -150 --session b26aaa76';
  assert.equal(writeRecoverPointer(proj, 'b26aaa76-full-sid', cmd), true);
  const rec = JSON.parse(fs.readFileSync(
    path.join(proj, '.claude', 'hooks', '.token-guard', 'recover.json'), 'utf8'));
  assert.equal(rec.recoverCmd, cmd);
  assert.equal(rec.sid, 'b26aaa76-full-sid');
  assert.equal(rec.projectDir, proj);
  assert.ok(Math.abs(Date.now() - rec.writtenAt) < 5000);
});

test('writeRecoverPointer overwrites a prior pointer (latest block wins)', () => {
  const proj = tmpProject();
  writeRecoverPointer(proj, 'sid-a', '/recover-context -15 --session aaaaaaaa');
  writeRecoverPointer(proj, 'sid-b', '/recover-context -30 --session bbbbbbbb');
  const rec = JSON.parse(fs.readFileSync(
    path.join(proj, '.claude', 'hooks', '.token-guard', 'recover.json'), 'utf8'));
  assert.equal(rec.sid, 'sid-b');
  assert.match(rec.recoverCmd, /bbbbbbbb/);
});

// ---------- ccr (bin side) ----------

test('readPointer round-trips what the hook wrote', () => {
  const proj = tmpProject();
  writeRecoverPointer(proj, 'sid-c', '/recover-context -45 --session cccccccc');
  const rec = readPointer(proj);
  assert.equal(rec.recoverCmd, '/recover-context -45 --session cccccccc');
});

test('readPointer rejects missing, malformed, and non-slash payloads', () => {
  const proj = tmpProject();
  assert.equal(readPointer(proj), null); // nothing written
  const dir = path.join(proj, '.claude', 'hooks', '.token-guard');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'recover.json'), 'not json');
  assert.equal(readPointer(proj), null); // malformed
  fs.writeFileSync(path.join(dir, 'recover.json'),
    JSON.stringify({ recoverCmd: 'rm -rf /' })); // not a slash command — refuse to shell it
  assert.equal(readPointer(proj), null);
});

test('buildLaunch wraps the slash command for the shell', () => {
  assert.equal(buildLaunch('/recover-context -150 --session b26aaa76'),
    'claude "/recover-context -150 --session b26aaa76"');
});

test('ccr --dry-run prints the launch command; exits 1 with no pointer', () => {
  const proj = tmpProject();
  writeRecoverPointer(proj, 'sid-d', '/recover-context -20 --session dddddddd');
  const ok = spawnSync(process.execPath, [CCR, '--dry-run'], { cwd: proj, encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout.trim(), 'claude "/recover-context -20 --session dddddddd"');

  const bare = spawnSync(process.execPath, [CCR, '--dry-run'],
    { cwd: tmpProject(), encoding: 'utf8' });
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /no recovery pointer/);
});
