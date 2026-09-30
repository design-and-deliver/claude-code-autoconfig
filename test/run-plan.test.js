/**
 * Suite for scripts/run-plan.js's 👤 human-step gate.
 *
 * run-plan.js exports nothing and spawns `claude -p` in its loop, so this drives the real
 * script with --dry-run (which spawns nothing) against fixture plans in temp dirs.
 *
 * Contracts pinned here:
 *   - a next unchecked substep whose heading carries 👤 stops the run with exit 5 and prints
 *     that substep's body — no session is spawned for it;
 *   - --human-done ticks that substep and appends a Ledger line, then the run carries on;
 *   - --human-done refuses (exit 1) when the next substep is not a 👤 step;
 *   - a 👤 step that is not next does not stop the run.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, assert, summary } = require('./_harness');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'run-plan.js');

const fixtures = [];
function makePlan(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-runplan-'));
  fixtures.push(dir);
  const plan = path.join(dir, 'plan.md');
  fs.writeFileSync(plan, content);
  return plan;
}

function run(plan, ...extra) {
  const r = spawnSync(process.execPath, [SCRIPT, '--plan', plan, '--dry-run', ...extra], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const PLAN = [
  '# Demo plan',
  '',
  '### ☑ 1.1 · S · ~10m — Write the extension',
  'done',
  '',
  '### ☐ 1.2 · S · ~5m — 👤 Reload the extension',
  'Open chrome://extensions and click reload on Demo.',
  '',
  '### ☐ 1.3 · S · ~10m — Test the extension',
  'Run the suite.',
  '',
  '## Ledger',
  '',
  '- 2026-09-30 — 1.1 — done',
  '',
].join('\n');

test('stops before a 👤 substep and prints its instructions', () => {
  const res = run(makePlan(PLAN));
  assert(res.code === 5, `expected exit 5, got ${res.code}: ${res.out}`);
  assert(res.out.includes('needs a human'), 'must say a human is needed');
  assert(res.out.includes('click reload on Demo'), 'must print the substep body');
  assert(!res.out.includes('child prompt would be'), 'must not reach the child prompt');
});

test('--human-done ticks the step, logs it, and carries on', () => {
  const plan = makePlan(PLAN);
  const res = run(plan, '--human-done');
  const text = fs.readFileSync(plan, 'utf8');
  assert(res.code === 0, `expected exit 0, got ${res.code}: ${res.out}`);
  assert(text.includes('### ☑ 1.2 · S · ~5m — 👤 Reload the extension'), 'step must be ticked');
  assert(/- \d{4}-\d\d-\d\d — 1\.2 — 👤 done by hand/.test(text), 'Ledger line must be appended');
  assert(text.includes('### ☐ 1.3'), 'later steps stay unchecked');
  assert(res.out.includes('child prompt would be'), 'run must carry on to the next substep');
});

test('--human-done refuses when the next step is not a 👤 step', () => {
  const plan = makePlan(PLAN.replace('— 👤 Reload', '— Reload'));
  const before = fs.readFileSync(plan, 'utf8');
  const res = run(plan, '--human-done');
  assert(res.code === 1, `expected exit 1, got ${res.code}: ${res.out}`);
  assert(fs.readFileSync(plan, 'utf8') === before, 'plan must be untouched');
});

test('a 👤 step later in the plan does not stop the run early', () => {
  const plan = makePlan(PLAN.replace('### ☐ 1.2', '### ☑ 1.2').replace(
    '## Ledger', '### ☐ 1.4 · S · ~5m — 👤 Publish\nPress publish.\n\n## Ledger'));
  const res = run(plan);
  assert(res.code === 0, `expected exit 0, got ${res.code}: ${res.out}`);
  assert(res.out.includes('child prompt would be'), 'run must proceed to 1.3');
});

test('Ledger line lands inside the Ledger when a section follows it', () => {
  const plan = makePlan(`${PLAN}\n## Appendix\n\nnotes\n`);
  run(plan, '--human-done');
  const text = fs.readFileSync(plan, 'utf8');
  const ledger = text.slice(text.indexOf('## Ledger'), text.indexOf('## Appendix'));
  assert(ledger.includes('👤 done by hand'), 'line must be inside the Ledger section');
  assert(text.trimEnd().endsWith('notes'), 'following section must be preserved');
});

for (const d of fixtures) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* temp dir — best effort */ }
}

summary();
