#!/usr/bin/env node
// fleet.js — READ-ONLY board of every Claude session working this repo.
//
// The problem it answers: several sessions run against one repo at once, some of them holding
// while others finish, and there is no single place that says WHO IS DOING WHAT and WHAT WILL
// COLLIDE. Every signal already exists on disk; nothing joined them. This joins them.
//
// DEV-ONLY (gated out of user installs via DEV_ONLY_FILES in bin/cli.js) — dogfooded from the CCA
// repo like token-guard and whats-happening.
//
// ⛔ READ-ONLY, deliberately. It never merges, never moves a branch, never writes to a worktree.
// Merging live branches is the one operation here that can destroy work, so it is not what the
// bare command does — a board you hesitate to run while sessions are busy is a board that is
// never run at the moment you need it. Landing is a separate, explicit verb (deferred; see the
// LAND marker at the bottom).
//
// Session discovery and the two title tiers mirror whats-happening.js exactly — same
// project-then-home search, same sid keying. What is new here is the JOIN:
//
//   sid → working tree.  A session's transcript lives at ~/.claude/projects/<slug>/<sid>.jsonl,
//   where <slug> is the session's cwd with every non-alphanumeric character replaced by '-'.
//   That is reversible enough for our purpose: rather than decode the slug (lossy — '-', '/' and
//   '.' all collapse to the same character), we slugify each tree we already know about and
//   compare forward. Exact, and it needs no new instrumentation in the hooks.
//
// Usage:
//   node fleet.js [--project-dir DIR] [--all] [--json]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// ---- args -------------------------------------------------------------
const opts = {
  projectDir: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  selfSid: process.env.CLAUDE_CODE_SESSION_ID || '',
  all: false,
  json: false,
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--project-dir') opts.projectDir = argv[++i];
  else if (a === '--all') opts.all = true;
  else if (a === '--json') opts.json = true;
}

const NOW = Date.now();
const projectsBase = path.join(os.homedir(), '.claude', 'projects');

// Liveness thresholds. LIVE is generous on purpose: a session composing a long turn can go 90s
// between transcript writes, and calling that "idle" is the error that makes the board lie in the
// dangerous direction (you'd take its file thinking nobody was there).
const LIVE_MS   = 3 * 60_000;    // wrote in the last 3 min — assume a human/agent is on it
const RECENT_MS = 30 * 60_000;   // wrote in the last 30 min — probably yours, probably parked

// ---- shared helpers (same shape as whats-happening.js) ----------------
function titleDirs() {
  const candidates = [
    path.join(opts.projectDir, '.claude', 'hooks', '.titles'),
    path.join(os.homedir(), '.claude', 'hooks', '.titles'),
  ];
  const seen = new Set();
  const out = [];
  for (const d of candidates) {
    let real;
    try { real = fs.realpathSync(d); } catch { continue; }
    if (seen.has(real)) continue;
    seen.add(real);
    out.push(d);
  }
  return out;
}

