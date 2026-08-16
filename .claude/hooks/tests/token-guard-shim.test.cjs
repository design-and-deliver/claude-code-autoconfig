// Remote-verdict shim — the dark-by-default contract. Unconfigured (no verdictService /
// verdictServiceKey — every install today), the shim adds NOTHING: no cache file, no child
// spawn, no note; the local guard chain is the whole path. Configured, each prompt posts
// counters fire-and-forget and renders the PREVIOUS post's verdicts (one-turn lag by
// design), failing open to the basic free-tier note when the service is dark. The cache
// file shape asserted here is an interface: statusline-cost.js may read it, and shimHealth
// is the canary's offline-vs-dead second axis.
// Run: node --test token-guard-shim.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');
const tg = require(HOOK);

const SID = 'sid-shim';

const usageLine = (id, inp) => JSON.stringify({ type: 'assistant',
  message: { id, model: 'claude-fable-5', usage: { input_tokens: inp, output_tokens: 10 } } }) + '\n';

function mkFixture(guardCfg) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'tgshim-'));
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'cca.config.json'),
    JSON.stringify({ tokenGuard: guardCfg || {} }));
  const tp = path.join(proj, 'main.jsonl');
  fs.writeFileSync(tp, usageLine('m1', 1000));
  // Isolated home — never the real one (live credentials).
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tgshim-home-'));
  return { proj, home, tp };
}

function promptSubmit(fix) {
  const env = Object.assign({}, process.env, {
    CLAUDE_PROJECT_DIR: fix.proj, USERPROFILE: fix.home, HOME: fix.home,
    ANTHROPIC_API_KEY: 'sk-test',
  });
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ session_id: SID, transcript_path: fix.tp,
      hook_event_name: 'UserPromptSubmit', prompt: 'hi' }),
    encoding: 'utf8', env, timeout: 20000,
  });
  return r.stdout || '';
}

const stateDirOf = fix => path.join(fix.proj, '.claude', 'hooks', '.token-guard');
const cacheFileOf = fix => path.join(stateDirOf(fix), `verdict-cache-${SID}.json`);
const noteOf = raw => ((JSON.parse(raw || '{}').hookSpecificOutput || {}).additionalContext) || '';

async function waitFor(pred, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return pred();
}

test('dark by default — no service config means no cache, no post file, no shim note', () => {
  const fix = mkFixture();
  const note = noteOf(promptSubmit(fix));
  assert.ok(!fs.existsSync(cacheFileOf(fix)), 'unconfigured shim must never write a verdict cache');
  const leftovers = fs.existsSync(stateDirOf(fix))
    ? fs.readdirSync(stateDirOf(fix)).filter(n => n.startsWith('verdict-')) : [];
  assert.deepEqual(leftovers, [], 'unconfigured shim must leave no verdict-* files behind');
  assert.doesNotMatch(note, /context-size note/, 'the free-tier floor belongs to the configured shim only');
});

