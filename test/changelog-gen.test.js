#!/usr/bin/env node

/**
 * Unit tests for scripts/generate-changelog.js bullet selection — the layer that keeps
 * CHANGELOG.md (and therefore the installer's "what's new" summary) user-facing:
 * `Changelog:` body trailers beat technical subjects, and the OVERRIDES map rewords
 * already-published history.
 */

const { bulletFor, isHousekeeping } = require('../scripts/generate-changelog.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

console.log('============================================================');
console.log('CHANGELOG GENERATION TESTS');
console.log('============================================================');
console.log();

console.log('Changelog: trailer (technical subject, user-facing bullet):');

test('trailer replaces the subject text but keeps the type(scope) prefix', () => {
  const b = bulletFor('abc1234', 'feat(hooks): TDZ-safe deferred grade child', 'Long body.\n\nChangelog: More reliable tab indicator\n\nCo-Authored-By: x', {});
  assert(b === 'feat(hooks): More reliable tab indicator', `got "${b}"`);
});

test('trailer on a prefix-less subject stands alone', () => {
  const b = bulletFor('abc1234', 'rework the grade internals', 'Changelog: Faster startup', {});
  assert(b === 'Faster startup', `got "${b}"`);
});

test('"Changelog: none" hides the commit from the changelog', () => {
  assert(bulletFor('abc1234', 'feat(x): internal plumbing', 'Changelog: none', {}) === null, 'none should drop the bullet');
  assert(bulletFor('abc1234', 'feat(x): internal plumbing', 'Changelog: skip', {}) === null, 'skip should drop the bullet');
});

test('no trailer -> the subject is used as-is', () => {
  const b = bulletFor('abc1234', 'fix(cli): handle empty changelog', 'Just a body with no trailer.', {});
  assert(b === 'fix(cli): handle empty changelog', `got "${b}"`);
});

test('trailer matching is case-insensitive and mid-body', () => {
  const b = bulletFor('abc1234', 'feat(x): y', 'para one\nchangelog: Plain words\npara two', {});
  assert(b === 'feat(x): Plain words', `got "${b}"`);
});
console.log();

console.log('OVERRIDES (retroactive rewording of published history):');

test('an override rewrites the bullet by hash prefix and beats any trailer', () => {
  const overrides = { 'abc12': 'feat(x): User words' };
  const b = bulletFor('abc1234def', 'feat(x): jargon words', 'Changelog: trailer words', overrides);
  assert(b === 'feat(x): User words', `got "${b}"`);
});

test('a null override drops the bullet', () => {
  const overrides = { 'abc12': null };
  assert(bulletFor('abc1234def', 'fix(x): something', '', overrides) === null, 'null override should drop');
});

test('the shipped 1.0.199 subjects are reworded/folded by the real OVERRIDES map', () => {
  assert(
    bulletFor('82f27d6ffffffff', 'feat(terminal-title): awaiting-signal hardening — …', '') ===
      "feat(terminal-title): More reliable 'awaiting your reply' tab indicator",
    'the 82f27d6 hardening commit should be reworded'
  );
  assert(bulletFor('4d43edeffffffff', "fix(terminal-title): require the '?' …", '') === null,
    'the 4d43ede fix should be folded (dropped)');
});
console.log();

console.log('Housekeeping filter:');

test('version bumps and chores are housekeeping; feat/fix are not', () => {
  assert(isHousekeeping('1.0.199') === true, 'bare version subject');
  assert(isHousekeeping('chore: update changelog') === true, 'chore:');
  assert(isHousekeeping('chore(release): x') === true, 'chore(scope):');
  assert(isHousekeeping('feat(x): y') === false, 'feat');
  assert(isHousekeeping('fix: y') === false, 'fix');
});
console.log();

console.log('============================================================');
if (failed === 0) {
  console.log(`ALL TESTS PASSED (${passed} tests)`);
} else {
  console.log(`TESTS FAILED: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
