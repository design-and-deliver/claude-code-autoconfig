// Rationale encapsulation (Andrew 2026-08-24) — verdictDetail + the /token-saver-rationale rail.
//
// The ruling this pins: most users never want the arithmetic, so with verdictDetail 'file'
// every family-tagged cost ask renders its family's consolidated two-line card, and the full
// card is persisted to .token-guard/<sid>.cards.jsonl for `--details` (the
// /token-saver-rationale command) to read back. "It's not a black box, it's encapsulation":
// the rationale is one command away, never deleted. The taxonomy (2026-08-24, same ruling
// thread): ten short codes in QUIET_CARDS, doubling as conversation references and the ledger's
// `family` field — one card per family because each family names its OWN remedy; every card
// leads with a one-line trigger under the header (Andrew 2026-08-27), and the migration trio
// (task-size/rent/session-total) shares Andrew's remedy steps verbatim, each under its own
// trigger line. Two mechanics
// matter enough to pin: the full card is persisted in BOTH modes (the details command answers
// even where the card rendered verbose), and --details reads the newest card across ALL
// sessions — the natural moment to ask is right after the /clear + /continue migration, when
// the asker's sid has already changed.
//
// Default posture is UNCHANGED: verdictDetail 'console' renders the same verbose cards the
// copy-contract tests pin, so nothing shifts under a live session until a config opts in.
// Run: node --test token-guard-quiet-card.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');
const { QUIET_CARDS, AUTO_RECEIPTS } = require(HOOK);

const MIGRATE_TAIL =
  '1. Select "No" below\n2. /clear to purge old context\n' +
  '3. /continue to restore the context for your last active use case\n' +
  '~ Rationale → /token-saver-rationale';
const TRIO_TRIGGER = {
  'task-size': 'This task has outgrown one session',
  'rent': 'Each turn re-pays to carry old context',
  'session-total': "This session's context only grows",
};
const QUIET_CARD = code => '⚠️ TokenSaver — /clear then /continue costs less\n~ ' + TRIO_TRIGGER[code] + '\n' + MIGRATE_TAIL;

const usageLine = (id, inp) => JSON.stringify({ type: 'assistant',
  message: { id, model: 'claude-fable-5', usage: { input_tokens: inp, output_tokens: 10 } } }) + '\n';
const roundTrip = (id, cr) => JSON.stringify({ type: 'assistant',
  message: { id, model: 'claude-fable-5',
    usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: cr } } }) + '\n';

function mkFixture(guardCfg) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'tgq-'));
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'cca.config.json'),
    // R13b parked high — these cases fire R14 (rent), the cheapest gate to prime end-to-end.
    JSON.stringify({ tokenGuard: Object.assign(
      { turnGateTokens: 10000000, turnRentGateTokens: 100000 }, guardCfg) }));
  const tp = path.join(proj, 'main.jsonl');
  fs.writeFileSync(tp, usageLine('m1', 1000));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tgq-home-'));
  return { proj, home, tp };
}

function runHook(fix, payload) {
  const env = Object.assign({}, process.env, {
    CLAUDE_PROJECT_DIR: fix.proj, USERPROFILE: fix.home, HOME: fix.home,
    ANTHROPIC_API_KEY: 'sk-test',
  });
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(Object.assign({ session_id: 'sid-qc', transcript_path: fix.tp }, payload)),
    encoding: 'utf8', env, timeout: 20000,
  });
  return r.stdout || '';
}

const call = (fix, tool_name, tool_input) =>
  runHook(fix, { hook_event_name: 'PreToolUse', tool_name, tool_input });
