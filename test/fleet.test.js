#!/usr/bin/env node
'use strict';

/**
 * Guardrail tests for .claude/scripts/fleet.js — the `git status --porcelain` parse.
 *
 * The bug this pins (self-inflicted, found by the user in the shipped board): fleet.js's git()
 * helper ended in a plain `.trim()`. Porcelain encodes the index/worktree state in the first TWO
 * COLUMNS, so an UNSTAGED edit begins with a literal space — and a leading trim eats that space on
 * the FIRST LINE ONLY. The dirty-file regex (/^..\s(.*)$/) then failed on that one row and fell
 * back to the whole line, so the board printed `M .claude/hooks/foo.js` as though the M were part
 * of the path. Every other row was correct, which is exactly why it survived review.
 *
 * So the test is deliberately about the ASYMMETRY: a two-row porcelain where row 1 is unstaged
 * (leading space) and row 2 is staged. The fix is trailing-only trim; the old code passes row 2
 * and mangles row 1.
 *
 * Exercised end-to-end against the real script over a real temp git repo — no stubbed git, no
 * re-implemented parser. HOME/USERPROFILE point at an empty fake home so the machine's real
 * sessions and transcripts stay out of the board.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { test, assert, summary } = require('./_harness');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'fleet.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-fleet-'));
const home = path.join(tmp, 'home');
const repo = path.join(tmp, 'repo');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(repo, { recursive: true });

const git = (...args) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// Two tracked files. The names are chosen so porcelain's alphabetical order puts the UNSTAGED one
// first — that first row is the only one the old trim could corrupt.
const UNSTAGED = 'a-unstaged.txt';
const STAGED = 'b-staged.txt';

git('init', '--initial-branch=main');
git('config', 'user.email', 'test@example.com');
git('config', 'user.name', 'Fleet Test');
git('config', 'commit.gpgsign', 'false');
fs.writeFileSync(path.join(repo, UNSTAGED), 'one\n');
fs.writeFileSync(path.join(repo, STAGED), 'one\n');
git('add', '-A');
git('commit', '-m', 'seed');

// Row 1: modified, NOT staged  -> porcelain ' M a-unstaged.txt'  (leading space — the trap)
// Row 2: modified AND staged   -> porcelain 'M  b-staged.txt'    (status in column 1 — always worked)
fs.writeFileSync(path.join(repo, UNSTAGED), 'two\n');
fs.writeFileSync(path.join(repo, STAGED), 'two\n');
git('add', STAGED);

function board() {
  const out = execFileSync('node', [SCRIPT, '--json', '--project-dir', repo], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CODE_SESSION_ID: '' },
  });
  return JSON.parse(out);
}

console.log('============================================================');
console.log('FLEET TESTS');
console.log('============================================================');
console.log();

// Guard the guard: if porcelain ever stops putting the unstaged row first, the test below would
// pass for the wrong reason (row 2 was never broken). Assert the fixture shape itself.
test('fixture sanity: porcelain row 1 is the unstaged edit, and it leads with a space', () => {
  const rows = git('status', '--porcelain').split(/\r?\n/).filter(Boolean);
  assert(rows.length === 2, `expected 2 porcelain rows, got ${rows.length}: ${JSON.stringify(rows)}`);
  assert(rows[0].startsWith(' M '), `row 1 must be an unstaged edit, got ${JSON.stringify(rows[0])}`);
  assert(rows[1].startsWith('M  '), `row 2 must be a staged edit, got ${JSON.stringify(rows[1])}`);
});

test('the FIRST porcelain row keeps its path intact — the status columns are not read as path', () => {
  const dirty = board().trees[0].dirty;
  assert(dirty.includes(UNSTAGED),
    `first row must parse to the bare path; got ${JSON.stringify(dirty)}`);
  // The precise old-code symptom: the two status columns survive as a prefix of the path.
  assert(!dirty.some(p => /^[ MADRCU?!]{1,2}\s/.test(p)),
    `no dirty path may carry porcelain status columns; got ${JSON.stringify(dirty)}`);
});

test('both rows land, and the board reports exactly the two dirty files', () => {
  const dirty = board().trees[0].dirty.slice().sort();
  assert(dirty.length === 2, `expected 2 dirty paths, got ${JSON.stringify(dirty)}`);
  assert(dirty[0] === UNSTAGED && dirty[1] === STAGED,
    `dirty must be the two bare paths; got ${JSON.stringify(dirty)}`);
});

test('a clean tree reports no dirty files at all', () => {
  git('stash', '--include-untracked');
  try {
    assert(board().trees[0].dirty.length === 0, 'a clean tree must report zero dirty paths');
  } finally {
    git('stash', 'pop');
  }
});

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }

summary();
