// R12 window guards — plan-aware throttle flags for subscription (Max) sessions, where the
// constraint is a rate-limit WINDOW, not a dollar bill. Two instruments:
//   R12a windowSpikeVerdict — one turn ate a big slice of the 5h window (meter %-delta, self-calibrating)
//   R12b windowThresholdVerdict — the tightest live window crossed the high-water mark (one-shot/cycle)
// Pure unit tests on the exported verdict/extractor/note functions (like driftVerdict / driftNote).
// Run: node --test token-guard-r12-window.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');
const {
  resolveConfig, MODE_PROFILES,
  fiveHourWindow, tightestWindow, windowSpikeVerdict, windowThresholdVerdict,
  windowSpikeNote, windowThresholdNote, windowThresholdGateReason,
} = require(HOOK);

const CFG = resolveConfig({});                 // standard: spike 20, threshold 80

// ---------- config surface: on by default, plan-agnostic thresholds ----------

test('window guards ship ON with 20/80 thresholds in standard', () => {
  assert.equal(CFG.windowSpikeWarn, true);
  assert.equal(CFG.windowSpikeWarnPct, 20);
  assert.equal(CFG.windowThresholdWarn, true);
  assert.equal(CFG.windowThresholdWarnPct, 80);
});

test('the window gate is opt-in — off by default and in standard', () => {
  assert.equal(CFG.windowThresholdGate, false);
  assert.equal(resolveConfig({ mode: 'standard' }).windowThresholdGate, false);
});

test('token-saver flags sooner (15/75) AND flips the gate on; flow keeps note-only', () => {
  const ts = resolveConfig({ mode: 'token-saver' });
  assert.equal(ts.windowSpikeWarnPct, 15);
  assert.equal(ts.windowThresholdWarnPct, 75);
  assert.equal(ts.windowThresholdGate, true);      // max protection: hard-pause at the mark
  const flow = resolveConfig({ mode: 'flow' });
  // throttle-avoidance is a seatbelt (note stays on), but a hard BLOCK contradicts "never break flow"
  assert.equal(flow.windowSpikeWarn, true);
  assert.equal(flow.windowThresholdWarn, true);
  assert.equal(flow.windowThresholdGate, false);   // note yes, block no
  assert.equal(flow.windowSpikeWarnPct, 20);
  assert.equal(flow.windowThresholdWarnPct, 80);
});

test('a user can pin the gate on in any mode (explicit key beats the mode)', () => {
  assert.equal(resolveConfig({ mode: 'flow', windowThresholdGate: true }).windowThresholdGate, true);
  assert.equal(resolveConfig({ mode: 'token-saver', windowThresholdGate: false }).windowThresholdGate, false);
});

test('standard profile stays empty (window keys ride bare defaults there)', () => {
  assert.deepEqual(MODE_PROFILES.standard, {});
});

// ---------- fiveHourWindow(): flat field first, limits[] fallback, null-safe ----------

test('fiveHourWindow reads the flat five_hour field', () => {
  const u = { five_hour: { utilization: 33, resets_at: 'R' }, seven_day: { utilization: 3 } };
  assert.deepEqual(fiveHourWindow(u), { pct: 33, resetsAt: 'R' });
});

test('fiveHourWindow falls back to the session limit in limits[]', () => {
  const u = { limits: [{ kind: 'session', percent: 41, resets_at: 'R2' }, { kind: 'weekly_all', percent: 5 }] };
  assert.deepEqual(fiveHourWindow(u), { pct: 41, resetsAt: 'R2' });
});

test('fiveHourWindow returns null when the meter carried no 5h figure', () => {
  assert.equal(fiveHourWindow(null), null);
  assert.equal(fiveHourWindow({}), null);
  assert.equal(fiveHourWindow({ seven_day: { utilization: 3 } }), null);
});

// ---------- tightestWindow(): highest % across every horizon, re-arm key ----------

test('tightestWindow picks the highest-% window across horizons', () => {
  const u = { limits: [
    { kind: 'session', percent: 33, resets_at: 'A' },
    { kind: 'weekly_all', percent: 82, resets_at: 'B' },
  ] };
  const w = tightestWindow(u);
  assert.equal(w.pct, 82);
  assert.equal(w.name, 'Weekly (all models)');
  assert.equal(w.resetsAt, 'B');
});

