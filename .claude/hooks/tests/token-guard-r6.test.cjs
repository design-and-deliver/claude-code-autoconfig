// R6 scope-drift → keyword-migrate nudge. Pure unit tests on slug/driftNote/ledgerScopes/
// driftVerdict. Scope data comes from the terminal-title per-title ledger ({sid}.history.jsonl).
// Run: node --test token-guard-r6.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');
const { slug, driftNote, driftVerdict, ledgerScopes, driftDeferralTick } = require(HOOK);

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

// ---------- driftNote(): the action-first /clear + /continue out + stay-put aside ----------

test('driftNote hands the user the action-first /clear + /continue out', () => {
  const note = driftNote('title hooks', 'CCA distribution', 90);
  assert.match(note, /\/clear, then \/continue/, 'the out leads with the action');
  assert.match(note, /ACTION-FIRST/, 'relay instruction pins the copy rule');
  // Swept 2026-07-21: one migration metaphor everywhere — no paste-command alternative.
  assert.doesNotMatch(note, /migrate-new-session/);
});

test('driftNote names NO retired command — the dependency case is a STAY advisory', () => {
  const note = driftNote('title hooks', 'CCA distribution', 90);
  // /eval-new-session was retired 2026-07-21: migrate is the only command in the copy,
  // and the dependency escape hatch became an advise-to-stay aside instead of a command.
  assert.doesNotMatch(note, /eval-new-session/);
  assert.match(note, /builds on the earlier work/);
  assert.match(note, /staying put/i);
});

