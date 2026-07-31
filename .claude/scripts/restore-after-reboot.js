#!/usr/bin/env node
// restore-after-reboot.js — the sessions the machine took with it, and how to get them back.
//
// THE PROBLEM
// A reboot closes every terminal at once. The conversations survive on disk (transcripts are
// append-only), but nothing tells you WHICH of the hundreds of transcripts were still open when
// the power went — so "get my view back" means guessing from mtimes, and an mtime cannot tell a
// session you deliberately quit at 06:23 from one the reboot took at 06:23.
//
// session-close.js fixes that by writing {sid}.closed on every ORDERLY end. A kill cannot write
// it. So the classifier is an ABSENCE:
//
//     transcript exists  AND  no {sid}.closed  AND  not live  ==  killed
//
// Everything else here is presentation.
//
// ⛔ READ-ONLY by default. --launch (Windows Terminal tabs) and --vscode (VS Code terminals) are
// the only writing verbs, and both must be asked for by name.
//
// WHY THIS IS NOT REPO-SCOPED (the one structural difference from fleet.js)
// A reboot is a machine event, not a repo event — it takes your six job-agent tabs AND the two
// wifi-app ones. So discovery starts from ~/.claude/projects (every session on the box) rather
// than from one repo's .titles dir, and each session's own transcript supplies its cwd.
//
// DEV-ONLY (DEV_ONLY_FILES in bin/cli.js) — dogfooded from the CCA repo like fleet and
// whats-happening. It reads session-close.js's marker, which is dev-only for the same reason.
//
// Usage:
//   node restore-after-reboot.js [--days N] [--all] [--json] [--launch] [--vscode]
//   node restore-after-reboot.js --resume-once <sid> <dir>   # internal: what --vscode's tasks call

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');

// ---- args -------------------------------------------------------------
const opts = {
  projectDir: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  selfSid: process.env.CLAUDE_CODE_SESSION_ID || '',
  days: 7,
  all: false,
  json: false,
  launch: false,
  vscode: false,
  resumeOnce: null,
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--days') opts.days = Math.max(1, parseInt(argv[++i], 10) || 7);
  else if (a === '--all') opts.all = true;
  else if (a === '--json') opts.json = true;
  else if (a === '--launch') opts.launch = true;
  else if (a === '--vscode') opts.vscode = true;
  else if (a === '--resume-once') opts.resumeOnce = { sid: argv[++i], dir: argv[++i] };
}

// ---- --resume-once (the other half of --vscode) ------------------------
// ⛔ THE FOOTGUN THIS DEFUSES: a VS Code task with runOn=folderOpen fires EVERY time you open
// that folder, forever. Writing `claude --resume <sid>` straight into tasks.json would relaunch
// a months-old conversation every time you opened the repo — worse than having no feature.
//
// So each generated task points here instead, carrying a one-shot token. First open: the token
// exists, we consume it and hand the terminal to claude. Every open after that: no token, so the
// task prints a line and exits. Per-session tokens mean no race between sibling tasks in one
// file, and the tasks.json can sit there harmlessly until the next run rewrites it.
const TOKEN_DIR = ['.vscode', '.restore-after-reboot'];
const tokenPath = (dir, sid) => path.join(dir, ...TOKEN_DIR, `${sid}.token`);

if (opts.resumeOnce) {
  const { sid, dir } = opts.resumeOnce;
  const token = tokenPath(dir || process.cwd(), sid);
  if (!fs.existsSync(token)) {
    console.log(`Already restored ${sid.slice(0, 8)} — this task is spent.`);
    console.log('(It stays in .vscode/tasks.json until the next --vscode run rewrites it.)');
    process.exit(0);
  }
  try { fs.unlinkSync(token); } catch { /* consumed by a concurrent open — resume anyway */ }
  // shell:true because `claude` is a .cmd shim on Windows; inherit so it owns the terminal.
  const r = spawnSync('claude', ['--resume', sid], { stdio: 'inherit', shell: true, cwd: dir || process.cwd() });
  process.exit(r.status == null ? 1 : r.status);
}