test('tightestWindow labels a model-scoped weekly cap by its model name', () => {
  const u = { limits: [{ kind: 'weekly_scoped', percent: 95, resets_at: 'C',
    scope: { model: { display_name: 'Fable' } } }] };
  assert.equal(tightestWindow(u).name, 'Weekly (Fable)');
});

test('tightestWindow falls back to flat fields and is null-safe', () => {
  assert.equal(tightestWindow(null), null);
  assert.equal(tightestWindow({}), null);
  const flat = tightestWindow({ five_hour: { utilization: 70, resets_at: 'A' },
    seven_day: { utilization: 88, resets_at: 'B' } });
  assert.equal(flat.pct, 88);
  assert.equal(flat.name, 'Weekly (all models)');
});

// ---------- R12a windowSpikeVerdict(): the self-calibrating 5h %-delta ----------

const R = '2026-07-15T08:20:00Z';
const now = pct => ({ pct, resetsAt: R });

test('spike fires when the 5h window jumped >= the threshold since the last prompt', () => {
  const v = windowSpikeVerdict(now(33), { pct: 10, resetsAt: R }, 0, CFG);
  assert.equal(v.fire, true);
  assert.equal(v.spikePct, 23);
  assert.equal(v.fromPct, 10);
  assert.equal(v.toPct, 33);
  assert.equal(v.estimated, false);   // measured off Anthropic's meter, not calibrated
});

test('spike stays quiet on a small hop below the threshold', () => {
  assert.equal(windowSpikeVerdict(now(33), { pct: 20, resetsAt: R }, 0, CFG).fire, false);
});

test('spike stays quiet on the first prompt (no baseline to diff against)', () => {
  assert.equal(windowSpikeVerdict(now(33), null, 0, CFG).fire, false);
});

test('spike does NOT fire across a window reset — it re-baselines instead of reading the drop as a jump', () => {
  // new cycle: resets_at moved a full 5h and pct dropped to ~0. A naive delta would be hugely
  // negative; a naive abs() would misread the reset as a spike. The same-cycle guard skips both.
  const prevCycle = { pct: 90, resetsAt: '2026-07-15T03:20:00Z' };  // 5h before R
  assert.equal(windowSpikeVerdict(now(5), prevCycle, 0, CFG).fire, false);
});

test('REGRESSION: spike STILL fires when resets_at jitters sub-second within one cycle', () => {
  // the server recomputes resets_at with ~0.5s jitter each fetch (real values, observed live).
  // exact-string cycle matching broke this outright — the baseline never lined up, so a genuine
  // 40-point jump was silently dropped. Tolerance-based same-cycle identity is what fixes it.
  const prev = { pct: 5, resetsAt: '2026-07-15T08:20:00.504765+00:00' };
  const nowJitter = { pct: 45, resetsAt: '2026-07-15T08:19:59.975486+00:00' };
  const v = windowSpikeVerdict(nowJitter, prev, 0, CFG);
  assert.equal(v.fire, true);
  assert.equal(v.spikePct, 40);
});

test('spike caps at a full window — a >100pt "jump" is a meter artifact (post-outage re-baseline), not a turn', () => {
  assert.equal(windowSpikeVerdict(now(100), { pct: -50, resetsAt: R }, 0, CFG).fire, false);
});

test('spike falls back to weighted $ vs windowBudgetUSD only when the meter is unreachable', () => {
  const cfg = resolveConfig({ windowBudgetUSD: 20 });
  const v = windowSpikeVerdict(null, { pct: 10, resetsAt: R }, 8, cfg);  // $8 of a $20 window = 40%
  assert.equal(v.fire, true);
  assert.equal(v.spikePct, 40);
  assert.equal(v.estimated, true);   // labeled: calibrated, not measured
});

test('spike stays silent when the meter is down AND no windowBudgetUSD proxy is set', () => {
  assert.equal(windowSpikeVerdict(null, { pct: 10, resetsAt: R }, 8, CFG).fire, false);
});

