// R6 scope-drift → keyword-migrate nudge. Pure unit tests on slug/driftNote/driftVerdict.
// Run: node --test token-guard-r6.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');
const { slug, driftNote, driftVerdict } = require(HOOK);

// ---------- slug(): stable, filesystem/keyword-safe, capped ----------

test('slug lowercases and hyphenates non-alnum runs', () => {
  assert.equal(slug('CCA distribution'), 'cca-distribution');
  assert.equal(slug('token-guard nudge'), 'token-guard-nudge');
  assert.equal(slug('  Spaces  and--punct!! '), 'spaces-and-punct');
});

test('slug handles the em-dash scope separator defensively', () => {
  assert.equal(slug('title hooks — Unify'), 'title-hooks-unify');
});

test('slug falls back to "session" on empty/degenerate input', () => {
  for (const x of ['', '   ', '!!!', null, undefined]) assert.equal(slug(x), 'session');
});

test('slug caps at 40 and never leaves a trailing hyphen', () => {
  const long = slug('a'.repeat(60));
  assert.equal(long.length, 40);
  assert.ok(!long.endsWith('-'));
  // a cut that lands on a separator must strip it, not emit "…-"
  const cut = slug('a'.repeat(39) + ' tail');
  assert.ok(!cut.endsWith('-'), `no trailing hyphen, got "${cut}"`);
});

test('slug is deterministic (idempotent for the once-per-scope one-shot)', () => {
  const s = 'CCA distribution';
  assert.equal(slug(s), slug(s));
});

// ---------- driftNote(): the paste-ready command + escape hatch ----------

test('driftNote hands the user a paste-ready /migrate-new-session {slug}', () => {
  const note = driftNote('title hooks', 'CCA distribution', 90);
  assert.match(note, /\/migrate-new-session cca-distribution\b/, 'keyword = slug(scope)');
});

test('driftNote keeps /eval-new-session only as the dependency escape hatch', () => {
  const note = driftNote('title hooks', 'CCA distribution', 90);
  assert.match(note, /\/eval-new-session/);
  // migrate is the headline out; eval is downstream of it in the copy
  assert.ok(note.indexOf('/migrate-new-session') < note.indexOf('/eval-new-session'),
    'migrate must lead, eval is the aside');
});

test('driftNote names did/costs/out and keeps the standalone-block relay contract', () => {
  const note = driftNote('title hooks', 'CCA distribution', 90);
  assert.match(note, /title hooks/);          // did: moved from
  assert.match(note, /CCA distribution/);      // to
  assert.match(note, /~90%/);                  // costs
  assert.match(note, /STANDALONE/);            // relay contract preserved
  assert.match(note, /NEVER run either command yourself/);
});

// ---------- driftVerdict(): the fire conditions the nudge rides on ----------

const CFG = { driftMinContextTokens: 100000, driftPriorShareMin: 0.6 };
const iso = 'ignored';
// title hooks owns [0,180k)=180k; the moved-to scope owns [180k,200k)=20k → prior share 90%.
const DRIFTED = [
  { scope: 'title hooks', enteredIso: iso, ctxWatermark: 0, prompts: 5 },
  { scope: 'CCA distribution', enteredIso: iso, ctxWatermark: 180000, prompts: 3 },
];

test('driftVerdict fires when the moved-past scope dominates above the floor', () => {
  const v = driftVerdict(DRIFTED, 200000, CFG);
  assert.equal(v.fire, true);
  assert.equal(v.dominant, 'title hooks');
  assert.equal(v.priorPct, 90);
});

test('driftVerdict stays silent below /eval STAY floor (nudge pointless by construction)', () => {
  assert.ok(!driftVerdict(DRIFTED, 90000, CFG).fire);
});

test('driftVerdict stays silent on a one-prompt title blip (a detour, not a move)', () => {
  const blip = [DRIFTED[0], { ...DRIFTED[1], prompts: 1 }];
  assert.ok(!driftVerdict(blip, 200000, CFG).fire);
});

test('driftVerdict stays silent when the current scope is a RETURN (multiplexing, not drift)', () => {
  const ret = [
    { scope: 'CCA distribution', enteredIso: iso, ctxWatermark: 0, prompts: 2 },
    { scope: 'title hooks', enteredIso: iso, ctxWatermark: 120000, prompts: 2 },
    { scope: 'CCA distribution', enteredIso: iso, ctxWatermark: 190000, prompts: 3 },
  ];
  assert.ok(!driftVerdict(ret, 200000, CFG).fire);
});
