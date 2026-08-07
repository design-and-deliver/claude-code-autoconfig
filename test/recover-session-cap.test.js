#!/usr/bin/env node
'use strict';

/**
 * Tests for cap_to_budget() in .claude/scripts/recover-session.py — the size bound on the
 * context /continue and /recover-context hand a resumed session.
 *
 * Behavioral, not structural: each case builds a real transcript under a throwaway HOME and
 * drives the actual script in minutes mode, then reads the JSON it prints AND the
 * recovered-context.json it wrote. Nothing here imports a Python helper directly, so the
 * wiring (extract → cap → temp file → JSON fields) is covered too.
 *
 * This is the FIRST test in the repo that spawns python3 — the recovery script is Python and
 * the suite was node-only. A missing interpreter FAILS rather than skips: an unguarded cap is
 * exactly the thing this file exists to prevent, and a silent skip is how that comes back.
 *
 * What it pins, and why each case exists (all three regressed or nearly did on 2026-08-07):
 *
 *  1. Under budget → byte-identical. Clipping runs LAST on purpose. An earlier draft clipped
 *     every long message up front at a fixed ceiling, which altered 32% of real sessions to
 *     fix the 5% that were over.
 *  2. Over budget, many messages → oldest dropped, TAIL kept. Recovery reads backward; the
 *     tail is the in-flight work.
 *  3. Over budget, FEW huge messages → survivors clipped. This is the one that bites: the
 *     session that motivated the cap held 156k tokens in FOUR messages, so MIN_EXTRACT_MSGS
 *     rightly refused to drop any and count-trimming alone did nothing. One pasted dump
 *     always defeats a message count.
 *
 * Fail-on-bug verified against the pre-cap file (no cap_to_budget at all): cases 2 and 3
 * overshoot the 3k budget by 50x and 200x respectively.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { test, assert, summary } = require('./_harness');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'recover-session.py');
const BUDGET = 3000;        // MAX_EXTRACT_TOKENS
const FLOOR = 4;            // MIN_EXTRACT_MSGS
const SLACK = 1.2;          // clipping bounds by construction, not exactly — 4 chars/token is an estimate

// python3 first (what the command docs tell users to run), then the Windows-flavored names.
const PYTHON = ['python3', 'python', 'py'].find(c => {
  const r = spawnSync(c, ['-c', 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)']);
  return !r.error && r.status === 0;
});
if (!PYTHON) {
  console.log('✗ no python3 interpreter on PATH — recover-session.py cannot be tested');
  process.exit(1);
}

/**
 * Build a throwaway HOME holding one transcript of `sizes.length` assistant messages, run the
 * script against it in minutes mode, and return { json, payload } — what it printed and what
 * it wrote. TMP is redirected too, so the run never clobbers the real recovered-context.json
 * of whoever is running the suite.
 */
function runWith(sizes) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-cap-home-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-cap-tmp-'));
  const proj = path.join(home, '.claude', 'projects', 'C--fake-project');
  fs.mkdirSync(proj, { recursive: true });

  // Ascending timestamps a few seconds apart, all comfortably inside the 60-minute window.
  const base = Date.now() - 10 * 60 * 1000;
  const lines = sizes.map((n, i) => JSON.stringify({
    parentUuid: `uuid-${i}`,
    type: 'assistant',
    timestamp: new Date(base + i * 5000).toISOString(),
    message: { content: [{ type: 'text', text: marker(i) + 'x'.repeat(n) + marker(i) }] }
  }));
  fs.writeFileSync(path.join(proj, 'aaaaaaaa-0000-0000-0000-000000000000.jsonl'),
    lines.join('\n') + '\n');

  const env = { ...process.env, USERPROFILE: home, HOME: home, TMP: tmp, TEMP: tmp };
  delete env.HOMEDRIVE;       // expanduser prefers USERPROFILE, but leave it nothing to fall back to
  delete env.HOMEPATH;
  delete env.CLAUDE_CODE_SESSION_ID;

  const r = spawnSync(PYTHON, [SCRIPT, '--minutes', '60', '--no-plan-probe'],
    { encoding: 'utf8', env, timeout: 60000 });
  assert(r.status === 0, `script exited ${r.status}: ${r.stderr || r.stdout}`);

  const json = JSON.parse(r.stdout);
  const payload = JSON.parse(fs.readFileSync(path.join(tmp, 'recovered-context.json'), 'utf8'));
  return { json, payload };
}