const NOW = Date.now();
const projectsBase = path.join(os.homedir(), '.claude', 'projects');

// Same liveness bar as fleet.js and the dupe guard. Generous on purpose: a session composing a
// long turn can go 90s between transcript writes, and calling that dead is the error that offers
// to "restore" a tab the user is actively typing in.
//
// ⛔ But a WRITE bar alone is not enough here, and that is the difference between this tool and
// fleet.js. fleet asks "is anyone working?", where 3 minutes of silence is a fine proxy. This
// tool asks "is the terminal still THERE?" — and a tab you walked away from 25 minutes ago is
// open, idle, and completely indistinguishable from a killed one by mtime. Measured 2026-07-30:
// a 25-minute-idle session was a live claude at PID 1948. Hence isProcessAlive below.
const LIVE_MS = 3 * 60_000;

// ---- boot time --------------------------------------------------------
// os.uptime() is the only cross-platform boot clock, and it is ADVISORY here, never the
// classifier. On Windows it derives from GetTickCount64, which some configurations do not
// advance across sleep/hibernate — so a fast-startup "shutdown" can report an uptime longer than
// the wall-clock gap. That would mis-BUCKET a session (reboot vs. other kill), never mis-CLASSIFY
// one: the .closed marker decides who is dead, and it is immune to clock questions.
const BOOT_MS = NOW - os.uptime() * 1000;

// ---- the instrumentation floor ---------------------------------------
// Absence is only evidence once the hook that writes the marker exists. Every session that ended
// before session-close.js was installed lacks a marker for the boring reason, and offering those
// for restore would bury the real ones under all of history. So sessions older than the hook are
// counted and named as unclassifiable, never offered.
function markerHookInstalledAt() {
  const candidates = [
    path.join(os.homedir(), '.claude', 'hooks', 'session-close.js'),
    path.join(opts.projectDir, '.claude', 'hooks', 'session-close.js'),
  ];
  let earliest = null;
  for (const p of candidates) {
    try {
      const m = fs.statSync(p).mtimeMs;
      if (earliest == null || m < earliest) earliest = m;
    } catch { /* not installed at this tier */ }
  }
  return earliest;
}

