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

// The line above only proves the floor stays quiet on a THIN fixture, where freeTierNote returns
// null anyway — so it passed right through a change that made the no-service branch reach the
// floor (2026-08-21). Fatten the context and the two halves of the contract separate: a dark
// install is not silent (the local context axis survives the forward-delete), and it does not
// say the same thing twice. The duplicate mattered beyond copy: the floor's wording names
// `/clear`, so a second one every prompt floods R19's restart-advice log with notes, not cards.
test('a FAT dark install gets the local context warning — and NOT a second one from the floor', () => {
  const fix = mkFixture();
  fs.appendFileSync(fix.tp, usageLine('m2', 300000));
  const note = noteOf(promptSubmit(fix));
  assert.match(note, /live context ≈ 300k/, 'unconfigured must not be silent on the context axis');
  assert.doesNotMatch(note, /context-size note/, 'the floor must not stack onto the local warning');
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
    // Every prompt-path family travels, present even when this fixture's meter is dark —
    // an absent family means "the client cannot decide this", not "nothing happened".
    assert.deepEqual(Object.keys(received.window).sort(),
      ['lastTurnUsd', 'now5h', 'prev', 'warnedGlobal', 'warnedSession', 'worst']);
    assert.deepEqual(Object.keys(received.meterCanary).sort(), ['off', 'warnedAt']);
    assert.equal(typeof received.spendSteps.billingKind, 'string');
    assert.equal(typeof received.spendSteps.sessionTokens, 'number');

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

// ── Field-only verdicts (2026-08-18) ────────────────────────────────────────────────────────
// The endpoint attaches `text` for only 3 of its rules; the rest return verdict FIELDS,
// deliberately, because their copy needs client-side data the server never sees (the local
// spend ledger, the live 5h window, the sid, the session meter). Those verdicts used to be
// dropped on the floor. The dispatch table words them through the surviving client renderers.
const renderCtx = (fix, cfgOver) => ({
  cfg: tg.resolveConfig(Object.assign({ planDetect: false }, cfgOver)),
  sid: SID, projectDir: fix.proj, usd$: false, st: {},
  m: tg.meterSession(fix.tp, {}), official: null, priorWindowAtIso: null,
});

test('field-only verdicts render through the client copy — one case per dispatched rule', () => {
  const ctx = renderCtx(mkFixture());
  const one = (v) => {
    const out = tg.renderCachedVerdicts({ verdicts: [v] }, ctx);
    assert.equal(out.length, 1, `${v.rule} must render exactly one note`);
    return out[0];
  };

  assert.match(one({ rule: 'R21', n: 3, tok: 120000, usd: 1.2, prompted: 0, promptedTok: 0 }),
    /recovery-cost: 3 self-initiated recoveries/,
    'R21 is the regression case — a cached recovery verdict produced NOTHING before the dispatch');
  assert.match(one({ rule: 'R12b', name: '5-hour window', pct: 82, rung: 80, topRung: 90, resetsAt: null }),
    /window-threshold: .*~82% used/);
  assert.match(one({ rule: 'R12a', fire: true, spikePct: 14, fromPct: 40, toPct: 54, estimated: false }),
    /^window-spike/);
  assert.match(one({ rule: 'spend-steps', crossed: [10], billingKind: 'api' }), /^token check-in:/);
});

// The point of the dispatch: the server decides, the CLIENT words it — using state the server
// never receives. windowSpikeConfirm is exactly that, and it picks between two different copies.
test('R12a is worded from client-side state, not from the cached verdict alone', () => {
  const fix = mkFixture();
  const spike = { rule: 'R12a', fire: true, spikePct: 14, fromPct: 40, toPct: 54, estimated: false };
  const render = cfgOver => tg.renderCachedVerdicts({ verdicts: [spike] }, renderCtx(fix, cfgOver))[0];

  const card = render({ windowSpikeConfirm: true });
  assert.match(card, /^window-spike\(confirm\):/, 'the confirm toggle is client-side — the service cannot know it');
  assert.match(card, new RegExp(`/analyze-session ${SID}`), 'the sid is threaded in at render time');

  assert.match(render({ windowSpikeConfirm: false }), /^window-spike: /,
    'toggle off renders the passive note instead — same verdict, different client copy');
});

test('PreToolUse rules and unknown rules render nothing, and a bad verdict never throws', () => {
  const ctx = renderCtx(mkFixture());
  // Two guard folds, and only PROMPT_GUARDS has a notes channel. The spend gates, R8, R10,
  // R18 and restart all return a blocking ask/deny from PreToolUse — a cached verdict has
  // nowhere to render there, so they are deliberately absent from the dispatch table.
  for (const rule of ['gate', 'R8', 'R10', 'R18', 'restart']) {
    assert.deepEqual(tg.renderCachedVerdicts({ verdicts: [{ rule, name: 'session' }] }, ctx), [],
      `${rule} fires from PreToolUse and must not surface as a prompt note`);
  }
  assert.deepEqual(tg.renderCachedVerdicts({ verdicts: [{ rule: 'R99-from-the-future' }] }, ctx), [],
    'a newer service than this client renders nothing — additive-only cuts both ways');
  assert.doesNotThrow(() => tg.renderCachedVerdicts({ verdicts: [{ rule: 'R21' }] }, ctx),
    'a renderer handed junk fails open to silence, never to a dead hook');
});

test('server-worded text wins, and the client\'s own switch still governs', () => {
  const fix = mkFixture();
  assert.deepEqual(tg.renderCachedVerdicts(
    { verdicts: [{ rule: 'R21', text: 'SERVER-WORDED', n: 1, tok: 1 }] }, renderCtx(fix)),
  ['SERVER-WORDED'], 'a rule that ships text must never be re-worded by the client');

  assert.deepEqual(tg.renderCachedVerdicts(
    { verdicts: [{ rule: 'R21', n: 3, tok: 120000, usd: 1.2, prompted: 0 }] },
    renderCtx(fix, { recoveryWasteTokens: null })),
  [], 'a family the user turned off locally stays off, whatever the service decided');
});

test('without ctx only server-worded verdicts render — the statusline\'s honest subset', () => {
  assert.deepEqual(tg.renderCachedVerdicts({ verdicts: [
    { rule: 'R6', text: 'one' }, { rule: 'R21', n: 3, tok: 120000, usd: 1.2, prompted: 0 },
  ] }), ['one']);
});

test('the cache lives in the state dir under a pinned name — statusline may read it', () => {
  assert.equal(tg.verdictCachePath('/p', 's'),
    path.join('/p', '.claude', 'hooks', '.token-guard', 'verdict-cache-s.json'));
});

// ── Prompt-path counter families (2026-08-18) ────────────────────────────────────────────────
// remoteVerdictGuard runs LAST in PROMPT_GUARDS, so by the time the reducer runs, r12a/r12b/
// spendStepGuard have already advanced the very state their verdicts are decided FROM. The
// reducer posts a pre-fold snapshot instead; reading `st` live would tell the service
// "already warned" about every family at once, and forwarding would answer nothing — silently.
const counterCtx = (fix, over) => Object.assign({
  cfg: tg.resolveConfig({}), sid: SID, projectDir: fix.proj,
  m: tg.meterSession(fix.tp, {}), official: null, officialOff: null, st: {},
}, over);

const PRIOR_ZERO = { window: null, windowWarns: {}, warnedWindow: null,
  warnedTok: 0, warnedUSD: 0, meterCanaryAt: null };

test('the counters reducer posts pre-fold state, not the state the guards just advanced', () => {
  const body = tg.collectVerdictCounters(counterCtx(mkFixture(), {
    // what the fold LEFT behind: the spike baseline moved to now, both ladders already fired
    st: { lastWindowPct: 61, lastWindowResetsAt: 'later', warnedTok: 6000000, warnedUSD: 30,
      warnedWindow: { name: '5h window', rung: 80 } },
    prior: Object.assign({}, PRIOR_ZERO, { window: { pct: 47, resetsAt: 'earlier' } }),
  }));

  assert.deepEqual(body.window.prev, { pct: 47, resetsAt: 'earlier' },
    'the spike baseline must be the one r12a REPLACED — posting the one it wrote is a delta of 0');
  assert.equal(body.window.warnedSession, null,
    "r12b's own fire this turn must not suppress the verdict being forwarded");
  assert.equal(body.spendSteps.warnedTok, 0, 'ditto the spend ladder — the crossing is the news');
  assert.equal(body.spendSteps.warnedUSD, 0);
});

test('without a snapshot the reducer falls back to live state — standalone callers still work', () => {
  const body = tg.collectVerdictCounters(counterCtx(mkFixture(), {
    st: { warnedTok: 1234, lastWindowPct: 12, lastWindowResetsAt: 'r' },
  }));
  assert.equal(body.spendSteps.warnedTok, 1234, 'outside the fold there is nothing to have advanced');
  assert.deepEqual(body.window.prev, { pct: 12, resetsAt: 'r' });
});

test('snapshotPriorGuardState reads the state the guards are about to move', () => {
  const prior = tg.snapshotPriorGuardState(counterCtx(mkFixture(), {
    st: { lastWindowPct: 5, warnedTok: 7, warnedUSD: 9 },
  }));
  assert.deepEqual(prior.window, { pct: 5, resetsAt: '' });
  assert.equal(prior.warnedTok, 7);
  assert.equal(prior.warnedUSD, 9);
  assert.equal(prior.warnedWindow, null, 'an unfired ladder snapshots as null, never undefined');
});

test('the meter-canary family forwards the fetch envelope, never the usage payload', () => {
  const body = tg.collectVerdictCounters(counterCtx(mkFixture(), {
    official: { five_hour: { utilization: 40, resets_at: 'z' } },
    officialOff: { data: { never: 'travels' }, stale: true, at: 111, ageMs: 222 },
    prior: Object.assign({}, PRIOR_ZERO, { meterCanaryAt: 111 }),
  }));
  assert.deepEqual(body.meterCanary, { off: { stale: true, at: 111, ageMs: 222 }, warnedAt: 111 });
  assert.deepEqual(body.window.now5h, { pct: 40, resetsAt: 'z' },
    'the live meter reads straight off ctx — it is not state any guard advances');
});

// Pins a microstep the plan asked for and 1.5a's finding withdrew: all four spend gates fire
// from spendGatesGuard in PRETOOL_GUARDS, which returns a blocking ask/deny synchronously and
// has no notes channel. Widening this family would post counters whose answers nothing renders.
test('gates stays session-only — the PreToolUse ladder has nowhere to render', () => {
  const body = tg.collectVerdictCounters(counterCtx(mkFixture(), { prior: PRIOR_ZERO }));
  assert.deepEqual(body.gates.map(g => g.name), ['session']);
});

// ── One-shot commit (2026-08-19) ─────────────────────────────────────────────────────────────
// The service holds nothing between calls: it re-decides every family from the counters this
// client posts. So a fire-only rule (its one-shot IS the fire) speaks forever unless the client
// writes the arming state down — the `state` field each fired verdict carries. Commit runs
// BEFORE rendering and regardless of the local toggle; the render is what the toggle governs.
const HOME_KEYS = ['HOME', 'USERPROFILE'];

function withHome(fix, fn) {
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  for (const k of HOME_KEYS) process.env[k] = fix.home;
  try { return fn(); } finally {
    for (const k of HOME_KEYS) {
      if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    }
  }
}

const homeJson = (fix, name) =>
  JSON.parse(fs.readFileSync(path.join(fix.home, '.claude', '.token-guard', name), 'utf8'));
const projJson = (fix, name) => JSON.parse(fs.readFileSync(path.join(stateDirOf(fix), name), 'utf8'));

const WARN = { name: '5-hour window', resetsAt: 'R', rung: 80 };
const firedVerdicts = now => [
  { rule: 'R6', text: 'drift', state: { nudgedScope: 'Modal' } },
  { rule: 'R12b', name: WARN.name, pct: 82, rung: 80, topRung: 90, resetsAt: WARN.resetsAt,
    state: { warnedWindow: WARN } },
  { rule: 'meter-canary', text: 'canary', state: { meterCanaryAt: 4242 } },
  { rule: 'spend-steps', crossed: [10], billingKind: 'api', state: { warnedUSD: 10 } },
  { rule: 'R21', n: 3, tok: 120000, usd: 1.2, prompted: 0, promptedTok: 0,
    state: { lastReportAt: now } },
];

test('a cached fire persists its one-shot — one case per fire-only family', () => {
  const fix = mkFixture();
  const ctx = renderCtx(fix);
  const now = Date.now();
  const notes = withHome(fix, () =>
    tg.consumeCachedVerdicts({ at: 'e1', verdicts: firedVerdicts(now) }, ctx));

  assert.equal(notes.length, 5, 'every served verdict still renders — the commit is silent');
  assert.equal(ctx.st.nudgedScope, 'Modal', 'R6 arms the scope the nudge just spoke about');
  assert.equal(ctx.st.driftSnooze, null, 'a fresh nudge ends any snooze, as fireDriftNudge does');
  assert.deepEqual(ctx.st.warnedWindow, WARN, 'R12b arms the rung this cycle announced');
  assert.deepEqual(homeJson(fix, 'window-warns.json')[WARN.name], WARN,
    "the rung is account-wide — the session copy alone would let another session re-announce it");
  assert.equal(homeJson(fix, 'meter-canary.json')[fix.proj], 4242,
    'the canary dates the outage from the last-success stamp, which IS its one-shot key');
  assert.equal(ctx.st.warnedUSD, 10, 'the spend ladder arms the top step crossed');
  assert.equal(projJson(fix, 'recovery-spend.json').lastReportAt, now, 'R21 stamps the report');
});

test('the same verdict served twice fires once — the second serving is already armed', () => {
  const fix = mkFixture();
  const ctx = renderCtx(fix);
  const now = Date.now();
  withHome(fix, () => tg.consumeCachedVerdicts({ at: 'e1', verdicts: firedVerdicts(now) }, ctx));

  // The re-serve is structural, not a bug: this prompt's post is spawned BEFORE the commit, so
  // the service answers the same question one more time — with a fresh nowMs on R21's stamp.
  const again = firedVerdicts(now + 60000);
  assert.deepEqual(withHome(fix, () => tg.consumeCachedVerdicts({ at: 'e2', verdicts: again }, ctx)),
    [], 'a re-decided fire whose one-shot is already armed must stay silent');

  const newRung = [{ rule: 'R12b', name: WARN.name, pct: 92, rung: 90, topRung: 90,
    resetsAt: WARN.resetsAt, state: { warnedWindow: { ...WARN, rung: 90 } } }];
  assert.equal(withHome(fix, () => tg.consumeCachedVerdicts({ at: 'e3', verdicts: newRung }, ctx)).length,
    1, 'a NEW rung is news — the one-shot suppresses repeats, not the ladder');
});

test('a family the user turned off locally still arms its one-shot', () => {
  const fix = mkFixture();
  const ctx = renderCtx(fix, { recoveryWasteTokens: null, driftNudge: false });
  const now = Date.now();
  const notes = withHome(fix, () => tg.consumeCachedVerdicts({ at: 'e1', verdicts: [
    { rule: 'R21', n: 3, tok: 120000, usd: 1.2, prompted: 0, state: { lastReportAt: now } },
  ] }, ctx));

  assert.deepEqual(notes, [], 'the local switch still governs what the user sees');
  assert.equal(projJson(fix, 'recovery-spend.json').lastReportAt, now,
    'the commit runs anyway — skipping it leaves the service re-deciding a fire nobody sees');
});

test('a cache entry is spent once — a slow child must not replay it', () => {
  const fix = mkFixture();
  const ctx = renderCtx(fix);
  // R12a carries no state (its client baseline advances whether or not the rule fires), so the
  // entry stamp is the only thing standing between a re-read cache and a duplicate note.
  const entry = { at: 'e1', verdicts: [
    { rule: 'R12a', fire: true, spikePct: 14, fromPct: 40, toPct: 54, estimated: false }] };
  assert.equal(tg.consumeCachedVerdicts(entry, ctx).length, 1);
  assert.deepEqual(tg.consumeCachedVerdicts(entry, ctx), [],
    'the same entry re-read is a duplicate note, not news');
  assert.equal(ctx.st.lastVerdictAt, 'e1');
});

test('the statusline path renders without committing — only the shim spends a fire', () => {
  const fix = mkFixture();
  const ctx = renderCtx(fix);
  tg.renderCachedVerdicts({ at: 'e1', verdicts: [
    { rule: 'R6', text: 'drift', state: { nudgedScope: 'Modal' } }] }, ctx);
  assert.equal(ctx.st.nudgedScope, undefined, 'a repaint must never arm a one-shot');
});

test('the library surface statusline-cost.js requires is intact, plus the shim additions', () => {
  for (const k of ['meterSession', 'coldStartTokens', 'resolveConfig', 'findActivePlan',
    'findCurrentSubstep', 'parsePlanLedger',
    'shimActive', 'collectVerdictCounters', 'readVerdictCache', 'renderCachedVerdicts',
    'freeTierNote', 'shimHealth', 'remoteVerdictGuard', 'spendStepNote',
    'snapshotPriorGuardState', 'consumeCachedVerdicts', 'commitVerdictState']) {
    assert.equal(typeof tg[k], 'function', `token-guard must export ${k}`);
  }
});
