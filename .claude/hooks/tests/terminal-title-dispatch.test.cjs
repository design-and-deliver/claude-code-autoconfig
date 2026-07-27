// Explicit Stop dispatch: handle() matches UserPromptSubmit / PostToolUse / SessionStart /
// Notification, and everything else used to FALL THROUGH to the Stop path — so any unknown or
// future hook event painted the tab ✻ idle mid-turn. The guard makes Stop explicit: an unknown
// event exits 0 quietly — no emit, no glyph write.
// Run: node --test terminal-title-dispatch.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.resolve(__dirname, '..', 'terminal-title.js');

// A throwaway project dir the hook anchors its .titles state to (via CLAUDE_PROJECT_DIR). The
// .titles dir is pre-created because setTitle's glyph write is fail-silent — without the dir,
// the "did it paint?" observable would vanish instead of failing.
function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-dispatch-'));
  fs.mkdirSync(path.join(dir, '.claude', 'hooks', '.titles'), { recursive: true });
  return dir;
}

// A minimal fully-flushed transcript: the last assistant message has text and ends on a
// statement, so the Stop grade resolves on the first read (no flush-race re-read loop).
function tmpTranscript(dir) {
  const p = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(p, JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'All done.' }] },
  }) + '\n');
  return p;
}

function runHook(projDir, payload) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projDir },
    encoding: 'utf8',
    timeout: 20000,
  });
}

function glyphOf(projDir, sid) {
  const p = path.join(projDir, '.claude', 'hooks', '.titles', `${sid}.glyph`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

test('an unknown hook event does not reach the Stop path (no emit, no glyph)', () => {
  const dir = tmpProject();
  const r = runHook(dir, {
    hook_event_name: 'SomeFutureEvent',
    session_id: 'sid-unknown',
    cwd: dir,
    transcript_path: tmpTranscript(dir),
  });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '', 'must emit nothing for an unknown event');
  assert.strictEqual(glyphOf(dir, 'sid-unknown'), null, 'must not persist a glyph for an unknown event');
});

test('Stop still dispatches the Stop path (paints idle on a statement turn)', () => {
  const dir = tmpProject();
  const r = runHook(dir, {
    hook_event_name: 'Stop',
    session_id: 'sid-stop',
    cwd: dir,
    transcript_path: tmpTranscript(dir),
  });
  assert.strictEqual(r.status, 0);
  assert.ok(r.stdout.length > 0, 'Stop must emit a hook payload');
  const glyph = glyphOf(dir, 'sid-stop');
  assert.ok(glyph && glyph.startsWith('idle|Stop'), `Stop on a statement turn paints idle (got ${glyph})`);
});
