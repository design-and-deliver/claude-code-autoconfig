// Official-usage fetch (substep 1.3, 2026-07-24): the impersonated client version is
// DERIVED from the running install (EXECPATH package.json → AI_AGENT stamp → dated pin),
// no longer a hand-rotated literal — and the fetch itself degrades silently: any failure
// (no credentials, network down, non-OK response) returns null/stale, never a throw.
// Run: node --test token-guard-official-usage.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');
const { claudeCodeUA, fetchOfficialUsage } = require(HOOK);

function tmpDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

// Every fetch test runs with os.homedir + global.fetch swapped out, so no test can read the
// dev box's real credentials or touch the real endpoint. Restored even on assertion failure.
async function withIsolation({ home, fetch }, fn) {
  const realHomedir = os.homedir;
  const realFetch = global.fetch;
  os.homedir = () => home;
  global.fetch = fetch;
  try { return await fn(); } finally {
    os.homedir = realHomedir;
    global.fetch = realFetch;
  }
}

const NO_NETWORK = async () => { throw new Error('network must not be touched'); };

// ---------- claudeCodeUA(): the derivation ladder ----------

test('claudeCodeUA derives from the package.json above CLAUDE_CODE_EXECPATH', () => {
  const root = tmpDir('tg-ua-');
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'),
    JSON.stringify({ name: '@anthropic-ai/claude-code', version: '9.9.9' }));
  const ua = claudeCodeUA({ CLAUDE_CODE_EXECPATH: path.join(root, 'bin', 'claude.exe') });
  assert.strictEqual(ua, 'claude-code/9.9.9');
});

test('claudeCodeUA refuses a foreign package.json (name check)', () => {
  const root = tmpDir('tg-ua-');
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'),
    JSON.stringify({ name: 'not-claude-code', version: '1.0.0' }));
  const ua = claudeCodeUA({ CLAUDE_CODE_EXECPATH: path.join(root, 'bin', 'claude') });
  assert.notStrictEqual(ua, 'claude-code/1.0.0');
  assert.match(ua, /^claude-code\/\d+\.\d+\.\d+$/);
});

test('claudeCodeUA refuses a non-semver version', () => {
  const root = tmpDir('tg-ua-');
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'),
    JSON.stringify({ name: '@anthropic-ai/claude-code', version: 'file:../evil' }));
  const ua = claudeCodeUA({ CLAUDE_CODE_EXECPATH: path.join(root, 'bin', 'claude') });
  assert.match(ua, /^claude-code\/\d+\.\d+\.\d+$/);
});

test('claudeCodeUA missing/unreadable EXECPATH falls through to the AI_AGENT stamp', () => {
  const ua = claudeCodeUA({
    CLAUDE_CODE_EXECPATH: path.join(tmpDir('tg-ua-'), 'gone', 'bin', 'claude'),
    AI_AGENT: 'claude-code_3-4-5_agent',
  });
  assert.strictEqual(ua, 'claude-code/3.4.5');
});

test('claudeCodeUA ignores a non-claude-code AI_AGENT stamp', () => {
  const ua = claudeCodeUA({ AI_AGENT: 'some-other-tool_1-2-3_agent' });
  assert.match(ua, /^claude-code\/\d+\.\d+\.\d+$/);
  assert.notStrictEqual(ua, 'claude-code/1.2.3');
});

test('claudeCodeUA with nothing to go on returns the dated pin, semver-shaped', () => {
  // Shape only, not the exact value — re-pinning per the rotation rule must not break this.
  assert.match(claudeCodeUA({}), /^claude-code\/\d+\.\d+\.\d+$/);
});

// ---------- fetchOfficialUsage(): silent degradation ----------

test('fetchOfficialUsage with no credentials returns null, never throws', async () => {
  const out = await withIsolation({ home: tmpDir('tg-home-'), fetch: NO_NETWORK }, () =>
    fetchOfficialUsage(tmpDir('tg-proj-')));
  assert.strictEqual(out, null);
});

test('fetchOfficialUsage network failure returns null, never throws', async () => {
  const home = tmpDir('tg-home-');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'test-token-not-real' } }));
  const out = await withIsolation({ home, fetch: async () => { throw new Error('boom'); } }, () =>
    fetchOfficialUsage(tmpDir('tg-proj-')));
  assert.strictEqual(out, null);
});

test('fetchOfficialUsage non-OK response falls back to the stale cache', async () => {
  const home = tmpDir('tg-home-');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'test-token-not-real' } }));
  const proj = tmpDir('tg-proj-');
  const state = path.join(proj, '.claude', 'hooks', '.token-guard');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'official-usage.json'),
    JSON.stringify({ at: Date.now() - 10 * 60 * 1000, data: { marker: 'stale-cache' } }));
  const out = await withIsolation({ home, fetch: async () => ({ ok: false }) }, () =>
    fetchOfficialUsage(proj));
  assert.ok(out && out.stale, 'expected the stale-cache fallback');
  assert.strictEqual(out.data.marker, 'stale-cache');
});

test('fetchOfficialUsage serves a fresh cache without touching network or credentials', async () => {
  const proj = tmpDir('tg-proj-');
  const state = path.join(proj, '.claude', 'hooks', '.token-guard');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'official-usage.json'),
    JSON.stringify({ at: Date.now(), data: { marker: 'fresh-cache' } }));
  const out = await withIsolation({ home: tmpDir('tg-home-'), fetch: NO_NETWORK }, () =>
    fetchOfficialUsage(proj));
  assert.ok(out && !out.stale);
  assert.strictEqual(out.data.marker, 'fresh-cache');
});
