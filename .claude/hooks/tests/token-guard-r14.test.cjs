// R14 — the in-turn RENT tripwire. ONE turn's cache RE-READS (round trips × resident context)
// ≥ turnRentGateTokens ⇒ PreToolUse ask; re-arms ABOVE the observed rent; every prompt
// re-baselines. R14 exists because R13b, by construction, cannot see this: R13b discounts
// re-reads 10× so it can judge TASK SIZE, which makes it blind to a turn that does ordinary
// work over many round trips at a fat context. Observed 2026-07-25 (session afd2a755): 24 round
// trips × ~104k context = 2.5M of re-reads and $2.62 in ONE 22-minute plan-authoring turn,
// while the work itself was 83k — under the ~100k normal-task bar. Copy contract: leads with
// round trips × context (the lever is context size, not task length), never calls it a spiral.
// Run: node --test token-guard-r14.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');

const usageLine = (id, inp) => JSON.stringify({ type: 'assistant',
  message: { id, model: 'claude-fable-5', usage: { input_tokens: inp, output_tokens: 10 } } }) + '\n';
// One round trip at a fat context: a little new input, a little output, the whole context re-read.
const roundTrip = (id, cr, outT) => JSON.stringify({ type: 'assistant',
  message: { id, model: 'claude-fable-5',
    usage: { input_tokens: 100, output_tokens: outT == null ? 10 : outT,
      cache_read_input_tokens: cr } } }) + '\n';

function mkFixture(guardCfg) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'tg14-'));
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'cca.config.json'),
    // turnGateTokens parked high so R13b never pre-empts: these cases are about rent alone.
    JSON.stringify({ tokenGuard: Object.assign(
      { turnGateTokens: 10000000, turnRentGateTokens: 100000 }, guardCfg) }));
  const tp = path.join(proj, 'main.jsonl');
  fs.writeFileSync(tp, usageLine('m1', 1000));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg14-home-'));
  return { proj, home, tp };
}

function runHook(fix, payload) {
  const env = Object.assign({}, process.env, {
    CLAUDE_PROJECT_DIR: fix.proj, USERPROFILE: fix.home, HOME: fix.home,
    ANTHROPIC_API_KEY: 'sk-test', // API-billed on purpose: R14 copy stays token-denominated
  });
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(Object.assign({ session_id: 'sid-r14', transcript_path: fix.tp }, payload)),
    encoding: 'utf8', env, timeout: 20000,
  });
  return r.stdout || '';
}