test('configured shim posts counters and renders the previous response next prompt', async () => {
  let received = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      received = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ schemaVersion: 1, verdicts: [{ rule: 'R6', text: 'SERVER-NOTE-XYZ' }] }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/cca`;
    const fix = mkFixture({ verdictService: url, verdictServiceKey: 'k-test' });

    const first = noteOf(promptSubmit(fix));
    assert.doesNotMatch(first, /SERVER-NOTE-XYZ/, 'the first prompt has no cache yet — one-turn lag is the contract');

    assert.ok(await waitFor(() => received !== null, 5000), 'the detached child must deliver the post');
    assert.equal(received.schemaVersion, 1);
    assert.equal(received.license.key, 'k-test');
    assert.equal(received.gates[0].name, 'session', 'v1 sends the session gate family');
    assert.equal(typeof received.gates[0].observed, 'number');
    assert.equal(typeof received.drift.liveContext, 'number');
    assert.ok(Array.isArray(received.drift.tenures));

    assert.ok(await waitFor(() => fs.existsSync(cacheFileOf(fix)), 5000), 'the child must write the cache');
    const cached = JSON.parse(fs.readFileSync(cacheFileOf(fix), 'utf8'));
    assert.equal(cached.post.ok, true);
    assert.equal(cached.post.status, 200);

    assert.match(noteOf(promptSubmit(fix)), /SERVER-NOTE-XYZ/, 'the second prompt renders the cached verdict');
  } finally { server.close(); }
});

test('unreachable service fails open — hook exits clean, cache records offline, guard stays live', async () => {
  const fix = mkFixture({ verdictService: 'http://127.0.0.1:9/api/cca', verdictServiceKey: 'k-test' });
  const raw = promptSubmit(fix);
  assert.doesNotMatch(raw, /"decision"\s*:\s*"block"/, 'the shim must never block a prompt');
  assert.ok(await waitFor(() => fs.existsSync(cacheFileOf(fix)), 8000),
    'even a refused socket must leave an ok:false record');
  const cached = JSON.parse(fs.readFileSync(cacheFileOf(fix), 'utf8'));
  assert.equal(cached.post.ok, false);
  const cfg = tg.resolveConfig({ verdictService: 'x', verdictServiceKey: 'y' });
  assert.equal(tg.shimHealth(fix.proj, SID, cfg), 'offline',
    'offline (guard live, service dark) must be distinguishable from a dead guard');
  assert.ok(fs.existsSync(path.join(stateDirOf(fix), `${SID}.json`)),
    'the state write is the liveness signal — a dead guard writes nothing');
});

test('a stale cache renders nothing and reads as stale', () => {
  const fix = mkFixture({ verdictService: 'http://127.0.0.1:9/api/cca', verdictServiceKey: 'k-test' });
  fs.mkdirSync(stateDirOf(fix), { recursive: true });
  fs.writeFileSync(cacheFileOf(fix), JSON.stringify({ v: 1, sid: SID,
    at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    post: { ok: true, status: 200 }, verdicts: [{ rule: 'R6', text: 'STALE-NOTE' }] }));
  assert.doesNotMatch(noteOf(promptSubmit(fix)), /STALE-NOTE/, 'aged-out verdicts must go dark, not linger');
  const cfg = tg.resolveConfig({ verdictService: 'x', verdictServiceKey: 'y' });
  assert.equal(tg.shimHealth(fix.proj, SID, cfg), 'stale');
});

test('freeTierNote is the floor: fires on the context axis, quiet below the bar, remedy named', () => {
  const cfg = tg.resolveConfig({});
  const note = tg.freeTierNote(200000, cfg);
  assert.match(note, /~200k of context/);
  assert.match(note, /\/clear then \/continue/);
  assert.equal(tg.freeTierNote(100000, cfg), null, 'under contextWarnTokens the floor stays quiet');
  assert.equal(tg.freeTierNote(200000, Object.assign({}, cfg, { contextWarnTokens: null })), null,
    'a null threshold disables the floor');
});

test('renderCachedVerdicts renders text-bearing verdicts only', () => {
  assert.deepEqual(tg.renderCachedVerdicts({ verdicts: [
    { rule: 'a', text: 'one' }, { rule: 'b' }, null, { rule: 'c', text: '' }, { rule: 'd', text: 'two' },
  ] }), ['one', 'two']);
  assert.deepEqual(tg.renderCachedVerdicts(null), []);
});

test('the cache lives in the state dir under a pinned name — statusline may read it', () => {
  assert.equal(tg.verdictCachePath('/p', 's'),
    path.join('/p', '.claude', 'hooks', '.token-guard', 'verdict-cache-s.json'));
});

test('the library surface statusline-cost.js requires is intact, plus the shim additions', () => {
  for (const k of ['meterSession', 'coldStartTokens', 'resolveConfig', 'findActivePlan',
    'findCurrentSubstep', 'parsePlanLedger',
    'shimActive', 'collectVerdictCounters', 'readVerdictCache', 'renderCachedVerdicts',
    'freeTierNote', 'shimHealth', 'remoteVerdictGuard']) {
    assert.equal(typeof tg[k], 'function', `token-guard must export ${k}`);
  }
});
