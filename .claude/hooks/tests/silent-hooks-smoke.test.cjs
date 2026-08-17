// Smoke tests for the three "silent" hooks — arcade-beeps.js, format.js, feedback-rule-check.js.
// Each swallows all errors and exits 0 no matter what (by design, so a regression can never
// crash a turn). That also means a regression is INVISIBLE. These tests convert "swallowed
// forever" into an assertable observable: exit code + a log line / stdout / a filesystem effect.
//
// Run: node --test silent-hooks-smoke.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS = path.resolve(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────────
// format.js — PostToolUse(Write|Edit): runs `npm run format` for source files, skips others.
// Observable: a fixture whose `format` script writes a sentinel proves whether it ran.
// ─────────────────────────────────────────────────────────────────────────────
const FORMAT_HOOK = path.join(HOOKS, 'format.js');

function tmpFormatProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fmt-'));
  // A minimal package.json whose `format` script writes a sentinel next to it. Using a separate
  // script file (not `node -e "..."`) avoids cross-platform nested-quote breakage.
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'fmt-fixture', version: '0.0.0', private: true,
    scripts: { format: 'node fmt-sentinel.js' },
  }));
  fs.writeFileSync(path.join(dir, 'fmt-sentinel.js'), "require('fs').writeFileSync('formatted.sentinel', 'ok');\n");
  return dir;
}

// format.js reads process.cwd() for the formatter's cwd, so the fixture dir must be the child's cwd.
function runFormat(dir, filePath) {
  return spawnSync(process.execPath, [FORMAT_HOOK], {
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    cwd: dir,
    env: { ...process.env },
    encoding: 'utf8',
  });
}
function formatRan(dir) { return fs.existsSync(path.join(dir, 'formatted.sentinel')); }

test('format.js runs the project formatter for a source file', () => {
  const dir = tmpFormatProject();
  const r = runFormat(dir, path.join(dir, 'src.js'));
  assert.strictEqual(r.status, 0);
  assert.ok(formatRan(dir), 'the format script should have run for a .js file');
});

test('format.js skips non-source files (no formatter run)', () => {
  const dir = tmpFormatProject();
  const r = runFormat(dir, path.join(dir, 'image.png'));
  assert.strictEqual(r.status, 0);
  assert.ok(!formatRan(dir), 'the format script must NOT run for a .png');
});

test('format.js skips node_modules paths', () => {
  const dir = tmpFormatProject();
  const r = runFormat(dir, path.join(dir, 'node_modules', 'pkg', 'index.js'));
  assert.strictEqual(r.status, 0);
  assert.ok(!formatRan(dir), 'the format script must NOT run for files under node_modules');
});

test('format.js exits 0 on malformed stdin', () => {
  const r = spawnSync(process.execPath, [FORMAT_HOOK], { input: 'not json{', encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// feedback-rule-check.js — PostToolUse(Write|Edit): prints migration guidance, but ONLY when
// the edited file is FEEDBACK.md. Observable: stdout.
// ─────────────────────────────────────────────────────────────────────────────
const FRC_HOOK = path.join(HOOKS, 'feedback-rule-check.js');

function runFrc(filePath) {
  return spawnSync(process.execPath, [FRC_HOOK], {
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    encoding: 'utf8',
  });
}

test('feedback-rule-check emits migration guidance when FEEDBACK.md is edited', () => {
  const r = runFrc('/proj/.claude/feedback/FEEDBACK.md');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /FEEDBACK\.md was just modified\./);
  assert.match(r.stdout, /\.claude\/rules\//, 'guidance should point at .claude/rules/');
});

test('feedback-rule-check is silent for non-FEEDBACK files', () => {
  const r = runFrc('/proj/src/app.js');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.trim(), '', 'must produce no output for a non-FEEDBACK.md edit');
});

test('feedback-rule-check exits 0 on malformed stdin', () => {
  const r = spawnSync(process.execPath, [FRC_HOOK], { input: 'not json{', encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// arcade-beeps.js — Stop/Notification: opt-in Pole-Position status cues. It logs every
// invocation to <home>/.claude/hooks/.titles/arcade-beeps.log BEFORE deciding to play.
// We drive only NON-Stop/Notification events, which return before any playback (arcade-beeps.js
// returns at `if (event !== 'Stop') return`), so this is deterministic and audio-free regardless
// of whether this machine has the opt-in flag (.claude/sounds/status-beeps.enabled) present.
// ─────────────────────────────────────────────────────────────────────────────
const BEEPS_HOOK = path.join(HOOKS, 'arcade-beeps.js');

function tmpHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beeps-home-'));
  // arcade-beeps.js's logLine() appends but never mkdirs — pre-create the .titles dir so the
  // diagnostic log is actually written (and lands under our temp home, not the real ~/.claude).
  fs.mkdirSync(path.join(dir, '.claude', 'hooks', '.titles'), { recursive: true });
  return dir;
}
// os.homedir() reads USERPROFILE on Windows, HOME on POSIX — set both to redirect the log.
function runBeeps(home, payload, raw) {
  return spawnSync(process.execPath, [BEEPS_HOOK], {
    input: raw !== undefined ? raw : JSON.stringify(payload),
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
  });
}
function beepsLog(home) {
  const p = path.join(home, '.claude', 'hooks', '.titles', 'arcade-beeps.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

test('arcade-beeps logs every invocation and never plays on a non-Stop event', () => {
  const home = tmpHome();
  const r = runBeeps(home, { hook_event_name: 'SessionStart', session_id: 's1' });
  assert.strictEqual(r.status, 0);
  const log = beepsLog(home);
  assert.match(log, /invoked event=SessionStart enabled=[01]/, 'the invocation should be recorded in the diagnostic log');
  assert.ok(!/\bplay /.test(log), 'must not attempt playback on a non-Stop/Notification event');
});

test('arcade-beeps exits 0 on malformed stdin', () => {
  const home = tmpHome();
  const r = runBeeps(home, null, 'not json{');
  assert.strictEqual(r.status, 0);
  assert.ok(!/\bplay /.test(beepsLog(home)), 'malformed input (event="?") must not play');
});

// spawnSync reports a failed player by RETURNING it, so the `play ...` log line alone can claim
// a beep that never sounded. spawnFailure() is what turns those two silent outcomes into a
// `play-failed` line; drive it directly rather than trying to break a real audio player.
test('arcade-beeps spawnFailure names both silent playback failures', () => {
  const { spawnFailure } = require(BEEPS_HOOK);
  assert.strictEqual(spawnFailure({ error: { code: 'ENOENT' }, status: null }), 'ENOENT',
    'a missing player binary arrives on r.error, never as a throw');
  assert.strictEqual(spawnFailure({ error: null, status: 1 }), 'exit=1',
    'a player that ran and failed arrives as a non-zero r.status');
  assert.strictEqual(spawnFailure({ error: null, status: 0 }), null,
    'a clean play must stay silent in the log');
});
