#!/usr/bin/env node
'use strict';

/**
 * plan-progress.js — deterministic progress digest for phased plan docs.
 *
 * DEV-ONLY: gated out of user installs via DEV_ONLY_FILES in bin/cli.js (and its
 * mirror in .claude/commands/validate-cca-install.md). Companion to /plan-progress.
 * Read-only twin of /continue: /continue *runs* the next unchecked substep; this
 * just shows where every in-flight plan stands.
 *
 * Parses the plan-authoring format (.claude/rules/plan-authoring.md):
 *   - phases:   `## Phase N — title`
 *   - substeps: `### ☑|☐ N.k · S|M|L · ~<time> — title`  (effort tag optional)
 *   - a `## Ledger` section marks a doc as an executable plan (vs a design doc).
 * Percent is EFFORT-weighted from the ~time tags when present, else count-based.
 * Emits ready-to-show Markdown on stdout; no LLM arithmetic downstream.
 *
 * Detection scans docs/, .claude/plans/, and the repo root for `## Ledger` docs.
 */

const fs = require('fs');
const path = require('path');

const root = process.cwd();

// ---- 1. discover candidate plan docs -------------------------------------
function walk(dir, out, depth) {
  if (depth < 0) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth - 1);
    else if (e.name.endsWith('.md')) out.push(p);
  }
}
const candidates = [];
walk(path.join(root, 'docs'), candidates, 4);
walk(path.join(root, '.claude', 'plans'), candidates, 2);
try {
  for (const f of fs.readdirSync(root)) {
    if (f.endsWith('.md')) candidates.push(path.join(root, f));
  }
} catch (_) { /* no root listing — fine */ }

// ---- 2. parse ------------------------------------------------------------
// Effort tag ( · S · ~time ) is optional so count-only plans still parse.
const SUBSTEP = /^#{2,4}\s+([☑☐])\s+(\d+\.\w+)\s*(?:·\s*([SML])\s*·\s*~(\d+(?:\.\d+)?)\s*([hm]))?\s*—\s*(.+?)\s*$/;
const PHASE = /^##\s+Phase\s+(\S+)\s*—\s*(.+?)\s*$/;
// A microstep is a checkbox action-bullet inside a substep body: `- [ ] …` / `- [x] …`.
// Only these count toward the per-substep bar — prose bullets, ⚠ notes, Verify/Commit stay out.
const MICRO = /^\s*-\s+\[([ xX])\]\s+(.+?)\s*$/;

function toMin(num, unit) {
  if (num == null) return null;
  return unit === 'h' ? Math.round(parseFloat(num) * 60) : Math.round(parseFloat(num));
}
function fmtMin(m) {
  if (m == null) return '?';
  const h = Math.floor(m / 60), r = m % 60;
  if (h && r) return `${h}h${r}m`;
  if (h) return `${h}h`;
  return `${r}m`;
}
function truncate(s, n) {
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s—·-]+$/, '') + '…';
}