// A per-message sentinel at BOTH ends, so a clipped message still proves which one it was and
// that head and tail both survived the elision.
const marker = i => `[MSG${i}]`;
const tokensOf = payload => payload.reduce((n, m) => n + m.text.length, 0) / 4;

test('under budget: payload comes back byte-identical, nothing dropped or clipped', () => {
  const { json, payload } = runWith([400, 400, 400]);
  assert(json.droppedOlder === 0, `droppedOlder should be 0, got ${json.droppedOlder}`);
  assert(json.clipped === 0, `clipped should be 0, got ${json.clipped}`);
  assert(payload.length === 3, `should keep all 3 messages, got ${payload.length}`);
  assert(payload.every(m => !m.text.includes('elided')), 'no message should be clipped');
  assert(payload[0].text === marker(0) + 'x'.repeat(400) + marker(0), 'text should be untouched');
});

test('over budget, many messages: oldest dropped, payload inside the budget', () => {
  const sizes = new Array(40).fill(2000);              // 40 x 500 tok = 20k
  const { json, payload } = runWith(sizes);
  assert(tokensOf(payload) <= BUDGET, `payload should be <= ${BUDGET} tok, got ${tokensOf(payload)}`);
  assert(json.droppedOlder > 0, 'should have dropped older messages');
  assert(json.clipped === 0, `count-trimming alone should suffice here, clipped=${json.clipped}`);
  assert(payload.length + json.droppedOlder === sizes.length, 'kept + dropped should account for every message');
});

test('over budget, many messages: the TAIL is what survives', () => {
  const { payload } = runWith(new Array(40).fill(2000));
  const last = 39;
  assert(payload[payload.length - 1].text.startsWith(marker(last)),
    'the newest message must be kept — recovery reads backward');
  assert(!payload.some(m => m.text.startsWith(marker(0))), 'the oldest message should be gone');
});

test('floor case: FEW huge messages are clipped, because dropping cannot bind', () => {
  const { json, payload } = runWith(new Array(FLOOR).fill(600000));   // 4 x 150k tok
  assert(payload.length === FLOOR, `the floor must keep all ${FLOOR} messages, got ${payload.length}`);
  assert(json.droppedOlder === 0, `nothing droppable at the floor, got ${json.droppedOlder}`);
  assert(json.clipped === FLOOR, `all ${FLOOR} survivors should be clipped, got ${json.clipped}`);
  assert(tokensOf(payload) <= BUDGET * SLACK,
    `payload should be ~<= ${BUDGET} tok, got ${tokensOf(payload)} — a message count cannot bound one pasted dump`);
});

test('clipping keeps the head AND the tail of a message', () => {
  const { payload } = runWith(new Array(FLOOR).fill(600000));
  payload.forEach((m, i) => {
    assert(m.text.startsWith(marker(i)), `message ${i} should keep its head`);
    assert(m.text.endsWith(marker(i)), `message ${i} should keep its tail`);
    assert(/\[\d+ tokens elided\]/.test(m.text), `message ${i} should say what it elided`);
  });
});

test('one giant message among small ones is still bounded', () => {
  const { json, payload } = runWith([100, 100, 100, 100, 100, 800000]);
  assert(tokensOf(payload) <= BUDGET * SLACK,
    `payload should be ~<= ${BUDGET} tok, got ${tokensOf(payload)}`);
  assert(json.clipped > 0, 'the giant message must be clipped');
});

summary();
