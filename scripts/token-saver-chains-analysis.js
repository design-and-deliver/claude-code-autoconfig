// Token-saver savings measurement: reconstruct real /clear+/continue chains from Claude Code
// session transcripts and compare actual billed token spend vs two counterfactuals over the
// SAME request sequences:
//   cfNoCompact  — one continuous session per chain, context never shed (unbounded ramp)
//   cfAutoCompact — one continuous session with built-in auto-compaction at the window ceiling
//
// Provenance: extracted 2026-08-12 from the 2026-08-05 measurement session (transcript
// e10dd837, job-agent-extension). Those runs produced the numbers in job-agent-extension's
// docs/token-saver-cost-savings-assertion-guidelines.md §7 (−16–23% vs auto-compact by day,
// median chain ~20.5%; −49–61% vs never clearing). Analysis semantics here are unchanged from
// that run — only the hardcoded date/dir became CLI args.
//
// Usage:
//   node scripts/token-saver-chains-analysis.js [YYYY-MM-DD] [projectsDir]
//
//   date        day to measure (default: today, local). A session is included when its LAST
//               activity falls on that day; chains never mix days across runs, so measure an
//               era by running once per day and comparing the per-day totals.
//   projectsDir the ~/.claude/projects/<slug> transcript dir to scan (default: derived from
//               the current working directory's slug — run it from the repo you measured).
const fs = require('fs');
const path = require('path');
const os = require('os');

const localIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const DAY = process.argv[2] || localIso(new Date());
const DIR = process.argv[3] ||
  path.join(os.homedir(), '.claude', 'projects', path.resolve(process.cwd()).replace(/[:\\/]/g, '-'));
if (!fs.existsSync(DIR)) {
  console.error(`No transcript dir at ${DIR} — pass it as the second arg.`);
  process.exit(1);
}

// Model assumptions (both were validated against the 2026-08-05 data):
const SUMMARY_TOKENS = 35000; // post-compact residual summary size (est.)
const T = 250000; // auto-compact threshold (never hit that day; max observed ctx 236k)

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl'));
const sessions = {};

for (const f of files) {
  const full = path.join(DIR, f);
  const raw = fs.readFileSync(full, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  let firstTs = null, lastTs = null, hasContinue = false;
  const reqMap = new Map();

  for (const line of lines) {
    let obj; try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type === 'summary') continue;
    const ts = obj.timestamp;
    if (ts) { if (!firstTs) firstTs = ts; lastTs = ts; }
    if (obj.type === 'user' && obj.message) {
      const c = obj.message.content;
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text || '').join(' ') : '';
      if (/<command-name>\/?continue<\/command-name>/.test(text)) hasContinue = true;
    }
    if (obj.type === 'assistant' && obj.message && obj.message.usage) {
      const u = obj.message.usage;
      const rid = obj.requestId || obj.message.id;
      reqMap.set(rid, { ts, in: u.input_tokens || 0, cc: u.cache_creation_input_tokens || 0, cr: u.cache_read_input_tokens || 0, out: u.output_tokens || 0 });
    }
  }
  if (!lastTs || !lastTs.startsWith(DAY)) continue;

  const reqs = [...reqMap.values()].sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  if (!reqs.length) continue;
  const ctxs = reqs.map(r => r.in + r.cc + r.cr);
  const id = f.replace('.jsonl', '');
  sessions[id] = {
    id, firstTs, lastTs, hasContinue, raw,
    reqs, ctxs,
    floor: Math.min(...ctxs.slice(0, Math.min(3, ctxs.length))),
    endCtx: Math.max(...ctxs.slice(-3)),
    billed: ctxs.reduce((a, b) => a + b, 0),
    out: reqs.reduce((s, r) => s + r.out, 0),
    cr: reqs.reduce((s, r) => s + r.cr, 0),
    cc: reqs.reduce((s, r) => s + r.cc, 0),
    inn: reqs.reduce((s, r) => s + r.in, 0),
  };
}

const ids = Object.keys(sessions);
// predecessor: the session whose transcript / title-history file the /continue probe READ
// (appears as "<uuid>.jsonl" or "<uuid>.history.jsonl" in tool inputs) — NOT bare uuid counts,
// which are polluted by the per-line session_id field (= terminal's original session).
for (const id of ids) {
  const s = sessions[id];
  if (!s.hasContinue) continue;
  let best = null, bestCount = 0;
  for (const other of ids) {
    if (other === id) continue;
    const o = sessions[other];
    if (o.firstTs >= s.firstTs) continue;
    const count = (s.raw.split(other + '.jsonl').length - 1) + (s.raw.split(other + '.history.jsonl').length - 1);
    if (count > bestCount) { bestCount = count; best = other; }
  }
  if (best && bestCount >= 1) s.prev = best;
}
for (const id of ids) delete sessions[id].raw;

// build chains: tails are sessions that are not anyone's prev; walk back from each tail
const pointedTo = new Set(ids.map(id => sessions[id].prev).filter(Boolean));
const chains = [];
for (const id of ids) {
  if (pointedTo.has(id)) continue;
  const chain = [];
  let cur = id;
  while (cur) { chain.unshift(cur); cur = sessions[cur].prev; }
  chains.push(chain);
}

