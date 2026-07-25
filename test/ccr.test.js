#!/usr/bin/env node
'use strict';

/**
 * Tests for bin/ccr.js ("claude code, recover").
 *
 * Unit: readPointer must accept only the shape token-guard actually writes (a plain
 * slash command: letters/digits/space/=.:-_) and reject anything metacharacter-laden.
 * buildLaunch wraps the command in double quotes for a `shell: true` spawn, so the
 * "recoverCmd never contains double quotes" property must be ENFORCED in code, not
 * asserted in a comment (2026-07-24 review).
 * Behavioral: --dry-run against a temp project prints the exact launch command.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CCR_PATH = path.join(__dirname, '..', 'bin', 'ccr.js');
const { readPointer, buildLaunch } = require(CCR_PATH);

const { test, assert, summary } = require('./_harness');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-ccr-'));
const guardDir = path.join(tmp, '.claude', 'hooks', '.token-guard');
fs.mkdirSync(guardDir, { recursive: true });
const pointerPath = path.join(guardDir, 'recover.json');

function writePointer(recoverCmd) {
  fs.writeFileSync(pointerPath, JSON.stringify({ recoverCmd, writtenAt: Date.now() }));
}

console.log('============================================================');
console.log('CCR TESTS');
console.log('============================================================');
console.log();

test('readPointer accepts the real token-guard pointer shape', () => {
  writePointer('/recover-context pid=12345 sid=abc123de');
  const rec = readPointer(tmp);
  assert(rec && rec.recoverCmd === '/recover-context pid=12345 sid=abc123de',
    'a valid pointer must be accepted');
});

test('readPointer rejects a missing, malformed, or non-slash-command pointer', () => {
  fs.rmSync(pointerPath, { force: true });
  assert(readPointer(tmp) === null, 'missing pointer must yield null');
  fs.writeFileSync(pointerPath, '{ not json');
  assert(readPointer(tmp) === null, 'unparsable pointer must yield null');
  writePointer(123);
  assert(readPointer(tmp) === null, 'non-string recoverCmd must yield null');
  writePointer('recover-context pid=1');
  assert(readPointer(tmp) === null, 'a non-slash-command must yield null');
});

test('readPointer rejects shell metacharacters (quote-wrap safety enforced, not assumed)', () => {
  const evil = [
    '/recover-context pid=1" & del something & "',
    '/recover-context $(whoami)',
    '/recover-context `whoami`',
    '/recover-context pid=1|whoami',
    '/recover;whoami',
    '/recover-context pid=1\nwhoami',
    '/recover-context pid=1%PATH%',
  ];
  for (const cmd of evil) {
    writePointer(cmd);
    assert(readPointer(tmp) === null, `must reject: ${JSON.stringify(cmd)}`);
  }
});

test('buildLaunch quote-wraps the command for the shell', () => {
  assert(buildLaunch('/recover-context pid=1') === 'claude "/recover-context pid=1"',
    'plain quote-wrap of a validated command');
});

test('--dry-run prints the launch command without launching', () => {
  writePointer('/recover-context pid=777');
  const out = execFileSync('node', [CCR_PATH, '--dry-run'], { cwd: tmp, encoding: 'utf8' });
  assert(out.trim() === 'claude "/recover-context pid=777"',
    `dry-run must print the exact command, got: ${out.trim()}`);
});

test('--dry-run with no pointer exits non-zero with guidance', () => {
  fs.rmSync(pointerPath, { force: true });
  let threw = false;
  try {
    execFileSync('node', [CCR_PATH, '--dry-run'],
      { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    threw = true;
    assert(/no recovery pointer/.test(e.stderr || ''), 'stderr must explain the missing pointer');
  }
  assert(threw, 'must exit non-zero when there is nothing to recover');
});

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }

summary();
