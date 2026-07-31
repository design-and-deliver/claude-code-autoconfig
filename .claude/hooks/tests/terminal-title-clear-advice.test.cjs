// The /clear advisory (clearAdvice + the marks ledger that floors it). Three things here are
// contracts rather than implementation detail, and each has already been broken once:
//
//  1. It must be REACHABLE. The original gate needed 2 title-shift watermarks, but the directive
//     tells the model a title is "a compass, not a log" — measured 2026-07-29, only 63 of 199
//     histories ever reached 2, so the advisory fired on ~5% of sessions. The single-topic cases
//     below are that starved case; they fail on the pre-marks copy by construction.
//  2. It must not advise mid-goal. The relevance join grades an earlier topic by how many LEADING
//     title segments it shares with the current one: 2+ shared means only the sub-function moved,
//     so that context is still LIVE and a /clear would discard what the next sub-step needs
//     (3% of 309 real shifts — rare, and the expensive one to get wrong).
//  3. Its wording is load-bearing. "N earlier topics" is a lie on a single-topic session, and the
//     `💡 Hey —` prefix is the house style that marks the line as ours rather than Claude Code's.
//
// Run: node --test terminal-title-clear-advice.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

//  4. Cost cannot see DONE-NESS. A topic is done when it externalised its decisions into files, so
//     the advisory is gated on a dead topic having produced SURVIVING file writes — a file written
//     and then deleted leaves nothing to re-read, and a discussion-only topic's context is the only
//     copy of it. Sessions predating the write ledger must keep advising (absent ≠ zero).
const { clearAdvice, recordMark, readTailWrites, recordWrites, readWriteLedger } =
  require(path.resolve(__dirname, '..', 'terminal-title.js'));

const SID = 'test-sid';

function tmpTitles() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tt-advice-'));
}

// History entries carry `tokens` only when the transcript had flushed usage at paint time, so both
// shapes are seeded here on purpose — a reader that assumes the field breaks on real sessions.
function seedHistory(dir, entries) {
  fs.writeFileSync(path.join(dir, `${SID}.history.jsonl`),
    entries.map(e => `${JSON.stringify(e)}\n`).join(''));
}

function seedMarks(dir, marks) {
  fs.writeFileSync(path.join(dir, `${SID}.marks.json`), JSON.stringify(marks));
}

// clearAdvice reads live context from the transcript, not from the ledger — the ledger only
// supplies the floor and the per-topic watermarks.
function seedTranscript(dir, total) {
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, `${JSON.stringify({
    type: 'assistant',
    message: { usage: { input_tokens: 10, cache_read_input_tokens: total - 10 } },
  })}\n`);
  return file;
}

// The starved case: one topic, fat context. Unreachable before the per-paint marks ledger.
function singleTopicFatSession() {
  const dir = tmpTitles();
  seedHistory(dir, [{ ts: '2026-07-29T10:00:00.000Z', title: 'Scope — Do a thing' }]);
  seedMarks(dir, { fixed: 50000, latest: 200000, n: 12 });
  return { dir, transcript: seedTranscript(dir, 200000) };
}

test('a single-topic fat session is advised at all (the starved case)', () => {
  const { dir, transcript } = singleTopicFatSession();
  assert.match(clearAdvice(dir, SID, transcript), /\/clear cuts per-turn input cost/);
});

test('single-topic wording avoids the "N earlier topics" lie', () => {
  const { dir, transcript } = singleTopicFatSession();
  const out = clearAdvice(dir, SID, transcript);
  assert.match(out, /earlier work still ride/);
  assert.doesNotMatch(out, /earlier topic/, 'there is no earlier topic to name');
});

test('the line opens with the house-style prefix', () => {
  const { dir, transcript } = singleTopicFatSession();
  assert.match(clearAdvice(dir, SID, transcript), /^\u{1F4A1} Hey — /u);
});

test('dead is measured from the fixed floor: 200k current - 50k fixed = 150k', () => {
  const { dir, transcript } = singleTopicFatSession();
  assert.match(clearAdvice(dir, SID, transcript), /~150k tokens/);
});

test('the advisory is one-shot per topic', () => {
  const { dir, transcript } = singleTopicFatSession();
  assert.notEqual(clearAdvice(dir, SID, transcript), '', 'first call advises');
  assert.equal(clearAdvice(dir, SID, transcript), '', 'second call on the same topic is silent');
});

test('a thin session stays silent (dead 70k is under the 2x-fixed break-even)', () => {
  const dir = tmpTitles();
  seedHistory(dir, [{ ts: '2026-07-29T10:00:00.000Z', title: 'Scope — Do a thing' }]);
  seedMarks(dir, { fixed: 50000, latest: 120000, n: 6 });
  assert.equal(clearAdvice(dir, SID, seedTranscript(dir, 120000)), '');
});

