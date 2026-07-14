// Cost Control modes: interruption profiles (Token Saver · Standard · Flow State).
// Pure unit tests on resolveConfig / MODE_PROFILES — the static profile layer.
// Run: node --test token-guard-modes.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');
const { resolveConfig, MODE_PROFILES } = require(HOOK);

// ---------- backward compat: empty config == today's standard posture ----------

test('empty config resolves to standard with today\'s shipped posture', () => {
  const c = resolveConfig({});
  assert.equal(c.mode, 'standard');
  // warns/asks on, opt-in blocks off — the pre-modes defaults, unchanged
  assert.equal(c.bombJumpTokens, 50000);
  assert.equal(c.driftNudge, true);
  assert.equal(c.miniBombWarn, true);
  assert.equal(c.idleGate, false);
  assert.equal(c.commandPayloadGate, false);
  assert.equal(c.miniBombGate, false);
  assert.equal(c.bombGateWhenFat, false);
});

test('standard has an intentionally empty static profile', () => {
  assert.deepEqual(MODE_PROFILES.standard, {});
  // so standard === bare defaults on every key it could touch
  assert.deepEqual(resolveConfig({ mode: 'standard' }), resolveConfig({}));
});

test('resolveConfig tolerates null/undefined input (fail-safe)', () => {
  assert.equal(resolveConfig(null).mode, 'standard');
  assert.equal(resolveConfig(undefined).bombJumpTokens, 50000);
});

// ---------- token-saver: more sensitive, blocks flip on ----------

test('token-saver tightens thresholds and turns opt-in blocks on', () => {
  const c = resolveConfig({ mode: 'token-saver' });
  assert.equal(c.bombJumpTokens, 30000);          // more sensitive than 50k default
  assert.equal(c.fanWarnAgents, 5);               // wide-fan asks sooner than 10
  assert.equal(c.idleWarnMinutes, 30);            // idle warns sooner than 60
  assert.equal(c.bombGateWhenFat, true);
  assert.equal(c.idleGate, true);
  assert.equal(c.commandPayloadGate, true);
  assert.equal(c.miniBombGate, true);
});

test('token-saver leaves the R6 drift floor at its principled 100k', () => {
  // below 100k /eval's CUT verdict isn\'t pre-determined — modes must not move it
  assert.equal(resolveConfig({ mode: 'token-saver' }).driftMinContextTokens, 100000);
});

// ---------- flow: quieter, but seatbelt + free-win stay ----------

test('flow raises the shared bomb threshold and silences soft nudges', () => {
  const c = resolveConfig({ mode: 'flow' });
  assert.equal(c.bombJumpTokens, 120000);         // quiets R3 warn / R8 gate / R9 accumulator together
  assert.equal(c.fanWarnAgents, 25);
  assert.equal(c.driftNudge, false);              // soft migrate nudge off
  assert.equal(c.miniBombWarn, false);            // soft mid-turn note off
});

test('flow KEEPS the R4 idle re-write warn — the zero-downside free win', () => {
  const c = resolveConfig({ mode: 'flow' });
  assert.equal(c.idleWarnMinutes, 60);            // unchanged: skipping it is pure loss
});

// ---------- the load-bearing invariant ----------

test('INVARIANT: no mode lowers fanHardCap — the catastrophe DENY seatbelt', () => {
  const floor = resolveConfig({}).fanHardCap;     // default 50
  for (const mode of Object.keys(MODE_PROFILES)) {
    assert.ok(resolveConfig({ mode }).fanHardCap >= floor,
      `${mode} must not lower fanHardCap below ${floor}`);
    // and no profile sets fanHardCap at all — it is never a mode-owned knob
    assert.ok(!(mode in MODE_PROFILES && 'fanHardCap' in MODE_PROFILES[mode]),
      `${mode} profile must not touch fanHardCap`);
  }
});

// ---------- precedence: explicit user key beats the mode ----------

test('an explicitly-set key overrides the mode preset for that key', () => {
  // Flow silences drift, but a user can still pin it back on
  assert.equal(resolveConfig({ mode: 'flow', driftNudge: true }).driftNudge, true);
  // Token Saver turns idleGate on, but a user can veto just that block
  assert.equal(resolveConfig({ mode: 'token-saver', idleGate: false }).idleGate, false);
  // untouched keys still follow the mode
  assert.equal(resolveConfig({ mode: 'flow', driftNudge: true }).bombJumpTokens, 120000);
});

// ---------- unknown mode: safe fallback ----------

test('unknown mode falls back to DEFAULTS + user (no profile applied)', () => {
  const c = resolveConfig({ mode: 'turbo', bombJumpTokens: 99000 });
  assert.equal(c.bombJumpTokens, 99000);          // user key honored
  assert.equal(c.fanHardCap, 50);                 // defaults intact, seatbelt intact
  assert.equal(c.driftNudge, true);               // no phantom flow-style suppression
});