function parsePlan(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (!/^##\s+Ledger/m.test(raw)) return null; // executable-plan marker
  const lines = raw.split(/\r?\n/);
  const phases = [];
  let cur = { num: '–', title: '(unphased)', subs: [] };
  let sawSub = false;
  let lastSub = null; // substep that trailing microsteps attach to

  let title = path.basename(file);
  const h1 = raw.match(/^#\s+(.+)$/m);
  if (h1) title = h1[1].trim();
  let goal = null;
  const g = raw.match(/^\*\*Goal:\*\*\s*([\s\S]+?)\n\s*\n/m);
  if (g) goal = truncate(g[1], 100);

  for (const line of lines) {
    const pm = line.match(PHASE);
    if (pm) {
      if (cur.subs.length) phases.push(cur);
      cur = { num: pm[1], title: pm[2].trim(), subs: [] };
      lastSub = null;
      continue;
    }
    const sm = line.match(SUBSTEP);
    if (sm) {
      sawSub = true;
      const sub = {
        done: sm[1] === '☑',
        id: sm[2],
        size: sm[3] || null,
        min: toMin(sm[4], sm[5]),
        title: sm[6].trim(),
        micro: [],
      };
      cur.subs.push(sub);
      lastSub = sub;
      continue;
    }
    const mm = line.match(MICRO);
    if (mm && lastSub) {
      lastSub.micro.push({ done: mm[1].toLowerCase() === 'x', text: mm[2].trim() });
      continue;
    }
    if (/^#{1,6}\s/.test(line)) lastSub = null; // a heading ends the substep body
  }
  if (cur.subs.length) phases.push(cur);
  if (!sawSub) return null;

  const all = phases.flatMap(p => p.subs);
  const doneCount = all.filter(s => s.done).length;
  const totalCount = all.length;
  const timed = all.filter(s => s.min != null);
  const totalMin = timed.reduce((a, s) => a + s.min, 0);
  const doneMin = timed.filter(s => s.done).reduce((a, s) => a + s.min, 0);
  const remMin = timed.filter(s => !s.done).reduce((a, s) => a + s.min, 0);
  const current = all.find(s => !s.done) || null;
  const noTime = totalCount - timed.length;

  return {
    file: path.relative(root, file), title, goal, phases,
    doneCount, totalCount, totalMin, doneMin, remMin, current, noTime,
    inProgress: doneCount > 0 && doneCount < totalCount,
  };
}

// ---- 3. render -----------------------------------------------------------
function bar(pct) {
  const n = Math.max(0, Math.min(10, Math.round(pct * 10)));
  return '▓'.repeat(n) + '░'.repeat(10 - n);
}
function render(p) {
  const pctTime = p.totalMin > 0 ? p.doneMin / p.totalMin : null;
  const pct = pctTime != null ? pctTime : (p.totalCount ? p.doneCount / p.totalCount : 0);
  const status = p.doneCount === 0 ? ' · _not started_'
    : p.doneCount === p.totalCount ? ' · ✓ _complete_' : '';
  const out = [];
  out.push(`### 📋 ${p.title}${status}`);
  if (p.goal) out.push(`*${p.goal}*`);
  out.push('');
  const bits = [`**${Math.round(pct * 100)}%** ${bar(pct)}`, `${p.doneCount}/${p.totalCount} substeps`];
  if (p.remMin > 0) bits.push(`~${fmtMin(p.remMin)} left`);
  if (p.current) bits.push(`next → **${p.current.id}**`);
  out.push(bits.join('  ·  '));
  if (pctTime == null) out.push(`_count-based — no effort tags found_`);
  else if (p.noTime) out.push(`_${p.noTime}/${p.totalCount} substeps carry no effort tag; % is effort-weighted over the rest_`);
  out.push('');

  for (const ph of p.phases) {
    const d = ph.subs.filter(s => s.done).length, t = ph.subs.length;
    const allDone = d === t && t > 0;
    const hasCurrent = p.current && ph.subs.some(s => s.id === p.current.id);
    // Bold phase heading with a done/total rollup; ✓ when the whole phase is closed.
    out.push(`**Phase ${ph.num} — ${ph.title}** — ${allDone ? '✓ ' : ''}${d}/${t}`);
    if (allDone) { out.push(''); continue; } // collapse finished phases to their heading

    const doneSubs = ph.subs.filter(s => s.done);
    const shownDone = hasCurrent && doneSubs.length > 2 ? doneSubs.slice(-2) : doneSubs;
    if (hasCurrent && doneSubs.length > shownDone.length) {
      out.push(`- _… ${doneSubs.length - shownDone.length} earlier done_`);
    }
    for (const s of ph.subs) {
      const eff = s.size ? ` · ${s.size} · ~${fmtMin(s.min)}` : '';
      const label = `${s.id}${eff} — ${truncate(s.title, 60)}`;
      if (s.done) {
        if (shownDone.includes(s)) out.push(`- ~~${label}~~`);           // struck-through when done
      } else if (p.current && s.id === p.current.id) {
        out.push(`- ▶ **${label}**  ← you are here`);                    // highlighted current step
        if (s.micro && s.micro.length) {                                 // expanded microstep widget (current step only)
          const md = s.micro.filter(m => m.done).length, mt = s.micro.length;
          const mpct = mt ? md / mt : 0;
          out.push(`      ${bar(mpct)}  **${Math.round(mpct * 100)}%**  ·  ${md}/${mt} microsteps`);
          for (const m of s.micro) {
            const txt = truncate(m.text, 62);
            out.push(`      ${m.done ? '☑' : '☐'} ${m.done ? `~~${txt}~~` : txt}`);
          }
        }
      } else {
        out.push(`- ${label}`);                                          // upcoming
      }
    }
    out.push('');
  }
  return out.join('\n').trimEnd();
}

// ---- main ----------------------------------------------------------------
const seen = new Set();
const plans = [];
for (const f of candidates) {
  const key = path.resolve(f);
  if (seen.has(key)) continue;
  seen.add(key);
  let p = null;
  try { p = parsePlan(f); } catch (_) { /* unreadable/odd file — skip */ }
  if (p) plans.push(p);
}

if (!plans.length) {
  console.log('No plan docs found here.');
  console.log('');
  console.log('A plan becomes trackable when it carries a `## Ledger` section and');
  console.log('`### ☐ N.k · S|M|L · ~time — title` substeps (the plan-authoring format,');
  console.log('e.g. produced by /up-to-snuff). Looked in: docs/, .claude/plans/, repo root.');
  process.exit(0);
}

// in-progress first, then most-complete
plans.sort((a, b) => (b.inProgress - a.inProgress) || (b.doneCount / b.totalCount) - (a.doneCount / a.totalCount));
console.log(plans.map(render).join('\n\n'));
