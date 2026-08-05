/**
 * Session-total ladder — denominated per billing (2026-08-05).
 *
 * Guards the gap found 2026-08-05: the 2026-07-18 change suppressed sessionWarnUSD check-ins
 * on subscription billing ($ steps map to nothing the user experiences) but removed the
 * session-total EVENT along with the denomination — a 15M-token session then sailed straight
 * to the $15 hard gate (~14.8M tokens) with no earlier session-total voice. The fix steps the
 * same check-in in TOKENS on subscription (sessionWarnTokens, default [5M, 10M], read off
 * sessionTokens(m) — the figure the gate's subscription copy shows).
 *
 * The regression case below (15M blank-state subscription session must cross rungs) FAILS on
 * the pre-fix code, which returned [] for every subscription session unconditionally.
 */
const { test, assert, summary } = require('./_harness');
const { crossedSpendSteps, resolveConfig } = require('../.claude/hooks/token-guard');

// Minimal meter shape for sessionTokens(m): tokOne sums inp+out+cr+cw per model bucket.
const mAt = (tokens, usd) => ({
  usd,
  main: { perModel: { 'claude-x': { inp: tokens, out: 0, cr: 0, cw: 0 } } },
  agents: { perModel: {} },
});
const CFG = resolveConfig({});
const blank = { warnedUSD: 0, warnedTok: 0 };

test('default config carries the token ladder', () => {
  assert(Array.isArray(CFG.sessionWarnTokens) && CFG.sessionWarnTokens.length >= 2,
    `sessionWarnTokens default missing: ${JSON.stringify(CFG.sessionWarnTokens)}`);
  assert(CFG.sessionWarnTokens[0] === 5000000 && CFG.sessionWarnTokens[1] === 10000000,
    `expected [5M, 10M] rungs, got: ${JSON.stringify(CFG.sessionWarnTokens)}`);
});

test('the 15M balloon crosses the subscription ladder (the 2026-08-05 regression)', () => {
  const crossed = crossedSpendSteps(CFG, mAt(15000000, 15.2), blank, 'subscription');
  assert(crossed.length === 2,
    `a 15M-token subscription session must cross both token rungs, got: ${JSON.stringify(crossed)}`);
});

test('first rung fires at 5M, one-shot floor suppresses a re-fire', () => {
  assert(crossedSpendSteps(CFG, mAt(5100000, 5), blank, 'subscription').length === 1,
    'first token rung should fire just past 5M');
  const warned = { warnedUSD: 0, warnedTok: 5000000 };
  assert(crossedSpendSteps(CFG, mAt(6000000, 6), warned, 'subscription').length === 0,
    'an announced rung must not re-fire below the next one');
  const next = crossedSpendSteps(CFG, mAt(10500000, 10), warned, 'subscription');
  assert(next.length === 1 && next[0] === 10000000,
    `the 10M rung should fire next, got: ${JSON.stringify(next)}`);
});

test('subscription steps in tokens, never in $', () => {
  // $6 of weighted spend but only 1M tokens processed: no $ rung may leak through.
  assert(crossedSpendSteps(CFG, mAt(1000000, 6), blank, 'subscription').length === 0,
    'subscription must ignore sessionWarnUSD rungs');
});

test('API billing keeps the $ ladder and ignores token rungs', () => {
  const crossed = crossedSpendSteps(CFG, mAt(15000000, 6), blank, 'api');
  assert(crossed.length === 1 && crossed[0] === 5,
    `api billing should cross the $5 rung only, got: ${JSON.stringify(crossed)}`);
});

test('state written before warnedTok existed is tolerated', () => {
  // Older per-session state files have no warnedTok field — read path must treat it as 0.
  const crossed = crossedSpendSteps(CFG, mAt(5100000, 5), { warnedUSD: 0 }, 'subscription');
  assert(crossed.length === 1, 'absent warnedTok must read as a blank floor, not a crash');
});

summary();
