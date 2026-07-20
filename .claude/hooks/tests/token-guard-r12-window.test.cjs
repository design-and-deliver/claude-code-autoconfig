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
  resolveConfig, TOKEN_SAVER,
  fiveHourWindow, tightestWindow, windowSpikeVerdict, windowThresholdVerdict, effectiveWarn,
  windowSpikeNote, windowSpikeConfirmNote, windowThresholdNote, windowThresholdGateReason,
} = require(HOOK);

const CFG = resolveConfig({});                 // light default (token-saver off): spike 20, threshold 80

// ---------- config surface: on by default, plan-agnostic thresholds ----------

test('window guards ship ON with 20/80 thresholds by default', () => {
  assert.equal(CFG.windowSpikeWarn, true);
  assert.equal(CFG.windowSpikeWarnPct, 20);
  assert.equal(CFG.windowSpikeConfirm, true);      // spike renders as the interactive confirm card
  assert.equal(CFG.windowThresholdWarn, true);
  assert.deepEqual(CFG.windowThresholdWarnPct, [50, 80]);  // warn ladder since 2026-07-18
});

test('the throttle gate is OPT-IN — the light default is the end-of-response note', () => {
  assert.equal(CFG.windowThresholdGate, false);
  assert.equal(resolveConfig({ tokenSaver: false }).windowThresholdGate, false);
  assert.equal(resolveConfig({ tokenSaver: true }).windowThresholdGate, true);   // token-saver arms it
  assert.equal(resolveConfig({ windowThresholdGate: true }).windowThresholdGate, true); // a user can pin it on solo
});

test('token-saver flags the spike sooner (10); threshold rides the 80 default; gate armed by the preset', () => {
  const ts = resolveConfig({ tokenSaver: true });
  assert.equal(ts.windowSpikeWarnPct, 10);         // sooner than the 20 default
  assert.deepEqual(ts.windowThresholdWarnPct, [50, 80]);  // rides the default ladder
  assert.equal(ts.windowThresholdGate, true);      // hard-pause at the mark
  // the default (toggle off) keeps the lighter spike (20) + soft card, and the NOTE (no gate)
  assert.equal(CFG.windowSpikeWarn, true);
  assert.equal(CFG.windowSpikeConfirm, true);
  assert.equal(CFG.windowThresholdWarn, true);
  assert.equal(CFG.windowThresholdGate, false);
  assert.equal(CFG.windowSpikeWarnPct, 20);
});

test('an explicit gate key beats the preset in both directions', () => {
  assert.equal(resolveConfig({ windowThresholdGate: true }).windowThresholdGate, true);         // on without token-saver
  assert.equal(resolveConfig({ tokenSaver: true, windowThresholdGate: false }).windowThresholdGate, false); // off despite token-saver
});

test('toggle off resolves to the bare defaults (no preset overlaid)', () => {
  assert.deepEqual(resolveConfig({ tokenSaver: false }), resolveConfig({}));
});