test('driftNote names did/costs/out and keeps the standalone-block relay contract', () => {
  const note = driftNote('title hooks', 'CCA distribution', 90);
  assert.match(note, /title hooks/);          // did: moved from
  assert.match(note, /CCA distribution/);      // to
  assert.match(note, /~90%/);                  // costs
  assert.match(note, /STANDALONE/);            // relay contract preserved
  assert.match(note, /NEVER run the commands yourself/);
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

test('driftVerdict stays silent below the STAY floor (nudge pointless by construction)', () => {
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

test('driftVerdict window-first tenure claims the pre-title baseline (starts at 0)', () => {
  // Ledger watermarks never start at 0 (turn 1 already carries the system prompt + CLAUDE.md);
  // the first tenure still owns that baseline, else shares would not sum to liveContext.
  const v = driftVerdict([
    { scope: 'title hooks', enteredIso: iso, ctxWatermark: 20000, prompts: 5 },
    { scope: 'CCA distribution', enteredIso: iso, ctxWatermark: 180000, prompts: 3 },
  ], 200000, CFG);
  assert.equal(v.fire, true);
  assert.equal(v.priorPct, 90); // [0,180k) is title hooks', not just [20k,180k)
});

test('driftVerdict stays silent when the CURRENT tenure has no measured watermark', () => {
  const v = driftVerdict([
    { scope: 'title hooks', enteredIso: iso, ctxWatermark: 20000, prompts: 5 },
    { scope: 'CCA distribution', enteredIso: iso, prompts: 3 }, // ledger line had no tokens yet
  ], 200000, CFG);
  assert.ok(!v.fire);
});

test('driftVerdict re-bases after a watermark SHRINK (auto-compact) instead of using dead watermarks', () => {
  // A@20k, B@180k, compaction, C@40k — pre-compaction watermarks describe a replaced context.
  const compacted = [
    { scope: 'A', enteredIso: iso, ctxWatermark: 20000, prompts: 2 },
    { scope: 'B', enteredIso: iso, ctxWatermark: 180000, prompts: 2 },
    { scope: 'C', enteredIso: iso, ctxWatermark: 40000, prompts: 3 },
  ];
  // Right after the compaction C is the only tenure in the re-based window — nothing measurable.
  assert.ok(!driftVerdict(compacted, 120000, CFG).fire);
  // Once a post-compaction scope D accrues, shares come from the re-based window only.
  const v = driftVerdict([...compacted,
    { scope: 'D', enteredIso: iso, ctxWatermark: 100000, prompts: 3 }], 120000, CFG);
  assert.equal(v.fire, true);
  assert.equal(v.dominant, 'C'); // C absorbed the compacted baseline, not pre-compaction B
  assert.equal(v.priorPct, 83);
});

// ---------- ledgerScopes(): title-ledger lines -> scope tenures ----------

const L = (ts, title, tokens) => JSON.stringify(tokens != null ? { ts, title, tokens } : { ts, title });

test('ledgerScopes collapses consecutive same-scope titles into one tenure', () => {
  const t = ledgerScopes([
    L('2026-07-18T10:00:00Z', 'title hooks — Refine taxonomy', 20000),
    L('2026-07-18T10:20:00Z', 'title hooks — Refine taxonomy — edge cases', 60000),
    L('2026-07-18T11:00:00Z', 'CCA distribution — Publish npm', 150000),
  ].join('\n'));
  assert.equal(t.length, 2);
  assert.deepEqual(t[0], { scope: 'title hooks', enteredIso: '2026-07-18T10:00:00Z', ctxWatermark: 20000 });
  assert.deepEqual(t[1], { scope: 'CCA distribution', enteredIso: '2026-07-18T11:00:00Z', ctxWatermark: 150000 });
});

test('ledgerScopes adopts a LATE watermark when the tenure-opening line has none', () => {
  const t = ledgerScopes([
    L('2026-07-18T10:00:00Z', 'title hooks — Baseline'), // very first paint: usage unflushed
    L('2026-07-18T10:05:00Z', 'title hooks — Baseline — details', 25000),
  ].join('\n'));
  assert.equal(t.length, 1);
  assert.equal(t[0].ctxWatermark, 25000);
  assert.equal(t[0].enteredIso, '2026-07-18T10:00:00Z', 'enteredIso stays the tenure-opening ts');
});

test('ledgerScopes tolerates malformed lines, blank lines, and titleless entries', () => {
  const t = ledgerScopes([
    'not json at all', '',
    JSON.stringify({ ts: '2026-07-18T10:00:00Z' }), // no title
    L('2026-07-18T10:01:00Z', 'title hooks — Real work', 30000),
  ].join('\n'));
  assert.equal(t.length, 1);
  assert.equal(t[0].scope, 'title hooks');
});

test('ledgerScopes on empty/absent text returns [] (feature silently off)', () => {
  assert.deepEqual(ledgerScopes(''), []);
  assert.deepEqual(ledgerScopes(null), []);
});

// ---------- the in-turn judge: arithmetic stages, the model holds the render gate ----------

test('driftNote stages the two judged tests AHEAD of the relay copy', () => {
  const note = driftNote('title hooks', 'CCA distribution', 90);
  assert.match(note, /RELATEDNESS/);
  assert.match(note, /RESOLUTION/);
  assert.match(note, /drift-deferred/);           // the defer out is a concrete flag file
  assert.match(note, /render NOTHING/);           // suppression must be total, not softened
  // judge first, relay second — the gate precedes the relay contract
  assert.ok(note.indexOf('RELATEDNESS') < note.indexOf('STANDALONE'));
});

test('driftNote plain branch gates on relatedness ONLY; resolution picks the framing', () => {
  const note = driftNote('title hooks', 'CCA distribution', 90);
  assert.match(note, /Relay ONLY if this prompt is UNRELATED/);
  assert.match(note, /RESOLUTION does not gate the relay/);
  // both framings the copy must be able to name
  assert.match(note, /safe to leave behind/);
  assert.match(note, /never quite wrapped up/);
});

test('driftNote auto-migrate branch demands BOTH tests (it sends the user straight to /clear)', () => {
  const note = driftNote('title hooks', 'CCA distribution', 90, true, 117000);
  assert.match(note, /UNRELATED to that earlier work AND its threads are RESOLVED/);
  assert.match(note, /any doubt defers/);
  assert.match(note, /drift-deferred/);
});

// ---------- driftDeferralTick(): the defer loop's pure state transitions ----------

test('a deferral converts the burnt one-shot into a snooze, then re-arms on expiry', () => {
  const st = { nudgedScope: 'CCA distribution', curScopePrompts: 5, driftSnooze: null };
  driftDeferralTick(st, true, 4);
  assert.deepEqual(st.driftSnooze, { scope: 'CCA distribution', retryAtPrompts: 9 });
  assert.equal(st.nudgedScope, 'CCA distribution'); // still one-shot-blocked while snoozing
  st.curScopePrompts = 8; driftDeferralTick(st, false, 4);
  assert.equal(st.nudgedScope, 'CCA distribution'); // not yet
  st.curScopePrompts = 9; driftDeferralTick(st, false, 4);
  assert.equal(st.nudgedScope, null);               // re-armed: driftVerdict may stage again
  assert.equal(st.driftSnooze, null);
});

test('an orphan flag (nothing staged) is consumed without creating a snooze', () => {
  const st = { nudgedScope: null, curScopePrompts: 3, driftSnooze: null };
  driftDeferralTick(st, true, 4);
  assert.equal(st.driftSnooze, null);
  assert.equal(st.nudgedScope, null);
});

test('a snooze for a scope that is no longer the nudged one is dropped as stale', () => {
  const st = { nudgedScope: 'new scope', curScopePrompts: 2,
    driftSnooze: { scope: 'old scope', retryAtPrompts: 9 } };
  driftDeferralTick(st, false, 4);
  assert.equal(st.driftSnooze, null);
  assert.equal(st.nudgedScope, 'new scope');        // the newer stage's one-shot is untouched
});

test('ledger text end-to-end: drifted session fires with ledger-derived tenures', () => {
  const tenures = ledgerScopes([
    L('2026-07-18T10:00:00Z', 'title hooks — Refine taxonomy', 20000),
    L('2026-07-18T12:00:00Z', 'CCA distribution — Publish npm', 180000),
  ].join('\n'));
  tenures[tenures.length - 1].prompts = 3; // caller-stamped residency
  const v = driftVerdict(tenures, 200000, CFG);
  assert.equal(v.fire, true);
  assert.equal(v.dominant, 'title hooks');
  assert.equal(v.priorPct, 90);
});
