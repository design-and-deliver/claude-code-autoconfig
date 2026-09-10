#!/usr/bin/env node

/**
 * Unit tests for scripts/generate-changelog.js bullet selection — the layer that keeps
 * CHANGELOG.md (and therefore the installer's "what's new" summary) user-facing:
 * `Changelog:` body trailers beat technical subjects, the OVERRIDES map rewords
 * already-published history, and the dev-gate cross-check drops commits that touch only
 * DEV_ONLY_FILES (bin/cli.js) — work users never receive, whatever the trailer promises.
 */

const {
  bulletFor, isHousekeeping, bulletForCommit, classifyPath, gateVerdict, parseLogRecords,
  loadDevOnlyFiles, loadTarballNegations,
} = require('../scripts/generate-changelog.js');

const { test, assert, summary } = require('./_harness');

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
  assert(isHousekeeping('plan: tick 1.2 + ledger') === true, 'plan: tick/ledger bookkeeping');
  assert(isHousekeeping('plan(clean-code): record the Phase 4 early-stop override') === true, 'plan(scope):');
  assert(isHousekeeping('feat(x): y') === false, 'feat');
  assert(isHousekeeping('fix: y') === false, 'fix');
  assert(isHousekeeping('feat(run-plan): --model passthrough') === false, 'feat mentioning plan stays');
});

test('revert and merge commits are housekeeping (BH-9) — never leak into the changelog', () => {
  // The confirmed-live leak: CHANGELOG.md shipped `- revert: remove /extract-rules …`.
  assert(isHousekeeping('revert: remove /extract-rules from deployed build') === true, 'revert:');
  assert(isHousekeeping('revert(cli): undo the thing') === true, 'revert(scope):');
  // git-authored default subjects for `git revert` / `git merge`.
  assert(isHousekeeping('Revert "feat(x): add thing"') === true, 'git Revert "…"');
  assert(isHousekeeping('Merge branch \'feature\' into main') === true, 'Merge branch');
  assert(isHousekeeping('Merge pull request #42 from user/topic') === true, 'Merge pull request');
  // A genuine feature whose scope/subject merely contains those words must survive.
  assert(isHousekeeping('feat(cli): add a revert command') === false, 'feat mentioning revert stays');
  assert(isHousekeeping('fix(merge): repair the merge logic') === false, 'fix mentioning merge stays');
});

console.log('Dev-gate cross-check (DEV_ONLY_FILES in bin/cli.js):');

const devOnly = new Set(['token-guard.js', 'fleet.md', 'fleet.js']);
const negations = ['.claude/hooks/tests', '.claude/worktrees', '.claude/commands/fleet.md'];
const quiet = { devOnly, negations, warn: () => {} };

test('classifyPath: gated / shipped / neutral', () => {
  assert(classifyPath('.claude/hooks/token-guard.js', devOnly, negations) === 'gated', 'hook in DEV_ONLY');
  assert(classifyPath('.claude/commands/fleet.md', devOnly, negations) === 'gated', 'negated AND gated -> gated wins');
  assert(classifyPath('.claude/commands/continue.md', devOnly, negations) === 'shipped', '/continue ships');
  assert(classifyPath('bin/cli.js', devOnly, negations) === 'shipped', 'the installer ships');
  assert(classifyPath('.claude/hooks/tests/x.test.cjs', devOnly, negations) === 'neutral', 'tarball-negated dir');
  assert(classifyPath('.claude/hooks/tests', devOnly, negations) === 'neutral', 'the negated dir itself');
  assert(classifyPath('scripts/generate-changelog.js', devOnly, negations) === 'neutral', 'maintainer script');
  assert(classifyPath('test/foo.test.js', devOnly, negations) === 'neutral', 'tests');
  assert(classifyPath('CLAUDE.md', devOnly, negations) === 'neutral', 'root doc');
  assert(classifyPath('.claude/docs/autoconfig.docs.html', devOnly, negations) === 'neutral', 'regenerated docs HTML is derived');
  assert(classifyPath('.claude\\hooks\\token-guard.js', devOnly, negations) === 'gated', 'backslash paths normalise');
});

test('gateVerdict: gated-only, mixed, clear', () => {
  assert(gateVerdict(['.claude/hooks/token-guard.js'], devOnly, negations) === 'gated', 'one gated file');
  assert(gateVerdict(['.claude/hooks/token-guard.js', '.claude/hooks/tests/t.cjs', 'docs/plan.md', 'CLAUDE.md'], devOnly, negations) === 'gated',
    'neutral files do not rescue a gated commit');
  assert(gateVerdict(['.claude/hooks/token-guard.js', '.claude/commands/gls.md'], devOnly, negations) === 'mixed', 'gated + shipped');
  assert(gateVerdict(['.claude/hooks/token-guard.js', '.claude/docs/autoconfig.docs.html'], devOnly, negations) === 'gated',
    'a docs regen does not rescue a gated commit (29e723c)');
  assert(gateVerdict(['.claude/docs/autoconfig.docs.html'], devOnly, negations) === 'clear', 'docs-only commit is left to the trailer');
  assert(gateVerdict(['.claude/commands/gls.md'], devOnly, negations) === 'clear', 'shipped only');
  assert(gateVerdict(['docs/x.md', 'scripts/y.js'], devOnly, negations) === 'clear', 'neutral-only is left to the trailer convention');
  assert(gateVerdict([], devOnly, negations) === 'clear', 'no files');
  assert(gateVerdict(undefined, devOnly, negations) === 'clear', 'missing files');
});

