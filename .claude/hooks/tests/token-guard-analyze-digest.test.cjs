// token-guard --analyze digest snapshot — pins the machine-interface literals.
// Run: node --test token-guard-analyze-digest.test.cjs
//
// The `--analyze` digest is NOT just display text: /analyze-session (analyze-session.md)
// parses ONLY this output and keys on the literal section headers RENT / BOMBS / FLEETS /
// TTL plus the phrase "live context at end" (see token-guard.js renderAnalysis comment and
// CLAUDE.md trap T2). Rewording any of them silently breaks /analyze-session — this test
// makes that a loud failure, pinned before token-guard ever un-gates.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');

// A minimal but valid transcript: two assistant requests carrying `usage` (so the RENT
// section — the only header gated on request count — renders) plus a user/tool_result
// line. BOMBS / FLEETS / TTL / "live context at end" always render.
const TRANSCRIPT = [
  { type: 'user', timestamp: '2026-07-20T17:59:00.000Z', message: { role: 'user', content: 'hello' } },
  { type: 'assistant', timestamp: '2026-07-20T18:00:00.000Z',
    message: { id: 'msg_1', model: 'claude-opus-4-8',
      usage: { input_tokens: 2000, cache_read_input_tokens: 40000, cache_creation_input_tokens: 1000, output_tokens: 300 } } },
  { type: 'user', timestamp: '2026-07-20T18:01:00.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
  { type: 'assistant', timestamp: '2026-07-20T18:02:00.000Z',
    message: { id: 'msg_2', model: 'claude-opus-4-8',
      usage: { input_tokens: 3000, cache_read_input_tokens: 60000, cache_creation_input_tokens: 1500, output_tokens: 400 } } },
].map(o => JSON.stringify(o)).join('\n') + '\n';

function runAnalyze() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-analyze-'));
  const fp = path.join(dir, 'session.jsonl');
  fs.writeFileSync(fp, TRANSCRIPT);
  try {
    const r = spawnSync(process.execPath, [HOOK, '--analyze', fp], { cwd: dir, encoding: 'utf8' });
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('--analyze exits 0 and emits the machine-interface digest headers', () => {
  const { status, out } = runAnalyze();
  assert.strictEqual(status, 0, `--analyze should exit 0, got ${status}\n${out}`);
  for (const literal of ['RENT', 'BOMBS', 'FLEETS', 'TTL', 'live context at end']) {
    assert.ok(out.includes(literal),
      `--analyze digest is missing the literal "${literal}" that /analyze-session parses (trap T2)\n--- output ---\n${out}`);
  }
});
