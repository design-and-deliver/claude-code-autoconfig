// Cost Control — a single on/off toggle (`tokenSaver`), off by default. Off is the light
// default posture; on overlays the TOKEN_SAVER preset (tighter thresholds + the opt-in blocks).
// Pure unit tests on resolveConfig / TOKEN_SAVER — the static overlay layer.
// Run: node --test token-guard-modes.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');
const { resolveConfig, TOKEN_SAVER } = require(HOOK);

// ---------- default: toggle OFF == the light shipped posture ----------

test('empty config resolves to the light default (token-saver off)', () => {
  const c = resolveConfig({});
  assert.equal(c.tokenSaver, false);              // the toggle defaults to off
  // warns/asks on, opt-in blocks off — the light default posture, unchanged
  assert.equal(c.bombJumpTokens, 50000);
  assert.equal(c.contextWarnTokens, 150000);
  assert.equal(c.driftNudge, true);
  assert.equal(c.miniBombWarn, true);
  assert.equal(c.idleGate, false);
  assert.equal(c.commandPayloadGate, false);
  assert.equal(c.miniBombGate, false);
  assert.equal(c.bombGateWhenFat, false);
  assert.equal(c.windowThresholdGate, false);     // 80% stopgate demoted to opt-in 2026-07-18 — the note is the default
});

test('an explicit tokenSaver:false is identical to the empty (off) config', () => {
  assert.deepEqual(resolveConfig({ tokenSaver: false }), resolveConfig({}));
});

test('resolveConfig tolerates null/undefined input (fail-safe → light default)', () => {
  assert.equal(resolveConfig(null).bombJumpTokens, 50000);
  assert.equal(resolveConfig(undefined).idleGate, false);
});

// ---------- toggle ON: tighter thresholds, opt-in blocks flip on ----------

test('tokenSaver:true tightens thresholds and turns the opt-in blocks on', () => {
  const c = resolveConfig({ tokenSaver: true });
  assert.equal(c.bombJumpTokens, 30000);          // more sensitive than 50k default
  assert.equal(c.fanWarnAgents, 5);               // wide-fan asks sooner than 10
  assert.equal(c.idleWarnMinutes, 30);            // idle warns sooner than 60
  assert.equal(c.contextWarnTokens, 100000);      // context warns sooner than 150k
  assert.equal(c.windowSpikeWarnPct, 10);         // single-turn spike flags sooner than 20
  assert.equal(c.bombGateWhenFat, true);
  assert.equal(c.idleGate, true);
  assert.equal(c.commandPayloadGate, true);
  assert.equal(c.miniBombGate, true);
  assert.equal(c.windowThresholdGate, true);      // flips on with the other opt-in blocks (demoted from DEFAULTS 2026-07-18)
});

test('tokenSaver leaves the R6 drift floor at its principled 100k', () => {
  // below 100k /eval's CUT verdict isn't pre-determined — the toggle must not move it
  assert.equal(resolveConfig({ tokenSaver: true }).driftMinContextTokens, 100000);
});

// ---------- retired modes: legacy compat + safe fallback ----------

test('a legacy `mode: "token-saver"` string still turns the toggle on', () => {
  assert.equal(resolveConfig({ mode: 'token-saver' }).idleGate, true);
  assert.equal(resolveConfig({ mode: 'token-saver' }).windowThresholdGate, true);
});

test('the retired standard/flow modes resolve to the light default (no phantom suppression)', () => {
  for (const mode of ['standard', 'flow', 'turbo']) {
    const c = resolveConfig({ mode });
    assert.equal(c.driftNudge, true);             // flow used to silence this — no longer
    assert.equal(c.idleGate, false);              // no opt-in blocks leak in
    assert.equal(c.windowThresholdGate, false);   // the 80% gate is opt-in now — retired modes don't arm it
    assert.equal(c.fanHardCap, 50);               // seatbelt intact
  }
});

// ---------- the load-bearing invariant ----------

test('INVARIANT: token-saver never lowers fanHardCap and never owns that knob', () => {
  const floor = resolveConfig({}).fanHardCap;     // default 50
  assert.ok(resolveConfig({ tokenSaver: true }).fanHardCap >= floor,
    `token-saver must not lower fanHardCap below ${floor}`);
  assert.ok(!('fanHardCap' in TOKEN_SAVER), 'fanHardCap is never a preset-owned knob');
});

// ---------- precedence: explicit user key beats the preset ----------

test('an explicitly-set key overrides the preset for that key', () => {
  // token-saver turns idleGate on, but a user can veto just that block
  assert.equal(resolveConfig({ tokenSaver: true, idleGate: false }).idleGate, false);
  // a pinned context warn beats the preset in either direction
  assert.equal(resolveConfig({ tokenSaver: true, contextWarnTokens: 200000 }).contextWarnTokens, 200000);
  // and a user can pin a block ON without the toggle at all
  assert.equal(resolveConfig({ windowThresholdGate: true }).windowThresholdGate, true);
  // untouched keys still follow the preset
  assert.equal(resolveConfig({ tokenSaver: true, idleGate: false }).bombJumpTokens, 30000);
});