const promptSubmit = fix => runHook(fix, { hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
const gateOut = raw => (JSON.parse(raw || '{}').hookSpecificOutput || {});

// Rent 3 gate-widths deep, then a bomb call — R14's deny branch, deterministic on any machine.
function fired(guardCfg) {
  const fix = mkFixture(guardCfg);
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, roundTrip('m2', 300000));
  return { fix, out: gateOut(call(fix, 'Bash', { command: 'pnpm test --run' })) };
}

const cardsPath = fix =>
  path.join(fix.proj, '.claude', 'hooks', '.token-guard', 'sid-qc.cards.jsonl');
const details = (projectDir, token) =>
  (spawnSync('node', [HOOK, '--details', projectDir].concat(token ? [token] : []),
    { encoding: 'utf8', timeout: 20000 }).stdout || '');

// The rendered card's rationale pointer carries the fire-time sid token; the static
// QUIET_CARDS map stays untagged (the copy contract the taxonomy tests pin below).
test("verdictDetail 'file': the ask renders Andrew's consolidated card + the session token", () => {
  const { out } = fired({ verdictDetail: 'file' });
  assert.equal(out.permissionDecision, 'ask');
  assert.equal(out.permissionDecisionReason, QUIET_CARD('rent') + ' sid-qc');
});

test("verdictDetail 'file': the full card is persisted for the details command", () => {
  const { fix } = fired({ verdictDetail: 'file' });
  const entries = fs.readFileSync(cardsPath(fix), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].family, 'rent');
  assert.match(entries[0].card, /• verdict — deny/);
  assert.match(entries[0].card, /round trip/);
  assert.ok(entries[0].at); // timestamp present — --details sorts on it
});

