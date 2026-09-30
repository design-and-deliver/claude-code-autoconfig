// Bug-hunt BH-6 + BH-7 (docs/bug-hunt-remediation-plan.md, substep 6.1).
//   BH-6 — a gate that blocks mid-fold used to discard the notes earlier guards had already
//          queued. Those guards consume one-shots as they speak (R2's receipt, R3/R4 flags…), so
//          the warning was gone for good. A block now HOLDS them; the next prompt speaks them.
//   BH-7 — the R12a spike baseline stamped `now` even when the 5h reading came from the 180s
//          usage cache, so the runway denominator started later than the % it was divided into.
//          The stamp is now the reading's own time: a cache hit leaves it where it was.
// Run: node --test token-saver-bh6-bh7.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const HOOK = path.resolve(__dirname, '..', 'token-saver.js');
const { foldPromptGuards, heldNotesGuard, r12aWindowBaselineGuard, resolveConfig } = require(HOOK);

const note = (s) => () => ({ notes: [s], block: null });
const blocker = () => ({ notes: [], block: 'paused' });

// ---------- BH-6 ----------

test('BH-6: a block holds the notes queued before it instead of dropping them', async () => {
  const ctx = { st: {} };
  const r = await foldPromptGuards(ctx, [note('receipt'), note('bomb'), blocker, note('never-ran')]);
  assert.equal(r.block, 'paused');
  assert.deepEqual(ctx.st.heldNotes, ['receipt', 'bomb']);
});

test('BH-6: the next prompt speaks the held notes once, then clears them', async () => {
  const ctx = { st: { heldNotes: ['receipt', 'bomb'] } };
  const r = await foldPromptGuards(ctx, [heldNotesGuard, note('steer')]);
  assert.equal(r.block, null);
  assert.deepEqual(r.notes, ['receipt', 'bomb', 'steer']);
  assert.equal(ctx.st.heldNotes, null);
  const again = await foldPromptGuards(ctx, [heldNotesGuard]);
  assert.deepEqual(again.notes, []);
});

test('BH-6: a per-prompt note held AND re-issued is spoken once, not twice', async () => {
  const ctx = { st: { heldNotes: ['steer'] } };
  const r = await foldPromptGuards(ctx, [heldNotesGuard, note('steer')]);
  assert.deepEqual(r.notes, ['steer']);
});

test('BH-6: a block with nothing queued holds nothing', async () => {
  const ctx = { st: {} };
  await foldPromptGuards(ctx, [blocker]);
  assert.equal(ctx.st.heldNotes ?? null, null);
});

// ---------- BH-7 ----------

const CFG = resolveConfig({});
const usage = (pct) => ({ five_hour: { utilization: pct, resets_at: 'R' } });

test('BH-7: the spike baseline is stamped with the reading time, not now', () => {
  const at = Date.now() - 150000;              // a cache hit: read 150s ago
  const ctx = { cfg: CFG, st: {}, official: usage(30), officialOff: { at } };
  r12aWindowBaselineGuard(ctx);
  assert.equal(ctx.st.lastWindowPct, 30);
  assert.equal(ctx.st.lastWindowAtIso, new Date(at).toISOString());
});

test('BH-7: a cache-hit sequence leaves the baseline on the true interval start', () => {
  const at = Date.now() - 170000;
  const st = {};
  r12aWindowBaselineGuard({ cfg: CFG, st, official: usage(30), officialOff: { at } });
  const first = st.lastWindowAtIso;
  r12aWindowBaselineGuard({ cfg: CFG, st, official: usage(30), officialOff: { at } });   // same cached reading
  assert.equal(st.lastWindowAtIso, first);
  assert.equal(st.lastWindowAtIso, new Date(at).toISOString());
});

test('BH-7: no reading time on the envelope falls back to now', () => {
  const before = Date.now();
  const st = {};
  r12aWindowBaselineGuard({ cfg: CFG, st, official: usage(30), officialOff: null });
  assert.ok(Date.parse(st.lastWindowAtIso) >= before);
});
