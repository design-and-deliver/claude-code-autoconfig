// Rationale encapsulation (Andrew 2026-08-24) — verdictDetail + the /cost-control-details rail.
//
// The ruling this pins: most users never want the arithmetic, so with verdictDetail 'file' the
// migration-remedy gates (R13b/R14/R20) render ONE consolidated two-line card — Andrew's wording
// verbatim, a copy contract like the verbose cards' — and the full card is persisted to
// .token-guard/<sid>.cards.jsonl for `--details` (the /cost-control-details command) to read
// back. "It's not a black box, it's encapsulation": the rationale is one command away, never
// deleted. Two mechanics matter enough to pin: the full card is persisted in BOTH modes (the
// details command answers even where the card rendered verbose), and --details reads the newest
// card across ALL sessions — the natural moment to ask is right after the /clear + /continue
// migration, when the asker's sid has already changed.
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

const QUIET_CARD =
  '[!] cost control -- deny, then /clear + /continue to optimize token savings and pick up ' +
  'where you left off\n/cost-control-details to see rationale';

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
const details = (projectDir) =>
  (spawnSync('node', [HOOK, '--details', projectDir], { encoding: 'utf8', timeout: 20000 })
    .stdout || '');

test("verdictDetail 'file': the ask renders Andrew's consolidated card, verbatim", () => {
  const { out } = fired({ verdictDetail: 'file' });
  assert.equal(out.permissionDecision, 'ask');
  assert.equal(out.permissionDecisionReason, QUIET_CARD);
});

test("verdictDetail 'file': the full card is persisted for the details command", () => {
  const { fix } = fired({ verdictDetail: 'file' });
  const entries = fs.readFileSync(cardsPath(fix), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].family, 'RENT');
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
  assert.equal(entries[0].family, 'RENT');
});

test('--details prints the persisted full card, not the consolidated one', () => {
  const { fix } = fired({ verdictDetail: 'file' });
  const out = details(fix.proj);
  assert.match(out, /Full card behind the last cost-control verdict \(RENT/);
  assert.match(out, /• verdict — deny/);
  assert.ok(!out.includes('[!] cost control')); // the quiet card is what it decodes, never echoes
});

test('--details reads the NEWEST card across sessions — it answers after the migration', () => {
  const { fix } = fired({ verdictDetail: 'file' });
  // The post-migration session has a different sid; its (newer) card must win.
  fs.writeFileSync(
    path.join(fix.proj, '.claude', 'hooks', '.token-guard', 'sid-next.cards.jsonl'),
    JSON.stringify({ at: '2999-01-01T00:00:00.000Z', family: 'SESSION', card: 'NEWEST-CARD' }) + '\n');
  const out = details(fix.proj);
  assert.match(out, /\(SESSION, fired 2999-01-01/);
  assert.match(out, /NEWEST-CARD/);
});

test('--details with nothing recorded says so instead of erroring', () => {
  const fix = mkFixture();
  assert.match(details(fix.proj), /no cost-control verdicts recorded in this project yet\./);
});
