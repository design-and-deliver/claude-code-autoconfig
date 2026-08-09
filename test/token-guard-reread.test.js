/**
 * R18 — turn-local re-read divert (2026-08-09).
 *
 * The gap this closes is the one R8 door 2 cannot see. R8 prices a Read by SIZE: it diverts an
 * unranged read over readDivertTokens (15k) and exempts every ranged read outright. Neither test
 * asks the only question that matters for a REPEAT read — "are these bytes already in context?"
 * So the two commonest shapes of pure waste both walk straight through it:
 *
 *   - a 20KB file (~7.7k tokens, under the 15k bar) read three times in one turn = ~15k paid for
 *     nothing, then re-read by every request after it;
 *   - the same ranged read twice ("Read modal.tsx:3459-3485"), which R8's door never even prices.
 *
 * Every assertion below FAILS on the pre-R18 code: reReadVerdict did not exist, so a second read
 * of identical bytes had no verdict at all and the guard fold had nothing to consult.
 */
const { test, assert, summary } = require('./_harness');
const { reReadVerdict, readWindow, windowCovered, windowTokens, reReadDivertCopy, reReadTarget,
  resolveConfig, TOKEN_SAVER } = require('../.claude/hooks/token-guard');

const CFG = resolveConfig({});
const MTIME = 1754700000000;
// The shape R8 lets through: 20KB ≈ 7.7k tokens, comfortably under readDivertTokens.
const STAMP = { mtime: MTIME, chars: 20000 };
const FULL = { lo: 1, hi: null };
const PRIOR_FULL = { lo: 1, hi: null, mtime: MTIME };

test('default config carries the re-read bar, an order of magnitude under the size bar', () => {
  assert(CFG.reReadDivertTokens === 2000,
    `reReadDivertTokens default should be 2000, got: ${CFG.reReadDivertTokens}`);
  assert(CFG.reReadDivertTokens < CFG.readDivertTokens,
    'a read that buys nothing must gate lower than one that buys new bytes');
});

test('the second full read of a sub-bar file is diverted (the class R8 misses)', () => {
  const v = reReadVerdict(PRIOR_FULL, FULL, STAMP, CFG);
  assert(v, 'bytes already in context must not be paid for twice');
  assert(v.estTokens > 2000 && v.estTokens < 15000,
    `expected a priced re-read under R8's own bar, got: ${JSON.stringify(v)}`);
});

test('the first read of a file is never diverted', () => {
  assert(reReadVerdict(undefined, FULL, STAMP, CFG) === null,
    'with no prior read there is nothing in context to point back to');
});

test('a file changed on disk since the first read re-opens', () => {
  const moved = { mtime: MTIME + 1, chars: 20000 };
  assert(reReadVerdict(PRIOR_FULL, FULL, moved, CFG) === null,
    'an Edit (or another session\'s write) makes the in-context copy stale — that re-read is real');
});

test('widening the window is new information, not a re-read', () => {
  const priorRanged = { lo: 100, hi: 200, mtime: MTIME };
  assert(reReadVerdict(priorRanged, FULL, STAMP, CFG) === null,
    'a full read after a ranged one must pass');
  assert(reReadVerdict(priorRanged, { lo: 50, hi: 150 }, STAMP, CFG) === null,
    'a window starting before the prior one must pass');
  assert(reReadVerdict(priorRanged, { lo: 150, hi: 400 }, STAMP, CFG) === null,
    'a window running past the prior one must pass');
});

test('a ranged re-read inside an earlier window IS diverted — R8 never prices these', () => {
  const v = reReadVerdict(PRIOR_FULL, { lo: 10, hi: 500 }, STAMP, CFG);
  assert(v, 'the "Read modal.tsx:3459-3485 twice" shape must not walk through');
  const prior = { lo: 3000, hi: 3600, mtime: MTIME };
  assert(reReadVerdict(prior, { lo: 3100, hi: 3500 }, { mtime: MTIME, chars: 900000 }, CFG),
    'a narrower window inside an earlier ranged read is still the same bytes');
});

test('a trivial window stays under the bar — the divert is not free of attention', () => {
  assert(reReadVerdict(PRIOR_FULL, { lo: 10, hi: 30 }, STAMP, CFG) === null,
    '21 lines is not worth a redirect');
});