test('sessions predating the marks ledger still advise off 2 title watermarks', () => {
  const dir = tmpTitles();
  seedHistory(dir, [
    { ts: '2026-07-29T10:00:00.000Z', title: 'A — one', tokens: 50000 },
    { ts: '2026-07-29T11:00:00.000Z', title: 'A — two', tokens: 200000 },
  ]);
  // No marks.json on purpose — this is the legacy path.
  assert.match(clearAdvice(dir, SID, seedTranscript(dir, 200000)), /1 earlier topic still ride/);
});

test('recordMark re-bases the floor on a shrink (auto-compact replaced the context)', () => {
  const dir = tmpTitles();
  recordMark(dir, SID, 60000);
  recordMark(dir, SID, 180000);
  recordMark(dir, SID, 55000); // under 60% of the prior sample = compaction, not ordinary drift
  const m = JSON.parse(fs.readFileSync(path.join(dir, `${SID}.marks.json`), 'utf8'));
  assert.equal(m.fixed, 55000, 'floor re-based to the post-compact sample');
  assert.equal(m.n, 1, 'sample count restarted with it');
});

// 2 shared leading segments: same scope AND goal, only the sub-function moved.
function nestedSubStep() {
  const dir = tmpTitles();
  seedHistory(dir, [
    { ts: '2026-07-29T10:00:00.000Z', title: 'Company Fields — Company-info API — Build cache table', tokens: 60000 },
    { ts: '2026-07-29T11:00:00.000Z', title: 'Company Fields — Company-info API — Deploy the endpoint', tokens: 190000 },
  ]);
  seedMarks(dir, { fixed: 50000, latest: 200000, n: 20 });
  return { dir, transcript: seedTranscript(dir, 200000) };
}

test('a nested sub-step is NOT counted as a dead topic', () => {
  const { dir, transcript } = nestedSubStep();
  assert.doesNotMatch(clearAdvice(dir, SID, transcript), /earlier topic/);
});

test('with no dead topic, dead falls back to current - fixed = 150k', () => {
  const { dir, transcript } = nestedSubStep();
  assert.match(clearAdvice(dir, SID, transcript), /~150k tokens/);
});

// 0 shared segments: a different scope entirely, so all of it is dead.
function scopeChange() {
  const dir = tmpTitles();
  seedHistory(dir, [
    { ts: '2026-07-29T10:00:00.000Z', title: 'Other scope — Some other goal', tokens: 130000 },
    { ts: '2026-07-29T11:00:00.000Z', title: 'Company Fields — Company-info API — Deploy', tokens: 190000 },
  ]);
  seedMarks(dir, { fixed: 50000, latest: 240000, n: 20 });
  return { dir, transcript: seedTranscript(dir, 240000) };
}

test('an unrelated earlier scope IS counted as a dead topic', () => {
  const { dir, transcript } = scopeChange();
  assert.match(clearAdvice(dir, SID, transcript), /1 earlier topic still ride/);
});

test('dead runs to the live goal\'s start watermark, not to current: 190k - 50k = 140k', () => {
  const { dir, transcript } = scopeChange();
  // 240k is live context; charging the live goal's own 50k to the shed would overstate it.
  assert.match(clearAdvice(dir, SID, transcript), /~140k tokens/);
});

test('an unreadable ledger never produces an estimated advisory', () => {
  const dir = tmpTitles();
  assert.equal(clearAdvice(dir, SID, seedTranscript(dir, 400000)), '', 'no history = no advice');
  seedHistory(dir, [{ ts: '2026-07-29T10:00:00.000Z', title: 'Scope — Goal' }]);
  assert.equal(clearAdvice(dir, SID, seedTranscript(dir, 400000)), '', 'history but no floor = no advice');
});

// ── done-ness: did the topic put anything on disk? ───────────────────────────────────────────────

// A transcript whose assistant turns carry tool_use blocks, the shape readTailWrites reads.
function seedToolTranscript(dir, calls) {
  const file = path.join(dir, 'tools.jsonl');
  fs.writeFileSync(file, calls.map(c => `${JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: c.name, input: c.input }] },
  })}\n`).join(''));
  return file;
}

test('readTailWrites picks up the write tools and ignores everything else', () => {
  const dir = tmpTitles();
  const file = seedToolTranscript(dir, [
    { name: 'Read', input: { file_path: '/repo/read-only.ts' } },
    { name: 'Edit', input: { file_path: '/repo/a.ts' } },
    { name: 'Bash', input: { command: 'rm -rf /repo/a.ts' } },
    { name: 'Write', input: { file_path: '/repo/b.ts', content: 'x' } },
    { name: 'MultiEdit', input: { file_path: '/repo/c.ts', edits: [] } },
    { name: 'NotebookEdit', input: { notebook_path: '/repo/d.ipynb' } },
    { name: 'Edit', input: { file_path: '/repo/a.ts' } }, // the tail window re-sees earlier turns
  ]);
  assert.deepEqual(readTailWrites(file),
    ['/repo/a.ts', '/repo/b.ts', '/repo/c.ts', '/repo/d.ipynb'], 'deduped, writes only');
  assert.deepEqual(readTailWrites(path.join(dir, 'nope.jsonl')), [], 'no transcript = no claim');
});