test('default (console) mode: verbose card unchanged AND still persisted', () => {
  const { fix, out } = fired();
  assert.equal(out.permissionDecision, 'ask');
  assert.match(out.permissionDecisionReason, /round trip/);      // the arithmetic still renders
  assert.match(out.permissionDecisionReason, /• verdict — deny/);
  const entries = fs.readFileSync(cardsPath(fix), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(entries.length, 1);                                // both modes feed --details
  assert.equal(entries[0].family, 'rent');
});

test('--details prints the persisted full card, not the consolidated one', () => {
  const { fix } = fired({ verdictDetail: 'file' });
  const out = details(fix.proj);
  assert.match(out, /Full card behind the last cost-control verdict \(rent/);
  assert.match(out, /• verdict — deny/);
  assert.ok(!out.includes('⚠️ TokenSaver')); // the quiet card is what it decodes, never echoes
});

test('--details reads the NEWEST card across sessions — it answers after the migration', () => {
  const { fix } = fired({ verdictDetail: 'file' });
  // The post-migration session has a different sid; its (newer) card must win.
  fs.writeFileSync(
    path.join(fix.proj, '.claude', 'hooks', '.token-guard', 'sid-next.cards.jsonl'),
    JSON.stringify({ at: '2999-01-01T00:00:00.000Z', family: 'session-total', card: 'NEWEST-CARD' }) + '\n');
  const out = details(fix.proj);
  assert.match(out, /\(session-total, fired 2999-01-01/);
  assert.match(out, /NEWEST-CARD/);
});

test('--details with the card-face token pins the firing session past a newer sibling', () => {
  const { fix } = fired({ verdictDetail: 'file' });
  // A parallel session lands a newer card; the token from sid-qc's card face must still win.
  fs.writeFileSync(
    path.join(fix.proj, '.claude', 'hooks', '.token-guard', 'sid-other.cards.jsonl'),
    JSON.stringify({ at: '2999-01-01T00:00:00.000Z', family: 'session-total', card: 'SIBLING-CARD' }) + '\n');
  const pinned = details(fix.proj, 'sid-qc');
  assert.match(pinned, /\(rent, fired /);
  assert.ok(!pinned.includes('SIBLING-CARD'));
  // An unknown token names itself instead of silently falling back to the sibling's card.
  assert.match(details(fix.proj, 'sid-gone'), /no cost-control verdicts recorded for session sid-gone\./);
});

test('--details with nothing recorded says so instead of erroring', () => {
  const fix = mkFixture();
  assert.match(details(fix.proj), /no cost-control verdicts recorded in this project yet\./);
});

// --- Card taxonomy (the enumeration itself) ---------------------------------------------
// Ten short codes, doubling as conversation references and the ledger's `family` field.
// Full-verbatim pins exist only for the migration trio (Andrew's agreed steps + its trigger
// lines); the other seven cards pin their REMEDY phrase — the design property that forced
// per-family cards — and get verbatim pins once their wording has had Andrew's pass.

const CODES = ['task-size', 'rent', 'session-total', 'idle-cache', 'payload-door',
  'mini-bomb', 'post-bomb', 'spend-gate', 'workflow-launch', 'workflow-fan'];

test('the taxonomy is exactly the ten agreed short codes', () => {
  assert.deepEqual(Object.keys(QUIET_CARDS).sort(), [...CODES].sort());
});

// The five restart-remedy cards carry the '— /clear then /continue costs less' header suffix
// (2026-08-27 as 'Restart Session'; literal commands + the shared verdict both 2026-08-31):
// only their remedy continues after the dialog; the other five finish in approve / "No".
const RESTART_SUFFIXED = new Set(['task-size', 'rent', 'session-total', 'idle-cache', 'post-bomb']);

test('every quiet card is header, trigger one-liner, numbered steps, and the rationale pointer', () => {
  for (const [code, card] of Object.entries(QUIET_CARDS)) {
    const lines = card.split('\n');
    assert.ok(lines.length >= 4, code);
    assert.equal(lines[0], RESTART_SUFFIXED.has(code)
      ? '⚠️ TokenSaver — /clear then /continue costs less' : '⚠️ TokenSaver', code);
    assert.ok(lines[1] && lines[1].startsWith('~ '), code); // the '~' trigger line precedes the steps
    assert.ok(lines.some(l => /^1\. /.test(l)), code);
    assert.equal(lines[lines.length - 1], '~ Rationale → /token-saver-rationale', code);
  }
});

test("the migration trio: per-family trigger over Andrew's shared steps, verbatim", () => {
  for (const code of Object.keys(TRIO_TRIGGER)) {
    assert.equal(QUIET_CARDS[code], QUIET_CARD(code), code);
  }
});

test('each non-migration card names its own remedy — the reason one shared card failed', () => {
  const remedy = {
    'idle-cache': /Idle past the cache window/,
    'payload-door': /ranged read or a subagent/,
    'mini-bomb': /through a subagent/,
    'post-bomb': /\/clear to shed/,
    'spend-gate': /\/clear for a fresh session/,
    'workflow-launch': /Approve to launch/,
    'workflow-fan': /cut the fan/,
  };
  for (const [code, re] of Object.entries(remedy)) assert.match(QUIET_CARDS[code], re, code);
});

// --- Autonomous-save receipts (2026-08-27) ------------------------------------------------
// The silent diverts (R8 read-divert, R18 re-read) carry a user-facing receipt via the hook's
// systemMessage while the deny reason stays model-facing, and the rationale feeds --details.

test('the receipt taxonomy is exactly the two silent diverts', () => {
  assert.deepEqual(Object.keys(AUTO_RECEIPTS).sort(), ['re-read', 'read-divert'].sort());
});

test("every receipt is Andrew's three-line card: saved header, one-liner, details pointer", () => {
  for (const [code, card] of Object.entries(AUTO_RECEIPTS)) {
    const lines = card.split('\n');
    assert.equal(lines.length, 3, code);
    assert.equal(lines[0], '⚠️ TokenSaver — you just saved tokens', code);
    assert.ok(lines[1] && !lines[1].startsWith('~'), code); // the one-liner, not a pointer
    assert.equal(lines[2], '~ See the details at /token-saver-rationale', code);
  }
});

test('a read divert denies model-facing, receipts the user, and feeds --details', () => {
  const fix = mkFixture({ readDivertTokens: 1000 });
  const big = path.join(fix.proj, 'big.txt');
  fs.writeFileSync(big, 'x'.repeat(60000));
  const raw = runHook(fix, { hook_event_name: 'PreToolUse', tool_name: 'Read',
    tool_input: { file_path: big } });
  const parsed = JSON.parse(raw);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /diverted, not loaded/);
  assert.equal(parsed.systemMessage, AUTO_RECEIPTS['read-divert'] + ' sid-qc');
  const out = details(fix.proj);
  assert.match(out, /read-divert/);
  assert.match(out, /diverted, not loaded/);
});
