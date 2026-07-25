#!/usr/bin/env node
'use strict';

/**
 * Characterization tests for .claude/scripts/whats-happening.js — pins the observable
 * CLI behavior (title lookup across BOTH tiers, --list, query render, no-match) so its
 * internals can be refactored safely. Isolated from the real machine: the project tier,
 * the fake HOME tier, and the transcript glob all live under a temp dir (HOME /
 * USERPROFILE are overridden for the child process).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'whats-happening.js');

const { test, assert, summary } = require('./_harness');

// --- Fixtures: one title per tier, each with a minimal transcript -----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-wh-'));
const home = path.join(tmp, 'home');
const proj = path.join(tmp, 'proj');
const projTitles = path.join(proj, '.claude', 'hooks', '.titles');
const homeTitles = path.join(home, '.claude', 'hooks', '.titles');
fs.mkdirSync(projTitles, { recursive: true });
fs.mkdirSync(homeTitles, { recursive: true });

const SID_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const SID_B = 'bbbbbbbb-1111-2222-3333-444444444444';
const TITLE_A = 'journal modal — Fix save race';
const TITLE_B = 'wifi-app — Tune reconnect backoff';
fs.writeFileSync(path.join(projTitles, SID_A + '.txt'), TITLE_A);
fs.writeFileSync(path.join(homeTitles, SID_B + '.txt'), TITLE_B);

const projectsDir = path.join(home, '.claude', 'projects', 'C--fake');
fs.mkdirSync(projectsDir, { recursive: true });
const row = o => JSON.stringify(o) + '\n';
for (const sid of [SID_A, SID_B]) {
  fs.writeFileSync(path.join(projectsDir, sid + '.jsonl'),
    row({ type: 'user', timestamp: '2026-07-24T10:00:00Z', message: { content: 'do the thing' } }) +
    row({ type: 'assistant', timestamp: '2026-07-24T10:00:05Z',
      message: { content: [{ type: 'text', text: 'on it' }] } }));
}

function run(args) {
  return execFileSync('node', [SCRIPT, ...args, '--project-dir', proj], {
    encoding: 'utf8',
    // Point os.homedir() at the fake HOME on every platform; make sure no ambient
    // session id excludes one of the fixture sids.
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CODE_SESSION_ID: '' },
  });
}

console.log('============================================================');
console.log('WHATS-HAPPENING TESTS');
console.log('============================================================');
console.log();

test('--list shows sessions from BOTH title tiers (project and home)', () => {
  const out = run(['--list']);
  assert(out.includes(TITLE_A), 'project-tier title must be listed');
  assert(out.includes(TITLE_B), 'home-tier title must be listed');
  assert(out.includes(SID_A.slice(0, 8)) && out.includes(SID_B.slice(0, 8)),
    'both short sids must be listed');
});

test('a title-substring query renders the matched session report', () => {
  const out = run(['save race']);
  assert(out.includes(`## ${TITLE_A}`), 'report header must carry the matched title');
  assert(out.includes(SID_A.slice(0, 8)), 'report must name the session id');
  assert(!out.includes(TITLE_B), 'non-matching session must not be reported');
});

test('the query is case-insensitive', () => {
  const out = run(['SAVE RACE']);
  assert(out.includes(`## ${TITLE_A}`), 'uppercase query must still match');
});

test('a non-matching query says so explicitly', () => {
  const out = run(['zzz-no-such-title']);
  assert(/No session title matches/.test(out), 'must print the explicit no-match message');
});

test('--json emits a parseable analysis object for the match', () => {
  const out = run(['save race', '--json']);
  const obj = JSON.parse(out);
  assert(obj.sid === SID_A, 'json.sid must be the matched session');
  assert(obj.title === TITLE_A, 'json.title must be the matched title');
});

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }

summary();
