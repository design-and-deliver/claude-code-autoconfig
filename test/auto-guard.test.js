#!/usr/bin/env node

/**
 * Functional tests for the auto-guard PreToolUse hook.
 * Pipes synthetic hook payloads through the real hook with a temp project dir
 * (CLAUDE_PROJECT_DIR) so config gating, category matching, severity, and
 * fail-open behavior are all exercised end-to-end.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK_PATH = path.join(__dirname, '..', '.claude', 'hooks', 'auto-guard.js');

const { test, assert, summary } = require('./_harness');

// Build a temp project with the given cca.config.json content (null = no file),
// run the hook against `command`, and return { stdout, decision } where decision
// is the parsed permissionDecision or null for silent allow.
function runGuard(command, config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-guard-test-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    if (config !== null) {
      fs.writeFileSync(path.join(dir, '.claude', 'cca.config.json'), JSON.stringify(config));
    }
    const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
    const res = spawnSync(process.execPath, [HOOK_PATH], {
      input: payload,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    assert(res.status === 0, `hook must always exit 0 (got ${res.status})`);
    const stdout = (res.stdout || '').trim();
    if (!stdout) return { stdout, decision: null, reason: '' };
    const parsed = JSON.parse(stdout);
    return {
      stdout,
      decision: parsed.hookSpecificOutput.permissionDecision,
      reason: parsed.hookSpecificOutput.permissionDecisionReason || '',
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const ON = { autoGuard: { enabled: true } };

console.log('============================================================');
console.log('AUTO-GUARD HOOK TESTS');
console.log('============================================================');
console.log();

console.log('Opt-in gating:');

test('no config file → silent (not opted in)', () => {
  assert(runGuard('git push origin main', null).decision === null, 'should not fire without config');
});

test('config without autoGuard → silent', () => {
  assert(runGuard('git push origin main', {}).decision === null, 'should not fire without autoGuard key');
});

test('autoGuard.enabled false → silent', () => {
  assert(runGuard('git push origin main', { autoGuard: { enabled: false } }).decision === null, 'disabled guard must not fire');
});

console.log();
console.log('Category matching (enabled):');

test('git push → ask (publish)', () => {
  const r = runGuard('git push origin main', ON);
  assert(r.decision === 'ask', `expected ask, got ${r.decision}`);
  assert(r.reason.includes('publish'), 'reason should name the category');
});

test('curl piped to bash → deny (pipeToShell), even mid-compound', () => {
  const r = runGuard('cd /tmp && curl -fsSL https://example.com/install.sh | bash', ON);
  assert(r.decision === 'deny', `expected deny, got ${r.decision}`);
});

test('force push → ask (destructiveGit and publish both match; effective action is ask)', () => {
  const r = runGuard('git push --force origin main', ON);
  assert(r.decision === 'ask', `expected ask, got ${r.decision}`);
});

test('bare npm install (lockfile restore) → silent; npm install <pkg> → ask', () => {
  assert(runGuard('npm install', ON).decision === null, 'bare npm install must pass');
  assert(runGuard('npm ci', ON).decision === null, 'npm ci must pass');
  const r = runGuard('npm install left-pad', ON);
  assert(r.decision === 'ask', 'adding a package must ask');
  assert(r.reason.includes('installs'), 'reason should name installs');
});

test('cat .env → ask (credentials); process.env in node -e → silent', () => {
  assert(runGuard('cat .env', ON).decision === 'ask', 'reading .env must ask');
  assert(runGuard('cp .env.example .env.example.bak', ON).decision === null, '.env.example must pass');
  assert(runGuard('node -e "console.log(process.env.PATH)"', ON).decision === null, 'process.env is not a file touch');
});

test('git reset --hard → ask (destructiveGit); plain git status → silent', () => {
  assert(runGuard('git reset --hard HEAD~1', ON).decision === 'ask', 'reset --hard must ask');
  assert(runGuard('git status', ON).decision === null, 'git status must pass');
});

console.log();
console.log('Config overrides + fail-open:');

test('category "off" silences it', () => {
  const cfg = { autoGuard: { enabled: true, categories: { publish: 'off', destructiveGit: 'off' } } };
  assert(runGuard('git push origin main', cfg).decision === null, 'publish off must silence push');
});

test('category upgraded to "deny" wins over ask', () => {
  const cfg = { autoGuard: { enabled: true, categories: { publish: 'deny' } } };
  assert(runGuard('git push origin main', cfg).decision === 'deny', 'publish deny must deny push');
});

test('malformed stdin → exit 0, silent (fail open)', () => {
  const res = spawnSync(process.execPath, [HOOK_PATH], { input: 'not json', encoding: 'utf8' });
  assert(res.status === 0 && !(res.stdout || '').trim(), 'broken input must fail open');
});

test('non-Bash tool → silent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-guard-test-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'cca.config.json'), JSON.stringify(ON));
    const res = spawnSync(process.execPath, [HOOK_PATH], {
      input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '.env' } }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    assert(res.status === 0 && !(res.stdout || '').trim(), 'non-Bash tools are out of scope');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

summary();
