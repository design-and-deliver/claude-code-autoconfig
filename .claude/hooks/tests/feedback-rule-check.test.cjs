// feedback-rule-check.js — PreToolUse(Bash) commit check. When a `git commit` would add new
// entries to .claude/feedback/FEEDBACK.md, it denies the commit ONCE with a reason telling Claude
// to run /extract-rules --source … --staged; the retry goes through. Fails open on any error.
//
// Each test builds a throwaway git repo, stages a FEEDBACK.md change, and drives the hook with a
// canned PreToolUse payload. Observable: stdout (a deny JSON, or nothing).
//
// Run: node --test feedback-rule-check.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.resolve(__dirname, '..', 'feedback-rule-check.js');
const FEEDBACK_REL = path.join('.claude', 'feedback', 'FEEDBACK.md');
const TEMPLATE = [
  '<!-- @description Human-authored corrections and guidance for Claude. -->',
  '',
  '# Team Feedback',
  '',
  '---',
  '',
  '',
].join('\n');

function sh(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frc-'));
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@example.com');
  sh(dir, 'config', 'user.name', 'T');
  sh(dir, 'config', 'core.autocrlf', 'false');
  fs.mkdirSync(path.join(dir, '.claude', 'feedback'), { recursive: true });
  fs.writeFileSync(path.join(dir, FEEDBACK_REL), TEMPLATE);
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

function writeFeedback(dir, body, { stage = true } = {}) {
  fs.writeFileSync(path.join(dir, FEEDBACK_REL), TEMPLATE + body);
  if (stage) sh(dir, 'add', '-A');
}

function run(dir, command) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: dir }),
    encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, 'hook must always exit 0');
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

function reasonOf(out) {
  assert.ok(out, 'expected a deny decision');
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  return out.hookSpecificOutput.permissionDecisionReason;
}

test('denies a commit that adds new feedback, naming the lines and the command', () => {
  const dir = tmpRepo();
  writeFeedback(dir, '- Never edit generated files under src/gen/.\n');
  const reason = reasonOf(run(dir, 'git commit -m "feedback"'));
  assert.match(reason, /Never edit generated files under src\/gen\//);
  assert.match(reason, /\/extract-rules --source \.claude\/feedback\/FEEDBACK\.md --staged/);
});

test('lets the retry through once the same lines were evaluated', () => {
  const dir = tmpRepo();
  writeFeedback(dir, '- Always run the api tests after touching src/api/.\n');
  reasonOf(run(dir, 'git commit -m "feedback"'));
  assert.strictEqual(run(dir, 'git commit -m "feedback"'), null);
});

test('a retry after conversion (entry removed, logged in EXTRACTED.md) goes through', () => {
  const dir = tmpRepo();
  writeFeedback(dir, '- Always run the api tests after touching src/api/.\n- Be terse in PR titles.\n');
  reasonOf(run(dir, 'git commit -m "feedback"'));
  fs.writeFileSync(path.join(dir, '.claude', 'feedback', 'EXTRACTED.md'), '- → Moved to rule [api-tests.md](../rules/api-tests.md) (2026-09-29)\n');
  writeFeedback(dir, '- Be terse in PR titles.\n');
  assert.strictEqual(run(dir, 'git commit -m "feedback"'), null);
});

test('a retry after conversion by an older version (pointer line replaces the entry) goes through', () => {
  const dir = tmpRepo();
  writeFeedback(dir, '- Always run the api tests after touching src/api/.\n- Be terse in PR titles.\n');
  reasonOf(run(dir, 'git commit -m "feedback"'));
  writeFeedback(dir, '- → Moved to rule [api-tests.md](../rules/api-tests.md) (2026-09-28)\n- Be terse in PR titles.\n');
  assert.strictEqual(run(dir, 'git commit -m "feedback"'), null);
});

test('a later commit with a different new entry is held again', () => {
  const dir = tmpRepo();
  writeFeedback(dir, '- First entry about src/a/.\n');
  reasonOf(run(dir, 'git commit -m "one"'));
  writeFeedback(dir, '- First entry about src/a/.\n- Second entry about src/b/.\n');
  assert.match(reasonOf(run(dir, 'git commit -m "two"')), /Second entry about src\/b\//);
});

test('ignores commits that do not touch FEEDBACK.md', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'app.js'), 'x\n');
  sh(dir, 'add', '-A');
  assert.strictEqual(run(dir, 'git commit -m "code"'), null);
});

test('ignores non-commit git commands and non-git commands', () => {
  const dir = tmpRepo();
  writeFeedback(dir, '- Some entry about src/.\n');
  assert.strictEqual(run(dir, 'git status'), null);
  assert.strictEqual(run(dir, 'git log --grep commit'), null);
  assert.strictEqual(run(dir, 'npm test'), null);
});

test('ignores changes above the --- separator (template header edits)', () => {
  const dir = tmpRepo();
  const edited = TEMPLATE.replace('# Team Feedback', '# Team Feedback\n\nA new header sentence.');
  fs.writeFileSync(path.join(dir, FEEDBACK_REL), edited);
  sh(dir, 'add', '-A');
  assert.strictEqual(run(dir, 'git commit -m "header"'), null);
});

test('unstaged feedback is ignored by a plain commit but caught by commit -a and add && commit', () => {
  const dir = tmpRepo();
  writeFeedback(dir, '- Unstaged entry about src/x/.\n', { stage: false });
  assert.strictEqual(run(dir, 'git commit -m "other"'), null);
  assert.match(reasonOf(run(dir, 'git commit -am "all"')), /Unstaged entry/);

  const dir2 = tmpRepo();
  writeFeedback(dir2, '- Another unstaged entry about src/y/.\n', { stage: false });
  assert.match(reasonOf(run(dir2, 'git add -A && git commit -m "all"')), /Another unstaged entry/);
});

test('fails open outside a git repo and on malformed stdin', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frc-nogit-'));
  assert.strictEqual(run(dir, 'git commit -m x'), null);
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json{', encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.trim(), '');
});
