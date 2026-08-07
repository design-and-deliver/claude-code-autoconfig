/**
 * R8 door 2 — divert-and-preview (2026-08-07).
 *
 * The gap this closes was measured, not theorised. A session read settings.local.json (53,044
 * bytes) on request 4 of 39; the file then re-uploaded on all ~34 requests after it, ~1.2M
 * tokens — 18-25% of the whole session. R8's door was open the entire time: it priced the file
 * at 53044/2.6 = ~20.4k tokens, under the 50k bombJumpTokens ask bar, so nothing fired.
 *
 * Two things changed. The door's ACTION became a divert (deny + head preview + the next move)
 * instead of a user-facing ask, and because a divert costs the user nothing, its BAR dropped to
 * readDivertTokens (15k) — a threshold an interrupting ask could never have justified.
 *
 * The regression case below (the 53KB read must be diverted) FAILS on the pre-fix code, which
 * returned null for anything under bombJumpTokens and had no divert action at all.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, assert, summary } = require('./_harness');
const { payloadVerdict, payloadDivertCopy, readHead, resolveConfig, TOKEN_SAVER } =
  require('../.claude/hooks/token-guard');

const CFG = resolveConfig({});
const THE_READ = { fileChars: 53044, isImage: false };   // the 2026-08-07 settings.local.json

test('default config carries the divert bar, well under the ask bar', () => {
  assert(CFG.readDivertTokens === 15000,
    `readDivertTokens default should be 15000, got: ${CFG.readDivertTokens}`);
  assert(CFG.readDivertTokens < CFG.bombJumpTokens,
    'a free action must gate lower than an interrupting one');
});

test('the 53KB read is diverted (the 2026-08-07 regression)', () => {
  const v = payloadVerdict('Read', {}, THE_READ, CFG);
  assert(v, 'the read that cost ~1.2M tokens must not pass the door in silence');
  assert(v.action === 'divert', `expected a divert, got: ${JSON.stringify(v)}`);
  assert(v.door === 'read' && v.estTokens > 15000,
    `expected a priced read door, got: ${JSON.stringify(v)}`);
});

test('a ranged read is still exempt — it is the behaviour the divert asks for', () => {
  assert(payloadVerdict('Read', { offset: 0, limit: 200 }, THE_READ, CFG) === null,
    'offset/limit must stay the free escape from the door');
  assert(payloadVerdict('Read', { limit: 200 }, THE_READ, CFG) === null,
    'limit alone must exempt too');
});

test('images and unsized files never divert', () => {
  assert(payloadVerdict('Read', {}, { fileChars: 900000, isImage: true }, CFG) === null,
    'vision tokens are not chars/2.6 — an image must not be priced by size');
  assert(payloadVerdict('Read', {}, { fileChars: null }, CFG) === null,
    'an unstatable file is never guessed at');
});

test('a small read still passes untouched', () => {
  assert(payloadVerdict('Read', {}, { fileChars: 20000, isImage: false }, CFG) === null,
    '20KB (~7.7k tokens) is under the bar and must not be diverted');
});

test('door 1 (Skill) still ASKS — a skill has no head to preview', () => {
  const v = payloadVerdict('Skill', { skill: 'claude-api' }, { skillTok: 245000 }, CFG);
  assert(v && v.door === 'skill' && v.action === 'ask',
    `the skill door must remain an ask, got: ${JSON.stringify(v)}`);
});

test('readDivertTokens null reverts door 2 to the old ask at bombJumpTokens', () => {
  const off = resolveConfig({ readDivertTokens: null });
  assert(payloadVerdict('Read', {}, THE_READ, off) === null,
    'with the divert off, a 53KB read is under bombJumpTokens and passes as it used to');
  const big = payloadVerdict('Read', {}, { fileChars: 200000, isImage: false }, off);
  assert(big && big.action === 'ask',
    `with the divert off, a bomb-sized read must still ASK, got: ${JSON.stringify(big)}`);
});

test('token-saver lowers the bar rather than raising the interruption', () => {
  assert(TOKEN_SAVER.readDivertTokens === 8000,
    `token-saver should tighten to 8000, got: ${TOKEN_SAVER.readDivertTokens}`);
  const saver = resolveConfig({ tokenSaver: true });
  const v = payloadVerdict('Read', {}, { fileChars: 30000, isImage: false }, saver);
  assert(v && v.action === 'divert',
    `30KB (~11.5k tokens) should divert under token-saver, got: ${JSON.stringify(v)}`);
});

test('readHead previews without loading — byte cap holds on a one-line file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-divert-'));
  try {
    const oneLine = path.join(dir, 'min.json');
    fs.writeFileSync(oneLine, '{"a":"' + 'x'.repeat(400000) + '"}');   // 400KB, no newline
    const head = readHead(oneLine);
    assert(head && head.length <= 1200,
      `a minified blob must not ride in through the preview channel: ${head && head.length}`);

    const many = path.join(dir, 'many.txt');
    fs.writeFileSync(many, Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n'));
    const lines = readHead(many).split('\n');
    assert(lines.length <= 12, `line cap should hold, got ${lines.length}`);
    assert(lines[0] === 'line 0', `preview should start at the head, got: ${lines[0]}`);

    assert(readHead(path.join(dir, 'nope.txt')) === null, 'a missing file previews as null');
    assert(readHead('') === null, 'an empty path previews as null');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('divert copy redirects — it never asks for approval', () => {
  const v = payloadVerdict('Read', {}, THE_READ, CFG);
  const copy = payloadDivertCopy({ file_path: 'C:\\x\\settings.local.json' }, v, 'line one');
  assert(/settings\.local\.json/.test(copy), 'the copy must name the file');
  assert(/Grep/.test(copy) && /offset/.test(copy), 'the copy must carry the next move');
  assert(/line one/.test(copy), 'the preview must ride in the copy');
  assert(!/[Aa]pprove/.test(copy),
    'a divert is not an ask — "approve" would train the model to expect a user decision');
  // Rent is a product, not a one-time charge — the copy has to say so or it under-sells itself.
  assert(/every request left/.test(copy), 'the copy must frame the cost as recurring');
  const noHead = payloadDivertCopy({ file_path: 'a.json' }, v, null);
  assert(!/Head of the file/.test(noHead), 'an unreadable head must drop the section cleanly');
});

summary();
