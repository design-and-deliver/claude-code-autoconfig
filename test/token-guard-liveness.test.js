/**
 * Liveness canary — the fail-open alarm for token-guard ITSELF (2026-08-05).
 *
 * Every token-guard handler swallows exceptions and emits nothing, so a dead guard (partial-
 * clobber runtime throw, load-time SyntaxError, unreadable transcript) looks exactly like a
 * quiet session. token-guard-liveness.js is a separate, dependency-free hook that counts
 * consecutive prompts across which the guard's <sid>.json mtime never moved. These pin the
 * verdict's edges: fire only after N consecutive silent prompts, exactly once per outage,
 * re-arm on any sign of life, and stay silent when disabled — plus the note's copy contract.
 * The suite requires the CANARY module only: it must stay importable even if token-guard.js
 * is broken (that independence is the whole design).
 */
const { test, assert, summary } = require('./_harness');
const { livenessVerdict, livenessNote } = require('../.claude/hooks/token-guard-liveness');

const NOW = 1754300000000;
const M = 1754300001234.5;   // an mtimeMs — fractional, as Windows/NTFS actually reports

// Fold a sequence of per-prompt mtime observations through the verdict, collecting fires.
function run(observations, threshold) {
  let prev = null;
  const fires = [];
  for (const mtime of observations) {
    const { next, fire } = livenessVerdict(prev, mtime, threshold, NOW);
    if (fire) fires.push(fire);
    prev = next;
  }
  return { fires, last: prev };
}

test('dead from birth: fires on the Nth consecutive absent-file prompt', () => {
  const { fires } = run([null, null, null], 3);
  assert(fires.length === 1 && fires[0] === 3,
    `3 promptless writes must fire once with count 3, got: ${JSON.stringify(fires)}`);
});

test('healthy session never fires: file appears, then keeps moving', () => {
  const { fires } = run([null, M, M + 10, M + 20, M + 30], 3);
  assert(fires.length === 0, `a guard writing every turn must stay silent, got: ${JSON.stringify(fires)}`);
});

test('first sighting of the file counts as alive and resets the count', () => {
  const { last } = run([null, null, M], 3);
  assert(last.silent === 0 && last.lastMtime === M,
    `an appearing file is a write — count must reset, got: ${JSON.stringify(last)}`);
});

test('mid-session death: a frozen mtime accumulates to a fire', () => {
  const { fires } = run([M, M + 10, M + 10, M + 10, M + 10], 3);
  assert(fires.length === 1 && fires[0] === 3,
    `3 frozen prompts after a healthy run must fire once, got: ${JSON.stringify(fires)}`);
});

test('one-shot per outage: continued silence after the fire stays quiet', () => {
  const { fires } = run([null, null, null, null, null, null], 3);
  assert(fires.length === 1, `one outage must warn exactly once, got ${fires.length} fires`);
});

test('recovery re-arms: a second outage fires again', () => {
  const seq = [null, null, null,          // outage 1 -> fire
    M,                                     // guard revives (write observed)
    M, M, M];                              // outage 2: frozen 3 in a row -> fire
  const { fires } = run(seq, 3);
  assert(fires.length === 2 && fires[1] === 3,
    `revive-then-die must produce a second fire, got: ${JSON.stringify(fires)}`);
});

test("a blind session's one stray write only delays the alarm", () => {
  // r14's baseline arm can land a single write on an unreadable transcript, then freeze.
  const { fires } = run([null, M, M, M, M], 3);
  assert(fires.length === 1 && fires[0] === 3,
    `one stray write then silence must still fire, got: ${JSON.stringify(fires)}`);
});

test('deleted state file counts as silence, not a crash', () => {
  const { fires } = run([M, null, null, null], 3);
  assert(fires.length === 1, `file deletion is silence — must fire, got: ${JSON.stringify(fires)}`);
});

test('null/0 threshold disables firing but keeps counting', () => {
  assert(run([null, null, null, null, null], null).fires.length === 0, 'null must disable');
  const { fires, last } = run([null, null, null, null, null], 0);
  assert(fires.length === 0, '0 must disable');
  assert(last.silent === 5, `disabled still tracks, got silent=${last.silent}`);
});

test('corrupt prior state degrades to a fresh count, never a throw', () => {
  const { next, fire } = livenessVerdict('not-an-object', null, 3, NOW);
  assert(next.silent === 1 && fire === null,
    `garbage prev must reset to a first-prompt count, got: ${JSON.stringify({ next, fire })}`);
});

test('the note carries the count with its threshold, a shortened sid, and no $', () => {
  const s = livenessNote(3, 3, 'deadbeef-1234-5678-9abc-def012345678');
  assert(/3 prompts in a row/.test(s), `the count must appear, got: ${s}`);
  assert(/threshold 3/.test(s), `a number needs its threshold, got: ${s}`);
  assert(/deadbeef…/.test(s) && !/deadbeef-1234/.test(s), `sid must be shortened, got: ${s}`);
  assert(!/\$/.test(s), `liveness copy never carries $, got: ${s}`);
  assert(/node --check/.test(s), `the diagnosis step must be actionable, got: ${s}`);
});

summary();