test('the spike confirm card ships ON with the toggle both off and on (a SOFT relay, rides DEFAULTS)', () => {
  assert.equal(resolveConfig({ tokenSaver: false }).windowSpikeConfirm, true);
  assert.equal(resolveConfig({ tokenSaver: true }).windowSpikeConfirm, true);
  // it's a config default, not a preset override — a user can still turn it off explicitly
  assert.equal(resolveConfig({ windowSpikeConfirm: false }).windowSpikeConfirm, false);
  assert.ok(!('windowSpikeConfirm' in TOKEN_SAVER));   // the preset doesn't pin it — it rides DEFAULTS
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

// ---------- R12b windowThresholdVerdict(): one-shot per rung per window cycle ----------

const HOT = { pct: 82, name: '5h window', resetsAt: R };
const WARNED = { name: '5h window', resetsAt: R, rung: 80 };   // what state stashes after a top-rung fire

test('threshold fires the top rung when the tightest window is at/over it', () => {
  const v = windowThresholdVerdict(HOT, null, CFG);
  assert.equal(v.fire, true);
  assert.equal(v.pct, 82);
  assert.equal(v.name, '5h window');
  assert.equal(v.rung, 80);
  assert.equal(v.topRung, 80);
});

test('threshold fires the 50 rung between the marks (a quiet bearing)', () => {
  const v = windowThresholdVerdict({ ...HOT, pct: 63 }, null, CFG);
  assert.equal(v.fire, true);
  assert.equal(v.rung, 50);
  assert.equal(v.topRung, 80);
});

test('threshold stays quiet below the lowest rung', () => {
  assert.equal(windowThresholdVerdict({ ...HOT, pct: 49 }, null, CFG).fire, false);
});

test('threshold is one-shot per rung — the same window/rung this cycle does not re-fire', () => {
  assert.equal(windowThresholdVerdict(HOT, WARNED, CFG).fire, false);                       // 80 fired, still 80s
  const warned50 = { name: '5h window', resetsAt: R, rung: 50 };
  assert.equal(windowThresholdVerdict({ ...HOT, pct: 63 }, warned50, CFG).fire, false);     // 50 fired, still 50s
});

test('escalating to a higher rung mid-cycle fires again', () => {
  const warned50 = { name: '5h window', resetsAt: R, rung: 50 };
  const v = windowThresholdVerdict(HOT, warned50, CFG);   // 50 fired earlier, now at 82
  assert.equal(v.fire, true);
  assert.equal(v.rung, 80);
});

test('BACK-COMPAT: pre-ladder warned state (no rung) suppresses everything this cycle', () => {
  const legacy = { name: '5h window', resetsAt: R };      // old shape — treated as top-rung-fired
  assert.equal(windowThresholdVerdict(HOT, legacy, CFG).fire, false);
  assert.equal(windowThresholdVerdict({ ...HOT, pct: 63 }, legacy, CFG).fire, false);
});

test('BACK-COMPAT: a pinned single number still works as a one-rung ladder', () => {
  const cfg = resolveConfig({ windowThresholdWarnPct: 80 });
  assert.equal(windowThresholdVerdict({ ...HOT, pct: 63 }, null, cfg).fire, false);  // no 50 rung
  const v = windowThresholdVerdict(HOT, null, cfg);
  assert.equal(v.fire, true);
  assert.equal(v.rung, 80);
  assert.equal(v.topRung, 80);
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

// ---------- effectiveWarn(): global (cross-session) rung memory unioned with the session field ----------

test('REGRESSION: a fresh session must NOT re-announce a rung another session already fired', () => {
  // the 2026-07-19 bug: rung memory was per-session, so a fresh session at 75% re-fired the
  // 50 rung and FYI\'d a random-looking "~75% used". With global memory the fresh session
  // (session field null) inherits the global entry and the verdict stays quiet.
  const worst = { pct: 75, name: 'Weekly (Fable)', resetsAt: R };
  const global50 = { name: 'Weekly (Fable)', resetsAt: R, rung: 50 };
  const warned = effectiveWarn(worst, global50, null);       // fresh session: no session memory
  assert.equal(warned, global50);
  assert.equal(windowThresholdVerdict(worst, warned, CFG).fire, false);
  // …but a genuine escalation past the NEXT rung still fires
  assert.equal(windowThresholdVerdict({ ...worst, pct: 82 }, warned, CFG).fire, true);
});

test('effectiveWarn keeps the session entry when it suppresses more (in-flight session, pre-global fire)', () => {
  const worst = { pct: 82, name: '5h window', resetsAt: R };
  const session80 = { name: '5h window', resetsAt: R, rung: 80 };
  assert.equal(effectiveWarn(worst, null, session80), session80);          // no global file yet
  assert.equal(effectiveWarn(worst, { name: '5h window', resetsAt: R, rung: 50 }, session80), session80);
});

test('effectiveWarn treats a pre-ladder entry (no rung) as top-fired, like the verdict does', () => {
  const worst = { pct: 82, name: '5h window', resetsAt: R };
  const legacy = { name: '5h window', resetsAt: R };
  const global50 = { name: '5h window', resetsAt: R, rung: 50 };
  assert.equal(effectiveWarn(worst, legacy, global50), legacy);
});

test('effectiveWarn ignores entries for another window or cycle and is null-safe', () => {
  const worst = { pct: 63, name: 'Weekly (Fable)', resetsAt: R };
  const otherWindow = { name: '5h window', resetsAt: R, rung: 80 };
  const matching = { name: 'Weekly (Fable)', resetsAt: R, rung: 50 };
  assert.equal(effectiveWarn(worst, otherWindow, matching), matching);     // name mismatch loses
  assert.equal(effectiveWarn(worst, null, null), null);
  assert.equal(effectiveWarn(null, matching, null), matching);
  // an other-window-only pair still returns something the verdict safely ignores
  assert.equal(windowThresholdVerdict(worst, effectiveWarn(worst, otherWindow, null), CFG).fire, true);
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

test('windowThresholdNote (below top rung) is a quiet ⚠️-free FYI bearing', () => {
  const note = windowThresholdNote({ pct: 63, name: '5h window', resetsAt: R, rung: 50, topRung: 80 }, CFG);
  assert.match(note, /STANDALONE/);
  assert.match(note, /close the response/);        // placement: AFTER the answer
  assert.match(note, /FYI: your 5h window is at ~63% used/);
  assert.ok(!/⚠️/.test(note), 'the 50 rung must not carry the alarm glyph — it would wallpaper the 80');
  assert.ok(!/\$\d/.test(note), 'must not contain a $ amount');
});

test('windowThresholdNote (top rung) is an end-of-response one-line checkpoint — heads-up copy, dollar-free', () => {
  const note = windowThresholdNote({ pct: 82, name: '5h window', resetsAt: R, rung: 80, topRung: 80 }, CFG);
  assert.match(note, /STANDALONE/);
  assert.match(note, /close the response/);        // placement: AFTER the answer, not before it
  assert.match(note, /heads up/);
  assert.match(note, /ONE sentence/);              // checkpoint, not coaching
  assert.match(note, /5h window/);
  assert.match(note, /82% used/);
  assert.match(note, /throttle/);
  assert.match(note, /not a bill/);
  assert.ok(!/\$\d/.test(note), 'must not contain a $ amount');
});

test('windowThresholdGateReason is USER-facing and tight: state + ↑+Enter escape, no lecture/no $', () => {
  const reason = windowThresholdGateReason({ pct: 82, name: '5h window', resetsAt: R });
  assert.match(reason, /⚠️ Hey/);
  assert.match(reason, /82% used/);
  assert.match(reason, /↑ then Enter/);          // the escape hatch, verbatim like idleGate
  assert.ok(!/throttle/.test(reason), 'the throttle explainer was deliberately cut (2026-07-18)');
  assert.ok(!/STANDALONE/.test(reason), 'user-facing text carries no relay instructions to the model');
  assert.ok(!/\$\d/.test(reason), 'must not contain a $ amount');
});

// ---------- R12a confirm-card copy: AskUserQuestion relay, two options, /analyze-session, dollar-free ----------

test('windowSpikeConfirmNote relays a two-option AskUserQuestion card, dollar-free', () => {
  const note = windowSpikeConfirmNote({ spikePct: 23, fromPct: 10, toPct: 33, estimated: false }, now(33), 'sid123');
  assert.match(note, /AskUserQuestion/);
  assert.match(note, /⚠️ Hey/);
  assert.match(note, /23%/);                       // names the measured jump
  assert.match(note, /Keep going/);                // option 1 (primary)
  assert.match(note, /Unpack/);                    // option 2
  assert.ok(!/\$\d/.test(note), 'window budget is a throttle, not money — never a $');
});

test('windowSpikeConfirmNote routes Unpack to /analyze-session for THIS session, and waits (no answer yet)', () => {
  const note = windowSpikeConfirmNote({ spikePct: 40, fromPct: 5, toPct: 45, estimated: false }, now(45), 'abc987');
  assert.match(note, /\/analyze-session abc987/);          // sid-scoped digest
  assert.match(note, /do NOT answer the original prompt/i); // it pauses instead of answering
});

test('windowSpikeConfirmNote is a SOFT relay — carries no decision:block (that is what keeps it flow-safe)', () => {
  const note = windowSpikeConfirmNote({ spikePct: 22, fromPct: 8, toPct: 30, estimated: false }, now(30), 'x');
  assert.ok(!/decision.{0,4}block/i.test(note), 'the confirm card is a relay, not a hard block');
});

test('windowSpikeConfirmNote labels the estimate path and omits the sid when the session id is absent', () => {
  const note = windowSpikeConfirmNote({ spikePct: 40, fromPct: null, toPct: null, estimated: true }, null, '');
  assert.match(note, /estimated ~40%/);
  assert.match(note, /not measured/);
  assert.match(note, /\/analyze-session/);
  assert.ok(!/\/analyze-session \w/.test(note), 'no sid to append when the session id is empty');
});
