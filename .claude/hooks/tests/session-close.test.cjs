'use strict';

/**
 * session-close.test.cjs — pins the clean-exit marker.
 *
 * The property under test is an ABSENCE: a killed session is identified by having no
 * {sid}.closed file. That makes two failure modes silent in production and worth pinning here —
 * a marker written to the wrong .titles dir (a restore reader joins it against {sid}.txt and
 * finds neither), and a marker written for an event that is not SessionEnd (a live session
 * reads as cleanly closed and never gets offered for restore).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'session-close.js');
const { resolveTitlesDir, markerBody } = require(HOOK);

function tmpdir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cca-session-close-${label}-`));
  return dir;
}

function titlesIn(root) {
  return path.join(root, '.claude', 'hooks', '.titles');
}

// Drive the REAL hook the way Claude Code does — spawn it, pipe a JSON payload to stdin — so
// the stdin plumbing and the exit path are covered, not just the exported helpers.
function runHook(payload, env) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('SessionEnd writes {sid}.closed into the project .titles dir', () => {
  const root = tmpdir('project');
  const sid = 'aaaaaaaa-0000-0000-0000-000000000001';
  fs.mkdirSync(titlesIn(root), { recursive: true });
  fs.writeFileSync(path.join(titlesIn(root), `${sid}.session.json`), '{}');

  const r = runHook(
    { hook_event_name: 'SessionEnd', session_id: sid, cwd: root, reason: 'prompt_input_exit' },
    { CLAUDE_PROJECT_DIR: root },
  );
  assert.strictEqual(r.status, 0, 'hook must always exit 0');

  const marker = path.join(titlesIn(root), `${sid}.closed`);
  assert.ok(fs.existsSync(marker), 'marker missing — a clean exit would read as a crash');
  const body = JSON.parse(fs.readFileSync(marker, 'utf8'));
  assert.strictEqual(body.sid, sid);
  assert.strictEqual(body.reason, 'prompt_input_exit');
  assert.strictEqual(body.cwd, root);
  assert.ok(Date.parse(body.ts) > 0, 'ts must be a parseable ISO timestamp');
});

test('marker follows the session state, not the hook tier', () => {
  // The session's state lives in the PROJECT dir; a home-tier .titles dir also exists. The
  // marker must join with the state, or a restore reader looking beside {sid}.txt finds nothing.
  const root = tmpdir('follow');
  const home = tmpdir('home');
  const sid = 'aaaaaaaa-0000-0000-0000-000000000002';
  fs.mkdirSync(titlesIn(root), { recursive: true });
  fs.mkdirSync(titlesIn(home), { recursive: true });
  fs.writeFileSync(path.join(titlesIn(root), `${sid}.txt`), 'Scope — Goal');

  const homedir = os.homedir;
  os.homedir = () => home;
  try {
    const resolved = resolveTitlesDir(root, sid);
    assert.strictEqual(resolved, titlesIn(root), 'resolved away from the session state');
  } finally {
    os.homedir = homedir;
  }
});

test('a non-SessionEnd payload writes nothing', () => {
  // A live session stamped .closed by a stray event would be silently dropped from the restore
  // roster — the exact bug the marker exists to prevent, inverted.
  const root = tmpdir('wrongevent');
  const sid = 'aaaaaaaa-0000-0000-0000-000000000003';
  fs.mkdirSync(titlesIn(root), { recursive: true });
  fs.writeFileSync(path.join(titlesIn(root), `${sid}.session.json`), '{}');

  const r = runHook(
    { hook_event_name: 'Stop', session_id: sid, cwd: root },
    { CLAUDE_PROJECT_DIR: root },
  );
  assert.strictEqual(r.status, 0);
  assert.ok(
    !fs.existsSync(path.join(titlesIn(root), `${sid}.closed`)),
    'a Stop payload must not mark the session closed',
  );
});

test('malformed stdin and a missing session_id both exit 0 without writing', () => {
  const root = tmpdir('malformed');
  fs.mkdirSync(titlesIn(root), { recursive: true });

  const garbage = spawnSync(process.execPath, [HOOK], {
    input: 'not json at all',
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  assert.strictEqual(garbage.status, 0, 'must not fail the quit on a bad payload');

  const nosid = runHook({ hook_event_name: 'SessionEnd', cwd: root }, { CLAUDE_PROJECT_DIR: root });
  assert.strictEqual(nosid.status, 0);
  assert.strictEqual(
    fs.readdirSync(titlesIn(root)).length, 0,
    'no session_id means nothing to key a marker to',
  );
});

test('the last SessionEnd wins', () => {
  // One terminal can end twice: /clear, then a real quit. The latest reason is the true one.
  const root = tmpdir('rewrite');
  const sid = 'aaaaaaaa-0000-0000-0000-000000000004';
  fs.mkdirSync(titlesIn(root), { recursive: true });
  fs.writeFileSync(path.join(titlesIn(root), `${sid}.session.json`), '{}');

  runHook({ hook_event_name: 'SessionEnd', session_id: sid, cwd: root, reason: 'clear' }, { CLAUDE_PROJECT_DIR: root });
  runHook({ hook_event_name: 'SessionEnd', session_id: sid, cwd: root, reason: 'logout' }, { CLAUDE_PROJECT_DIR: root });

  const body = JSON.parse(fs.readFileSync(path.join(titlesIn(root), `${sid}.closed`), 'utf8'));
  assert.strictEqual(body.reason, 'logout');
});

test('markerBody defaults a missing reason rather than emitting undefined', () => {
  const body = JSON.parse(markerBody({ cwd: 'C:\\x' }, 'sid-1'));
  assert.strictEqual(body.reason, 'other');
  assert.strictEqual(body.transcript, '');
});
