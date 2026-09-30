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
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CODE_SESSION_ID: '', CCA_FLEET_AGENTS_JSON: 'off' },
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

// ---- behind counts, STALE, pile-up ------------------------------------
// A second repo, so the porcelain fixture above stays exactly two rows. One branch carries an
// unlanded commit and then falls 60 commits behind main; twelve more empty worktrees make 13
// registered — one over the pile-up threshold.
const repo2 = path.join(tmp, 'repo2');
fs.mkdirSync(repo2, { recursive: true });
const git2 = (...args) =>
  execFileSync('git', args, { cwd: repo2, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
git2('init', '--initial-branch=main');
git2('config', 'user.email', 'test@example.com');
git2('config', 'user.name', 'Fleet Test');
git2('config', 'commit.gpgsign', 'false');
git2('commit', '--allow-empty', '-m', 'seed');
const staleDir = path.join(tmp, 'wt-stale');
git2('worktree', 'add', '-b', 'old-work', staleDir);
execFileSync('git', ['commit', '--allow-empty', '-m', 'unlanded'], { cwd: staleDir, stdio: 'ignore' });
for (let i = 0; i < 60; i++) git2('commit', '--allow-empty', '-m', `main ${i}`);
for (let i = 0; i < 12; i++) git2('worktree', 'add', '-b', `idle-${i}`, path.join(tmp, `wt-${i}`));

const run2 = (...extra) => execFileSync('node', [SCRIPT, '--project-dir', repo2, ...extra], {
  encoding: 'utf8',
  env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CODE_SESSION_ID: '', CCA_FLEET_AGENTS_JSON: 'off' },
});

test('--json carries behind and stale for a branch 60 commits behind', () => {
  const t = JSON.parse(run2('--json')).trees.find((x) => x.branch === 'old-work');
  assert(t && t.behind === 60, `expected behind 60, got ${t && t.behind}`);
  assert(t.stale === true, 'a branch 60 behind must be stale');
});

test('the UNLANDED row prints the behind count and a STALE marker', () => {
  const out = run2();
  assert(/old-work\s+⚠ STALE \(60 behind main\)/.test(out), `no STALE marker:\n${out}`);
  assert(out.includes('60 behind'), `no behind count in the flags:\n${out}`);
});

test('13 registered worktrees print the pile-up line', () => {
  const out = run2();
  assert(out.includes('13 worktrees registered — run /sync-worktrees'), `no pile-up line:\n${out}`);
  assert(JSON.parse(run2('--json')).pileUp === true, '--json pileUp must be true');
});

test('12 or fewer worktrees print no pile-up line', () => {
  git2('worktree', 'remove', path.join(tmp, 'wt-0'));
  assert(!run2().includes('worktrees registered'), 'pile-up line must not show at 12');
});

// ---- placement by `claude agents --json` cwd ---------------------------
// Both sessions' transcripts sit in repo2's MAIN-checkout folder (they were launched there). The
// fixture says session 1 now works in the old-work worktree and session 2 in another repo. The
// transcript folder alone would place both at the base checkout.
const SID_WT = '00000000-0000-4000-8000-000000000001';
const SID_AWAY = '00000000-0000-4000-8000-000000000002';
const titles = path.join(home, '.claude', 'hooks', '.titles');
const baseSlug = path.join(home, '.claude', 'projects', repo2.replace(/[^a-zA-Z0-9]/g, '-'));
fs.mkdirSync(titles, { recursive: true });
fs.mkdirSync(baseSlug, { recursive: true });
for (const sid of [SID_WT, SID_AWAY]) {
  fs.writeFileSync(path.join(titles, `${sid}.txt`), `Fleet test — session ${sid.slice(-1)}`);
  fs.writeFileSync(path.join(baseSlug, `${sid}.jsonl`), '{}\n');
}
const agentsFile = path.join(tmp, 'claude-agents.json');
fs.writeFileSync(agentsFile, fs.readFileSync(path.join(__dirname, 'fixtures', 'claude-agents.json'), 'utf8')
  .replace('{{WORKTREE}}', JSON.stringify(staleDir).slice(1, -1))
  .replace('{{OTHER_REPO}}', JSON.stringify(path.join(tmp, 'elsewhere')).slice(1, -1)));

const sessionsWith = (agents) => JSON.parse(execFileSync('node', [SCRIPT, '--json', '--project-dir', repo2], {
  encoding: 'utf8',
  env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CODE_SESSION_ID: '', CCA_FLEET_AGENTS_JSON: agents },
})).sessions;
const sameDir = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

test('agents off: both sessions fall back to the transcript folder (base checkout)', () => {
  const s = sessionsWith('off');
  for (const sid of [SID_WT, SID_AWAY]) {
    const row = s.find((x) => x.sid === sid);
    assert(row && sameDir(row.tree.dir, repo2), `${sid} must sit at the base; got ${row && row.tree.dir}`);
  }
});

test('a session whose cwd is a worktree outside its transcript folder is placed in that worktree', () => {
  const row = sessionsWith(agentsFile).find((x) => x.sid === SID_WT);
  assert(row && sameDir(row.tree.dir, staleDir), `expected ${staleDir}, got ${row && row.tree && row.tree.dir}`);
});

test('a session whose cwd is another repo leaves this board', () => {
  assert(!sessionsWith(agentsFile).some((x) => x.sid === SID_AWAY), 'session in another repo must not be listed');
});

test('an unreadable agents file falls back to the transcript folder', () => {
  const row = sessionsWith(path.join(tmp, 'missing.json')).find((x) => x.sid === SID_WT);
  assert(row && sameDir(row.tree.dir, repo2), `fallback must place it at the base; got ${row && row.tree.dir}`);
});

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }

summary();
