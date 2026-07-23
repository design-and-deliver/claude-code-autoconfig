#!/usr/bin/env node
// whats-happening.js — OBSERVER for a (possibly still-running) Claude session.
//
// A session that's "running forever" is busy in its agent loop and can't answer
// a slash command mid-turn. So this runs from a DIFFERENT terminal: given a
// session TITLE (the one shown in the tab), it finds that session's live
// transcript on disk and reports what its CURRENT turn is doing and how long
// each step has taken.
//
// DEV-ONLY (gated out of user installs via DEV_ONLY_FILES in bin/cli.js) —
// dogfooded from the CCA repo like token-guard. See CLAUDE.md dev-gate trap.
//
// Scope (the two RELIABLE outputs only):
//   (1) what the turn is doing right now, and
//   (2) time spent per activity, from transcript event timestamps.
// Deferred (best-effort, often absent): "still plans to do" + ETA. See the
// PLANS/ETA marker below for where they'd slot in.
//
// Title lookup mirrors terminal-title.js's TWO tiers: a copy-shipping repo keeps
// titles at <project>/.claude/hooks/.titles; the user-level fallback copy keeps
// them at ~/.claude/hooks/.titles. We search both. Transcripts are globbed from
// ~/.claude/projects/*/{sid}.jsonl, so no path-slug math is needed.
//
// Usage:
//   node whats-happening.js "<title substring>" [--project-dir DIR] [--exclude-sid SID] [--json]
//   node whats-happening.js --list

const fs = require('fs');
const os = require('os');
const path = require('path');

// ---- args -------------------------------------------------------------
const argv = process.argv.slice(2);
const opts = {
  query: '',
  projectDir: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  excludeSid: process.env.CLAUDE_CODE_SESSION_ID || '',
  json: false,
  list: false,
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--project-dir') opts.projectDir = argv[++i];
  else if (a === '--exclude-sid') opts.excludeSid = argv[++i];
  else if (a === '--json') opts.json = true;
  else if (a === '--list') opts.list = true;
  else if (!a.startsWith('--') && !opts.query) opts.query = a;
}
if (!opts.query && !opts.list) {
  console.error('Usage: node whats-happening.js "<title substring>" | --list  [--project-dir DIR]');
  process.exit(2);
}

const NOW = Date.now();
const projectsBase = path.join(os.homedir(), '.claude', 'projects');

// Both title tiers, existing only, deduped by canonical path (an aliased HOME or
// a project that IS ~/.claude must not be scanned twice).
function titleDirs() {
  const candidates = [
    path.join(opts.projectDir, '.claude', 'hooks', '.titles'),
    path.join(os.homedir(), '.claude', 'hooks', '.titles'),
  ];
  const seen = new Set();
  const out = [];
  for (const d of candidates) {
    let real;
    try { real = fs.realpathSync(d); } catch { continue; } // missing dir
    if (seen.has(real)) continue;
    seen.add(real);
    out.push(d);
  }
  return out;
}

// ---- 1. title substring -> candidate sids -----------------------------
// Scan every title tier; first tier to name a sid wins (project before home).
function readTitles() {
  const q = opts.query.trim().toLowerCase();
  const bySid = new Map();
  for (const dir of titleDirs()) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')); } catch { continue; }
    for (const f of files) {
      const sid = f.slice(0, -4);
      if (sid === opts.excludeSid || bySid.has(sid)) continue;
      let title = '';
      try { title = fs.readFileSync(path.join(dir, f), 'utf8').trim(); } catch { continue; }
      if (title.toLowerCase().includes(q)) bySid.set(sid, { sid, title });
    }
  }
  return [...bySid.values()];
}

// All sessions across tiers (for --list), deduped by sid.
function allTitles() {
  const bySid = new Map();
  for (const dir of titleDirs()) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')); } catch { continue; }
    for (const f of files) {
      const sid = f.slice(0, -4);
      if (sid === opts.excludeSid || bySid.has(sid)) continue;
      let title = '';
      try { title = fs.readFileSync(path.join(dir, f), 'utf8').trim(); } catch { continue; }
      bySid.set(sid, { sid, title });
    }
  }
  return [...bySid.values()];
}

