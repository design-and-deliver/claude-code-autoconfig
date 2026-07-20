// migrate-feedback: SessionStart hook that DESTRUCTIVELY rewrites two files — it lifts the
// custom content out of .claude/feedback/FEEDBACK.md into a new "## Discoveries" section in
// CLAUDE.md, then resets FEEDBACK.md to a clean template. Because it deletes user content on
// one side and appends on the other, its guard conditions (missing files, the idempotence
// includes-check, the missing "---" separator) are load-bearing — a regression silently eats
// feedback or double-migrates. This suite drives the real hook against temp fixtures so those
// paths stop being "swallowed forever" (the hook exits 0 on every error) and become assertable.
//
// It also pins the FEEDBACK.md reset template, which exists as TWO hand-synced copies
// (.claude/hooks/migrate-feedback.js and bin/cli.js's upgrade-time migration) — see the
// template-parity test at the bottom.
//
// Run: node --test migrate-feedback.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.resolve(__dirname, '..', 'migrate-feedback.js');
const CLI = path.resolve(__dirname, '..', '..', '..', 'bin', 'cli.js');

const CUSTOM = '## Custom Note\nMy custom guidance here.';
// A realistic FEEDBACK.md: header prose, the first "---" separator, then the custom content.
const FEEDBACK_WITH = `# Team Feedback\n\nSome header prose.\n\n---\n\n${CUSTOM}\n`;

function tmpProject({ claudeMd, feedback } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfb-'));
  if (claudeMd !== undefined) fs.writeFileSync(claudeFile(dir), claudeMd);
  if (feedback !== undefined) {
    fs.mkdirSync(path.join(dir, '.claude', 'feedback'), { recursive: true });
    fs.writeFileSync(feedbackFile(dir), feedback);
  }
  return dir;
}

function claudeFile(dir) { return path.join(dir, 'CLAUDE.md'); }
function feedbackFile(dir) { return path.join(dir, '.claude', 'feedback', 'FEEDBACK.md'); }

// migrate-feedback.js resolves its paths from process.cwd(), so the fixture dir must be the
// child's cwd (NOT just an env var).
function runHook(dir, stdin = '{}') {
  return spawnSync(process.execPath, [HOOK], {
    input: stdin,
    cwd: dir,
    env: { ...process.env },
    encoding: 'utf8',
  });
}

