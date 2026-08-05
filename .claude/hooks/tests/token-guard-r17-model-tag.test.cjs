// R17 model-tag validation — a substep heading's `· [tag]` routing token checked against the
// transcript's own model id. Generic by design: any bracketed tag, substring-matched, no enum.
// Run: node --test token-guard-r17-model-tag.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');
const { meter, parsePlanSubsteps, parsePlanLedger, findCurrentSubstep,
  planBoundaryNote, planModelMismatchLine } = require(HOOK);

// Fixture plans -----------------------------------------------------------------

const PLAN_AT_BOUNDARY = [
  '# Fixture plan',
  '### ☑ 1.1 · S · ~15m — done thing · [fable] (DONE 2026-08-01, see Ledger)',
  '### ☐ 1.2 · M · ~45m — next thing · [opus]',
  '### ☐ 1.3 · M — untagged thing',
  '## Ledger',
  '- 2026-08-01 — 1.1 done. Commit `abc1234`.',
].join('\n');

const PLAN_MID_SUBSTEP = PLAN_AT_BOUNDARY.replace(
  '- 2026-08-01 — 1.1 done. Commit `abc1234`.',
  '- 2026-08-02 — 1.2 progress note, still open.');

// Tag grammar -------------------------------------------------------------------

test('parsePlanSubsteps: trailing `· [tag]` lands as .model, lowercased', () => {
  const subs = parsePlanSubsteps(PLAN_AT_BOUNDARY);
  assert.strictEqual(subs.length, 3);
  assert.strictEqual(subs[1].model, 'opus');
});

test('parsePlanSubsteps: tag survives a (DONE …) suffix after it', () => {
  const subs = parsePlanSubsteps(PLAN_AT_BOUNDARY);
  assert.strictEqual(subs[0].done, true);
  assert.strictEqual(subs[0].model, 'fable');
});

test('parsePlanSubsteps: an untagged heading has no .model at all', () => {
  const subs = parsePlanSubsteps(PLAN_AT_BOUNDARY);
  assert.strictEqual(subs[2].model, undefined);
});

// Verdict carry-through -----------------------------------------------------------

test('findCurrentSubstep: the current substep\'s tag rides on the verdict', () => {
  const v = findCurrentSubstep(PLAN_AT_BOUNDARY, parsePlanLedger(PLAN_AT_BOUNDARY));
  assert.strictEqual(v.substepId, '1.2');
  assert.strictEqual(v.isBoundary, true);
  assert.strictEqual(v.model, 'opus');
});

test('findCurrentSubstep: mid-substep verdict carries the tag too', () => {
  const v = findCurrentSubstep(PLAN_MID_SUBSTEP, parsePlanLedger(PLAN_MID_SUBSTEP));
  assert.strictEqual(v.isBoundary, false);
  assert.strictEqual(v.model, 'opus');
});

// Mismatch line -------------------------------------------------------------------

const AT_BOUNDARY = { substepId: '1.2', model: 'opus', isBoundary: true, planPath: 'p.md', reason: 'r' };
const MID = { substepId: '1.2', model: 'opus', isBoundary: false, planPath: 'p.md', reason: 'r' };

test('mismatch at a boundary names the /model switch for the handoff', () => {
  const line = planModelMismatchLine(AT_BOUNDARY, 'claude-fable-5');
  assert.match(line, /tagged \[opus\]/);
  assert.match(line, /\/model opus/);
});

test('mismatch mid-substep steers to restart-or-ledger, not the handoff', () => {
  const line = planModelMismatchLine(MID, 'claude-fable-5');
  assert.match(line, /Ledger entry/);
  assert.doesNotMatch(line, /\/model opus before/);
});

test('substring match: [opus] against claude-opus-5 is NOT a mismatch', () => {
  assert.strictEqual(planModelMismatchLine(AT_BOUNDARY, 'claude-opus-5'), '');
});

test('silent when the substep is untagged or the meter has no model', () => {
  assert.strictEqual(planModelMismatchLine({ ...AT_BOUNDARY, model: null }, 'claude-fable-5'), '');
  assert.strictEqual(planModelMismatchLine(AT_BOUNDARY, ''), '');
});

test('planBoundaryNote appends the mismatch line only on mismatch', () => {
  const hit = planBoundaryNote(AT_BOUNDARY, 'claude-fable-5');
  assert.match(hit, /tagged \[opus\]/);
  const clean = planBoundaryNote(AT_BOUNDARY, 'claude-opus-5');
  assert.doesNotMatch(clean, /tagged \[opus\]/);
  const legacy = planBoundaryNote(AT_BOUNDARY); // pre-tag call shape still works
  assert.doesNotMatch(legacy, /tagged \[opus\]/);
});

// meter.lastModel -----------------------------------------------------------------

test('meter: lastModel is the model of the transcript\'s final request', () => {
  const line = (id, model) => JSON.stringify({
    type: 'assistant', timestamp: '2026-08-05T00:00:00Z',
    message: { id, model, usage: { input_tokens: 10, output_tokens: 5 } },
  });
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-r17-')), 't.jsonl');
  fs.writeFileSync(tmp, line('m1', 'claude-opus-5') + '\n' + line('m2', 'claude-fable-5') + '\n');
  assert.strictEqual(meter(tmp).lastModel, 'claude-fable-5');
});