// ---------- R12b windowThresholdVerdict(): one-shot per window cycle ----------

const HOT = { pct: 82, name: '5h window', resetsAt: R };
const WARNED = { name: '5h window', resetsAt: R };   // what state stashes after a fire

test('threshold fires when the tightest window is at/over the mark', () => {
  const v = windowThresholdVerdict(HOT, null, CFG);
  assert.equal(v.fire, true);
  assert.equal(v.pct, 82);
  assert.equal(v.name, '5h window');
});

test('threshold stays quiet below the mark', () => {
  assert.equal(windowThresholdVerdict({ ...HOT, pct: 79 }, null, CFG).fire, false);
});

test('threshold is one-shot per cycle — the same window this cycle does not re-fire', () => {
  assert.equal(windowThresholdVerdict(HOT, WARNED, CFG).fire, false);
});

test('REGRESSION: threshold does NOT re-nag on sub-second resets_at jitter (still same cycle)', () => {
  // without tolerance matching this re-fired every single prompt while over 80% — the worst UX bug
  const jittered = { ...HOT, resetsAt: '2026-07-15T08:19:59.975486+00:00' };
  const warned = { name: '5h window', resetsAt: '2026-07-15T08:20:00.504765+00:00' };
  assert.equal(windowThresholdVerdict(jittered, warned, CFG).fire, false);
});

test('threshold re-arms when the window actually resets (resets_at a full cycle later)', () => {
  const next = { ...HOT, resetsAt: '2026-07-15T13:20:00Z' };  // 5h after R = a real new cycle
  assert.equal(windowThresholdVerdict(next, WARNED, CFG).fire, true);
});

test('threshold re-fires for a DIFFERENT window even within the same cycle', () => {
  const weekly = { pct: 84, name: 'Weekly (all models)', resetsAt: 'W' };
  assert.equal(windowThresholdVerdict(weekly, WARNED, CFG).fire, true);  // 5h warned, weekly is new
});

test('threshold null-safe when the meter carried no window', () => {
  assert.equal(windowThresholdVerdict(null, null, CFG).fire, false);
});

// ---------- note copy: the relay contract, and NEVER a dollar figure ----------

test('windowSpikeNote keeps the standalone-⚠️-block contract and stays dollar-free', () => {
  const note = windowSpikeNote({ spikePct: 23, fromPct: 10, toPct: 33, estimated: false }, now(33));
  assert.match(note, /STANDALONE/);
  assert.match(note, /⚠️ Hey/);
  assert.match(note, /23 points/);           // names the jump in window %
  assert.match(note, /NO dollar figures/);
  assert.ok(!/\$\d/.test(note), 'must not contain a $ amount — window budget is not money');
});

test('windowSpikeNote labels the estimate path as calibrated, not measured', () => {
  const note = windowSpikeNote({ spikePct: 40, fromPct: null, toPct: null, estimated: true }, null);
  assert.match(note, /estimated ~40%/);
  assert.match(note, /not measured/);
});

test('windowThresholdNote names window/%/reset, frames it as a throttle not a bill, dollar-free', () => {
  const note = windowThresholdNote({ pct: 82, name: '5h window', resetsAt: R }, CFG);
  assert.match(note, /STANDALONE/);
  assert.match(note, /5h window/);
  assert.match(note, /82% used/);
  assert.match(note, /throttle/);
  assert.match(note, /not a bill/);
  assert.ok(!/\$\d/.test(note), 'must not contain a $ amount');
});

test('windowThresholdGateReason is USER-facing: ↑+Enter escape, throttle framing, no relay/no $', () => {
  const reason = windowThresholdGateReason({ pct: 82, name: '5h window', resetsAt: R });
  assert.match(reason, /⚠️ Hey/);
  assert.match(reason, /82% used/);
  assert.match(reason, /↑ then Enter/);          // the escape hatch, verbatim like idleGate
  assert.match(reason, /throttle/);
  assert.ok(!/STANDALONE/.test(reason), 'user-facing text carries no relay instructions to the model');
  assert.ok(!/\$\d/.test(reason), 'must not contain a $ amount');
});