// glob ~/.claude/projects/*/<sid>.jsonl without extra deps
function findTranscript(sid) {
  let dirs = [];
  try { dirs = fs.readdirSync(projectsBase); } catch { return null; }
  for (const d of dirs) {
    const p = path.join(projectsBase, d, `${sid}.jsonl`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ---- 2. transcript parsing --------------------------------------------
function parseTranscript(file) {
  const raw = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const rows = [];
  for (const line of raw) { try { rows.push(JSON.parse(line)); } catch { /* skip partial tail write */ } }
  return rows;
}

const isRealPrompt = (o) => o && o.type === 'user' && !o.isMeta && !o.isSidechain && (
  typeof o.message?.content === 'string'
    ? o.message.content.trim() !== ''
    : Array.isArray(o.message?.content) && o.message.content.some((b) => b.type !== 'tool_result')
);

function ms(ts) { const t = Date.parse(ts); return Number.isNaN(t) ? null : t; }

function summarizeInput(name, input) {
  if (!input || typeof input !== 'object') return '';
  const pick = (...keys) => { for (const k of keys) { const v = input[k]; if (v != null && v !== '') return String(v); } return ''; };
  let s;
  switch (name) {
    case 'Bash': s = pick('description', 'command'); break;
    case 'Read': case 'Edit': case 'Write': case 'NotebookEdit': s = pick('file_path'); break;
    case 'Grep': s = 'grep ' + pick('pattern'); break;
    case 'Glob': s = pick('pattern'); break;
    case 'Agent': case 'Task': s = '[' + pick('subagent_type', 'agentType') + '] ' + pick('description'); break;
    case 'Workflow': s = pick('name', 'title', 'description'); break;
    case 'WebFetch': s = pick('url'); break;
    case 'WebSearch': s = pick('query'); break;
    case 'Skill': s = pick('skill'); break;
    default: s = pick('description', 'file_path', 'command', 'pattern', 'query', 'url', 'name');
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > 90 ? s.slice(0, 87) + '…' : s;
}

function fmtDur(msSpan) {
  if (msSpan == null) return '?';
  const s = Math.max(0, Math.round(msSpan / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60); const rm = m % 60;
  return `${h}h ${rm}m`;
}

function fmtAgo(msSpan) { return msSpan == null ? '?' : `${fmtDur(msSpan)} ago`; }

// Build the current-turn timeline for one session.
function analyze(sid, title, file) {
  const rows = parseTranscript(file);
  const mtimeMs = (() => { try { return fs.statSync(file).mtimeMs; } catch { return null; } })();

  // current turn = from the LAST real user prompt to the end
  let startIdx = 0;
  for (let i = rows.length - 1; i >= 0; i--) { if (isRealPrompt(rows[i])) { startIdx = i; break; } }
  const turn = rows.slice(startIdx);
  const turnStartTs = ms(rows[startIdx]?.timestamp);

  // completion map: tool_use_id -> result timestamp (scan whole turn)
  const resultTs = new Map();
  for (const o of turn) {
    const c = o.message?.content;
    if (Array.isArray(c)) for (const b of c) if (b.type === 'tool_result' && b.tool_use_id) resultTs.set(b.tool_use_id, ms(o.timestamp));
  }

  // main-thread tool_use blocks in order = the step timeline
  const steps = [];
  let lastAssistantText = '';
  let lastLineTs = null;
  for (const o of turn) {
    if (o.timestamp) { const t = ms(o.timestamp); if (t != null) lastLineTs = t; }
    if (o.isSidechain) continue; // subagent internals collapse into their parent Agent step
    const c = o.message?.content;
    if (o.type === 'assistant' && Array.isArray(c)) {
      for (const b of c) {
        if (b.type === 'text' && b.text?.trim()) lastAssistantText = b.text.trim();
        if (b.type === 'tool_use') {
          const startTs = ms(o.timestamp);
          const endTs = resultTs.has(b.id) ? resultTs.get(b.id) : null;
          steps.push({
            name: b.name,
            summary: summarizeInput(b.name, b.input),
            startTs,
            endTs,
            running: endTs == null,
            durMs: endTs != null && startTs != null ? endTs - startTs : (startTs != null ? NOW - startTs : null),
          });
        }
      }
    }
  }

  const running = steps.find((s) => s.running) || null;
  const sinceLastEvent = lastLineTs != null ? NOW - lastLineTs : null;
  const sinceMtime = mtimeMs != null ? NOW - mtimeMs : null;

  // liveness: freshest of (last event, file mtime). Small => actively working.
  const freshness = Math.min(...[sinceLastEvent, sinceMtime].filter((x) => x != null));
  let state;
  if (running) state = 'running-tool';
  else if (Number.isFinite(freshness) && freshness < 90_000) state = 'thinking';
  else state = 'idle-or-done';

  return {
    sid, title, file, mtimeMs,
    turnStartTs, elapsedMs: turnStartTs != null ? NOW - turnStartTs : null,
    steps, running, lastAssistantText, sinceLastEvent, sinceMtime, state,
  };
}

// ---- 3. run + render ---------------------------------------------------

// --list: recent sessions across both tiers by last transcript write, so you can
// see which are live and grab a title to probe.
if (opts.list) {
  const rows = [];
  for (const { sid, title } of allTitles()) {
    const file = findTranscript(sid);
    if (!file) continue;
    let mtimeMs = null; try { mtimeMs = fs.statSync(file).mtimeMs; } catch { /* skip */ }
    rows.push({ sid, title, file, mtimeMs });
  }
  rows.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
  const top = rows.slice(0, 12);
  console.log('**Recent sessions** (newest write first, both title tiers):');
  if (top.length === 0) { console.log('- (none found)'); process.exit(0); }
  for (const r of top) {
    const A = analyze(r.sid, r.title, r.file);
    const glyph = A.state === 'running-tool' ? '▶ live' : A.state === 'thinking' ? '… live' : '⏸ idle';
    console.log(`- ${glyph} · last write ${fmtAgo(A.sinceMtime)} · ${A.sid.slice(0, 8)} · ${r.title}`);
  }
  process.exit(0);
}

const matches = readTitles();
if (matches.length === 0) {
  console.log(`No session title matches "${opts.query}" in ${titleDirs().join(' or ') || '(no .titles dirs found)'}`);
  process.exit(0);
}

const analyses = matches
  .map((m) => { const f = findTranscript(m.sid); return f ? analyze(m.sid, m.title, f) : null; })
  .filter(Boolean)
  .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0)); // most recently active first

if (analyses.length === 0) {
  console.log(`Matched ${matches.length} title(s) but found no transcript on disk for them.`);
  process.exit(0);
}

if (opts.json) { console.log(JSON.stringify(analyses[0], null, 2)); process.exit(0); }

const A = analyses[0];
const shortSid = A.sid.slice(0, 8);
const stateLabel = A.state === 'running-tool'
  ? '▶ actively running a tool'
  : A.state === 'thinking'
    ? '… thinking / composing (no tool in flight)'
    : '⏸ idle or turn finished (no fresh writes)';

const lines = [];
lines.push(`## ${A.title}`);
lines.push(`session ${shortSid} · ${stateLabel}`);
lines.push(`turn started ${fmtAgo(A.elapsedMs)} · ${A.steps.length} tool step${A.steps.length === 1 ? '' : 's'} · last write ${fmtAgo(A.sinceMtime)}`);
lines.push('');

if (A.running) {
  lines.push(`**Right now:** ${A.running.name} — ${A.running.summary || '(no summary)'}  ·  running for ${fmtDur(A.running.durMs)}`);
} else if (A.state === 'thinking') {
  lines.push(`**Right now:** generating the next step (${fmtDur(A.sinceLastEvent)} since the last tool returned)`);
} else {
  lines.push('**Right now:** nothing in flight — this turn looks finished or the session is awaiting you.');
}
if (A.lastAssistantText) {
  const t = A.lastAssistantText.replace(/\s+/g, ' ').slice(0, 160);
  lines.push(`_last said:_ "${t}${A.lastAssistantText.length > 160 ? '…' : ''}"`);
}
lines.push('');

// where the time went — rollup by tool (each step's span = time to produce +
// run it, so these sum to ~the turn's wall-clock; a compact budget view).
if (A.steps.length > 0) {
  const roll = new Map();
  for (const s of A.steps) {
    const r = roll.get(s.name) || { n: 0, ms: 0 };
    r.n += 1; r.ms += s.durMs || 0; roll.set(s.name, r);
  }
  const ranked = [...roll.entries()].sort((a, b) => b[1].ms - a[1].ms);
  lines.push('**Where the time went** (produce + run, per tool):');
  lines.push(ranked.map(([name, r]) => `${name} ×${r.n} ${fmtDur(r.ms)}`).join('  ·  '));
  lines.push('');
}

const CAP = 12;
const tail = A.steps.slice(-CAP);
const hidden = A.steps.length - tail.length;
lines.push(`**Recent steps**${hidden > 0 ? ` (last ${CAP} of ${A.steps.length})` : ''}:`);
if (A.steps.length === 0) {
  lines.push('- (no tool calls yet this turn)');
} else {
  if (hidden > 0) lines.push(`- …${hidden} earlier step${hidden === 1 ? '' : 's'}`);
  for (const s of tail) {
    const mark = s.running ? '⏳' : '✓';
    const dur = s.running ? `${fmtDur(s.durMs)} so far` : fmtDur(s.durMs);
    lines.push(`- ${mark} **${s.name}** — ${s.summary || '(no summary)'}  (${dur})`);
  }
}

// PLANS/ETA: deferred by design. To add: read the session's TaskList state / any
// plan doc here and append "Plans:" + a low-confidence ETA off remaining steps.

if (analyses.length > 1) {
  lines.push('');
  lines.push(`_(${analyses.length} sessions share this title; showing the most recently active. Others: ${analyses.slice(1).map((x) => x.sid.slice(0, 8)).join(', ')})_`);
}

console.log(lines.join('\n'));