const preToolUse = fix => runHook(fix, { hook_event_name: 'PreToolUse', tool_name: 'Bash' });
const promptSubmit = fix => runHook(fix, { hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
const gateOut = raw => (JSON.parse(raw || '{}').hookSpecificOutput || {});

test('R14 fires once a turn\'s re-reads cross the gate — round-trip copy, re-arms above observed', () => {
  const fix = mkFixture();
  promptSubmit(fix);                                 // baseline: 0 rent, 1 round trip
  fs.appendFileSync(fix.tp, roundTrip('m2', 300000)); // 3 gate-widths of rent in one trip
  const out = gateOut(preToolUse(fix));
  assert.equal(out.permissionDecision, 'ask');
  assert.match(out.permissionDecisionReason, /1 round trip this turn/); // singular throughout
  // 300k of rent RENDERS as 30k: the meter stays raw, the card converts at display (2026-07-30).
  // 0.1× is not a discount the script elects — it is the price — so a raw figure overstates the
  // bill 10× and, set beside the already-weighted work figure, overstated the ratio by as much.
  // Since 2026-07-31 the conversion is SHOWN, not just applied: trips × context × rate = billed.
  // One trip has no average to take, so the multiplicand is the live figure and 'avg' is absent.
  assert.match(out.permissionDecisionReason,
    /1 × ~300k × 10% \(a cache read\) = ~30k of re-reads/);
  assert.doesNotMatch(out.permissionDecisionReason, /avg/);
  // The editorial tail ("that is rent, not progress") went with the 2026-08-14 condensation —
  // the RENT meter tag names the phenomenon; pinned absent so it does not grow back.
  assert.doesNotMatch(out.permissionDecisionReason, /rent, not progress/);
  assert.doesNotMatch(out.permissionDecisionReason, /\$/);
  // Structure (2026-08-14): a headline reading, then FOUR label — value bullets — this turn /
  // if it continues / verdict / rationale, the label-dash grammar /cost-compare's readout wears.
  // The 2026-07-29 cuts still govern: no Lever (restated the headline), no Restart (its one
  // keeper, the measured floor, lives in the rationale line now). Pinned as the 5-line shape
  // plus the absence of every retired bullet, or the briefing grows back a line at a time.
  const lines = out.permissionDecisionReason.split('\n');
  assert.equal(lines.length, 5);
  // 'each' is load-bearing: this figure is the CURRENT per-trip context, not a total and
  // not the turn's average — the ambiguity that had Andrew differencing it against the cost line.
  assert.match(lines[0], /^⚠️ RENT · 1st check — .*round trip this turn, ~\d+k context each\.$/);
  assert.deepEqual(lines.slice(1).map(l => l.split(' — ')[0]),
    ['• this turn', '• if it continues', '• verdict', '• rationale']);
  assert.doesNotMatch(out.permissionDecisionReason, /• Lever|• Restart|• Cost|• Choice/);
  // Converts with the this-turn figure, or the card re-mixes units in one breath.
  assert.match(lines[2], / Next check ≈ \d+k this turn\.$/);
  // Re-armed at 400k (above the 300k observed) ⇒ the very next tool call must not re-fire.
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, undefined);
});

test('R14 catches what R13b cannot: ordinary work spread over many trips at a fat context', () => {
  // The 2026-07-25 shape, at default gates. 24 trips × 104k = 2.5M of rent; work = 24×1.6k ≈
  // 38k. R13b's work meter reads ~288k against a 1M gate ⇒ silent. R14 must not be.
  //
  // The fat line is pinned at 100k for this fixture rather than left at the 150k default, because
  // since the 2026-07-31 silence guard a fat window is a PRECONDITION of R14 speaking at all, and
  // the incident's own 104k sits just under the default line. Pinning it here keeps the case about
  // what it is about — rent invisible to a work meter — instead of quietly becoming a second test
  // of the threshold. (That the founding incident would now be silenced at defaults is a real
  // consequence of the guard, and belongs in the guard's own tests, not smuggled into this one.)
  const fix = mkFixture({ turnGateTokens: 1000000, turnRentGateTokens: 1000000,
    contextWarnTokens: 100000 });
  promptSubmit(fix);
  for (let i = 2; i <= 25; i++) fs.appendFileSync(fix.tp, roundTrip(`m${i}`, 104000, 1500));
  const out = gateOut(preToolUse(fix));
  assert.equal(out.permissionDecision, 'ask');
  assert.match(out.permissionDecisionReason, /24 round trips/);
  // The 2.5M raw renders as 250k weighted — same fire, same moment, honest unit. Asserting the
  // pair together is the point: "~250k of re-reads vs ~38k of actual work" is 6.6:1, where
  // the raw figure claimed 66:1 off the same turn.
  assert.match(out.permissionDecisionReason,
    /24 × ~104k avg × 10% \(a cache read\) = ~250k of re-reads/);
  assert.match(out.permissionDecisionReason, /vs ~38k of actual work/);
  // No 7-figure token count anywhere: "~2.5M" read as alarm rather than as information.
  assert.doesNotMatch(out.permissionDecisionReason, /~?\d+(\.\d+)?M\b/);
  // It is rent, not a spiral — R13b's framing must not leak into this message.
  assert.doesNotMatch(out.permissionDecisionReason, /spiral/i);
});

// The card prints an equation, so the equation has to close — arithmetic a reader can check is
// the whole point of showing it, and one that does not add up is worse than a bare product.
// This is the regression guard for the naive fix: multiplying by the HEADLINE context instead of
// the average. On a turn whose context grew (the normal shape) those differ, and 44 × live × 10%
// overstates the bill by whatever the context gained — here ~35%.
test('R14: the printed equation closes — trips × avg × 10% equals the billed figure', () => {
  // Fat line pinned at 100k for the same reason as the case above: the silence guard makes a fat
  // window a precondition of the card existing, and this case is about the card's arithmetic.
  const fix = mkFixture({ turnGateTokens: 10000000, turnRentGateTokens: 4000000,
    contextWarnTokens: 100000 });
  promptSubmit(fix);
  // Context climbs 62k -> 139k across 44 trips, so avg (~101k) is nowhere near the live figure.
  for (let i = 2; i <= 45; i++) fs.appendFileSync(fix.tp, roundTrip(`m${i}`, 60000 + i * 1750, 1500));
  const r = gateOut(preToolUse(fix)).permissionDecisionReason || '';
  const eq = r.match(/(\d+) × ~(\d+)k avg × 10% \(a cache read\) = ~(\d+)k of re-reads/);
  assert.ok(eq, `the this-turn line carries no equation: ${r}`);
  const [, trips, avgK, billedK] = eq.map(Number);
  const product = trips * avgK * 0.1;
  assert.ok(Math.abs(product - billedK) / billedK < 0.02,      // slack for two k-roundings only
    `equation does not close: ${trips} × ${avgK}k × 10% = ${product}k, printed ~${billedK}k`);
  // And the headline figure is genuinely a DIFFERENT number, or this proved nothing.
  const live = Number((r.match(/, ~(\d+)k context each/) || [])[1]);
  assert.ok(live > avgK * 1.2, `fixture failed to grow the context: live ${live}k vs avg ${avgK}k`);
  assert.match(r, new RegExp(`~${Math.round(live / 10)}k more rent per trip at the current size`));
});

test('R14 re-baselines on the next prompt — a new turn starts rent-free', () => {
  const fix = mkFixture();
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, roundTrip('m2', 300000));
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, 'ask');
  promptSubmit(fix);                                 // new turn: baseline 300k, re-arm cleared
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, undefined);
});

test('R14 lazy-arms its baseline when none exists — never bills the session\'s rent to one turn', () => {
  const fix = mkFixture();
  fs.appendFileSync(fix.tp, roundTrip('m2', 300000)); // no prompt ever metered
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, undefined);
  fs.appendFileSync(fix.tp, roundTrip('m3', 300000)); // from that baseline, this IS a crossing
  assert.equal(gateOut(preToolUse(fix)).permissionDecision, 'ask');
});

test('R14: turnRentGateTokens null disables the tripwire', () => {
  const fix = mkFixture({ turnRentGateTokens: null, turnGateTokens: null });
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, roundTrip('m2', 900000));
  assert.equal(preToolUse(fix).trim(), '');
});
