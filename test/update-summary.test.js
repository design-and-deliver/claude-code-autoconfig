#!/usr/bin/env node
'use strict';

/**
 * Tests for the upgrade-path change summary (bin/update-summary.js).
 * Guards the fix for the "re-run says nothing came down" bug.
 */

const { formatUpdateSummary, compareVersions, classifyBullet } = require('../bin/update-summary.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.log(`✗ ${name}`); console.log(`  Error: ${e.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m); }

const CHANGELOG = `# Changelog

## v1.0.198
- feat(arcade-beeps): ship opt-in Pole Position status beeps via CCA

## v1.0.197
- perf(terminal-title): deliver the directive once per session

## v1.0.196
- fix(terminal-title): stop at the turn boundary when grading the closing '?'
- fix(cli): require non-TTY stdout for inside-Claude block

## v1.0.195
- fix(terminal-title): flip awaiting for a closing question
- chore(release): bump version
- docs(readme): tidy wording
`;

console.log('============================================================');
console.log('UPDATE SUMMARY TESTS');
console.log('============================================================');
console.log();

// The exact bug from the report: already on latest, re-run.
test('re-run on latest: one confirmation line, no feature relist', () => {
  const out = formatUpdateSummary('1.0.198', '1.0.198', CHANGELOG);
  assert(out.length === 1, 'should be a single line');
  assert(out[0].kind === 'latest', "kind should be 'latest'");
  assert(/already on the latest/i.test(out[0].text), 'should confirm already-latest');
  assert(!out.some(s => s.kind === 'item'), 'no feature items on a re-run');
});

test('upgrade: groups New features and Fixes since the installed version', () => {
  const out = formatUpdateSummary('1.0.195', '1.0.198', CHANGELOG);
  assert(out.some(s => s.kind === 'heading'), 'has a heading');
  assert(out.some(s => s.kind === 'group' && s.text === 'New features'), 'has New features group');
  assert(out.some(s => s.kind === 'group' && s.text === 'Fixes & improvements'), 'has Fixes group');
  const items = out.filter(s => s.kind === 'item').map(s => s.text);
  assert(items.some(t => /Pole Position/.test(t)), 'lists the beeps feature');
  assert(items.some(t => /turn boundary/.test(t)), 'lists a fix');
});

test('upgrade heading references the previously-installed version', () => {
  const out = formatUpdateSummary('1.0.195', '1.0.198', CHANGELOG);
  const h = out.find(s => s.kind === 'heading');
  assert(h && h.text.includes('1.0.195'), 'heading names the prev version');
});

test('upgrade drops chore/docs housekeeping bullets', () => {
  const out = formatUpdateSummary('1.0.194', '1.0.198', CHANGELOG);
  const items = out.filter(s => s.kind === 'item').map(s => s.text);
  assert(!items.some(t => /bump version/i.test(t)), 'chore(release) excluded');
  assert(!items.some(t => /tidy wording/i.test(t)), 'docs excluded');
});

test('upgrade drops a revert: bullet already sitting in CHANGELOG.md (BH-9)', () => {
  // A leaked `revert:` bullet lives in the committed changelog until the next regen;
  // update-summary must not surface it on the upgrade screen in the meantime.
  const CL = '# Changelog\n\n## v1.0.200\n'
    + '- feat(x): a real feature\n'
    + '- revert: remove /extract-rules from deployed build\n';
  const out = formatUpdateSummary('1.0.199', '1.0.200', CL);
  const items = out.filter(s => s.kind === 'item').map(s => s.text);
  assert(items.some(t => /a real feature/i.test(t)), 'the real feature still shows');
  assert(!items.some(t => /extract-rules/i.test(t)), 'the revert bullet is dropped');
});

test('feat/fix classification strips prefix and capitalizes', () => {
  assert(classifyBullet('feat(x): add thing').type === 'feat', 'feat type');
  assert(classifyBullet('fix(y): repair thing').type === 'fix', 'fix type');
  assert(classifyBullet('feat: add thing').text === 'Add thing', 'strips prefix + caps');
});

test('null previous version: shows current version features', () => {
  const out = formatUpdateSummary(null, '1.0.198', CHANGELOG);
  assert(out.some(s => s.kind === 'heading' && s.text.includes('1.0.198')), 'heading names current');
  assert(out.some(s => s.kind === 'item' && /Pole Position/.test(s.text)), 'shows current features');
});

test('upgrade with only housekeeping falls back to a confirm line', () => {
  const CL = '# Changelog\n\n## v1.0.200\n- chore(release): bump\n- docs: tweak\n';
  const out = formatUpdateSummary('1.0.199', '1.0.200', CL);
  assert(out.length === 1 && out[0].kind === 'latest', 'single confirm line');
  assert(/Updated to v1\.0\.200/.test(out[0].text), 'confirms the bump');
});

test('compareVersions orders segment-wise', () => {
  assert(compareVersions('1.0.198', '1.0.197') === 1, '198 > 197');
  assert(compareVersions('1.0.197', '1.0.198') === -1, '197 < 198');
  assert(compareVersions('1.0.198', '1.0.198') === 0, 'equal');
  assert(compareVersions('1.1.0', '1.0.999') === 1, 'minor beats patch');
});

console.log();
console.log('============================================================');
if (failed === 0) {
  console.log(`ALL TESTS PASSED (${passed} tests)`);
} else {
  console.log(`TESTS FAILED: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
