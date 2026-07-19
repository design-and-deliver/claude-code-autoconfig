// R4 idle-return recovery pointer: the hook writes a numbered pointer that
// `/recover-context pid=N` resolves; the legacy ccr bin still round-trips it.
// Run: node --test token-guard-ccr.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { writeRecoverPointer, idleReturnNote } = require(path.resolve(__dirname, '..', 'token-guard.js'));
const CCR = path.resolve(__dirname, '..', '..', '..', 'bin', 'ccr.js');
const { readPointer, buildLaunch } = require(CCR);

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ccr-'));
}

function readRec(proj) {
  return JSON.parse(fs.readFileSync(
    path.join(proj, '.claude', 'hooks', '.token-guard', 'recover.json'), 'utf8'));
}

// ---------- writeRecoverPointer (hook side) ----------

test('first fire writes pid=1 with the pid-form command and a frozen cutoff', () => {
  const proj = tmpProject();
  const rec = writeRecoverPointer(proj, 'b26aaa76-full-sid', 15);
  assert.equal(rec.pid, 1);
  assert.equal(rec.recoverCmd, '/recover-context pid=1');
  assert.equal(rec.sid, 'b26aaa76-full-sid');
  assert.equal(rec.minutes, 15);
  assert.equal(rec.projectDir, proj);
  assert.ok(Math.abs(Date.now() - rec.writtenAt) < 5000);
  // cutoffIso is writtenAt minus minutes — the boundary is frozen at fire time
  const drift = Math.abs((rec.writtenAt - 15 * 60000) - Date.parse(rec.cutoffIso));
  assert.ok(drift < 5000, `cutoffIso off by ${drift}ms`);
  assert.deepEqual(rec.history, []);
  assert.deepEqual(readRec(proj), rec); // what's on disk is what was returned
});

test('pid is monotonic and prior fires ride along under history[]', () => {
  const proj = tmpProject();
  writeRecoverPointer(proj, 'sid-a', 15);
  const rec = writeRecoverPointer(proj, 'sid-b', 30);
  assert.equal(rec.pid, 2);
  assert.equal(rec.sid, 'sid-b');
  assert.equal(rec.history.length, 1);
  assert.equal(rec.history[0].pid, 1);
  assert.equal(rec.history[0].sid, 'sid-a');
  assert.ok(rec.history[0].cutoffIso, 'history keeps the frozen cutoff');
});

test('history is capped at 4 prior fires (5 pointers total on disk)', () => {
  const proj = tmpProject();
  for (let n = 1; n <= 7; n++) writeRecoverPointer(proj, `sid-${n}`, 10);
  const rec = readRec(proj);
  assert.equal(rec.pid, 7);
  assert.equal(rec.history.length, 4);
  assert.deepEqual(rec.history.map(h => h.pid), [6, 5, 4, 3]);
});

test('writeRecoverPointer returns null when the pointer cannot be written', () => {
  // A file where the state DIR should be makes mkdirSync throw on every platform.
  const proj = tmpProject();
  fs.mkdirSync(path.join(proj, '.claude', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'hooks', '.token-guard'), 'not a dir');
  assert.equal(writeRecoverPointer(proj, 'sid-x', 15), null);
});

// ---------- ccr (legacy bin side — still round-trips the flat top level) ----------

test('readPointer round-trips what the hook wrote', () => {
  const proj = tmpProject();
  writeRecoverPointer(proj, 'sid-c', 45);
  const rec = readPointer(proj);
  assert.equal(rec.recoverCmd, '/recover-context pid=1');
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
  assert.equal(buildLaunch('/recover-context pid=3'), 'claude "/recover-context pid=3"');
});

test('ccr --dry-run prints the launch command; exits 1 with no pointer', () => {
  const proj = tmpProject();
  writeRecoverPointer(proj, 'sid-d', 20);
  const ok = spawnSync(process.execPath, [CCR, '--dry-run'], { cwd: proj, encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout.trim(), 'claude "/recover-context pid=1"');

  const bare = spawnSync(process.execPath, [CCR, '--dry-run'],
    { cwd: tmpProject(), encoding: 'utf8' });
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /no recovery pointer/);
});

// ---------- idleReturnNote (warn-mode relay copy) ----------

test('idleReturnNote is the prose warning built on the given command — no card, no ccr', () => {
  const note = idleReturnNote(178000, '/recover-context pid=2');
  assert.match(note, /STANDALONE warning block/);
  assert.match(note, /~178k tokens/);
  assert.match(note, /\/recover-context pid=2/);
  assert.ok(!note.includes('AskUserQuestion'), 'the new-terminal card is retired');
  assert.ok(!note.includes('ccr'), 'ccr is no longer advertised');
  assert.ok(!note.includes('$'), 'never a dollar figure');
});

test('idleReturnNote carries the fallback command verbatim when given one', () => {
  const note = idleReturnNote(90000, '/recover-context -20 --session abcd1234');
  assert.match(note, /\/recover-context -20 --session abcd1234/);
});