let dayActual = { billed: 0, out: 0, cr: 0, cc: 0, inn: 0, req: 0 };
const chainReports = [];

for (const chain of chains) {
  const segs = chain.map(id => sessions[id]);
  const actualBilled = segs.reduce((s, x) => s + x.billed, 0);
  const actualOut = segs.reduce((s, x) => s + x.out, 0);
  const nReq = segs.reduce((s, x) => s + x.reqs.length, 0);
  segs.forEach(x => {
    dayActual.billed += x.billed; dayActual.out += x.out; dayActual.cr += x.cr;
    dayActual.cc += x.cc; dayActual.inn += x.inn; dayActual.req += x.reqs.length;
  });
  if (chain.length === 1) { chainReports.push({ chain, single: true, actualBilled, actualOut, nReq }); continue; }

  // Variant A: continuous, no compaction ever (unbounded context)
  // Variant B: continuous with auto-compact at T (compact pass bills full ctx, resets work to SUMMARY_TOKENS)
  let cfA = 0, cfB = 0, carryA = 0, carryB = 0, compactions = 0;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    for (const ctx of seg.ctxs) {
      cfA += ctx + carryA;
      let cB = ctx + carryB;
      if (cB > T) {
        compactions++;
        cfB += cB; // the compaction summarization pass reads the full context
        // reset: context becomes floor + summary; subsequent work continues on top
        carryB = SUMMARY_TOKENS - (ctx - seg.floor);
        cB = ctx + carryB;
      }
      cfB += cB;
    }
    carryA += seg.endCtx - seg.floor;
    carryB += seg.endCtx - seg.floor;
  }
  chainReports.push({
    chain, nReq, segs: segs.map(s => ({ id: s.id.slice(0, 8), first: s.firstTs, end: s.endCtx, floor: s.floor, billed: s.billed, n: s.reqs.length })),
    actualBilled, actualOut,
    cfA, cfB, compactions,
  });
}

// totals over multi-seg chains only
const multi = chainReports.filter(c => !c.single);
const tot = {
  actual: multi.reduce((s, c) => s + c.actualBilled, 0),
  cfA: multi.reduce((s, c) => s + c.cfA, 0),
  cfB: multi.reduce((s, c) => s + c.cfB, 0),
  out: multi.reduce((s, c) => s + c.actualOut, 0),
  compactions: multi.reduce((s, c) => s + c.compactions, 0),
  nReq: multi.reduce((s, c) => s + c.nReq, 0),
};

console.log(`=== ${DAY} @ ${DIR} ===`);
console.log('\n=== CHAINS (multi-segment) ===');
for (const c of multi) {
  console.log('\nChain: ' + c.chain.map(x => x.slice(0, 8)).join(' -> '));
  for (const s of c.segs) console.log(`   ${s.id} reqs=${s.n} floor=${(s.floor/1e3)|0}k end=${(s.end/1e3)|0}k billed=${(s.billed/1e6).toFixed(2)}M`);
  console.log(`   actual=${(c.actualBilled/1e6).toFixed(2)}M  cfNoCompact=${(c.cfA/1e6).toFixed(2)}M (save ${(100*(1-c.actualBilled/c.cfA)).toFixed(0)}%)  cfAutoCompact=${(c.cfB/1e6).toFixed(2)}M (save ${(100*(1-c.actualBilled/c.cfB)).toFixed(0)}%, ${c.compactions} compactions)`);
}
console.log('\n=== SINGLES (no continue) ===');
for (const c of chainReports.filter(c => c.single)) console.log(`   ${c.chain[0].slice(0,8)} reqs=${c.nReq} billed=${(c.actualBilled/1e6).toFixed(2)}M`);

console.log('\n=== TOTALS (chained work only) ===');
if (tot.actual) {
  console.log(`actual billed input: ${(tot.actual/1e6).toFixed(2)}M over ${tot.nReq} requests (+${(tot.out/1e3).toFixed(0)}k output)`);
  console.log(`cf no-compact:      ${(tot.cfA/1e6).toFixed(2)}M  -> savings ${(100*(1-tot.actual/tot.cfA)).toFixed(1)}%  (${(tot.cfA/tot.actual).toFixed(2)}x)`);
  console.log(`cf auto-compact:    ${(tot.cfB/1e6).toFixed(2)}M  -> savings ${(100*(1-tot.actual/tot.cfB)).toFixed(1)}%  (${(tot.cfB/tot.actual).toFixed(2)}x), ${tot.compactions} compactions`);
} else {
  console.log('no multi-segment chains found this day');
}
console.log(`\nday total actual (all sessions incl. singles): billed=${(dayActual.billed/1e6).toFixed(2)}M out=${(dayActual.out/1e3).toFixed(0)}k reqs=${dayActual.req}`);
console.log(`day composition: cacheRead=${(dayActual.cr/1e6).toFixed(2)}M cacheWrite=${(dayActual.cc/1e6).toFixed(2)}M fresh=${(dayActual.inn/1e6).toFixed(2)}M`);
