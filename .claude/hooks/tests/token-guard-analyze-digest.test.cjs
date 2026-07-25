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

// The substep-done recap convention quotes this line verbatim into plan Ledgers — pin its
// wording and the split math (fixture: 100k cache reads of 108.2k total → 92%; effective
// = 5000 inp + 700 out + 2500 cw + 100k*0.1 cr = 18.2k).
test('--analyze TOTALS breaks out the cached re-read share and effective spend', () => {
  const { out } = runAnalyze();
  assert.ok(out.includes('92% cached re-reads (billed at 0.1x input)'),
    `digest is missing the cached re-read share line\n--- output ---\n${out}`);
  assert.ok(out.includes('effective ≈ 18k token-equivalents'),
    `digest is missing the effective token-equivalents figure\n--- output ---\n${out}`);
});

// resolveTranscript accepts every form a user actually pastes: the bare sid8, and the whole
// "project/sid8" row label /usage-report prints (the form that used to fail with "no
// transcript matches" — 2026-07-25). Subprocess with HOME/USERPROFILE redirected to a fake
// ~/.claude/projects tree; the fixture's first line carries cwd so projectNameOf labels the
// hit "testproj/<sid8>".
const SID = '1a2b3c4d-1111-2222-3333-444455556666';
function mkResolveHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-resolve-'));
  const projDir = path.join(home, '.claude', 'projects', 'C--CODE-testproj');
  fs.mkdirSync(projDir, { recursive: true });
  const cwdLine = JSON.stringify({ type: 'user', timestamp: '2026-07-20T17:58:00.000Z',
    cwd: '/CODE/testproj', message: { role: 'user', content: 'hi' } });
  fs.writeFileSync(path.join(projDir, SID + '.jsonl'), cwdLine + '\n' + TRANSCRIPT);
  return home;
}
function runResolve(arg, home) {
  const r = spawnSync(process.execPath, [HOOK, '--analyze', arg],
    { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('--analyze resolves a bare sid8 prefix', () => {
  const home = mkResolveHome();
  try {
    const { status, out } = runResolve(SID.slice(0, 8), home);
    assert.strictEqual(status, 0);
    assert.ok(out.includes('SESSION'), `bare sid8 should resolve to a digest\n--- output ---\n${out}`);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('--analyze resolves the project/sid8 label form /usage-report prints', () => {
  const home = mkResolveHome();
  try {
    const { out } = runResolve(`testproj/${SID.slice(0, 8)}`, home);
    assert.ok(out.includes('SESSION'), `project/sid8 label should resolve to a digest\n--- output ---\n${out}`);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('--analyze project/sid8 with the wrong project name does not match', () => {
  const home = mkResolveHome();
  try {
    const { out } = runResolve(`otherproj/${SID.slice(0, 8)}`, home);
    assert.ok(out.includes('no transcript matches'),
      `a wrong project name must not resolve\n--- output ---\n${out}`);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
