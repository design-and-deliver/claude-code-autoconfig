#!/usr/bin/env node
'use strict';

/**
 * Guardrail tests for .claude/scripts/restore-after-reboot.js.
 *
 * Both bugs pinned here were self-inflicted, both were found by running the script against this
 * machine's real sessions, and both failed in the SAME direction: a session that was alive and
 * open got listed as killed, i.e. the tool offered to "restore" a tab the user was sitting in.
 *
 *  1. A QUIET TAB IS NOT A DEAD TAB. The first version borrowed fleet.js's 3-minute write bar.
 *     That bar answers "is anyone working?", not "is the terminal still there" — measured
 *     2026-07-30, a session idle for 25 minutes was a live claude at pid 1948. The fix reads
 *     {sid}.pid and asks the kernel.
 *
 *  2. A SESSION'S STATE DIR IS NOT DERIVABLE FROM ITS CWD. terminal-title.js writes to the
 *     directory the terminal was LAUNCHED from; the transcript records where the session ended
 *     up. Measured the same day: session 1b6eb3a1 had cwd C:\CODE\claude-code-autoconfig and
 *     every state file under C:\CODE\job-agent-extension. A cwd-derived lookup found neither its
 *     title nor its pid, so it read as untitled AND killed. The fix indexes state dirs by sid.
 *
 * Run against the real script with HOME/USERPROFILE pointed at a fake home, so this machine's
 * own sessions stay out of the result.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { test, assert, summary } = require('./_harness');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'restore-after-reboot.js');
const TITLES = ['.claude', 'hooks', '.titles'];

// The script classifies against the machine's real boot clock, and every fixture below is dated a
// few minutes back so it lands AFTER boot (the pid-checked bucket, which is what these tests are
// about). On a box that just restarted there is no such window.
if (os.uptime() < 15 * 60) {
  console.log('SKIP restore-after-reboot: machine booted less than 15 minutes ago.');
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-restore-'));
const home = path.join(tmp, 'home');
const repoA = path.join(tmp, 'repo-a');       // where sessions say they were working
const repoB = path.join(tmp, 'repo-b');       // where one session's state actually lives
for (const d of [home, repoA, repoB]) fs.mkdirSync(d, { recursive: true });

const homeTitles = path.join(home, ...TITLES);
const aTitles = path.join(repoA, ...TITLES);
const bTitles = path.join(repoB, ...TITLES);
for (const d of [homeTitles, aTitles, bTitles]) fs.mkdirSync(d, { recursive: true });

const MIN = 60 * 1000;
const ago = (mins) => new Date(Date.now() - mins * MIN);

// The marker hook has to look older than every fixture, or they all classify as "unclassifiable"
// (absence of a marker proves nothing for a session that predates the hook).
const hookPath = path.join(home, '.claude', 'hooks', 'session-close.js');
fs.mkdirSync(path.dirname(hookPath), { recursive: true });
fs.writeFileSync(hookPath, '// fixture\n');
fs.utimesSync(hookPath, ago(24 * 60), ago(24 * 60));

// One transcript per session, under the project slug Claude Code would have used.
function seedTranscript(sid, minsAgo, cwd = repoA) {
  const dir = path.join(home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${sid}.jsonl`);
  fs.writeFileSync(p, JSON.stringify({ type: 'user', cwd, gitBranch: 'main' }) + '\n');
  fs.utimesSync(p, ago(minsAgo), ago(minsAgo));
  return p;
}

// A pid that cannot be running. Out of range for a real process table, so process.kill(pid, 0)
// throws however the platform prefers and the script's catch reports "not alive" either way.
const DEAD_PID = 2147483647;

// --- session CLEAN: quit properly. Has a marker, so it is not lost at all. -----------------
seedTranscript('aaaaaaaa-1111-4111-8111-111111111111', 10);
fs.writeFileSync(path.join(aTitles, 'aaaaaaaa-1111-4111-8111-111111111111.txt'), 'Clean — quit properly\n');
fs.writeFileSync(path.join(aTitles, 'aaaaaaaa-1111-4111-8111-111111111111.closed'),
  JSON.stringify({ sid: 'aaaaaaaa-1111-4111-8111-111111111111', reason: 'other', cwd: repoA }));

// --- session NEIGHBOUR: an ordinary session in repo-B. Its only job is to make repo-B a
//     directory the index can NAME — which is exactly how the real case works: the terminal
//     that owns the stray state is itself a project you were working in. Without a neighbour,
//     repo-B is invisible to the index (the known limit documented in the script).
seedTranscript('eeeeeeee-5555-4555-8555-555555555555', 40, repoB);
fs.writeFileSync(path.join(bTitles, 'eeeeeeee-5555-4555-8555-555555555555.txt'), 'Neighbour\n');
fs.writeFileSync(path.join(bTitles, 'eeeeeeee-5555-4555-8555-555555555555.closed'),
  JSON.stringify({ sid: 'eeeeeeee-5555-4555-8555-555555555555', reason: 'other', cwd: repoB }));

// --- session QUIET: idle 25 minutes, still running. Its cwd is repo-A but its state lives in
//     repo-B (the terminal was launched there), so this fixture covers both bugs at once:
//     find the state at all, then believe the pid it holds. --------------------------------
seedTranscript('bbbbbbbb-2222-4222-8222-222222222222', 25);
fs.writeFileSync(path.join(bTitles, 'bbbbbbbb-2222-4222-8222-222222222222.txt'), 'Quiet — but the tab is open\n');
fs.writeFileSync(path.join(bTitles, 'bbbbbbbb-2222-4222-8222-222222222222.pid'),
  JSON.stringify({ pid: process.pid, sid: 'bbbbbbbb-2222-4222-8222-222222222222', ts: Date.now() }));

// --- session GONE: same silence, but its process is not there. The only true casualty. -----
seedTranscript('cccccccc-3333-4333-8333-333333333333', 25);
fs.writeFileSync(path.join(aTitles, 'cccccccc-3333-4333-8333-333333333333.txt'), 'Gone — killed terminal\n');
fs.writeFileSync(path.join(aTitles, 'cccccccc-3333-4333-8333-333333333333.pid'),
  JSON.stringify({ pid: DEAD_PID, sid: 'cccccccc-3333-4333-8333-333333333333', ts: Date.now() }));

function run(extra = []) {
  const out = execFileSync(process.execPath, [SCRIPT, '--json', ...extra], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_PROJECT_DIR: repoA,
      CLAUDE_CODE_SESSION_ID: '',
    },
  });
  return JSON.parse(out);
}

const result = run();
const offeredSids = result.offered.map((s) => s.sid);
const byId = new Map(result.offered.map((s) => [s.sid, s]));

test('a session that quit cleanly is never offered for restore', () => {
  assert(!offeredSids.some((s) => s.startsWith('aaaaaaaa')),
    `clean session was offered: ${offeredSids.join(', ')}`);
});

test('a quiet-but-running session is not mistaken for a dead one', () => {
  // The regression: 25 minutes of silence looks identical to a kill by mtime alone.
  assert(!offeredSids.some((s) => s.startsWith('bbbbbbbb')),
    'a live session (pid alive) was offered for restore — the write-bar bug is back');
  assert(result.stillOpen >= 1, 'the live session was not counted as still open');
});

test('state is found in the dir that HAS it, not the one derived from cwd', () => {
  // repo-B holds the pid file. If lookup were cwd-derived it would search repo-A only, find
  // nothing, and fall through to "killed" — which is exactly bug 2.
  const all = [...result.offered, ...result.fromReboot, ...result.sinceReboot];
  const quiet = all.find((s) => s.sid.startsWith('bbbbbbbb'));
  assert(!quiet, 'the foreign-state session leaked into a lost bucket');
});

test('a session whose process is gone IS offered, with its title', () => {
  const gone = byId.get('cccccccc-3333-4333-8333-333333333333');
  assert(gone, `dead session missing from the roster: ${offeredSids.join(', ')}`);
  assert(gone.title === 'Gone — killed terminal',
    `title did not resolve: ${JSON.stringify(gone.title)}`);
  assert(gone.cwd === repoA, `cwd did not resolve: ${JSON.stringify(gone.cwd)}`);
  assert(gone.cwdGone === false, 'an existing directory was reported as gone');
});

test('a cwd that no longer exists is flagged rather than emitted as a cd', () => {
  const doomed = path.join(tmp, 'repo-vanished');
  fs.mkdirSync(path.join(doomed, ...TITLES), { recursive: true });
  const slug = path.join(home, '.claude', 'projects', doomed.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(slug, { recursive: true });
  const sid = 'dddddddd-4444-4444-8444-444444444444';
  const tp = path.join(slug, `${sid}.jsonl`);
  fs.writeFileSync(tp, JSON.stringify({ type: 'user', cwd: doomed, gitBranch: 'main' }) + '\n');
  fs.utimesSync(tp, ago(25), ago(25));
  fs.rmSync(doomed, { recursive: true, force: true });   // renamed out from under it

  const after = run();
  const row = after.offered.find((s) => s.sid === sid);
  assert(row, 'session in a vanished directory dropped off the roster entirely');
  assert(row.cwdGone === true, 'a vanished directory was not flagged');

  const text = execFileSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PROJECT_DIR: repoA, CLAUDE_CODE_SESSION_ID: '' },
  });
  assert(!text.includes(`cd "${doomed}"`), 'emitted a cd into a directory that does not exist');
});

test('--launch refuses a session whose directory is gone', () => {
  // Not a launch test (it would open real terminals) — it pins that the skip path is reachable
  // by name, so a future edit cannot quietly drop the guard.
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert(/if \(!s\.cwd \|\| s\.cwdGone\)/.test(src),
    '--launch no longer guards on cwdGone');
});

summary();
