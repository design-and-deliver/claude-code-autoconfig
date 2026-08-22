// Per-session scratch sweep: .titles/ used to grow without bound (nothing pruned it but the
// terminals/ registry), so a year-old project surfaced thousands of untracked files. The sweep
// ages scratch out — the interesting half of these tests is what it must NOT delete, since the
// title-carry reads a dead session's {prevSid}.txt and a wrong deletion blanks a real tab.
// Run: node --test terminal-title-sweep.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { pruneTitleState } = require(path.resolve(__dirname, '..', 'terminal-title.js'));

const LIVE = '11111111-1111-1111-1111-111111111111';
const OLD = '22222222-2222-2222-2222-222222222222';
const PREV = '33333333-3333-3333-3333-333333333333';

function tmpTitles() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tt-sweep-'));
}

// Write a file and backdate it past the 14-day horizon (or leave it fresh).
function seed(dir, name, ageDays) {
  const fp = path.join(dir, name);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, 'x');
  if (ageDays) {
    const t = (Date.now() - ageDays * 86400000) / 1000;
    fs.utimesSync(fp, t, t);
  }
  return fp;
}

function has(dir, name) {
  return fs.existsSync(path.join(dir, name));
}

test('scratch past the horizon is swept', () => {
  const dir = tmpTitles();
  seed(dir, `${OLD}.txt`, 30);
  seed(dir, `${OLD}.glyph`, 30);
  seed(dir, `${OLD}.history.jsonl`, 30);
  pruneTitleState(dir, LIVE);
  assert.ok(!has(dir, `${OLD}.txt`), 'stale title removed');
  assert.ok(!has(dir, `${OLD}.glyph`), 'stale glyph removed');
  assert.ok(!has(dir, `${OLD}.history.jsonl`), 'stale history removed');
});

test('recent scratch survives', () => {
  const dir = tmpTitles();
  seed(dir, `${OLD}.txt`, 3);
  pruneTitleState(dir, LIVE);
  assert.ok(has(dir, `${OLD}.txt`), 'inside the horizon — kept');
});

test('the live session is never swept, however old its files look', () => {
  const dir = tmpTitles();
  seed(dir, `${LIVE}.txt`, 90);
  pruneTitleState(dir, LIVE);
  assert.ok(has(dir, `${LIVE}.txt`), 'current session is exempt by sid');
});

// The regression this whole guard exists for: carriedTitle() resolves a NEW session's tab title
// through {prevSid}.txt. That predecessor is dead and its file is old by definition, so a naive
// age sweep deletes exactly the file the next carry needs.
test('a predecessor named by a surviving lineage is shielded', () => {
  const dir = tmpTitles();
  seed(dir, `${PREV}.txt`, 60);
  fs.writeFileSync(path.join(dir, `${LIVE}.lineage.json`),
    JSON.stringify({ prevSid: PREV, tid: '9-9', source: 'clear' }));
  pruneTitleState(dir, LIVE);
  assert.ok(has(dir, `${PREV}.txt`), 'carry target survives despite age');
});

test('an unshielded predecessor still ages out', () => {
  const dir = tmpTitles();
  seed(dir, `${PREV}.txt`, 60);
  seed(dir, `${OLD}.lineage.json`, 60); // lineage naming nobody — no shield
  pruneTitleState(dir, LIVE);
  assert.ok(!has(dir, `${PREV}.txt`), 'no lineage points here — swept');
});

test('non-session files are untouched at any age', () => {
  const dir = tmpTitles();
  seed(dir, '_debug.log', 400);
  seed(dir, '_alarms.log', 400);
  seed(dir, 'title-painter-v6.exe', 400);
  seed(dir, 'title-painter-v6.cs', 400);
  seed(dir, 'needle-distrust', 400);
  seed(dir, path.join('terminals', 'dead.json'), 400);
  pruneTitleState(dir, LIVE);
  assert.ok(has(dir, '_debug.log'), 'shared log kept');
  assert.ok(has(dir, '_alarms.log'), 'alarm log kept');
  assert.ok(has(dir, 'title-painter-v6.exe'), 'painter binary kept');
  assert.ok(has(dir, 'title-painter-v6.cs'), 'painter source kept');
  assert.ok(has(dir, 'needle-distrust'), 'flag kept');
  assert.ok(has(dir, path.join('terminals', 'dead.json')), 'terminals/ is the other prune\'s job');
});

test('the sweep runs at most once a day', () => {
  const dir = tmpTitles();
  seed(dir, `${OLD}.txt`, 30);
  pruneTitleState(dir, LIVE); // claims the stamp, sweeps
  assert.ok(!has(dir, `${OLD}.txt`));
  seed(dir, `${PREV}.txt`, 30); // new stale file, same day
  pruneTitleState(dir, LIVE);
  assert.ok(has(dir, `${PREV}.txt`), 'second call same day is a no-op');
});

test('a stamp older than a day re-arms the sweep', () => {
  const dir = tmpTitles();
  const stamp = seed(dir, '.sweep-stamp', 2);
  seed(dir, `${OLD}.txt`, 30);
  pruneTitleState(dir, LIVE);
  assert.ok(!has(dir, `${OLD}.txt`), 'stale stamp does not block');
  assert.ok(fs.existsSync(stamp), 'stamp refreshed, not removed');
});

test('sweep is fail-safe on a missing dir and an empty sid', () => {
  const dir = tmpTitles();
  assert.doesNotThrow(() => pruneTitleState(path.join(dir, 'nope'), LIVE));
  assert.doesNotThrow(() => pruneTitleState(dir, ''));
});