function fmtDur(msSpan) {
  if (msSpan == null) return '?';
  const s = Math.max(0, Math.round(msSpan / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
const fmtAgo = (msSpan) => (msSpan == null ? 'never' : `${fmtDur(msSpan)} ago`);

// Claude Code's project-directory slug: every non-alphanumeric character becomes '-'.
// (`C:\CODE\job-agent-extension` → `C--CODE-job-agent-extension`.)
const slugify = (p) => String(p).replace(/[^a-zA-Z0-9]/g, '-');

function git(cwd, args) {
  try {
    const out = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    // TRAILING trim only. `git status --porcelain` encodes the index/worktree state in the first
    // TWO COLUMNS, so an unstaged edit begins with a literal space — a .trim() here silently ate it
    // on the first line and only the first line, which then failed the status-column regex and
    // printed 'M .claude/…' as if the M were part of the path. Cost an hour to see because every
    // other row was correct.
    return out.replace(/\s+$/, '');
  } catch {
    return null;   // not a repo, bad ref, or git absent — every caller treats null as "unknown"
  }
}

// ---- 1. sessions ------------------------------------------------------
// One row per session: title, when its title last changed, whether it is flagged as awaiting the
// user, and which transcript (hence which working tree) it belongs to.
function readSessions() {
  const bySid = new Map();
  for (const dir of titleDirs()) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')); } catch { continue; }
    for (const f of files) {
      const sid = f.slice(0, -4);
      if (bySid.has(sid)) continue;                 // project tier wins over home tier
      const full = path.join(dir, f);
      let title = '';
      let titleMs = null;
      try {
        title = fs.readFileSync(full, 'utf8').trim();
        titleMs = fs.statSync(full).mtimeMs;
      } catch { continue; }
      if (!title) continue;
      // The awaiting-you flag is one-shot and consumed at turn end, so its PRESENCE is a live
      // signal, not a historical one — exactly what the board wants to surface first.
      const awaiting = fs.existsSync(path.join(dir, `${sid}.ask`));
      // The dupe guard already computes colliding twins; reuse rather than recompute.
      let dupeSids = [];
      try {
        const d = JSON.parse(fs.readFileSync(path.join(dir, `${sid}.dupe.json`), 'utf8'));
        if (Array.isArray(d.sids)) dupeSids = d.sids;
      } catch { /* absent or mid-write — the title-grouping below covers it anyway */ }
      bySid.set(sid, { sid, title, titleMs, awaiting, dupeSids });
    }
  }
  return [...bySid.values()];
}

// Locate the transcript and, through its parent directory name, the session's working tree.
function locate(sess, treeSlugs) {
  let dirs = [];
  try { dirs = fs.readdirSync(projectsBase); } catch { return sess; }
  for (const d of dirs) {
    const p = path.join(projectsBase, d, `${sess.sid}.jsonl`);
    if (!fs.existsSync(p)) continue;
    sess.transcript = p;
    sess.slug = d;
    sess.tree = treeSlugs.get(d) || null;   // null = a tree we don't know (another repo entirely)
    try { sess.writeMs = fs.statSync(p).mtimeMs; } catch { sess.writeMs = null; }
    break;
  }
  return sess;
}

const stateOf = (s) => {
  if (s.awaiting) return 'awaiting';
  const age = s.writeMs != null ? NOW - s.writeMs : null;
  if (age == null) return 'unknown';
  if (age < LIVE_MS) return 'live';
  if (age < RECENT_MS) return 'recent';
  return 'idle';
};

// ---- 2. worktrees + git state ----------------------------------------
// The FIRST entry of `git worktree list --porcelain` is always the main checkout; its branch is
// the base every other branch is measured against. Detecting it beats hardcoding 'main' — a repo
// on 'master' or mid-release on a different base would otherwise silently report every branch as
// fully unlanded.
function readWorktrees() {
  const raw = git(opts.projectDir, ['worktree', 'list', '--porcelain']);
  if (!raw) return [];
  const trees = [];
  let cur = null;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      cur = { dir: line.slice(9).trim(), branch: null, locked: false };
      trees.push(cur);
    } else if (cur && line.startsWith('branch ')) {
      cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
    } else if (cur && line.startsWith('locked')) {
      cur.locked = true;
    }
  }
  return trees;
}

function enrich(trees, baseBranch, baseDir) {
  for (const t of trees) {
    t.isBase = t.dir === baseDir;
    t.slug = slugify(t.dir);
    // Dirty files. --porcelain keeps this parseable and, unlike `git status`, says nothing about
    // branch state we'd have to strip back out.
    // Parse the two status columns off the front rather than slicing a fixed 3 — a staged-and-
    // modified entry ('MM ') and an unstaged one (' M ') are the same width, but a rename carries
    // 'old -> new' and a fixed slice silently ate the leading '.' of dotfile paths.
    const st = git(t.dir, ['status', '--porcelain']);
    t.dirty = st
      ? st.split(/\r?\n/).filter(Boolean).map((l) => {
          const m = /^..\s(.*)$/.exec(l);
          const p = m ? m[1] : l;
          return p.includes(' -> ') ? p.split(' -> ').pop().trim() : p.trim();
        })
      : [];
    if (t.isBase || !t.branch) { t.unlanded = []; t.files = []; continue; }
    // Commits on this branch not yet on the base, and the files they touch. Three-dot is
    // deliberate: it measures the branch against the MERGE BASE, so a base that moved ahead
    // doesn't inflate the branch's apparent footprint.
    const log = git(t.dir, ['log', '--oneline', `${baseBranch}..HEAD`]);
    t.unlanded = log ? log.split(/\r?\n/).filter(Boolean) : [];
    const names = git(t.dir, ['diff', '--name-only', `${baseBranch}...HEAD`]);
    t.files = names ? names.split(/\r?\n/).filter(Boolean) : [];
  }
  return trees;
}

// ---- 3. the collisions worth naming ----------------------------------
// Three distinct hazards, in descending order of how badly they end.

