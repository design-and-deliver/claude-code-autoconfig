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
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, assert, summary } = require('./_harness');
const { livenessVerdict, livenessNote, livenessCheck } = require('../.claude/hooks/token-guard-liveness');

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

// --- the I/O half (added 2026-08-07, clean-code plan 4.3) --------------------------------
// livenessCheck is the seam pulled out of main()'s stdin 'end' arrow when it was decomposed
// from CC 12. Before the extraction that path had NO coverage — only the pure verdict above
// did — so these characterize it: state really round-trips through the project dir, the
// config threshold is honored, and an ignored event writes nothing.

const SID = 'feedface-0000-0000-0000-000000000000';
const PROMPT = { hook_event_name: 'UserPromptSubmit', session_id: SID };

// Run fn against a throwaway project dir. CLAUDE_PROJECT_DIR beats data.cwd inside the hook,
// so pin it rather than hoping the runner's env is clean; restore it either way.
function inProject(fn, config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-liveness-'));
  if (config !== undefined) {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'cca.config.json'), JSON.stringify(config));
  }
  const saved = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('livenessCheck: the Nth silent prompt emits the note, and only that one', () => {
  inProject(() => {
    const quiet = [livenessCheck(PROMPT), livenessCheck(PROMPT)];
    assert(quiet.every(n => n === ''),
      `must stay quiet below the threshold, got: ${JSON.stringify(quiet)}`);
    const fired = livenessCheck(PROMPT);
    assert(/3 prompts in a row/.test(fired), `the 3rd silent prompt must fire, got: ${fired}`);
    assert(livenessCheck(PROMPT) === '', 'one outage must warn exactly once');
  }, { tokenGuard: { livenessWarnPrompts: 3 } });
});

test('livenessCheck: a guard whose state file keeps moving never fires', () => {
  inProject(dir => {
    const guardFile = path.join(dir, '.claude', 'hooks', '.token-guard', `${SID}.json`);
    fs.mkdirSync(path.dirname(guardFile), { recursive: true });
    const notes = [];
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(guardFile, '{}');
      const stamp = new Date(Date.now() + i * 1000);
      fs.utimesSync(guardFile, stamp, stamp);
      notes.push(livenessCheck(PROMPT));
    }
    assert(notes.every(n => n === ''), `a live guard must stay silent, got: ${JSON.stringify(notes)}`);
  });
});

test('livenessCheck: a null livenessWarnPrompts disables the warning entirely', () => {
  inProject(() => {
    const notes = [1, 2, 3, 4, 5].map(() => livenessCheck(PROMPT));
    assert(notes.every(n => n === ''), `null must disable, got: ${JSON.stringify(notes)}`);
  }, { tokenGuard: { livenessWarnPrompts: null } });
});

test('livenessCheck: a wrong event or a missing sid is ignored and writes no state', () => {
  inProject(dir => {
    assert(livenessCheck({ hook_event_name: 'Stop', session_id: SID }) === '',
      'a non-UserPromptSubmit event must be ignored');
    assert(livenessCheck({ hook_event_name: 'UserPromptSubmit' }) === '',
      'a payload with no session_id must be ignored');
    assert(!fs.existsSync(path.join(dir, '.claude', 'hooks', '.token-guard')),
      'an ignored event must not create the state dir');
  });
});

summary();