test('a user-facing trailer on a gated-only commit is dropped — the leak OVERRIDES nulls used to patch by hand', () => {
  const warned = [];
  const gate = { devOnly, negations, warn: m => warned.push(m) };
  const b = bulletForCommit({
    hash: '0bf89e3abcdef', subject: 'feat(token-guard): R12a confirm card',
    body: 'Changelog: A confirm card before big spends',
    files: ['.claude/hooks/token-guard.js', '.claude/hooks/tests/r12a.test.cjs'],
  }, gate, {});
  assert(b === null, `should drop, got "${b}"`);
  assert(warned.length === 1 && /0bf89e3/.test(warned[0]) && /dropped/.test(warned[0]), `warn line: ${warned}`);
});

test('a mixed commit keeps its bullet and warns', () => {
  const warned = [];
  const gate = { devOnly, negations, warn: m => warned.push(m) };
  const b = bulletForCommit({
    hash: 'ad2a136abcdef', subject: 'feat(gls): downscale', body: 'Changelog: Smaller screenshots',
    files: ['.claude/scripts/gls.js', '.claude/hooks/token-guard.js'],
  }, gate, {});
  assert(b === 'feat(gls): Smaller screenshots', `got "${b}"`);
  assert(warned.length === 1 && /ad2a136/.test(warned[0]) && /alongside/.test(warned[0]), `warn line: ${warned}`);
});

test('an explicit OVERRIDES row beats the gate, silently', () => {
  const warned = [];
  const gate = { devOnly, negations, warn: m => warned.push(m) };
  const b = bulletForCommit({ hash: 'abc1234', subject: 'feat(x): y', body: '', files: ['.claude/hooks/token-guard.js'] },
    gate, { 'abc12': 'feat(x): Kept on purpose' });
  assert(b === 'feat(x): Kept on purpose', `got "${b}"`);
  assert(warned.length === 0, 'no warning for a sanctioned override');
});

test('"Changelog: none" on a gated commit stays silent (no warning noise)', () => {
  const warned = [];
  const gate = { devOnly, negations, warn: m => warned.push(m) };
  const b = bulletForCommit({ hash: 'abc1234', subject: 'feat(x): y', body: 'Changelog: none', files: ['.claude/hooks/token-guard.js'] }, gate, {});
  assert(b === null && warned.length === 0, 'already hidden by the trailer — nothing to say');
});

test('a clear commit and a null gate both fall through to bulletFor', () => {
  const b1 = bulletForCommit({ hash: 'abc1234', subject: 'fix(cli): x', body: '', files: ['bin/cli.js'] }, quiet, {});
  assert(b1 === 'fix(cli): x', `clear: got "${b1}"`);
  const b2 = bulletForCommit({ hash: 'abc1234', subject: 'fix(cli): x', body: '', files: ['.claude/hooks/token-guard.js'] }, null, {});
  assert(b2 === 'fix(cli): x', `null gate: got "${b2}"`);
});

test('parseLogRecords splits hash / subject / body / files from the --name-only format', () => {
  const raw = '\x1eaaa\x1ffeat(x): one\x1fbody line\n\nChangelog: One\x1f\n\n.claude/commands/gls.md\nbin/cli.js\n'
    + '\x1ebbb\x1ffix: two\x1f\x1f\n\ndocs/a.md\n';
  const recs = parseLogRecords(raw);
  assert(recs.length === 2, `records: ${recs.length}`);
  assert(recs[0].hash === 'aaa' && recs[0].subject === 'feat(x): one', 'first record fields');
  assert(/^Changelog: One$/m.test(recs[0].body), 'body keeps its trailer');
  assert(recs[0].files.join(',') === '.claude/commands/gls.md,bin/cli.js', `files: ${recs[0].files}`);
  assert(recs[1].body === '' && recs[1].files.join(',') === 'docs/a.md', 'empty body still yields files');
});

test('loadDevOnlyFiles parses the real bin/cli.js literal', () => {
  const real = loadDevOnlyFiles();
  assert(real.has('token-guard.js') && real.has('fleet.md'), 'known gated files present');
  assert(!real.has('continue.md'), '/continue ships to users — must not be gated');
});

test('loadTarballNegations strips "!" and "/**" from package.json "files"', () => {
  const n = loadTarballNegations();
  assert(n.includes('.claude/hooks/tests') && n.includes('.claude/worktrees'), `negations: ${n.slice(0, 5)}`);
  assert(n.every(x => !x.startsWith('!') && !x.endsWith('/**')), 'normalised');
});
console.log();

summary();