// (a) SAME-TREE — two or more live sessions sharing one working tree that is dirty. This is the
//     one that silently loses work: last write wins and no session is told. It is also the one a
//     merge tool cannot fix after the fact, which is why the board leads with it.
function sameTreeCollisions(sessions, trees) {
  const out = [];
  const byTree = new Map();
  for (const s of sessions) {
    if (!s.tree || (stateOf(s) !== 'live' && stateOf(s) !== 'awaiting')) continue;
    if (!byTree.has(s.tree.dir)) byTree.set(s.tree.dir, []);
    byTree.get(s.tree.dir).push(s);
  }
  for (const [dir, group] of byTree) {
    if (group.length < 2) continue;
    const tree = trees.find((t) => t.dir === dir);
    out.push({ dir, group, dirty: tree ? tree.dirty : [] });
  }
  return out;
}

// (b) DUPLICATE TITLE — sessions that believe they are doing the same job. Cheap to detect and a
//     strong signal of wasted work even when they are properly isolated in separate worktrees.
function duplicateTitles(sessions) {
  const byTitle = new Map();
  for (const s of sessions) {
    if (stateOf(s) === 'idle') continue;
    const k = s.title.toLowerCase().trim();
    if (!byTitle.has(k)) byTitle.set(k, []);
    byTitle.get(k).push(s);
  }
  return [...byTitle.entries()].filter(([, g]) => g.length > 1).map(([, g]) => g);
}

// (c) FILE OVERLAP — two unlanded branches touching the same file. Titles tell you two sessions
//     SOUND similar; this tells you they will actually conflict at merge time, which is the only
//     version of the question that has a mechanical answer.
function fileOverlaps(trees) {
  const branched = trees.filter((t) => !t.isBase && t.files && t.files.length);
  const out = [];
  for (let i = 0; i < branched.length; i++) {
    for (let j = i + 1; j < branched.length; j++) {
      const a = new Set(branched[i].files);
      const shared = branched[j].files.filter((f) => a.has(f));
      if (shared.length) out.push({ a: branched[i], b: branched[j], shared });
    }
  }
  return out;
}

// ---- 4. run -----------------------------------------------------------
const trees = readWorktrees();
if (trees.length === 0) {
  console.log(`Not a git repository (or git unavailable): ${opts.projectDir}`);
  process.exit(0);
}
const baseDir = trees[0].dir;
const baseBranch = trees[0].branch || 'HEAD';
enrich(trees, baseBranch, baseDir);

const treeSlugs = new Map(trees.map((t) => [t.slug, t]));
const sessions = readSessions()
  .map((s) => locate(s, treeSlugs))
  .filter((s) => opts.all || s.tree || s.writeMs != null)
  .sort((a, b) => (b.writeMs || b.titleMs || 0) - (a.writeMs || a.titleMs || 0));

// Only sessions belonging to a tree of THIS repo — a board that lists your other projects'
// sessions is noise, and the git half of every row would be meaningless for them.
const mine = sessions.filter((s) => s.tree);
const shown = opts.all ? mine : mine.filter((s) => stateOf(s) !== 'idle');

if (opts.json) {
  console.log(JSON.stringify({
    base: { dir: baseDir, branch: baseBranch },
    trees, sessions: mine.map((s) => ({ ...s, state: stateOf(s) })),
    sameTree: sameTreeCollisions(mine, trees),
    duplicates: duplicateTitles(mine),
    overlaps: fileOverlaps(trees),
  }, null, 2));
  process.exit(0);
}

const L = [];
const liveN = mine.filter((s) => stateOf(s) === 'live').length;
const awaitN = mine.filter((s) => stateOf(s) === 'awaiting').length;
// Lead with the ACTIVE count, not the total. Every session this repo has ever run leaves a title
// file behind, so the total is in the hundreds and reads as alarming noise — the number you act on
// is how many are awake right now. The historical count trails in parentheses for context.
const wtN = trees.length - 1;
L.push(`FLEET — ${shown.length} active · ${liveN} live · ${awaitN} awaiting you · ` +
       `${wtN} worktree${wtN === 1 ? '' : 's'}   (${mine.length} sessions known)`);
L.push(`base: ${baseBranch} at ${baseDir}`);
L.push('');