// ---- helpers ----------------------------------------------------------
function fmtDur(msSpan) {
  if (msSpan == null) return '?';
  const s = Math.max(0, Math.round(msSpan / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
const fmtAgo = (msSpan) => (msSpan == null ? 'never' : `${fmtDur(msSpan)} ago`);

// Read the LAST complete JSON line carrying a cwd. Transcripts run to megabytes and the field
// repeats on nearly every entry, so a tail read is both cheaper and more current than a forward
// scan — and the last one wins because a session's cwd is what `claude --resume` has to run in.
const TAIL_BYTES = 64 * 1024;

function readTailLines(file) {
  let fd = null;
  try {
    const size = fs.statSync(file).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split(/\r?\n/);
    // Drop the first line when we started mid-file — it is a fragment, not JSON.
    if (size > len) lines.shift();
    return lines;
  } catch {
    return [];                       // unreadable — the caller falls back to no cwd
  } finally {
    if (fd != null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

function tailMeta(file) {
  const lines = readTailLines(file);
  for (let i = lines.length - 1; i >= 0; i--) {
    let o;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    if (o && o.cwd) return { cwd: o.cwd, branch: o.gitBranch || null, version: o.version || null };
  }
  return null;
}

// ⛔ A session's state dir is NOT derivable from its cwd, and assuming it is silently reports
// live sessions as killed. terminal-title.js's project copy writes to CLAUDE_PROJECT_DIR — the
// directory the terminal was LAUNCHED from — while the transcript records where the session
// actually ended up. Measured 2026-07-30: session 1b6eb3a1 had cwd C:\CODE\claude-code-autoconfig
// and every state file under C:\CODE\job-agent-extension\.claude\hooks\.titles, so a cwd-derived
// lookup found no title AND no pid, and called a running claude dead.
//
// So the dirs are INDEXED, not computed: one readdir over every .titles dir we can name (home,
// this project, and the cwd of every session in the window), keyed by the sid in each filename.
// Self-assembling and bounded — the terminal that owns a stray session is nearly always itself a
// cwd somewhere in the same window, because it is a project you were also working in.
//
// Known limit, stated rather than papered over: a state dir that is NONE of those three is
// unreachable, and its session degrades to untitled + pid-less (so it falls back to the write
// bar and may read as killed). Fixing that properly means the session recording its own state
// dir — worth doing only if this is ever seen in the wild.
const TITLES_REL = ['.claude', 'hooks', '.titles'];
const SID_FILE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\./i;

function buildStateIndex(sessions) {
  const home = path.join(os.homedir(), ...TITLES_REL);
  const dirs = new Set([home, path.join(opts.projectDir, ...TITLES_REL)]);
  for (const s of sessions) if (s.cwd) dirs.add(path.join(s.cwd, ...TITLES_REL));
  const index = new Map();
  for (const d of dirs) {
    let files = [];
    try { files = fs.readdirSync(d); } catch { continue; }
    for (const f of files) {
      const m = SID_FILE_RE.exec(f);
      if (!m) continue;
      const sid = m[1].toLowerCase();
      if (!index.has(sid)) index.set(sid, []);
      const list = index.get(sid);
      if (!list.includes(d)) list.push(d);
    }
  }
  return index;
}

// The session's own cwd first (the common case, and the one that is right when both tiers hold
// state), then wherever the index actually found it, then home as the last resort.
function titleDirsFor(cwd, sid, index) {
  const dirs = [];
  if (cwd) dirs.push(path.join(cwd, ...TITLES_REL));
  for (const d of (index && index.get(sid.toLowerCase())) || []) {
    if (!dirs.includes(d)) dirs.push(d);
  }
  const home = path.join(os.homedir(), ...TITLES_REL);
  if (!dirs.includes(home)) dirs.push(home);
  return dirs;
}

function readFirst(dirs, sid, ext) {
  for (const d of dirs) {
    const p = path.join(d, sid + ext);
    try { return { text: fs.readFileSync(p, 'utf8'), dir: d }; } catch { /* next tier */ }
  }
  return null;
}

function existsIn(dirs, sid, ext) {
  for (const d of dirs) {
    if (fs.existsSync(path.join(d, sid + ext))) return true;
  }
  return false;
}

function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .replace(/\s+$/, '');
  } catch {
    return null;   // not a repo, or git absent — callers treat null as unknown
  }
}

// Is the claude process this session was running in still alive? terminal-title.js records it in
// {sid}.pid, which turns "the tab looks quiet" into a decidable question. signal 0 does no work:
// it runs the kernel's permission-and-existence check and throws ESRCH when the pid is gone.
//
// Only trusted for a pid file written AFTER boot. PIDs are recycled, and a pre-reboot pid number
// now belongs to whatever the OS handed it to this cycle — checking it would report a long-dead
// session as alive. Pre-boot sessions do not need this anyway: no process survives a restart, so
// the reboot bucket is decided before we ever get here.
function isProcessAlive(dirs, sid) {
  const rec = readFirst(dirs, sid, '.pid');
  if (!rec) return null;                       // no ledger entry — caller falls back to mtime
  let pid, ts;
  try { ({ pid, ts } = JSON.parse(rec.text)); } catch { return null; }
  if (!pid || !ts || ts < BOOT_MS) return null;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }     // EPERM = alive, owned by someone else
}

// ---- 1. discover ------------------------------------------------------
// Stat-only first pass. Every session this machine has ever run leaves a transcript, so parsing
// them all would cost seconds; the mtime window cuts the set to the handful a reboot could
// plausibly have killed before a single byte is parsed.
function discover(windowMs) {
  const out = [];
  let slugs = [];
  try { slugs = fs.readdirSync(projectsBase); } catch { return out; }
  for (const slug of slugs) {
    const dir = path.join(projectsBase, slug);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const sid = f.slice(0, -6);
      if (sid === opts.selfSid) continue;                    // never offer to restore yourself
      const full = path.join(dir, f);
      let writeMs;
      try { writeMs = fs.statSync(full).mtimeMs; } catch { continue; }
      if (NOW - writeMs > windowMs) continue;
      out.push({ sid, transcript: full, slug, writeMs });
    }
  }
  return out;
}

// ---- 2. classify ------------------------------------------------------
const INSTALLED_AT = markerHookInstalledAt();

// Pass 1: the only thing that must happen before the index can be built.
function readCwd(s) {
  const meta = tailMeta(s.transcript) || {};
  s.cwd = meta.cwd || null;
  s.branch = meta.branch || null;
  // A transcript's cwd is a historical record, not a live path. Observed 2026-07-30: a sibling
  // session renamed C:\CODE\workforce-oregon to worksource-oregon mid-run, and every session that
  // had worked there still pointed at the old name. Resuming into a directory that no longer
  // exists fails, and its .titles dir went with it — which is also why such a row has no title.
  s.cwdGone = !!s.cwd && !fs.existsSync(s.cwd);
  return s;
}

// Small readers, split out so the verdict below stays readable — and so a malformed state file
// degrades to a default instead of throwing the whole roster away.
function readJsonField(dirs, sid, ext, field, fallback) {
  const hit = readFirst(dirs, sid, ext);
  if (!hit) return null;
  try { return JSON.parse(hit.text)[field] || fallback; } catch { return fallback; }
}

// The painter and watchdog keep touching {sid}.glyph while a session is open, so it moves on
// turns the transcript does not — take the later of the two as "last sign of life".
function lastSignOfLife(dirs, sid, writeMs) {
  let latest = writeMs;
  for (const d of dirs) {
    try { latest = Math.max(latest, fs.statSync(path.join(d, sid + '.glyph')).mtimeMs); }
    catch { /* no glyph at this tier */ }
  }
  return latest;
}

// Order matters, and each rung is a strictly stronger claim than the one below it.
function verdict(s, dirs) {
  if (s.closeReason) return 'closed';                            // it told us, on the way out
  if (INSTALLED_AT == null || s.writeMs < INSTALLED_AT) return 'unknowable';
  if (NOW - s.aliveMs < LIVE_MS) return 'live';
  if (s.writeMs < BOOT_MS) return 'reboot';                      // no process survives a restart
  if (isProcessAlive(dirs, s.sid)) return 'open';                // quiet, but the tab is there
  return 'killed';
}

// Pass 2: everything that needs to know where this session's state actually lives.
function classify(s, index) {
  const dirs = titleDirsFor(s.cwd, s.sid, index);

  const title = readFirst(dirs, s.sid, '.txt');
  s.title = title ? title.text.trim() : '';
  s.stateDir = title ? title.dir : null;
  // The awaiting flag is one-shot and consumed at turn end, so a surviving one means the session
  // died mid-question — the single most valuable thing to know before picking what to reopen.
  s.awaiting = existsIn(dirs, s.sid, '.ask');
  s.closeReason = readJsonField(dirs, s.sid, '.closed', 'reason', 'other');

  // A predecessor whose successor is also dead is NOT a second lost tab — it is the same terminal
  // one /clear earlier, and its work already moved forward. Recorded here, pruned after the whole
  // set is classified (the successor has to be known dead first).
  s.prevSid = readJsonField(dirs, s.sid, '.lineage.json', 'prevSid', null);

  s.aliveMs = lastSignOfLife(dirs, s.sid, s.writeMs);
  s.state = verdict(s, dirs);
  return s;
}

// ---- 3. run -----------------------------------------------------------
const windowMs = opts.days * 24 * 60 * 60_000;
const found = discover(windowMs).map(readCwd);
const STATE_INDEX = buildStateIndex(found);
const all = found.map((s) => classify(s, STATE_INDEX)).sort((a, b) => b.writeMs - a.writeMs);

// Prune superseded predecessors now that every session's fate is known.
const deadSids = new Set(all.filter((s) => s.state === 'reboot' || s.state === 'killed').map((s) => s.sid));
const superseded = new Set();
for (const s of all) {
  if (deadSids.has(s.sid) && s.prevSid && deadSids.has(s.prevSid)) superseded.add(s.prevSid);
}
const lost = all.filter((s) => deadSids.has(s.sid) && !superseded.has(s.sid));

const fromReboot = lost.filter((s) => s.state === 'reboot');
const sinceReboot = lost.filter((s) => s.state === 'killed');
const unknowable = all.filter((s) => s.state === 'unknowable');
const stillOpen = all.filter((s) => s.state === 'open' || s.state === 'live');

// Default to the reboot's own casualties — that is the event the command is named for, and the
// set the user can be certain about. The since-reboot bucket is a weaker claim (a pid ledger can
// be missing, and then a quiet tab looks killed), so it only leads when the reboot took nothing.
const offered = opts.all ? lost : fromReboot.length ? fromReboot : lost;
const fellBack = !opts.all && !fromReboot.length && lost.length > 0;

// Resume has to run in the session's own directory; group so the paste block is one cd per repo.
function groupByCwd(list) {
  const by = new Map();
  for (const s of list) {
    const k = s.cwd || '(unknown directory)';
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(s);
  }
  return by;
}

if (opts.json) {
  console.log(JSON.stringify({
    bootMs: BOOT_MS, instrumentedAt: INSTALLED_AT, windowDays: opts.days,
    fromReboot, sinceReboot, offered, stillOpen: stillOpen.length, unknowable: unknowable.length,
  }, null, 2));
  process.exit(0);
}

const L = [];
if (INSTALLED_AT == null) {
  console.log(
    'session-close.js is not installed, so nothing on this machine can be classified.\n' +
    'Without it, a killed session and a cleanly-quit one look identical on disk — the marker\n' +
    'has to be in place BEFORE the crash it explains. Install it and wire SessionEnd first.'
  );
  process.exit(0);
}

L.push(`RESTORE AFTER REBOOT — booted ${fmtAgo(NOW - BOOT_MS)} · ` +
       `${fromReboot.length} session${fromReboot.length === 1 ? '' : 's'} died in it` +
       (sinceReboot.length ? ` · ${sinceReboot.length} killed since` : '') +
       (stillOpen.length ? ` · ${stillOpen.length} still open` : ''));
L.push('');

if (!lost.length) {
  L.push('Nothing to restore — every session in the last ' +
         `${opts.days} day${opts.days === 1 ? '' : 's'} ended cleanly or is still open.`);
} else {
  if (fellBack) {
    L.push('The reboot took nothing — these died some other way (a force-quit terminal).');
  }
  const GLYPH = { reboot: '⏻ REBOOT', killed: '✕ KILLED' };
  L.push('LOST SESSIONS');
  for (const s of offered) {
    const flag = s.awaiting ? ' ◐ was awaiting you' : '';
    L.push(`  ${GLYPH[s.state]}  ${s.sid.slice(0, 8)}  ${fmtAgo(NOW - s.writeMs).padEnd(10)} ${s.title || '(untitled)'}${flag}`);
    const where = s.cwd || '(directory unknown — transcript has no cwd)';
    const gone = s.cwdGone ? '  ⚠ gone — renamed or deleted since' : '';
    L.push(`            ${where}${s.branch ? `  [${s.branch}]` : ''}${gone}`);
  }
  L.push('');

  // The sessions are the visible loss; the working trees they were editing are the one that bites
  // later. Uncommitted work SURVIVES a reboot — but nobody tells you it is sitting there, and a
  // restored session, whose own memory of it died with the terminal, will edit straight over it.
  const trees = [...groupByCwd(offered).keys()].filter((d) => d !== '(unknown directory)');
  const dirty = [];
  for (const dir of trees) {
    const st = git(dir, ['status', '--porcelain']);
    if (st) dirty.push({ dir, n: st.split(/\r?\n/).filter(Boolean).length, branch: git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']) });
  }
  const withWork = dirty.filter((d) => d.n > 0);
  if (withWork.length) {
    L.push('STILL ON DISK — uncommitted work in the trees these sessions were editing');
    for (const d of withWork) {
      L.push(`  ${d.dir}  [${d.branch || '?'}]  ${d.n} uncommitted file${d.n === 1 ? '' : 's'}`);
    }
    L.push('  → it outlived the terminal. Look at it before a restored session edits on top.');
    L.push('');
  }

  L.push('REOPEN THEM');
  for (const [dir, group] of groupByCwd(offered)) {
    if (group[0].cwdGone) {
      // No cd line: pasting one that fails is worse than saying why it is missing.
      L.push(`  ${dir}  — no longer exists, so these cannot be resumed in place:`);
      for (const s of group) L.push(`    ${s.sid}  # find where this moved, then resume there`);
      continue;
    }
    L.push(`  cd "${dir}"`);
    for (const s of group) L.push(`    claude --resume ${s.sid}    # ${s.title || '(untitled)'}`);
  }
  if (offered.some((s) => s.cwd && !s.cwdGone)) {
    L.push('');
    L.push('  or re-run with --launch (Windows Terminal tabs) or --vscode (VS Code terminals).');
  }
}

if (unknowable.length) {
  L.push('');
  L.push(`${unknowable.length} session${unknowable.length === 1 ? '' : 's'} in this window predate the marker hook ` +
         `(installed ${fmtAgo(NOW - INSTALLED_AT)}) and cannot be classified.`);
  L.push('Absence of a marker only means "killed" for sessions that ended after it existed.');
}

if (sinceReboot.length && !opts.all && fromReboot.length) {
  L.push('');
  L.push(`${sinceReboot.length} session${sinceReboot.length === 1 ? '' : 's'} died some other way since the reboot ` +
         `(a force-quit terminal, not the restart) — --all to include them.`);
}

console.log(L.join('\n'));

// ---- 4. --vscode ------------------------------------------------------
// VS Code has no CLI verb for "open a terminal running X" — the only supported hook is a task
// with runOn=folderOpen, which fires as the window opens. So the restore is: write one task per
// lost session, then `code <repo>`. Each task gets its own dedicated panel, which is what makes
// the result look like the tabs you lost rather than one shared output pane.
const TASK_PREFIX = 'restore-after-reboot: ';
const SCRIPT_PATH = path.resolve(__filename);

function taskFor(s) {
  return {
    // The prefix is the ownership marker. A merge removes every task carrying it and adds these,
    // so re-running never accumulates duplicates and never touches a task you wrote.
    //
    // The sid8 suffix is not decoration: two lost tabs in one repo very often share a title (that
    // is what the title hook is FOR), and VS Code keys tasks by label — same label twice is an
    // ambiguous entry the user cannot tell apart in the picker.
    label: `${TASK_PREFIX}${s.title || 'session'} (${s.sid.slice(0, 8)})`,
    detail: `session ${s.sid}`,
    type: 'shell',
    command: `node "${SCRIPT_PATH}" --resume-once "${s.sid}" "${s.cwd}"`,
    presentation: { panel: 'dedicated', group: 'restore', reveal: 'always', focus: false },
    runOptions: { runOn: 'folderOpen' },
    problemMatcher: [],
  };
}

// ⛔ Never clobber. tasks.json is a file the user owns, it is JSONC (comments are legal and
// common), and a reformat that silently eats their comments is not a trade this feature gets to
// make. Strict JSON.parse is the gate: it parses, we merge and keep a .bak; it does not, we leave
// the file completely alone and say so.
function writeTasks(dir, sessions) {
  const vscodeDir = path.join(dir, '.vscode');
  const file = path.join(vscodeDir, 'tasks.json');
  const scratch = path.join(dir, ...TOKEN_DIR);
  const existing = (() => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } })();
  let doc = { version: '2.0.0', tasks: [] };
  if (existing != null) {
    try {
      doc = JSON.parse(existing);
    } catch {
      return { ok: false, why: 'tasks.json has comments or is malformed — left untouched' };
    }
    if (!Array.isArray(doc.tasks)) doc.tasks = [];
  }
  doc.tasks = doc.tasks.filter((t) => !(t && typeof t.label === 'string' && t.label.startsWith(TASK_PREFIX)));
  doc.tasks.push(...sessions.map(taskFor));
  doc.version = doc.version || '2.0.0';

  fs.mkdirSync(scratch, { recursive: true });
  // ⛔ This tool's whole pitch is "here is the uncommitted work you forgot about" — so it does not
  // get to leave its own droppings in your `git status`. The scratch dir ignores ITSELF, which
  // needs no cooperation from the repo's .gitignore, and the backup lives in it for the same
  // reason (a tasks.json.bak sitting in .vscode/ is one more untracked file to explain).
  fs.writeFileSync(path.join(scratch, '.gitignore'), '*\n');
  const bak = existing != null ? path.join(scratch, 'tasks.json.bak') : null;
  if (bak) fs.writeFileSync(bak, existing);
  for (const s of sessions) fs.writeFileSync(tokenPath(dir, s.sid), s.sid);
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  return { ok: true, bak };
}

if (opts.vscode) {
  const launchable = offered.filter((s) => s.cwd && !s.cwdGone);
  if (!launchable.length) {
    console.log('\nNothing --vscode can open — every lost session lacks a usable directory.');
    process.exit(0);
  }
  console.log('');
  for (const [dir, group] of groupByCwd(launchable)) {
    const r = writeTasks(dir, group);
    if (!r.ok) {
      console.log(`  ⚠ ${dir} — ${r.why}`);
      for (const s of group) console.log(`      cd "${dir}" && claude --resume ${s.sid}`);
      continue;
    }
    console.log(`  ${dir} — ${group.length} task${group.length === 1 ? '' : 's'}` +
                `${r.bak ? `\n      (your tasks.json backed up to ${r.bak})` : ''}`);
    // Test seam: the suite exercises the tasks.json merge, which must not open a real editor.
    if (process.env.CLAUDE_RESTORE_TEST_NO_OPEN) continue;
    const c = spawnSync('code', [dir], { stdio: 'ignore', shell: true });
    if (c.status !== 0) console.log(`      ⚠ \`code\` did not open it — run: code "${dir}"`);
  }
  console.log('\nVS Code asks once per folder to allow automatic tasks — answer Allow.');
  // Worth saying out loud: folderOpen fires on OPEN. A window already showing that folder is not
  // reopened by `code <dir>`, it is focused, and the tasks do not run.
  console.log('A folder already open in a window is only focused, so its tasks will not fire —');
  console.log('close that window first, or paste the resume line above.');
  process.exit(0);
}

// ---- 5. --launch ------------------------------------------------------
// The only verb here that does anything. Windows Terminal is the one shell host that can be told
// "new tab, in this directory, running this" from outside itself; everywhere else the paste block
// above is the interface. `-w 0` targets the CURRENT window so the tabs land beside the one you
// ran this from, rather than scattering into new windows.
if (opts.launch) {
  if (process.platform !== 'win32') {
    console.log('\n--launch needs Windows Terminal. Paste the block above instead.');
    process.exit(0);
  }
  if (!offered.length) process.exit(0);
  console.log(`\nOpening ${offered.length} tab${offered.length === 1 ? '' : 's'}…`);
  for (const s of offered) {
    if (!s.cwd || s.cwdGone) {
      console.log(`  skipped ${s.sid.slice(0, 8)} — ${s.cwd ? 'its directory no longer exists' : 'no known directory'}`);
      continue;
    }
    const args = ['-w', '0', 'nt', '-d', s.cwd, '--title', s.title || s.sid.slice(0, 8),
                  'powershell.exe', '-NoExit', '-Command', `claude --resume ${s.sid}`];
    try {
      spawn('wt.exe', args, { detached: true, stdio: 'ignore' }).unref();
      console.log(`  ${s.sid.slice(0, 8)}  ${s.title || '(untitled)'}`);
    } catch (e) {
      console.log(`  failed ${s.sid.slice(0, 8)} — ${e.message}`);
    }
  }
}
