#!/usr/bin/env node
/**
 * statusline-cost.js — Claude Code statusLine command: the ambient session-cost readout.
 *
 * When (and only when) a fresh session would be meaningfully cheaper, the statusline shows
 * three distilled figures — session total, live context (the per-turn re-read), fresh-start
 * cost — and a /clear + /continue remedy line. The rest of the time it is EMPTY: figures
 * with nothing to do about them are noise (Andrew, 2026-08-12). The statusline is the one
 * surface that can carry this without becoming wallpaper: it renders outside the
 * transcript, costs zero context tokens, and never repeats into scrollback. token-guard's
 * cards stay the interrupts; this is the gauge between them.
 *
 * GLOBAL-tier like session-close.js: wired once in ~/.claude/settings.json (statusLine
 * key), covers every repo. All metering comes from the PROJECT's own token-guard.js,
 * require()d read-only as a library — it exports its meter for tests, and require.main
 * guards its hook path. A repo without token-guard prints nothing: an empty statusline is
 * the correct rendering of "this repo doesn't meter".
 *
 * COST DISCIPLINE: Claude Code re-runs this command on every conversation update, but
 * meterSession parses the whole main transcript. The render is therefore cached per
 * session, keyed on the transcript's (mtimeMs, size) with a 10s freshness floor for the
 * mid-turn window where the transcript grows on every message — steady state is one
 * stat() per refresh and one real meter per landed turn, the same price the guard's own
 * hooks already pay.
 *
 * Fail-open EVERYWHERE: any throw prints the cached line or nothing. A statusline must
 * never be the reason a session stalls — and a mid-edit token-guard that fails to parse
 * must dim the gauge, not break the terminal.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const COLD_START_FALLBACK_TOK = 84000;  // measured 2026-07-25 floor — until the repo has samples
const MID_TURN_REUSE_MS = 10000;
const CACHE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
// A break-even horizon of BREAKEVEN_STAY_TURNS+ turns is too far out to bank on.
const BREAKEVEN_STAY_TURNS = 3;

function fmtK(n) {
  if (!(n > 0)) return '0';
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`;
}

// 0.1× cache-read price, one decimal (trailing .0 dropped): 120k → 12k, 66k → 6.6k
const k1 = (n) => `${(n / 10000).toFixed(1).replace(/\.0$/, '')}k`;

// The one gauge both surfaces share (Andrew, 2026-08-13): every figure in
// what-you-actually-pay terms (raw × 0.1 cache rate), and the fresh session is
// charged its full first-turn cold start before crediting the per-turn saving.
// save1 subtracts the ROUNDED operands so any printed saving matches the
// bullets — rounding from raw values lets "13.7k - 6.6k = 7.2k"-style drift
// slip through. clear === true is the verdict: /clear pays off within
// BREAKEVEN_STAY_TURNS turns (turns === 0 ⇒ saving starts on the first turn).
function breakEven(ctx, cold) {
  const savings = ctx - cold;
  const upfront = cold - ctx * 0.1;
  const save1 = `${(+(k1(ctx).slice(0, -1)) - +(k1(cold).slice(0, -1))).toFixed(1).replace(/\.0$/, '')}k`;
  const turns = savings > 0 && upfront > 0 ? Math.ceil(upfront / (savings * 0.1)) : 0;
  return { savings, upfront, save1, turns, clear: savings > 0 && turns < BREAKEVEN_STAY_TURNS };
}

function cachePath(sid) {
  return path.join(os.homedir(), '.claude', '.token-guard', `statusline-${sid}.json`);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function writeCache(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
  } catch (_) {}
}

// One tiny cache file per session accumulates forever otherwise. Runs only on the real-meter
// path (never the hot cached path), so it costs a readdir once per landed turn at most.
function pruneCaches(dir) {
  try {
    const cutoff = Date.now() - CACHE_MAX_AGE_MS;
    for (const n of fs.readdirSync(dir)) {
      if (!n.startsWith('statusline-')) continue;
      const p = path.join(dir, n);
      try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch (_) {}
    }
  } catch (_) {}
}

function bucketSum(per) {
  let t = 0;
  for (const v of Object.values(per || {})) t += (v.inp || 0) + (v.out || 0) + (v.cr || 0) + (v.cw || 0);
  return t;
}

// Session total = every bucket of every model, main + agents — the same sum token-guard's
// sessionTokens() renders (not exported, so summed here from the tested perModel contract).
function totalTokens(m) {
  return bucketSum((m.main || {}).perModel) + bucketSum((m.agents || {}).perModel);
}

// Mid-substep is the one moment the nudge must NOT show: a /clear there loses the substep
// narrative and re-pays the plan read (plan-authoring.md). isBoundary === false is
// token-guard's own mid-substep verdict; anything unreadable counts as "not mid-substep".
function midPlanSubstep(tg, projectDir) {
  try {
    const plans = tg.findActivePlan(projectDir);
    if (!plans || !plans.length) return false;
    const text = fs.readFileSync(plans[0].path, 'utf8');
    const cur = tg.findCurrentSubstep(text, tg.parsePlanLedger(text));
    return !!(cur && cur.isBoundary === false);
  } catch (_) { return false; }
}

function loadConfig(tg, projectDir) {
  const user = (readJson(path.join(projectDir, '.claude', 'cca.config.json')) || {}).tokenGuard || {};
  return tg.resolveConfig ? tg.resolveConfig(user) : user;
}

function render(tg, data, projectDir) {
  const cfg = loadConfig(tg, projectDir);
  const m = tg.meterSession(data.transcript_path, { fleet: cfg.fleetMeter !== false, projectDir });
  const session = totalTokens(m);
  if (!session) return '';
  const ctx = m.liveContext || 0;
  const cold = tg.coldStartTokens(projectDir, data.session_id, m, data.transcript_path)
    || COLD_START_FALLBACK_TOK;
  // Andrew's format (2026-08-12): labeled fields that carry their own explanation, and the
  // remedy as a full sentence on its own line. ALL-OR-NOTHING — the figures alone are noise
  // when there is nothing to do about them, so the whole block gates on the shared
  // break-even verdict (Andrew, 2026-08-13): the statusline interrupts only when the
  // report would say /clear, and stays empty otherwise — one gauge, two surfaces.
  const be = breakEven(ctx, cold);
  if (!be.clear) return '';
  if (midPlanSubstep(tg, projectDir)) return '';
  const DIM = '\x1b[2m', YEL = '\x1b[33m', OFF = '\x1b[0m';
  const remedy = be.upfront <= 0
    ? `/clear then /continue to save ${be.save1} tokens per turn, starting on the first turn`
    : `/clear then /continue — ${fmtK(be.upfront)} upfront breaks even within ${be.turns} turns, ` +
      `then saves ${be.save1} tokens per turn`;
  return `${DIM}session tokens = ${fmtK(session)} (${fmtK(ctx)} cache price) ·  ` +
    `new session cost = ${fmtK(cold)}${OFF}\n` +
    `${YEL}${remedy}${OFF}`;
}

function readInput() {
  let data; try { data = JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { return null; }
  if (!data || !data.transcript_path || !data.session_id) return null;
  let st; try { st = fs.statSync(data.transcript_path); } catch (_) { return null; }
  return { data, st };
}

// ---- /cost-compare report mode ---------------------------------------------
// `node statusline-cost.js --report [transcript.jsonl]` prints the two figures
// the continue-vs-fresh decision actually turns on — live context (the per-turn
// re-read) and fresh-start cost — with the comparison spelled out. Session
// total is deliberately absent: it is sunk cost, and no decision recovers it
// (Andrew, 2026-08-13); /usage-report owns the spend detail. It is the
// on-demand readout for the times the ambient line is deliberately empty. Run from a
// shell, not from Claude Code's statusLine, so there is no stdin payload:
// project = cwd, transcript = the argument, else the newest one for this
// project. Unlike the statusline path it fails LOUD — an interactive command
// with a broken meter should say so, not go dark.

function projectSlug(dir) {
  return path.resolve(dir).replace(/[^a-zA-Z0-9]/g, '-');
}

// Newest-mtime transcript can belong to a SIBLING session when several run on
// one repo — callers who know their own transcript path should pass it.
function newestTranscript(projectDir) {
  const dir = path.join(os.homedir(), '.claude', 'projects', projectSlug(projectDir));
  let best = null, bestM = -1;
  for (const n of fs.readdirSync(dir)) {
    if (!n.endsWith('.jsonl')) continue;
    const p = path.join(dir, n);
    let mt; try { mt = fs.statSync(p).mtimeMs; } catch (_) { continue; }
    if (mt > bestM) { bestM = mt; best = p; }
  }
  return best;
}

function resolveTranscript(projectDir, transcriptArg) {
  if (transcriptArg) return transcriptArg;
  try { return newestTranscript(projectDir); } catch (_) { return null; }
}

function requireGuard(projectDir) {
  try { return require(path.join(projectDir, '.claude', 'hooks', 'token-guard.js')); }
  catch (_) { return null; }
}

// Both surfaces share breakEven(); the statusline only interrupts when the
// verdict is /clear, while a solicited report SPEAKS the verdict either way —
// the user asking is already past the flow question (Andrew, 2026-08-13).
// Output shape: a "verdict —" line naming the action (stay the course vs
// /clear) + a "rationale —" line with the why (Andrew, 2026-08-13; the em-dash
// separator matches the session bullets' labels — Andrew, 2026-08-14, which is
// also why no rationale wording carries its own mid-sentence em-dash).
function verdictLines(be, bold) {
  if (be.clear) {
    return [`* ${bold('verdict')} — /clear`,
      be.upfront <= 0
        ? `* ${bold('rationale')} — purge the old bloated context to save ${be.save1} tokens, starting on the first turn`
        : `* ${bold('rationale')} — purge the old bloated context: ${fmtK(be.upfront)} upfront breaks even within ${be.turns} turns, then saves ${be.save1} tokens per turn`];
  }
  if (be.savings > 0) {
    return [`* ${bold('verdict')} — stay the course`,
      `* ${bold('rationale')} — a new session would take you ${be.turns}+ turns to break even`];
  }
  return [`* ${bold('verdict')} — stay the course`,
    `* ${bold('rationale')} — a new session costs more every turn; it never breaks even`];
}

function reportMain(transcriptArg) {
  const projectDir = process.cwd();
  const transcript = resolveTranscript(projectDir, transcriptArg);
  if (!transcript) {
    console.log(`cost-compare: no session transcript found for ${projectDir}`);
    return;
  }
  const sid = path.basename(transcript, '.jsonl');
  const tg = requireGuard(projectDir);
  if (!tg) {
    console.log('cost-compare: this repo has no token-guard meter (.claude/hooks/token-guard.js) — no figures to report.');
    return;
  }
  const cfg = loadConfig(tg, projectDir);
  const m = tg.meterSession(transcript, { fleet: cfg.fleetMeter !== false, projectDir });
  const session = totalTokens(m);
  if (!session) {
    console.log(`cost-compare: session ${sid.slice(0, 8)} metered to zero tokens — nothing to compare yet.`);
    return;
  }
  const ctx = m.liveContext || 0;
  const measured = tg.coldStartTokens(projectDir, sid, m, transcript);
  const cold = measured || COLD_START_FALLBACK_TOK;

  // Bold the labels on a real terminal; piped/captured output (Claude's Bash
  // relay, tests) stays plain — the /cost-compare command re-bolds via markdown.
  const bold = process.stdout.isTTY ? (s) => `\x1b[1m${s}\x1b[22m` : (s) => s;
  const lines = [
    `session ${sid.slice(0, 8)} — ${path.basename(path.resolve(projectDir))}`,
    '',
    `* ${bold('current session')} — ${k1(ctx)} token cost (${fmtK(ctx)} * 0.1 cache) per turn`,
    `* ${bold('new session')} — ${fmtK(cold)} token cost, reduced to +${k1(cold)} per turn thereafter`,
    '',
  ];
  lines.push(...verdictLines(breakEven(ctx, cold), bold));
  console.log(lines.join('\n'));
}

function cacheHit(cached, st) {
  if (!cached) return false;
  return (cached.mtimeMs === st.mtimeMs && cached.size === st.size)
    || Date.now() - (cached.at || 0) < MID_TURN_REUSE_MS;
}

function computeLine(data, projectDir, cached) {
  try {
    const tg = require(path.join(projectDir, '.claude', 'hooks', 'token-guard.js'));
    return render(tg, data, projectDir) || '';
  } catch (_) {
    return (cached && cached.line) || '';   // no token-guard here, or a mid-edit copy — stay dark,
  }                                          // but cache the miss so require isn't retried per refresh
}

function statuslineMain() {
  const input = readInput();
  if (!input) return;
  const { data, st } = input;
  const projectDir = (data.workspace && data.workspace.project_dir) || data.cwd || process.cwd();
  const cacheFile = cachePath(data.session_id);
  const cached = readJson(cacheFile);
  if (cacheHit(cached, st)) {
    if (cached.line) process.stdout.write(cached.line);
    return;
  }
  const line = computeLine(data, projectDir, cached);
  writeCache(cacheFile, { mtimeMs: st.mtimeMs, size: st.size, at: Date.now(), line });
  pruneCaches(path.dirname(cacheFile));
  if (line) process.stdout.write(line);
}

(function main() {
  if (process.argv[2] === '--report') {
    try { reportMain(process.argv[3]); } catch (e) { console.log(`cost-compare: ${e.message}`); }
    return;
  }
  statuslineMain();
})();