// --- hazards first. The board's job is to put the thing that loses work at the top. ---
const sameTree = sameTreeCollisions(mine, trees);
for (const c of sameTree) {
  L.push(`⚠ SAME-TREE COLLISION — ${c.group.length} active sessions in one working tree`);
  L.push(`  ${c.dir}`);
  for (const s of c.group) {
    L.push(`    ${s.sid.slice(0, 8)}  ${fmtAgo(NOW - (s.writeMs || s.titleMs))}  ${s.title}`);
  }
  if (c.dirty.length) {
    L.push(`  uncommitted here: ${c.dirty.slice(0, 6).join(', ')}${c.dirty.length > 6 ? ` (+${c.dirty.length - 6})` : ''}`);
    L.push('  → last write wins and no session is told. Worktree the newest, or stop them.');
  }
  L.push('');
}

for (const g of duplicateTitles(mine)) {
  // A duplicate that is ALSO a same-tree collision is already reported above with more detail.
  const treesInGroup = new Set(g.map((s) => s.tree && s.tree.dir));
  if (treesInGroup.size === 1 && sameTree.some((c) => c.dir === [...treesInGroup][0])) continue;
  L.push(`⚠ DUPLICATE TITLE — ${g.length} sessions think they own the same job`);
  L.push(`  "${g[0].title}"`);
  for (const s of g) {
    const wt = s.tree && !s.tree.isBase ? s.tree.branch : '(base checkout)';
    L.push(`    ${s.sid.slice(0, 8)}  ${wt}`);
  }
  L.push('');
}

for (const o of fileOverlaps(trees)) {
  L.push(`⚠ OVERLAP — ${o.a.branch} and ${o.b.branch} both touch ${o.shared.length} file${o.shared.length === 1 ? '' : 's'}`);
  for (const f of o.shared.slice(0, 5)) L.push(`    ${f}`);
  if (o.shared.length > 5) L.push(`    (+${o.shared.length - 5} more)`);
  L.push('  → these will conflict at merge. Land one, rebase the other.');
  L.push('');
}

// --- then the roster ---
// Padded to one width so the columns after them line up — the roster is scanned vertically, and a
// ragged left edge is what makes a six-row board harder to read than it should be.
const GLYPH = {
  awaiting: '◐ AWAIT ', live: '● LIVE  ', recent: '○ RECENT', idle: '· IDLE  ', unknown: '? UNKNWN',
};
if (shown.length === 0) {
  L.push('No active sessions in this repo. (--all to include idle ones.)');
} else {
  L.push('SESSIONS');
  for (const s of shown) {
    const st = stateOf(s);
    const wt = s.tree.isBase ? 'base' : s.tree.branch;
    const age = fmtAgo(NOW - (s.writeMs || s.titleMs));
    const self = s.sid === opts.selfSid ? ' ←you' : '';
    L.push(`  ${GLYPH[st]}  ${s.sid.slice(0, 8)}  ${age.padEnd(9)} ${wt.padEnd(28)} ${s.title}${self}`);
  }
}
L.push('');

// --- and what is sitting unlanded ---
const landable = trees.filter((t) => !t.isBase && t.unlanded.length);
if (landable.length) {
  L.push('UNLANDED');
  // Least-overlapping first: a branch that shares no files with any other is safe to land now and
  // shrinks the problem for the rest. This is an ORDERING, not an instruction to merge.
  const overlapCount = new Map(landable.map((t) => [t.branch, 0]));
  for (const o of fileOverlaps(trees)) {
    overlapCount.set(o.a.branch, (overlapCount.get(o.a.branch) || 0) + o.shared.length);
    overlapCount.set(o.b.branch, (overlapCount.get(o.b.branch) || 0) + o.shared.length);
  }
  const ordered = [...landable].sort((a, b) => (overlapCount.get(a.branch) || 0) - (overlapCount.get(b.branch) || 0));
  for (const t of ordered) {
    const busy = mine.some((s) => s.tree && s.tree.dir === t.dir && (stateOf(s) === 'live' || stateOf(s) === 'awaiting'));
    const ov = overlapCount.get(t.branch) || 0;
    const flags = [
      `${t.unlanded.length} commit${t.unlanded.length === 1 ? '' : 's'}`,
      ov ? `${ov} overlapping file${ov === 1 ? '' : 's'}` : 'no overlap',
      t.dirty.length ? `${t.dirty.length} uncommitted` : 'clean',
      busy ? '⚠ session still active' : 'session idle',
    ];
    L.push(`  ${t.branch}`);
    L.push(`    ${flags.join(' · ')}`);
  }
  L.push('');
  L.push(`  merge from ${baseDir} (never from inside a worktree):`);
  L.push(`    git merge ${ordered[0].branch}`);
}

// LAND: the second verb lives here when it is built — it would consume this same ordering, refuse
// while any session in a group is live, and stop on the first conflict rather than continuing.

console.log(L.join('\n'));