test('a ranged estimate can never exceed the whole file', () => {
  const small = { mtime: MTIME, chars: 500 };
  assert(windowTokens({ lo: 1, hi: 9999 }, small) <= Math.round(500 / 2.6),
    'the per-line estimate must stay capped by the file size — it may under-warn, never over');
  assert(windowTokens(FULL, STAMP) === Math.round(20000 / 2.6),
    'an open-ended window prices as the whole file');
});

test('window parsing matches the Read tool contract', () => {
  assert(readWindow({}).lo === 1 && readWindow({}).hi === null, 'a bare Read is 1..EOF');
  assert(readWindow({ offset: 100, limit: 50 }).hi === 149, 'offset+limit is an inclusive window');
  assert(readWindow({ offset: 100 }).hi === null, 'offset alone still runs to EOF');
  assert(readWindow({ limit: 50 }).lo === 1, 'limit alone starts at line 1');
});

test('containment is directional', () => {
  assert(windowCovered({ lo: 5, hi: 9 }, { lo: 1, hi: null }), 'open-ended covers everything after it');
  assert(!windowCovered({ lo: 1, hi: null }, { lo: 1, hi: 500 }), 'open-ended is not covered by bounded');
  assert(windowCovered({ lo: 1, hi: 500 }, { lo: 1, hi: 500 }), 'an identical window is covered');
});

test('images are never priced by this guard', () => {
  assert(reReadTarget(CFG, { tool_name: 'Read', tool_input: { file_path: 'C:\\x\\shot.png' } }) === null,
    'vision tokens are not chars/2.6 — the same reason R8 declines images');
  assert(reReadTarget(CFG, { tool_name: 'Grep', tool_input: { file_path: 'a.ts' } }) === null,
    'only Read carries a re-read ledger');
  assert(reReadTarget(CFG, { tool_name: 'Read', tool_input: {} }) === null,
    'a Read with no path is nothing to stat');
  assert(reReadTarget(CFG, { tool_name: 'Read', tool_input: { file_path: 'a.ts' } }) === 'a.ts',
    'an ordinary source read is in scope');
});

test('reReadDivertTokens null turns the guard off entirely', () => {
  const off = resolveConfig({ reReadDivertTokens: null });
  assert(reReadTarget(off, { tool_name: 'Read', tool_input: { file_path: 'a.ts' } }) === null,
    'with the guard off, no Read is even looked at');
});

test('token-saver lowers the bar rather than raising the interruption', () => {
  assert(TOKEN_SAVER.reReadDivertTokens === 800,
    `token-saver should tighten to 800, got: ${TOKEN_SAVER.reReadDivertTokens}`);
  const saver = resolveConfig({ tokenSaver: true });
  assert(reReadVerdict(PRIOR_FULL, { lo: 10, hi: 80 }, STAMP, saver),
    'max protection catches the smaller repeat windows the default lets go');
});

test('the divert copy redirects and closes the retry loop', () => {
  const v = reReadVerdict(PRIOR_FULL, FULL, STAMP, CFG);
  const copy = reReadDivertCopy('C:\\x\\background.ts', PRIOR_FULL, v);
  assert(/background\.ts/.test(copy), 'the copy must name the file');
  assert(/ALREADY in this conversation/.test(copy),
    'the copy must say where the content already is — that is the whole redirect');
  assert(/Do NOT retry/.test(copy),
    'an unqualified deny invites the identical Read again; the copy has to close that loop');
  assert(/offset\/limit OUTSIDE/.test(copy) && /Edit counts/.test(copy),
    'both escapes (widen, or change the file) must be spelled out or the model has no next move');
  assert(!/[Aa]pprove/.test(copy),
    'a divert is not an ask — "approve" would train the model to expect a user decision');
  assert(/every request after this one/.test(copy),
    'rent is a product, not a one-time charge — the copy has to say so');
  const ranged = reReadDivertCopy('a.ts', { lo: 100, hi: 200, mtime: MTIME }, v);
  assert(/lines 100-200/.test(ranged), 'a ranged prior must name its window, not say "in full"');
});

summary();