test('recordWrites accumulates per topic and dedups across paints', () => {
  const dir = tmpTitles();
  recordWrites(dir, SID, 'T1', ['/repo/a.ts']);
  recordWrites(dir, SID, 'T1', ['/repo/a.ts', '/repo/b.ts']); // next paint re-sees a.ts
  recordWrites(dir, SID, 'T2', ['/repo/c.ts']);
  assert.deepEqual(readWriteLedger(dir, SID), { T1: ['/repo/a.ts', '/repo/b.ts'], T2: ['/repo/c.ts'] });
});

test('an empty write list is recorded as a measured zero, not left absent', () => {
  const dir = tmpTitles();
  recordWrites(dir, SID, 'T1', []);
  assert.deepEqual(readWriteLedger(dir, SID), { T1: [] });
});

test('the write ledger survives a watermark shrink (files outlive a compaction)', () => {
  const dir = tmpTitles();
  recordMark(dir, SID, 60000);
  recordWrites(dir, SID, 'T1', ['/repo/a.ts']);
  recordMark(dir, SID, 180000);
  recordMark(dir, SID, 55000); // compaction: re-bases the watermarks, not what is on disk
  const m = JSON.parse(fs.readFileSync(path.join(dir, `${SID}.marks.json`), 'utf8'));
  assert.equal(m.fixed, 55000, 'floor still re-bases');
  assert.deepEqual(m.writes, { T1: ['/repo/a.ts'] }, 'the write ledger rode across');
});

// scopeChange's dead topic (entry 0), with its write ledger under our control.
function scopeChangeWithWrites(writes) {
  const { dir, transcript } = scopeChange();
  const m = JSON.parse(fs.readFileSync(path.join(dir, `${SID}.marks.json`), 'utf8'));
  m.writes = writes;
  fs.writeFileSync(path.join(dir, `${SID}.marks.json`), JSON.stringify(m));
  return { dir, transcript };
}

test('a dead topic with a surviving file write is counted done', () => {
  const dir0 = tmpTitles();
  const survivor = path.join(dir0, 'shipped.ts');
  fs.writeFileSync(survivor, 'export const x = 1\n');
  const { dir, transcript } = scopeChangeWithWrites({ '2026-07-29T10:00:00.000Z': [survivor] });
  assert.match(clearAdvice(dir, SID, transcript), /1 earlier topic still ride/);
});

test('a dead topic that wrote nothing is discussion-only, not done', () => {
  const { dir, transcript } = scopeChangeWithWrites({ '2026-07-29T10:00:00.000Z': [] });
  assert.equal(clearAdvice(dir, SID, transcript), '');
});

test('a write that did not survive does not buy a "you are done"', () => {
  const dir0 = tmpTitles();
  const gone = path.join(dir0, 'scratch.ts');
  const { dir, transcript } = scopeChangeWithWrites({ '2026-07-29T10:00:00.000Z': [gone] });
  assert.equal(clearAdvice(dir, SID, transcript), '', 'the file was never left on disk');
});

test('writes belonging only to the LIVE topic do not unlock the advisory', () => {
  const dir0 = tmpTitles();
  const survivor = path.join(dir0, 'live.ts');
  fs.writeFileSync(survivor, 'x\n');
  // Keyed to entry 1 — the current topic — so the DEAD topic still produced nothing.
  const { dir, transcript } = scopeChangeWithWrites({ '2026-07-29T11:00:00.000Z': [survivor] });
  assert.equal(clearAdvice(dir, SID, transcript), '');
});

test('a session with no write ledger at all still advises (absent is unknown, not zero)', () => {
  const { dir, transcript } = scopeChange(); // marks.json predates the ledger
  assert.equal(readWriteLedger(dir, SID), null);
  assert.match(clearAdvice(dir, SID, transcript), /1 earlier topic still ride/);
});

test('a single-topic session is gated on its own window having produced something', () => {
  const dir0 = tmpTitles();
  const survivor = path.join(dir0, 'only.ts');
  fs.writeFileSync(survivor, 'x\n');
  const bare = singleTopicFatSession();
  const withNone = singleTopicFatSession();
  for (const [s, writes] of [[bare, { '2026-07-29T10:00:00.000Z': [survivor] }],
    [withNone, { '2026-07-29T10:00:00.000Z': [] }]]) {
    const mf = path.join(s.dir, `${SID}.marks.json`);
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    m.writes = writes;
    fs.writeFileSync(mf, JSON.stringify(m));
  }
  assert.match(clearAdvice(bare.dir, SID, bare.transcript), /earlier work still ride/);
  assert.equal(clearAdvice(withNone.dir, SID, withNone.transcript), '', 'nothing on disk = not done');
});
