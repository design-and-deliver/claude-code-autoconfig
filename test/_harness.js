/**
 * Shared mini-harness for the CLI-side suites (test/*.test.js) — clean-code plan substep 2.2.
 *
 * The repo has exactly TWO test frameworks, ON PURPOSE:
 *   1. this harness — plain-node CLI suites, chained by `npm test` (package.json scripts.test);
 *   2. `node:test`  — the hook suites (.claude/hooks/tests/*.test.cjs), bridged into the chain
 *      by test/hook-tests.test.js.
 * Do not add a third, and do not migrate the hook suites onto this one — node:test's
 * subtest/skip semantics fit the hook corpus; this harness fits linear script suites.
 *
 * Not every test/*.js file uses it: box-alignment.test.js and live-twin-parity.test.js have
 * bespoke whole-run pass/fail structures (and their own environment skips) and stay standalone
 * (box-alignment borrows makeClaudeShim from here but keeps its own structure);
 * hook-tests.test.js is only the node:test runner bridge.
 *
 * Usage:
 *   const { test, assert, summary } = require('./_harness');
 *   test('name', () => { assert(cond, 'message'); });
 *   summary(); // last statement of the suite — prints the banner, exits 1 on any failure
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');

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

function assertExists(filePath, msg) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${msg || 'File should exist'}: ${filePath}`);
  }
}

function summary() {
  console.log();
  console.log('============================================================');
  if (failed === 0) {
    console.log(`ALL TESTS PASSED (${passed} tests)`);
  } else {
    console.log(`TESTS FAILED: ${passed} passed, ${failed} failed`);
    process.exit(1);
  }
}

// A throwaway dir on PATH holding a `claude` that answers `claude --version` and exits 0, so
// isClaudeInstalled() returns true without a real Claude Code install (and never shells out to
// `npm install -g`). Cross-platform: .cmd on Windows, an executable shell script elsewhere.
function makeClaudeShim() {
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-shim-'));
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(shimDir, 'claude.cmd'), '@echo off\r\necho claude 1.0.0\r\n');
  } else {
    const p = path.join(shimDir, 'claude');
    fs.writeFileSync(p, '#!/bin/sh\necho claude 1.0.0\n');
    fs.chmodSync(p, 0o755);
  }
  return shimDir;
}

// Run the CLI without ever throwing. Returns { code, out } (stdout+stderr combined). CLAUDECODE
// is cleared so the inside-Claude block never fires for --bootstrap when a suite itself runs
// inside a Claude session; the shim dir is prepended to PATH (handling Windows' 'Path' casing).
function runCli(projectDir, args, shimDir) {
  const env = { ...process.env, CLAUDECODE: '' };
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = shimDir + path.delimiter + (env[pathKey] || '');
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

module.exports = { test, assert, assertExists, summary, makeClaudeShim, runCli };