// The single source of truth for the reset template: bin/cli.js's `cleanTemplate` literal,
// extracted from source and un-escaped (\n → newline, \` → backtick). Fails loudly if the
// literal is renamed/moved so the parity guard can't silently go vacuous.
function cliTemplateFromSource() {
  const src = fs.readFileSync(CLI, 'utf8');
  const m = src.match(/const cleanTemplate = `([\s\S]*?)`;/);
  assert.ok(m, 'could not find the `cleanTemplate` literal in bin/cli.js — did it get renamed/moved?');
  return m[1].replace(/\\n/g, '\n').replace(/\\`/g, '`');
}

// (a) — the core migration: custom content moves under ## Discoveries; FEEDBACK.md is reset.
test('custom FEEDBACK.md content migrates to CLAUDE.md ## Discoveries and FEEDBACK.md is reset', () => {
  const dir = tmpProject({ claudeMd: '# My Project\n\nBase instructions.\n', feedback: FEEDBACK_WITH });
  const r = runHook(dir);
  assert.strictEqual(r.status, 0);

  const claudeMd = fs.readFileSync(claudeFile(dir), 'utf8');
  assert.match(claudeMd, /## Discoveries/, 'CLAUDE.md should gain a ## Discoveries section');
  assert.ok(claudeMd.includes('## Custom Note'), 'the custom heading should land in CLAUDE.md');
  assert.ok(claudeMd.includes('My custom guidance here.'), 'the custom body should land in CLAUDE.md');
  assert.ok(claudeMd.startsWith('# My Project'), 'existing CLAUDE.md content must be preserved');

  const feedback = fs.readFileSync(feedbackFile(dir), 'utf8');
  assert.ok(!feedback.includes('My custom guidance here.'), 'FEEDBACK.md custom content must be cleared after migration');
  assert.strictEqual(feedback, cliTemplateFromSource(), 'FEEDBACK.md should be reset to the exact clean template');
});

// (b) — idempotence: once CLAUDE.md has ## Discoveries, a second run is a no-op even if new
// feedback was added. The includes('## Discoveries') guard must protect against re-migration.
test('second run is a no-op once ## Discoveries exists (does not clobber CLAUDE.md or re-eat feedback)', () => {
  const dir = tmpProject({ claudeMd: '# My Project\n', feedback: FEEDBACK_WITH });
  runHook(dir); // first run migrates
  const claudeAfter1 = fs.readFileSync(claudeFile(dir), 'utf8');

  // Simulate a human adding fresh feedback after the one-time migration already happened.
  const CUSTOM2 = '## Later Note\nAdded after the migration.';
  fs.writeFileSync(feedbackFile(dir), `# Team Feedback\n\n---\n\n${CUSTOM2}\n`);

  const r = runHook(dir); // second run must not touch anything
  assert.strictEqual(r.status, 0);
  assert.strictEqual(fs.readFileSync(claudeFile(dir), 'utf8'), claudeAfter1, 'CLAUDE.md must be byte-identical after the no-op second run');
  assert.ok(fs.readFileSync(feedbackFile(dir), 'utf8').includes('Added after the migration.'), 'the new feedback must NOT be reset — the guard should block re-migration');
});

// (c) — no "---" separator: nothing to slice, so it must be a clean no-op (no partial write).
test('FEEDBACK.md with no --- separator is left untouched', () => {
  const feedbackNoSep = '# Team Feedback\n\nJust some prose with no separator at all.\n';
  const dir = tmpProject({ claudeMd: '# My Project\n', feedback: feedbackNoSep });
  const r = runHook(dir);
  assert.strictEqual(r.status, 0);
  assert.ok(!fs.readFileSync(claudeFile(dir), 'utf8').includes('## Discoveries'), 'no Discoveries section without a separator');
  assert.strictEqual(fs.readFileSync(feedbackFile(dir), 'utf8'), feedbackNoSep, 'FEEDBACK.md must be untouched when there is no separator');
});

// (d) — missing files: either file absent → clean no-op exit 0, no crash, nothing created.
test('missing CLAUDE.md → clean no-op exit 0', () => {
  const dir = tmpProject({ feedback: FEEDBACK_WITH }); // no CLAUDE.md
  const r = runHook(dir);
  assert.strictEqual(r.status, 0);
  assert.ok(!fs.existsSync(claudeFile(dir)), 'must not create CLAUDE.md');
  assert.strictEqual(fs.readFileSync(feedbackFile(dir), 'utf8'), FEEDBACK_WITH, 'FEEDBACK.md must be untouched');
});

test('missing FEEDBACK.md → clean no-op exit 0', () => {
  const dir = tmpProject({ claudeMd: '# My Project\n' }); // no FEEDBACK.md
  const r = runHook(dir);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(fs.readFileSync(claudeFile(dir), 'utf8'), '# My Project\n', 'CLAUDE.md must be untouched');
});

// The hook reads stdin purely to satisfy the hook protocol (it ignores the payload). Malformed
// stdin must still not break the SessionStart pipeline.
test('malformed stdin never breaks the pipeline', () => {
  const dir = tmpProject({ claudeMd: '# My Project\n' });
  const r = runHook(dir, 'not json{');
  assert.strictEqual(r.status, 0);
});

// Template-parity: the FEEDBACK.md reset template exists as two hand-synced copies — the hook's
// own array (migrate-feedback.js:~60) and bin/cli.js's upgrade-time `cleanTemplate` literal
// (bin/cli.js:~1078). Compare the hook's ACTUAL output (ground truth) against cli.js's source
// literal so a drift in either copy fails loudly, pinning them until someone consolidates.
test('FEEDBACK.md reset template is character-identical in migrate-feedback.js and bin/cli.js', () => {
  const dir = tmpProject({ claudeMd: '# P\n', feedback: FEEDBACK_WITH });
  runHook(dir);
  const hookProduced = fs.readFileSync(feedbackFile(dir), 'utf8');
  assert.strictEqual(hookProduced, cliTemplateFromSource(), 'the two hand-synced FEEDBACK.md templates have drifted — resync migrate-feedback.js and bin/cli.js');
});
