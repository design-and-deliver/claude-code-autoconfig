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

// ---------------------------------------------------------------------------------------------
// --vscode: the tasks.json writer.
//
// This half writes into a directory the USER owns, and it wires itself to VS Code's folderOpen
// trigger — which fires every single time that folder is opened, forever. So the tests below are
// mostly about what it must NOT do: not resume twice, not eat a hand-written tasks.json, not
// litter the git status this very tool reports on.
// ---------------------------------------------------------------------------------------------

const vscodeEnv = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  CLAUDE_PROJECT_DIR: repoA,
  CLAUDE_CODE_SESSION_ID: '',
  CLAUDE_RESTORE_TEST_NO_OPEN: '1',   // seam: exercise the merge without opening a real editor
};

function runVscode() {
  return execFileSync(process.execPath, [SCRIPT, '--vscode'], { encoding: 'utf8', env: vscodeEnv });
}

const tasksFile = path.join(repoA, '.vscode', 'tasks.json');
const scratchDir = path.join(repoA, '.vscode', '.restore-after-reboot');
const readTasks = () => JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
const ourTasks = () => readTasks().tasks.filter((t) => t.label.startsWith('restore-after-reboot: '));

// A second casualty in repo-A wearing the SAME title as the first. Two tabs on the same feature
// is the normal case, not a corner one — the title hook is designed to give them the same name.
seedTranscript('ffffffff-6666-4666-8666-666666666666', 25);
fs.writeFileSync(path.join(aTitles, 'ffffffff-6666-4666-8666-666666666666.txt'), 'Gone — killed terminal\n');
fs.writeFileSync(path.join(aTitles, 'ffffffff-6666-4666-8666-666666666666.pid'),
  JSON.stringify({ pid: DEAD_PID, sid: 'ffffffff-6666-4666-8666-666666666666', ts: Date.now() }));

test('--vscode writes one folderOpen task per lost session, and a token for each', () => {
  fs.mkdirSync(path.dirname(tasksFile), { recursive: true });
  fs.writeFileSync(tasksFile, JSON.stringify({
    version: '2.0.0',
    tasks: [{ label: 'my own build', type: 'shell', command: 'echo hi' }],
  }, null, 2));

  runVscode();
  const doc = readTasks();
  const mine = ourTasks();
  assert(mine.length === 2, `expected 2 generated tasks, got ${mine.length}`);
  assert(mine.every((t) => t.runOptions && t.runOptions.runOn === 'folderOpen'),
    'a generated task is not wired to folderOpen — it would never fire');
  assert(mine.every((t) => t.presentation && t.presentation.panel === 'dedicated'),
    'tasks share a panel — the point is one terminal per session');
  assert(doc.tasks.some((t) => t.label === 'my own build'),
    'the user\'s own task was dropped from tasks.json');
  for (const sid of ['cccccccc-3333-4333-8333-333333333333', 'ffffffff-6666-4666-8666-666666666666']) {
    assert(fs.existsSync(path.join(scratchDir, `${sid}.token`)), `no one-shot token written for ${sid}`);
  }
});

test('two sessions sharing a title still get distinct task labels', () => {
  // Both fixtures are titled "Gone — killed terminal". A label is VS Code's key for a task; two
  // identical ones are indistinguishable in the picker and ambiguous to resolve.
  const labels = ourTasks().map((t) => t.label);
  assert(new Set(labels).size === labels.length, `duplicate task labels: ${labels.join(' | ')}`);
});

test('re-running replaces our tasks instead of accumulating them', () => {
  runVscode();
  runVscode();
  const mine = ourTasks();
  assert(mine.length === 2, `tasks accumulated across runs: ${mine.length} after 3 runs`);
  assert(readTasks().tasks.some((t) => t.label === 'my own build'),
    'the user\'s own task did not survive a re-run');
});

test('the scratch dir ignores itself, so this tool adds nothing to git status', () => {
  // The tool's headline output is "here is your uncommitted work" — it must not create any.
  const ig = path.join(scratchDir, '.gitignore');
  assert(fs.existsSync(ig) && fs.readFileSync(ig, 'utf8').trim() === '*',
    'the token/backup dir does not ignore itself — every run would dirty the tree');
  assert(!fs.existsSync(`${tasksFile}.bak`), 'the backup was left in .vscode/ as an untracked file');
  assert(fs.existsSync(path.join(scratchDir, 'tasks.json.bak')), 'the pre-existing tasks.json was not backed up');
});

test('a tasks.json with comments is left byte-for-byte alone', () => {
  // JSONC is legal in tasks.json and common. JSON.parse cannot read it, and a reformat that
  // silently ate the user's comments would be a far worse bug than the feature is worth.
  const jsonc = '{\n  // my build, do not touch\n  "version": "2.0.0",\n  "tasks": []\n}\n';
  fs.writeFileSync(tasksFile, jsonc);
  const out = runVscode();
  assert(fs.readFileSync(tasksFile, 'utf8') === jsonc, 'a commented tasks.json was rewritten');
  assert(/left untouched/.test(out), 'no warning was printed for the untouched file');
  assert(/claude --resume cccccccc-3333/.test(out),
    'no fallback resume line offered when the tasks route was refused');
});

// --resume-once: the half that runs INSIDE VS Code. Driven with a stub `claude` on PATH so the
// consumed path is genuinely exercised without launching a real session.
const stubDir = path.join(tmp, 'stub-bin');
fs.mkdirSync(stubDir, { recursive: true });
fs.writeFileSync(path.join(stubDir, 'claude.cmd'), '@echo STUB-CLAUDE %*\r\n');
fs.writeFileSync(path.join(stubDir, 'claude'), '#!/bin/sh\necho "STUB-CLAUDE $@"\n', { mode: 0o755 });

function resumeOnce(sid) {
  return execFileSync(process.execPath, [SCRIPT, '--resume-once', sid, repoA], {
    encoding: 'utf8',
    env: { ...vscodeEnv, PATH: `${stubDir}${path.delimiter}${process.env.PATH}` },
  });
}

test('a folderOpen task resumes exactly once, then goes inert', () => {
  // ⛔ THE FOOTGUN. folderOpen fires on every open of that folder for the rest of time. If the
  // task held `claude --resume <sid>` directly, opening the repo next month would relaunch a dead
  // conversation. The token makes the second firing a no-op.
  fs.writeFileSync(tasksFile, JSON.stringify({ version: '2.0.0', tasks: [] }, null, 2));
  runVscode();
  const sid = 'cccccccc-3333-4333-8333-333333333333';
  assert(fs.existsSync(path.join(scratchDir, `${sid}.token`)), 'no token to consume');

  const first = resumeOnce(sid);
  assert(/STUB-CLAUDE --resume cccccccc-3333/.test(first), `first open did not resume: ${first}`);
  assert(!fs.existsSync(path.join(scratchDir, `${sid}.token`)), 'the token was not consumed');

  const second = resumeOnce(sid);
  assert(!/STUB-CLAUDE/.test(second), `a second folder open resumed the session again: ${second}`);
  assert(/spent/.test(second), `no explanation printed on the spent path: ${second}`);
});

summary();
