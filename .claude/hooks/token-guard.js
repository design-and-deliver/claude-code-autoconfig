#!/usr/bin/env node
/**
 * token-guard v2 — session spend meter + tripwires for Claude Code (prototyped in wifi-app,
 * destined for CCA distribution as a module beside terminal-title.js / arcade-beeps.js).
 * Spec: docs/token-guard-v2-cca-spec.md. Evidence base: the July 10-11 blowup forensics
 * (RENT / BOMBS / FLEETS) — every v2 guard maps to a measured failure mode.
 *
 * WHY: the API is stateless — every turn re-sends (via cache) the whole conversation, so a fat
 * session makes even a one-line question expensive. Dollars here are API-list-price
 * EQUIVALENTS: on a subscription they proxy for rate-limit consumption, on an API key real money.
 *
 * MESSAGING UNIT (2026-07-12): user-facing check-ins lead with TOKENS — meaningful on both Max
 * (dollars are fictional there) and API plans — one metric per line (session / 5h window / plan
 * target); the model-weighted dollar figure stays as internal normalization + a parenthetical.
 *
 * ONE self-dispatching hook, keyed on hook_event_name:
 *   UserPromptSubmit -> meter the session (v2: INCLUDING subagent/workflow fleets); inject
 *                       compact additionalContext warnings: fat-context advisory, session-spend
 *                       steps, context-bomb tripwire (R3), idle-return TTL warning (R4),
 *                       workflow completion receipts (R2), scope-drift nudge (R6), window
 *                       spike + threshold flags (R12).
 *   Stop             -> append one line to the bounded usage log (now with a main/agents split);
 *                       detect workflow cost growth and queue a receipt for the next prompt.
 *   PreToolUse       -> (a) R2 + R10: gate Workflow launches — R2 confirms the launch COST from a
 *                           history-based estimate; R10 flags a fan whose SHAPE is disproportionate
 *                           to the task (a fan-named constant >= threshold, or a fan nested inside a
 *                           fan over run-time data). R10 asks (never blocks) and fires even with R2 off;
 *                       (b) R8: payload pre-gate — ask BEFORE a bomb-sized Skill/Read payload
 *                           lands (R3 warns after; this fires while the rent is avoidable);
 *                       (c) R9: one-shot ask once the turn's accumulator crossed (opt-in);
 *                       (d) R3: one-shot post-bomb gate when bombGateWhenFat is on;
 *                       (e) v1 hard gate on total session spend (default off, re-arms stepwise).
 *   PostToolUse      -> R9: mini-bomb accumulator — per-turn sum of tool-result payloads; when
 *                       the total crosses bombJumpTokens, one mid-turn note to Claude (payloads
 *                       individually too small for R8's doors, bomb-sized in aggregate).
 *   CLI --report     -> per-model session breakdown split main vs agents + per-workflow lines +
 *                       5-hour cross-project rollup (fleet-aware).
 *   CLI --analyze    -> R7: per-session forensic digest (RENT / BOMBS / FLEETS / TTL) —
 *                       deterministic, no LLM; the /analyze-session skill interprets ONLY this
 *                       output, never the raw transcript.
 *   CLI --budgets    -> R5 producer: scan project/user/plugin-cache skills and write
 *                       .claude/skill-budgets.md (door 1's lookup table). Rows marked
 *                       (observed ...) came from measured landings and survive regeneration —
 *                       the ONLY source that can price built-in skills, which ship no files.
 *
 * METERING (R1): the main transcript is only part of the bill. Agent transcripts live in a
 * sibling directory named after the session id (layout verified 2026-07-11):
 *     <proj>/<session-id>.jsonl                                    main
 *     <proj>/<session-id>/subagents/agent-*.jsonl                  Agent-tool subagents
 *     <proj>/<session-id>/subagents/workflows/<wf>/agent-*.jsonl   Workflow fleets
 * The forensic fleet session under-counted 63% without these. Agent files are immutable once
 * their agent finishes, so they sit behind an mtime+size cache (meter-cache.json) and cost one
 * stat() each at steady state. Live context / per-turn floor comes from the MAIN transcript only
 * — fleet contexts die with the fleet.
 *
 * Dedup is per-file by message.id (streamed updates rewrite the same message; last wins).
 * Cross-file dedup was dropped in v2: message ids don't repeat across transcripts and the cache
 * makes a global id map impossible anyway.
 *
 * KNOWN UNDERCOUNTS (accepted, documented): background utility calls (Haiku titles/summaries)
 * are in no transcript; compaction continuations split a logical session across files (v2.1).
 *
 * Config (.claude/cca.config.json -> tokenGuard), all optional:
 *   contextWarnTokens 150000 · sessionWarnUSD [5,15,30] · hardGateUSD null · gateStepUSD 5
 *   (sessionWarnUSD check-ins fire on API-billed sessions ONLY since 2026-07-18 — on a
 *   subscription the $-equivalent steps map to nothing the user experiences; the R12 window
 *   flags carry the plan-meter story there. billingKind() is the cheap per-prompt read.)
 *   windowBudgetUSD null — your 5h-window budget in WEIGHTED $-equivalent, the mix-robust proxy
 *   for Max metering (Anthropic confirms cached content is discounted and model choice affects
 *   depletion, but publishes no multipliers — support.claude.com 9797557 / 14552983). Set an
 *   estimate, calibrate from usage.log at throttle time. Enables the "Plan target: N%" line.
 *   planDetect true — read plan/tier/overage-toggle from Claude Code's local files (fail-safe;
 *   fields it can't find are omitted) and append a "Plan: ..." line to check-ins + --report
 *   showDollars 'auto' — 'auto' renders $ only for API-billed sessions (subscription users get
 *   tokens-only copy: $ figures are noise that doesn't drive their decisions — Andrew 2026-07-12);
 *   true/false forces. Internal metering stays $-weighted either way (it's the normalization).
 *   officialUsageFetch true — lead reports/check-ins with Anthropic's OWN window percentages
 *   (the /usage numbers) via the OAuth usage endpoint; cached 180s, 4s timeout, fail -> omit.
 *   windowSpikeWarn true · windowSpikeWarnPct 20 — R12a: flag when a single turn (the interval
 *   between two prompts) ate >= N points of the 5h window. Reads the delta of Anthropic's own 5h
 *   meter %, so it SELF-CALIBRATES — no budget to set. When the meter is unreachable it falls back
 *   to the last turn's weighted $ vs windowBudgetUSD, and if that's unset too it simply stays quiet.
 *   windowSpikeConfirm true — R12a escalation: render the spike as an interactive AskUserQuestion
 *   card ("Keep going" / "Unpack to review") instead of the passive note. "Unpack" runs the
 *   /analyze-session forensic digest and waits (does NOT answer the pending prompt). It is a SOFT
 *   relay card, never a decision:'block' — a soft interrupt safe even in the light default
 *   posture, not only under token-saver. Off -> the passive standalone warning note.
 *   windowThresholdWarn true · windowThresholdWarnPct [50, 80] — R12b: a warn LADDER (a single
 *   number still works). Fires once per RUNG per window cycle as the tightest live window (5h OR
 *   weekly) climbs past each mark; an escalation to a higher rung mid-cycle fires again; re-arms
 *   when THAT window resets. The stake is a throttle, not a bill — the copy never carries a $
 *   figure. Both ride the officialUsageFetch meter; on an API key with no OAuth meter they're
 *   inert unless windowBudgetUSD supplies a proxy.
 *   Each firing is a one-line note appended at the END of the response. Rungs below the top are a
 *   quiet "FYI:" line (a bearing, not an alarm — wallpaper-proofing the real one); the TOP rung
 *   keeps the "⚠️ Hey —" checkpoint styling (80% still leaves ~an hour of runway, so no coaching
 *   and no swallowed prompt; Andrew 2026-07-18). Notes ride the NEXT submit (the meter reads
 *   pre-turn); exact-turn delivery would cost a per-turn Stop-hook fetch and was judged not worth it.
 *   windowThresholdGate false — R12b escalation, OPT-IN (token-saver arms it): BLOCK the submission
 *   instead of the note at the TOP rung only (lower rungs never block). The one-shot key lets the
 *   ↑+Enter re-send through (charge accepted). The block reason is user-facing (no relay prose,
 *   no $). Demoted from default-on 2026-07-18 — a swallowed prompt is too heavy for a checkpoint.
 *   fleetMeter true · workflowConfirm true · bombJumpTokens 50000 · bombGateWhenFat false
 *   workflowFanGuard true · fanWarnAgents 10 · fanHardCap 50 — R10: gate a Workflow whose agent
 *   fan looks disproportionate (SHAPE signals only — a fan constant >= fanWarnAgents, a
 *   multiplicative/nested fan, or an oversized Array.from literal — never a fabricated count).
 *   Two tiers: an ASK past fanWarnAgents (right-size before launch), and a hard DENY once a
 *   CONCRETE single fan (a named constant or Array literal) reaches fanHardCap — the runaway
 *   backstop. A multiplicative "up to N (a × b)" ceiling rides the ask as honest scale but never
 *   drives the block (blocking on an estimated product would be the false-precision this refuses).
 *   Composes with R2 and fires even when workflowConfirm is off.
 *   payloadGate true — R8 doors 1-2: PreToolUse ask on Skill/Read payloads > bombJumpTokens
 *   commandPayloadGate false — R8 door 3: UserPromptSubmit block on oversized slash commands
 *   miniBombWarn true — R9: mid-turn note to Claude when a turn's tool results sum past
 *   bombJumpTokens · miniBombGate false — R9 escalation: one-shot ask on the next tool call
 *   skillBudgetWarnChars 150000 — R5: full-payload ⚠ threshold in the --budgets table
 *   idleWarnMinutes 60 · idleGate false — block (pre-empt) instead of warn on idle-return;
 *   the one gate that saves one-shot money: the warn ships in the request that pays, the gate
 *   fires before it.  (skillBudgetWarnChars is read by the CCA auditor, not this hook)
 *   driftNudge true · driftPriorShareMin 0.6 · driftMinContextTokens 100000 · driftRetryPrompts 4
 *   — R6: the terminal-title trail as a RENT signal; fires only above /eval's STAY floor, so it hands
 *   the user a paste-ready /migrate-new-session {slug(scope)} (never runs it); /eval is the escape
 *   hatch. The hook's arithmetic only STAGES the card (2026-07-18) — the in-turn model holds the
 *   render gate: it judges RELATEDNESS (current prompt returns to the earlier work → stale premise)
 *   and RESOLUTION (earlier threads actually closed → picks the copy's framing) against the live
 *   conversation, and defers by writing .token-guard/drift-deferred; the guard snoozes
 *   driftRetryPrompts prompts, then re-arms the one-shot so the card re-offers with a fresh premise.
 *   driftAutoMigrate false · driftMigrateMarkerTTLmin 120 · driftMigrateMaxInjectTokens 40000 — R11:
 *   arm-offer + SessionStart(source clear/startup) auto-migrate. A consent marker (hook-staged
 *   candidate + model-written .armed flag) lets a single /clear rehydrate the drifted thread — the hook
 *   recovers the pinned tail and injects it as additionalContext. Gated off; SessionStart-wired in the
 *   dogfood workspace only.
 * Per-session state in .claude/hooks/.token-guard/<sid>.json; usage log + meter cache beside it.
 *
 * Fail-safe like every hook in this family: any error -> exit 0, emit nothing, never break a turn.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// pricing — API list prices per MILLION tokens. Cache read = 0.1x input;
// cache write = 1.25x (5m TTL) / 2x (1h TTL). Web search $10 per 1k searches.
// First matching regex wins; unknown models fall back to Opus pricing (safe: overcounts never
// undercounts for cheaper tiers... except Fable — hence fable/mythos listed first).
const PRICES = [
  { re: /fable|mythos/i, inp: 10, out: 50 },
  { re: /opus/i, inp: 5, out: 25 },
  { re: /sonnet/i, inp: 3, out: 15 },
  { re: /haiku/i, inp: 1, out: 5 },
];
const FALLBACK_PRICE = { inp: 5, out: 25 };
const WEB_SEARCH_USD_EACH = 0.01;
const USD_PER_AGENT_RULE_OF_THUMB = 0.5; // forensic fleet: 1.05M writes / 45 agents ≈ 23k × $20/MTok

const DEFAULTS = {
  tokenSaver: false,                // Cost Control: single on/off toggle. Off = this light default posture;
                                    // on overlays the aggressive TOKEN_SAVER preset (blocks + tighter thresholds).
  contextWarnTokens: 150000,
  sessionWarnUSD: [5, 15, 30],
  windowBudgetUSD: null,
  hardGateUSD: null,
  gateStepUSD: 5,
  fleetMeter: true,
  workflowConfirm: true,
  workflowFanGuard: true,
  fanWarnAgents: 10,
  fanHardCap: 50,
  bombJumpTokens: 50000,
  bombGateWhenFat: false,
  payloadGate: true,
  commandPayloadGate: false,
  miniBombWarn: true,
  miniBombGate: false,
  skillBudgetWarnChars: 150000,
  idleWarnMinutes: 60,
  idleGate: false,
  driftNudge: true,
  driftPriorShareMin: 0.6,
  driftMinContextTokens: 100000,
  driftRetryPrompts: 4,             // R6 defer loop: prompts to snooze after a model-judged deferral
                                    // before the one-shot re-arms and the card may re-stage
  driftAutoMigrate: false,
  driftMigrateMarkerTTLmin: 120,
  driftMigrateMaxInjectTokens: 40000,
  planDetect: true,
  showDollars: 'auto',
  officialUsageFetch: true,
  windowSpikeWarn: true,
  windowSpikeWarnPct: 20,
  windowSpikeConfirm: true,      // R12a: render the spike flag as a two-option confirm card (keep going /
                                 // unpack via /analyze-session), not a passive note. On regardless of the toggle.
  windowThresholdWarn: true,
  windowThresholdWarnPct: [50, 80],  // warn ladder (number or array): 50 = quiet FYI bearing,
                                     // top rung = ⚠️ checkpoint. One-shot per rung per cycle.
  windowThresholdGate: false,    // R12b gate demoted to opt-in 2026-07-18 — 80% is a checkpoint, not an
                                 // emergency, so the default is the end-of-response note. Token-saver arms it.
  analyzeHint: true,
};

// ---------------------------------------------------------------------------
// Cost Control — a SINGLE on/off toggle (`tokenSaver`), off by default. Off is the light
// default posture above; on overlays the TOKEN_SAVER preset: maximum protection, maximum
// interruption. The preset is applied BETWEEN DEFAULTS and the user's explicit config, so
// an explicitly-set key always wins over the preset (the preset only sets defaults; the user
// can still pin one knob). INVARIANT: the preset never touches fanHardCap (R10) or lowers a
// DENY floor — token-saver only ADDS seatbelts, never removes one. (The retired three-mode
// dial — token-saver / standard / flow — collapsed to this toggle on 2026-07-15; a future
// budget-scaled 'adaptive' layer is deferred until the levers exist.)
const TOKEN_SAVER = {
  // Maximum protection, maximum interruption: the shared bomb threshold gets more sensitive,
  // wide-fan asks fire sooner, idle + context warn sooner, the single-turn spike flags sooner,
  // and the opt-in BLOCKS flip on — idle, command-payload, mini-bomb, bomb-when-fat, and the
  // R12b 80% throttle gate (demoted from DEFAULTS to this preset 2026-07-18).
  // driftMinContextTokens is left at its principled 100k floor (below it /eval's CUT verdict
  // isn't pre-determined — R6).
  bombJumpTokens: 30000,
  fanWarnAgents: 5,
  idleWarnMinutes: 30,
  contextWarnTokens: 100000,     // flag context bloat earlier than the 150k default
  bombGateWhenFat: true,
  idleGate: true,
  commandPayloadGate: true,
  miniBombGate: true,
  windowThresholdGate: true,     // hard-pause at the 80% mark — max-protection posture keeps the stopgate
  windowSpikeWarnPct: 10,        // flag a smaller single-turn window bite than the 20 default
};

// Layer DEFAULTS < TOKEN_SAVER (when on) < explicit user config. Pure + exported for
// fixtures (like meter/driftVerdict). The toggle is `tokenSaver` (boolean); a legacy
// `mode: 'token-saver'` still turns it on, and the retired 'standard'/'flow' resolve to
// the light default (off).
function resolveConfig(user) {
  const u = user || {};
  const on = u.tokenSaver === true || u.mode === 'token-saver';
  const profile = on ? TOKEN_SAVER : {};
  return Object.assign({}, DEFAULTS, profile, u);
}

function priceFor(model) {
  for (const p of PRICES) if (p.re.test(model || '')) return p;
  return FALLBACK_PRICE;
}

// ---------------------------------------------------------------------------
// meter: one transcript JSONL -> { usd, perModel, liveContext, turnFloorUSD, turns,
//                                  maxInp, lastTs, rawLength }
function meter(transcriptPath, sinceMs) {
  const out = { usd: 0, perModel: {}, liveContext: 0, turnFloorUSD: 0, turns: 0,
    maxInp: 0, lastTs: 0, rawLength: 0, tsList: [] };
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch (_) { return out; }
  out.rawLength = raw.length;

  const byId = new Map(); // message.id -> {model, usage} — last occurrence wins
  let last = null;        // last assistant usage in file order = live context source
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch (_) { continue; }
    if (!o || o.type !== 'assistant' || !o.message || !o.message.usage) continue;
    if (sinceMs && o.timestamp && Date.parse(o.timestamp) < sinceMs) continue;
    const id = o.message.id || `line-${byId.size}`;
    byId.set(id, { model: o.message.model || '', usage: o.message.usage });
    last = o.message.usage;
    if (o.timestamp) { const t = Date.parse(o.timestamp); if (t) { out.lastTs = t; out.tsList.push(t); } }
  }

  for (const { model, usage: u } of byId.values()) {
    const p = priceFor(model);
    const inp = u.input_tokens || 0;
    const outT = u.output_tokens || 0;
    const cr = u.cache_read_input_tokens || 0;
    const cwTotal = u.cache_creation_input_tokens || 0;
    // TTL breakdown when present; otherwise price the whole write at the cheaper 5m rate.
    const cw1h = (u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0;
    const cw5m = (u.cache_creation && u.cache_creation.ephemeral_5m_input_tokens != null)
      ? u.cache_creation.ephemeral_5m_input_tokens : Math.max(0, cwTotal - cw1h);
    const searches = (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;

    const usd =
      (inp * p.inp + outT * p.out + cr * p.inp * 0.1 + cw5m * p.inp * 1.25 + cw1h * p.inp * 2) / 1e6 +
      searches * WEB_SEARCH_USD_EACH;

    const m = out.perModel[model] || (out.perModel[model] = { inp: 0, out: 0, cr: 0, cw: 0, searches: 0, usd: 0 });
    m.inp += inp; m.out += outT; m.cr += cr; m.cw += cwTotal; m.searches += searches; m.usd += usd;
    out.usd += usd;
    out.turns++;
  }

  for (const model of Object.keys(out.perModel)) out.maxInp = Math.max(out.maxInp, priceFor(model).inp);
  if (last) {
    out.liveContext = (last.input_tokens || 0) + (last.cache_read_input_tokens || 0) +
      (last.cache_creation_input_tokens || 0);
    // Floor for the NEXT turn: today's context re-read at cache-read rates on the priciest
    // model seen this session (cheap, honest lower bound — output/thinking comes on top).
    out.turnFloorUSD = (out.liveContext * out.maxInp * 0.1) / 1e6;
  }
  return out;
}

// ---------------------------------------------------------------------------
// R1 fleet metering: main transcript + every agent-*.jsonl under the session's sibling dir.
function walkAgentFiles(dir, out) {
  out = out || [];
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walkAgentFiles(fp, out);
    else if (/^agent-.*\.jsonl$/.test(e.name)) out.push(fp);
  }
  return out;
}

function agentCachePath(projectDir) { return path.join(stateDir(projectDir), 'meter-cache.json'); }

function loadAgentCache(projectDir) {
  try { return JSON.parse(fs.readFileSync(agentCachePath(projectDir), 'utf8')); } catch (_) { return {}; }
}

function saveAgentCache(projectDir, cache) {
  try {
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    for (const k of Object.keys(cache)) if ((cache[k].seenAt || 0) < cutoff) delete cache[k];
    fs.mkdirSync(stateDir(projectDir), { recursive: true });
    fs.writeFileSync(agentCachePath(projectDir), JSON.stringify(cache));
  } catch (_) { /* cache loss just re-parses — harmless */ }
}

// meterSession: { main, agents:{usd,turns,files,perModel,perWorkflow}, usd, turns } — the number
// everything user-facing should quote is .usd (main+agents); the split exists so no report ever
// hides the fleet again. cacheOpts = {projectDir} enables the agent-file cache (hooks path);
// omit it (report/rollup path, or when sinceMs is set) to parse fresh.
function meterSession(transcriptPath, opts) {
  opts = opts || {};
  const main = meter(transcriptPath, opts.sinceMs);
  const agents = { usd: 0, turns: 0, files: 0, perModel: {}, perWorkflow: {} };
  const res = { main, agents, usd: main.usd, turns: main.turns,
    liveContext: main.liveContext, turnFloorUSD: main.turnFloorUSD,
    maxInp: main.maxInp, lastTs: main.lastTs };
  if (opts.fleet === false) return res;

  const sessionDir = transcriptPath.replace(/\.jsonl$/i, '');
  if (sessionDir === transcriptPath || !fs.existsSync(sessionDir)) return res;

  const useCache = !!(opts.projectDir && !opts.sinceMs);
  const cache = useCache ? loadAgentCache(opts.projectDir) : null;
  let cacheDirty = false;

  for (const fp of walkAgentFiles(sessionDir)) {
    let summary = null;
    let st; try { st = fs.statSync(fp); } catch (_) { continue; }
    if (cache && cache[fp] && cache[fp].mtime === st.mtimeMs && cache[fp].size === st.size) {
      summary = cache[fp];
      summary.seenAt = Date.now();
    } else {
      const m = meter(fp, opts.sinceMs);
      summary = { mtime: st.mtimeMs, size: st.size, seenAt: Date.now(),
        usd: m.usd, turns: m.turns, perModel: m.perModel };
      if (cache) { cache[fp] = summary; cacheDirty = true; }
    }
    if (!summary.usd && !summary.turns) continue;
    agents.usd += summary.usd; agents.turns += summary.turns; agents.files++;
    for (const [model, v] of Object.entries(summary.perModel || {})) {
      const t = agents.perModel[model] ||
        (agents.perModel[model] = { inp: 0, out: 0, cr: 0, cw: 0, searches: 0, usd: 0 });
      for (const k of Object.keys(t)) t[k] += v[k] || 0;
    }
    const wf = /[\\/]workflows[\\/]([^\\/]+)[\\/]/.exec(fp);
    const key = wf ? wf[1] : 'ad-hoc';
    const g = agents.perWorkflow[key] || (agents.perWorkflow[key] = { usd: 0, tok: 0, agents: 0 });
    g.usd += summary.usd; g.tok += tokensOf(summary.perModel || {}); g.agents++;
  }
  if (cache && cacheDirty) saveAgentCache(opts.projectDir, cache);

  res.usd += agents.usd;
  res.turns += agents.turns;
  return res;
}

// ---------------------------------------------------------------------------
// R3 attribution: name the largest single message in the transcript region a bomb landed in.
// Best-effort — the jump number comes from usage either way; this just points a finger.
function attributeJump(transcriptPath, fromChar) {
  let raw; try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch (_) { return null; }
  const toolNames = {}; // tool_use_id -> "Tool(detail)"
  let best = null;
  for (const line of raw.slice(Math.max(0, fromChar)).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch (_) { continue; }
    const msg = o && o.message;
    if (o.type === 'assistant' && msg && Array.isArray(msg.content)) {
      for (const c of msg.content) {
        if (c && c.type === 'tool_use') {
          const detail = (c.input && (c.input.skill || c.input.file_path)) || '';
          toolNames[c.id] = c.name + (detail ? `(${path.basename(String(detail))})` : '');
        }
      }
      continue; // assistant output is priced as output, not context payload
    }
    if (best && line.length <= best.chars) continue;
    let label = 'message';
    if (o.isMeta) label = 'meta/skill payload';
    if (msg && Array.isArray(msg.content)) {
      const tr = msg.content.find(c => c && c.type === 'tool_result');
      if (tr) label = toolNames[tr.tool_use_id] || 'tool result';
    }
    best = { chars: line.length, label };
  }
  return best;
}

// ---------------------------------------------------------------------------
// R6 scope-drift: the terminal-title per-title LEDGER ({sid}.history.jsonl — one line per title
// change, each carrying the context watermark when that topic began) as the RENT signal. The same
// watermarks terminal-title's /clear advisor reads, so there is ONE topic-cost ledger, not two.
// Scope = segment 1 of "{scope} — {use-case}". File absent (module not installed, model not
// maintaining it) -> [] -> feature silently off: absence, not a broken state.
function readLedgerTenures(projectDir, sid) {
  try {
    return ledgerScopes(fs.readFileSync(
      path.join(projectDir, '.claude', 'hooks', '.titles', `${sid}.history.jsonl`), 'utf8'));
  } catch (_) { return []; }
}

// Pure: ledger text -> scope TENURES [{scope, enteredIso, ctxWatermark?}]. Consecutive lines with
// the same scope collapse into one tenure (use-case/sub-function shifts inside a scope are not
// boundaries). A tenure's enteredIso is its first line's ts; its watermark is its first line that
// carries `tokens` (the field is optional in the ledger — a late watermark beats none).
function ledgerScopes(text) {
  const tenures = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch (_) { continue; }
    const scope = String((e && e.title) || '').split(' — ')[0].trim();
    if (!scope || scope.length > 80) continue;
    const last = tenures[tenures.length - 1];
    if (!last || last.scope !== scope) {
      const t = { scope, enteredIso: e.ts };
      if (e.tokens > 0) t.ctxWatermark = e.tokens;
      tenures.push(t);
    } else if (last.ctxWatermark == null && e.tokens > 0) {
      last.ctxWatermark = e.tokens;
    }
  }
  return tenures;
}

// Keyword form of a scope for the migrate command (and any handoff manifest): lowercase, every run
// of non-alnum -> '-', trimmed, capped at 40. Deterministic + stable (same scope -> same slug) so the
// once-per-scope nudge is idempotent and migrate can match the keyword back to a ledger tenure.
// Empty/degenerate scopes fall back to 'session' so the emitted command is always well-formed.
function slug(scope) {
  const s = String(scope || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s || 'session';
}

// The relay instruction the model turns into the standalone warm warning block. Pure + exported so a
// fixture can assert the out without an E2E. Follows the did/costs/out shape (ux copy/warnings-name-the-
// trigger): moved scope + rent% + a SINGLE ready out, with /eval as a one-clause escape hatch for the
// cross-scope-dependency case drift can't see. R11: when autoMigrate is on, the out is rendered as
// clickable AskUserQuestion buttons ("Set it up → just /clear" writes the .armed consent flag; "I'll
// paste it myself" = the /migrate fallback) — no typed magic word. The lead is identical in both modes.
// 2026-07-18: the arithmetic only STAGES the card — the in-turn model holds the render gate, because
// it sees meaning where the hook sees sizes. Two judged tests: RELATEDNESS gates the render (a
// current prompt that returns to the earlier work = stale premise — the failure we watched live was
// the card claiming a topic change in the very turn the user pivoted back); RESOLUTION picks the
// copy's framing (settled-and-safe vs never-closed-but-moved-on). The auto-migrate card demands BOTH
// (a click there truncates context, so the destructive path stays conservative). A refusal is not a
// kill: the model writes the drift-deferred flag and the caller snoozes, then re-offers.
function driftJudge(dominant, autoMigrate) {
  const gate = autoMigrate
    ? `Proceed ONLY if this prompt is UNRELATED to that earlier work AND its threads are RESOLVED ` +
      `(shipped, committed, answered, user-confirmed — nothing still open); a click on this card ` +
      `truncates the old context, so any doubt defers. `
    : `Relay ONLY if this prompt is UNRELATED to that earlier work; RESOLUTION does not gate the ` +
      `relay — it picks the framing below (an unresolved thread the user has moved past still ` +
      `deserves the card). `;
  return `The numbers here are ARITHMETIC — you hold the render gate, because you can see what the ` +
    `hook cannot: meaning. Before relaying anything, judge two tests against the conversation and ` +
    `the user's CURRENT prompt: (1) RELATEDNESS — does this very prompt return to, build on, or ask ` +
    `about the earlier "${dominant}" work? (2) RESOLUTION — were the "${dominant}" threads actually ` +
    `closed (shipped, committed, answered, user-confirmed), or is something still open? ${gate}` +
    `To DEFER instead: write the contentless flag file ` +
    `".claude/hooks/.token-guard/drift-deferred" (the guard snoozes and re-offers in a few ` +
    `prompts) and render NOTHING about drift this turn — no card, no aside. `;
}

function driftNote(dominant, scope, priorPct, autoMigrate, liveContext) {
  const kw = slug(scope);
  if (autoMigrate) {
    // Fully self-contained card: the verbatim warning line IS the AskUserQuestion question (not prose
    // above it), header chip "Token bloat". Fixed 3-part number line (total / keep / truncate): keep =
    // the current scope's live share, truncate = the prior scopes we drop, both derived from priorPct.
    const truncate = Math.round((liveContext || 0) * priorPct / 100);
    const keep = Math.max(0, (liveContext || 0) - truncate);
    return `scope-drift(auto-migrate, staged): this session moved from "${dominant}" to "${scope}", and the ` +
      `earlier scopes are ~${priorPct}% of the live context every turn re-reads. ` +
      driftJudge(dominant, true) +
      `If proceeding: present it as a SINGLE ` +
      `self-contained AskUserQuestion card — do NOT render any warning prose above it. The card's ` +
      `\`question\` field is this line VERBATIM (the agreed copy):\n` +
      `"⚠️ Hey — this session has ~${fmtK(liveContext)} of context, but the current topic only needs ` +
      `~${fmtK(keep)} of that. We can reduce token cost by truncating the old ~${fmtK(truncate)}. ` +
      `Continue?"\n` +
      `Header chip: "Token bloat". TWO options, primary first. Option 1 — label "Yes — Please clean it ` +
      `up. I don't want to waste tokens." Option 2 — label "Cancel". BOTH options are bare labels with NO ` +
      `description — the labels say it all, do NOT add subtext to either. NEVER narrate the internal ` +
      `mechanism anywhere (no armed flag, staged candidate, /clear ` +
      `"keystroke" handoff, or "scope-named receipt" — that wiring is pure noise to the user). On the ` +
      `Option 1 pick, write the contentless flag file ` +
      `\`.claude/hooks/.token-guard/pending-migrate.armed\` (the pointer is already staged), then print ` +
      `EXACTLY this one line and nothing else: "Now /clear your session — your current \"${scope}\" context ` +
      `will be preserved." On Cancel, dismiss — nothing changes. NEVER run \`/clear\` yourself, and ` +
      `write the flag ONLY after the user picks option 1.`;
  }
  const lead = `scope-drift(staged): this session's work has moved from "${dominant}" to "${scope}", and ` +
    `the earlier scopes still make up ~${priorPct}% of the live context every turn ` +
    `re-reads. ` +
    driftJudge(dominant, false) +
    `If relaying: a STANDALONE warning block, never woven into your answer: open ` +
    `with "⚠️ Hey —" and keep a warm conversational voice (helpful friend, not system ` +
    `log), 2-3 plain sentences: the session started on ${dominant}, has moved on to ` +
    `${scope}, and every message still re-carries that earlier work (~${priorPct}% of ` +
    `what each turn costs). Name the RESOLUTION case in one of those clauses: settled → that ` +
    `earlier work shipped and is safe to leave behind; never-closed → the ${dominant} thread ` +
    `never quite wrapped up, so migrating only makes sense if they don't plan to come back to it. `;
  return lead +
    `Then give the ONE-step out as a paste-ready command: in a fresh ` +
    `session, run \`/migrate-new-session ${kw}\` — it recovers this thread and picks up where ` +
    `you left off (nothing to prep first). As a brief closing aside, note that if "${scope}" ` +
    `actually builds on the earlier work, \`/eval-new-session\` instead will judge the cut ` +
    `boundary. NEVER run either command yourself. Then a horizontal rule before the answer itself.`;
}

// Pure fire-rule (exported for fixtures, like meter). Input = ledgerScopes() tenures, the LAST one
// stamped with `prompts` by the caller. Token share per scope = watermark deltas (tenure i owns
// [its watermark, next tenure's watermark)); the last tenure runs to liveContext; the window's
// FIRST tenure starts at 0 (it claims the pre-title baseline, so shares sum to liveContext). The
// window RE-BASES after any watermark SHRINK (auto-compact replaced the context; earlier
// watermarks describe a context that no longer exists — same rule as terminal-title's /clear
// advisor). Fires only when ALL hold:
//   - live context ≥ driftMinContextTokens (below /eval-new-session's own STAY floor the
//     eval's verdict is known in advance — nudging is pointless by construction)
//   - the current scope has held ≥2 prompts (a one-prompt title blip is a detour, not a move —
//     and the transition turn itself is the fat-ctx advisory's beat, not ours)
//   - the current scope is a FIRST appearance (a return to an earlier scope = multiplexing or
//     coming back from a detour — never drift; dominance math alone can't tell A<->B apart)
//   - the current tenure has a measured watermark (an unmeasured current scope can't be scored)
//   - the current scope is not the dominant-by-token-share scope
//   - prior scopes hold ≥ driftPriorShareMin of live context
// The once-per-scope one-shot (nudgedScope) is the CALLER's job — this stays pure.
function driftVerdict(tenures, liveContext, cfg) {
  const none = { fire: false };
  if (!Array.isArray(tenures) || tenures.length < 2) return none;
  if (liveContext < cfg.driftMinContextTokens) return none;
  const cur = tenures[tenures.length - 1];
  if ((cur.prompts || 0) < 2) return none;
  if (tenures.findIndex(e => e.scope === cur.scope) !== tenures.length - 1) return none;
  const known = tenures.filter(e => typeof e.ctxWatermark === 'number');
  if (known[known.length - 1] !== cur) return none;
  let base = 0;
  for (let i = 1; i < known.length; i++) {
    if (known[i].ctxWatermark < known[i - 1].ctxWatermark) base = i; // shrink → re-base
  }
  const win = known.slice(base);
  if (win.length < 2) return none;
  const share = {};
  for (let i = 0; i < win.length; i++) {
    const start = i === 0 ? 0 : win[i].ctxWatermark;
    const end = i + 1 < win.length ? win[i + 1].ctxWatermark : liveContext;
    share[win[i].scope] = (share[win[i].scope] || 0) + Math.max(0, end - start);
  }
  const dominant = Object.keys(share).sort((a, b) => share[b] - share[a])[0];
  const priorShare = liveContext
    ? Math.max(0, liveContext - (share[cur.scope] || 0)) / liveContext : 0;
  if (dominant === cur.scope || priorShare < cfg.driftPriorShareMin) return none;
  return { fire: true, dominant, priorPct: Math.round(priorShare * 100) };
}

// R6 defer loop (2026-07-18). The staged card's render gate lives in the in-turn model (see
// driftJudge); a refusal comes back as the model-written drift-deferred flag. One flag per project,
// not per sid — same posture as the migrate candidate; a cross-session collision costs at worst one
// early or lost re-offer, never a wrong render (every render re-passes the model's gate anyway).
const DRIFT_DEFERRED = 'drift-deferred';
function consumeDriftDeferred(projectDir) {
  try { fs.unlinkSync(path.join(stateDir(projectDir), DRIFT_DEFERRED)); return true; }
  catch (_) { return false; }
}

// Pure state-transition half of the defer loop (exported for fixtures, like driftVerdict). A
// consumed flag converts the burnt one-shot into a snooze (re-offer after retryPrompts more prompts
// in the nudged scope); an expired snooze re-arms the one-shot so driftVerdict may stage the card
// again with a fresh premise. Clearing nudgedScope can only ever ALLOW a re-offer the model
// re-judges — never force a render — so every path here is fail-soft. A snooze whose scope is no
// longer the nudged one is stale (a newer scope fired since): drop it.
function driftDeferralTick(st, flagConsumed, retryPrompts) {
  if (flagConsumed && st.nudgedScope) {
    st.driftSnooze = { scope: st.nudgedScope,
      retryAtPrompts: (st.curScopePrompts || 0) + (retryPrompts || 4) };
  }
  if (st.driftSnooze && st.driftSnooze.scope !== st.nudgedScope) st.driftSnooze = null;
  if (st.driftSnooze && (st.curScopePrompts || 0) >= st.driftSnooze.retryAtPrompts) {
    st.nudgedScope = null;
    st.driftSnooze = null;
  }
}

// ---------------------------------------------------------------------------
// R8 payload pre-gate — the preventive complement to R3: R5 flags heavy skills at install
// time, R3 warns after a payload has landed; R8 fires in the moment between "about to load"
// and "loaded", the only moment the rent is still avoidable. Shares R3's bombJumpTokens —
// the barrier, the tripwire, and the post-mortem must call the same thing a bomb.

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|svg|pdf)$/i; // vision tokens ≠ chars/2.6

// Pure rule half (exported for fixtures, like driftVerdict) — decides from resolved sizes
// only, no fs. sizes: {skillTok, skillFloor} for Skill / {fileChars, isImage} for Read.
function payloadVerdict(toolName, toolInput, sizes, cfg) {
  if (!sizes) return null;
  if (toolName === 'Skill') {
    if (sizes.skillTok == null || sizes.skillTok <= cfg.bombJumpTokens) return null;
    return { door: 'skill', estTokens: sizes.skillTok, floor: !!sizes.skillFloor };
  }
  if (toolName === 'Read') {
    if (toolInput && (toolInput.offset != null || toolInput.limit != null)) return null;
    if (sizes.fileChars == null || sizes.isImage) return null;
    const tok = Math.round(sizes.fileChars / CHARS_PER_TOKEN);
    return tok > cfg.bombJumpTokens ? { door: 'read', estTokens: tok } : null;
  }
  return null;
}

// Skill payload estimate: prefer .claude/skill-budgets.md (R5's audit output doubles as the
// runtime lookup table — zero scanning); else stat SKILL.md and mark it a floor (referenced
// files are unknowable pre-expansion). Unknown/plugin-namespaced -> null: never guess.
function skillSizes(projectDir, name) {
  if (!name) return null;
  try {
    const table = fs.readFileSync(path.join(projectDir, '.claude', 'skill-budgets.md'), 'utf8');
    for (const line of table.split('\n')) {
      const mt = line.match(/^(\S+)\s+.*?≈\s*([\d.]+)\s*(k|M)?\s*tok/);
      if (mt && mt[1] === name) {
        const mul = mt[3] === 'M' ? 1e6 : mt[3] === 'k' ? 1e3 : 1;
        return { skillTok: Math.round(parseFloat(mt[2]) * mul), skillFloor: false };
      }
    }
  } catch (_) { /* no table — fall through to the stat floor */ }
  for (const dir of [projectDir, os.homedir()]) {
    try {
      const bytes = fs.statSync(path.join(dir, '.claude', 'skills', name, 'SKILL.md')).size;
      return { skillTok: Math.round(bytes / CHARS_PER_TOKEN), skillFloor: true };
    } catch (_) { /* try next */ }
  }
  return null;
}

function readSizes(filePath) {
  if (!filePath) return null;
  try { return { fileChars: fs.statSync(filePath).size, isImage: IMAGE_EXT.test(filePath) }; }
  catch (_) { return null; }
}

// Door 3: user-typed slash command — resolution order mirrors Claude Code's own
// (project commands, user commands, project skills, user skills); first hit wins.
function commandPayloadTokens(projectDir, name) {
  const candidates = [
    path.join(projectDir, '.claude', 'commands', `${name}.md`),
    path.join(os.homedir(), '.claude', 'commands', `${name}.md`),
    path.join(projectDir, '.claude', 'skills', name, 'SKILL.md'),
    path.join(os.homedir(), '.claude', 'skills', name, 'SKILL.md'),
  ];
  for (const p of candidates) {
    try { return Math.round(fs.statSync(p).size / CHARS_PER_TOKEN); } catch (_) { /* next */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Workflow fan-size guard — a pre-launch companion to R2. R2 makes you confirm the COST of a
// launch; this flags the SHAPE that made a 103-agent fleet plan itself for a one-paragraph
// feasibility question: a fixed N-votes × M-claims verify tier, or a fan sized by data found at
// run time. It reports honest SHAPE signals only — never a false-precision agent count, because
// a script's real fan is dynamic (the R2 spec's reason not to parse for an exact number). It is
// an ASK, not a block: a multiplicative fan is sometimes correct (small × small), so the guard
// surfaces the shape and lets the human right-size — the exact flag that got the original run
// cancelled by hand. Pure (exported for fixtures, like payloadVerdict): reads only the script
// text. Regexes are length-bounded ({0,N}) so a long minified script can't backtrack quadratically
// (the R5 ref-regex lesson). Conservative by design: it stays silent unless a fan is either large
// by an explicit constant/literal, or multiplicative AND (has a fan constant or a heavy-harness
// marker) — a plain bounded pipeline over a small literal array never trips it.
function fanVerdict(src, cfg) {
  if (!src || typeof src !== 'string') return null;
  const warnN = (cfg && cfg.fanWarnAgents) || DEFAULTS.fanWarnAgents;
  const hardCap = (cfg && cfg.fanHardCap) || DEFAULTS.fanHardCap;
  const signals = [];
  let estimate = null;

  // (a) explicit fan constants — VOTES / CLAIMS / MAX_* / FINDERS / … = a number. A single one
  //     at or above the threshold is already a large per-stage fan.
  const found = []; // {name, n} — names kept so the ceiling can compose the RIGHT pair, not the
                    // two biggest (MAX_FETCH and MAX_VERIFY_CLAIMS are separate stages, not nested).
  const NAME = /\b(VOTES?(?:_PER_\w+)?|CLAIMS?|MAX_[A-Z_]+|FETCH\w*|N_?AGENTS?|AGENTS?|FAN\w*|WORKERS?|SHARDS?|PANEL|LENS(?:ES)?|FINDERS?|FLEET\w*|ROUNDS?|SAMPLES?)\b\s*[:=]\s*(\d{1,6})/gi;
  let m;
  while ((m = NAME.exec(src))) { const n = parseInt(m[2], 10); if (n > 1) found.push({ name: m[1], n }); }
  const nums = found.map(f => f.n);
  const maxN = nums.length ? Math.max(...nums) : 0;
  if (maxN >= warnN) { signals.push(`a fan constant of ${maxN}`); estimate = `up to ~${maxN} agents in one stage`; }

  // (b) multiplicative / nested fan — a fan-out whose mapped items fan out again, so the per-stage
  //     counts multiply (the 3-votes-per-claim shape). Detected structurally, not by counting:
  //     a fan sized by a run-time .map AND more than one fan level. Gated on a corroborating
  //     signal (a fan constant present, or a research-harness marker) to keep a plain bounded
  //     review workflow — which is also parallel-over-map — from tripping it.
  const fanLevels = (src.match(/\b(?:parallel|pipeline)\s*\(/g) || []).length;
  const mapFan = /\.(?:map|flatMap)\s*\(/.test(src); // fan sized by a mapped collection
  const heavyHint = /adversariall?y|votes?\s+per\s+claim|deep.?research|refute|skeptic/i.test(src);
  const multiplicative = mapFan && fanLevels >= 2 && (nums.length >= 1 || heavyHint);
  let ceiling = 0; // honest upper bound — only where a breadth fan and a per-item multiplier compose
  if (multiplicative) {
    signals.push('agents fan out inside another fan-out over run-time data (the per-stage counts multiply)');
    // Compose the ceiling from a BREADTH constant (the item count — CLAIMS/FINDERS/MAX_*) times a
    // per-item MULTIPLIER (VOTES/ROUNDS/LENSES/*_PER_*). Multiplying the two biggest blindly is
    // wrong — MAX_FETCH × MAX_VERIFY_CLAIMS are separate stages that never nest. This is a CEILING
    // ("if every stage fans fully"), not a prediction — shown as scale on the ask, never a block.
    const MULT = /VOTES?|ROUNDS?|LENS|SAMPLES?|_PER_/i;
    const mults = found.filter(f => MULT.test(f.name)).map(f => f.n);
    const breadths = found.filter(f => !MULT.test(f.name)).map(f => f.n);
    const mult = mults.length ? Math.max(...mults) : 0;
    const breadth = breadths.length ? Math.max(...breadths) : maxN;
    if (mult > 1 && breadth > 1) {
      ceiling = breadth * mult;
      estimate = `up to ~${ceiling} agents total (${breadth} × ${mult} if every stage fans fully)`;
    }
  }

  // (c) explicit oversized literal fan — Array.from({length:N}) / new Array(N) that spawns agents.
  let litMax = 0;
  const LIT = /(?:Array\.from\s*\(\s*\{\s*length\s*:\s*|new\s+Array\s*\(\s*)(\d{1,6})/g;
  while ((m = LIT.exec(src))) {
    const n = parseInt(m[1], 10);
    if (n >= warnN && n > litMax) litMax = n;
  }
  if (litMax) { signals.push(`a literal fan of ${litMax}`); estimate = estimate || `up to ~${litMax} agents`; }

  if (!signals.length) return null;

  // `concrete` = the largest count written LITERALLY in the script (a named fan constant or an
  // Array literal). Unlike the multiplicative ceiling, it is a certainty, so it is the only thing
  // allowed to trip the hard cap — blocking a launch on the estimated product would be exactly the
  // fabricated-number precision this project refuses.
  const concrete = Math.max(maxN, litMax);
  if (!ceiling) ceiling = concrete;
  const level = (hardCap && concrete >= hardCap) ? 'block'
    : (maxN >= warnN * 2 || multiplicative) ? 'high'
    : 'warn';
  return { level, signals, estimate, ceiling, concrete };
}

// Resolve the script text a fanVerdict reads. Inline `script` is the common case; `scriptPath`
// is read from disk; a named/saved workflow (tool_input.name) has no cheap source to inspect ->
// '' -> fanVerdict returns null and R2's history estimate still fires. Never throws.
function workflowSource(toolInput) {
  if (!toolInput) return '';
  if (typeof toolInput.script === 'string' && toolInput.script) return toolInput.script;
  if (toolInput.scriptPath) {
    try { return fs.readFileSync(String(toolInput.scriptPath), 'utf8'); } catch (_) { /* unreadable */ }
  }
  return '';
}

// ---------------------------------------------------------------------------
// R5 producer — the budgets table door 1 reads. Two sources, one file:
//   static rows: --budgets scans every stat-able skill (project, user, plugin cache) and
//     prices its INVOKE payload (SKILL.md — reference files load later, where door 2 catches
//     them one Read at a time); the full SKILL.md+refs figure rides along as an audit
//     annotation with R5's ⚠ over skillBudgetWarnChars.
//   observed rows: when a >bombJumpTokens landing is attributable to a named skill (an
//     R8-approved hop, or R3's Skill(name) attribution), the MEASURED jump is recorded. This
//     is the only source that can price built-in skills (claude-api ships no files to stat —
//     verified 2026-07-12), and a measured landing beats any static guess, so observed rows
//     survive regeneration.
function budgetsPath(projectDir) { return path.join(projectDir, '.claude', 'skill-budgets.md'); }

function recordObservedSkill(projectDir, name, tok, chars, cfg) {
  try {
    if (!name || !tok) return;
    let lines = [];
    try { lines = fs.readFileSync(budgetsPath(projectDir), 'utf8').split('\n'); } catch (_) { /* new table */ }
    const row = `${name}  ${chars ? `${fmtK(chars)} chars ` : ''}≈ ${fmtK(tok)} tok` +
      `${tok > cfg.bombJumpTokens ? '  ⚠' : ''}  (observed ${new Date().toISOString().slice(0, 10)})`;
    const at = lines.findIndex(l => l.split(/\s+/)[0] === name);
    if (at >= 0) lines[at] = row; else {
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      lines.push(row, '');
    }
    fs.writeFileSync(budgetsPath(projectDir), lines.join('\n'));
  } catch (_) { /* table update is best-effort — the warn already shipped */ }
}

// Every skill with a SKILL.md on disk: project + user dirs (bare name), plugin cache
// (namespaced plugin:skill, newest version dir only). First hit wins, mirroring Claude
// Code's own resolution order. Built-ins live in no directory — observed rows only.
function scanSkillDirs(projectDir) {
  const found = new Map(); // name -> skill dir
  const add = (name, dir) => {
    if (!found.has(name) && fs.existsSync(path.join(dir, 'SKILL.md'))) found.set(name, dir);
  };
  const listDirs = p => {
    try { return fs.readdirSync(p, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); }
    catch (_) { return []; }
  };
  for (const root of [path.join(projectDir, '.claude', 'skills'),
    path.join(os.homedir(), '.claude', 'skills')]) {
    for (const name of listDirs(root)) add(name, path.join(root, name));
  }
  const cache = path.join(os.homedir(), '.claude', 'plugins', 'cache');
  const verNum = v => String(v).split('.').map(n => parseInt(n, 10) || 0);
  const cmpVer = (a, b) => {
    const A = verNum(a), B = verNum(b);
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) - (B[i] || 0);
    }
    return 0;
  };
  for (const mkt of listDirs(cache)) {
    for (const plugin of listDirs(path.join(cache, mkt))) {
      const vers = listDirs(path.join(cache, mkt, plugin)).sort(cmpVer);
      const ver = vers[vers.length - 1];
      if (!ver) continue;
      for (const sub of ['skills', path.join('.claude', 'skills')]) {
        const root = path.join(cache, mkt, plugin, ver, sub);
        for (const name of listDirs(root)) add(`${plugin}:${name}`, path.join(root, name));
      }
    }
  }
  return found;
}

// Full payload = SKILL.md + files it references (path-ish tokens resolved inside the skill
// dir, chased one level through referenced .md/.txt). Audit-grade ceiling for the ⚠ flag —
// the parsed ≈tok figure stays the invoke payload (SKILL.md alone).
function skillPayloadChars(dir) {
  const root = path.resolve(dir);
  const seen = new Set();
  const queue = [path.join(root, 'SKILL.md')];
  let total = 0, guard = 0;
  while (queue.length && guard++ < 64) {
    const fp = path.resolve(queue.shift());
    const key = fp.toLowerCase();
    if (seen.has(key) || (fp !== path.join(root, 'SKILL.md') && !fp.startsWith(root + path.sep))) continue;
    seen.add(key);
    let size; try { size = fs.statSync(fp).size; } catch (_) { continue; }
    total += size;
    if (!/\.(md|txt)$/i.test(fp) || size > 2e6) continue;
    let text; try { text = fs.readFileSync(fp, 'utf8'); } catch (_) { continue; }
    // Split-then-test, never a global scan: an unbounded [\w.-]+ prefix backtracks
    // quadratically on long unbroken runs (a 200k-char line = ~4e10 steps — measured hang).
    for (const tokn of text.split(/[\s"'()\[\]<>`,;]+/)) {
      if (tokn.length < 4 || tokn.length > 200) continue;
      const m = /^[\w./-]+\.(?:md|txt|json|js|ts|py|html|css|csv)$/i.exec(tokn.replace(/[.:]+$/, ''));
      if (m) queue.push(path.resolve(path.dirname(fp), m[0]));
    }
  }
  return total;
}

function generateBudgets(projectDir, cfg) {
  const observed = [];
  const observedNames = new Set();
  try {
    for (const line of fs.readFileSync(budgetsPath(projectDir), 'utf8').split('\n')) {
      if (/\(observed \d{4}-\d{2}-\d{2}\)/.test(line)) {
        observed.push(line);
        observedNames.add(line.split(/\s+/)[0]);
      }
    }
  } catch (_) { /* first run */ }
  const rows = [];
  for (const [name, dir] of scanSkillDirs(projectDir)) {
    if (observedNames.has(name)) continue; // a measured landing beats the static scan
    let invokeChars; try { invokeChars = fs.statSync(path.join(dir, 'SKILL.md')).size; } catch (_) { continue; }
    const fullChars = skillPayloadChars(dir);
    const tok = Math.round(invokeChars / CHARS_PER_TOKEN);
    rows.push({ tok, line:
      `${name}  ${fmtK(invokeChars)} chars ≈ ${fmtK(tok)} tok` +
      (fullChars > invokeChars * 1.2 ? `  (+refs → ${fmtK(fullChars)} chars full)` : '') +
      (fullChars > cfg.skillBudgetWarnChars ? '  ⚠' : '') });
  }
  rows.sort((a, b) => b.tok - a.tok);
  const out = [
    '# skill payload budgets — door 1 (R8) lookup table, R5 audit view',
    `# regenerate: node .claude/hooks/token-guard.js --budgets   (${new Date().toISOString().slice(0, 10)})`,
    '# (observed ...) rows were measured from real landings — they survive regeneration and',
    '# are the only coverage for built-in skills, which ship no files to scan.',
    '',
    ...observed,
    ...rows.map(r => r.line),
    '',
  ];
  fs.writeFileSync(budgetsPath(projectDir), out.join('\n'));
  return { rows: rows.length, observed: observed.length, path: budgetsPath(projectDir), out };
}

// ---------------------------------------------------------------------------
// config + per-session state
function loadConfig(projectDir) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectDir, '.claude', 'cca.config.json'), 'utf8'));
    return resolveConfig((cfg && cfg.tokenGuard) || {});
  } catch (_) { return resolveConfig({}); }
}

function stateDir(projectDir) { return path.join(projectDir, '.claude', 'hooks', '.token-guard'); }

function loadState(projectDir, sid) {
  const blank = { warnedUSD: 0, warnedCtx: false, gateArmedAt: null, lastUSD: 0,
    lastLiveContext: null, scanOffset: 0, warnedIdleAt: 0, knownWf: {},
    pendingWfReceipt: null, bombGateArmed: false, curScope: null, curScopePrompts: 0,
    nudgedScope: null, driftSnooze: null,
    approvedPayloadHop: null, payloadGateOkOnce: null,
    turnPayloadTok: 0, turnPayloadWarned: false, miniBombGateArmed: false,
    lastWindowPct: null, lastWindowResetsAt: null, warnedWindow: null, lastTurnDeltaUsd: 0 };
  try {
    return Object.assign(blank,
      JSON.parse(fs.readFileSync(path.join(stateDir(projectDir), `${sid}.json`), 'utf8')));
  } catch (_) { return blank; }
}

function saveState(projectDir, sid, st) {
  try {
    fs.mkdirSync(stateDir(projectDir), { recursive: true });
    fs.writeFileSync(path.join(stateDir(projectDir), `${sid}.json`), JSON.stringify(st));
  } catch (_) { /* state loss just re-warns — harmless */ }
}

// R4 idle-return new-terminal pointer: `ccr` (CCA's companion bin) reads recover.json from
// the project it's run in and execs `claude "<recoverCmd>"` — one word instead of retyping
// the recovery invocation after exiting a stale session. Refreshed on every idle fire.
function writeRecoverPointer(projectDir, sid, recoverCmd) {
  try {
    fs.mkdirSync(stateDir(projectDir), { recursive: true });
    fs.writeFileSync(path.join(stateDir(projectDir), 'recover.json'),
      JSON.stringify({ sid, recoverCmd, projectDir, writtenAt: Date.now() }, null, 2));
    return true;
  } catch (_) { return false; /* pointer is a convenience — the pasteable command still shows */ }
}

// R11 auto-migrate consent marker (two files under stateDir): the CANDIDATE carries the deterministic
// {keyword, sid, boundaryIso} the hook already knows at nudge time; the ARMED flag is contentless proof
// the model wrote only after the user opted in. Both required to consume — the candidate alone is inert.
const MIGRATE_CANDIDATE = 'pending-migrate.json';
const MIGRATE_ARMED = 'pending-migrate.armed';

// Stage the candidate when the drift nudge fires (best-effort; the paste-command out still works if it
// fails). A candidate for a DIFFERENT scope invalidates any prior consent — re-arm must be explicit for
// the thread you'd actually migrate now.
function writeMigrateCandidate(projectDir, sid, scope, boundaryIso) {
  const dir = stateDir(projectDir);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const kw = slug(scope);
    try {
      const prev = JSON.parse(fs.readFileSync(path.join(dir, MIGRATE_CANDIDATE), 'utf8'));
      if (prev.keyword !== kw) fs.unlinkSync(path.join(dir, MIGRATE_ARMED));
    } catch (_) { /* no prior candidate/flag to invalidate */ }
    const now = new Date().toISOString();
    fs.writeFileSync(path.join(dir, MIGRATE_CANDIDATE), JSON.stringify({
      keyword: kw, sid, boundaryIso: boundaryIso || now, scope, writtenIso: now,
    }));
  } catch (_) { /* staging is best-effort */ }
}

// Return the candidate iff consent (armed flag) exists, the SessionStart lands in a FRESH context
// (clear/startup — never resume/compact, which retain context and would double-inject), and the arm is
// within TTL (a forgotten arm can't hijack a much-later unrelated clear). Otherwise null. Pure-ish (reads).
function resolveMarker(projectDir, source, cfg) {
  if (source && source !== 'clear' && source !== 'startup') return null;
  const dir = stateDir(projectDir);
  let cand;
  try { cand = JSON.parse(fs.readFileSync(path.join(dir, MIGRATE_CANDIDATE), 'utf8')); } catch (_) { return null; }
  if (!fs.existsSync(path.join(dir, MIGRATE_ARMED))) return null; // no opt-in
  if (!cand || !cand.sid || !cand.boundaryIso) return null;
  const ttlMin = cfg.driftMigrateMarkerTTLmin || 120;
  const ageMin = (Date.now() - (Date.parse(cand.writtenIso) || 0)) / 60000;
  if (ageMin > ttlMin) return null; // stale arm — leave for reaping
  return cand;
}

function clearMarker(projectDir) {
  const dir = stateDir(projectDir);
  for (const f of [MIGRATE_CANDIDATE, MIGRATE_ARMED]) {
    try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* already gone */ }
  }
}

// R2 history lives at project level, not session level — "what did the LAST fleet here cost"
// must survive across sessions to be worth quoting.
function wfHistoryPath(projectDir) { return path.join(stateDir(projectDir), 'workflow-history.json'); }
function loadWfHistory(projectDir) {
  try { return JSON.parse(fs.readFileSync(wfHistoryPath(projectDir), 'utf8')); } catch (_) { return null; }
}
function saveWfHistory(projectDir, h) {
  try {
    fs.mkdirSync(stateDir(projectDir), { recursive: true });
    fs.writeFileSync(wfHistoryPath(projectDir), JSON.stringify(h));
  } catch (_) { /* harmless */ }
}

function logLine(projectDir, msg) {
  try {
    const dir = stateDir(projectDir);
    fs.mkdirSync(dir, { recursive: true });
    const log = path.join(dir, 'usage.log');
    try { if (fs.statSync(log).size > 256 * 1024) fs.renameSync(log, `${log}.1`); } catch (_) { /* none yet */ }
    fs.appendFileSync(log, `${new Date().toISOString()}  ${msg}\n`);
  } catch (_) { /* logging must never throw */ }
}

// ---------------------------------------------------------------------------
// Plan autodetection (2026-07-12) — reads two Claude Code internal files so check-ins can
// say WHICH meter applies (plan window vs real dollars) and whether overage billing is
// armed. The calm case matters most: "overage OFF" stops users stressing over big token
// totals. Undocumented formats: any surprise -> nulls -> lines omitted (absence, not
// disabled states). Reads ONLY the named fields; NEVER log these files (live tokens).
// macOS keeps credentials in the Keychain -> plan fields come back null there (v2.1).
// hasExtraUsageEnabled is a CACHED profile — a toggle flipped on claude.ai lags until
// Claude Code refetches.
// Billing-only fast path — reads env + the small credentials file, safe on EVERY prompt
// (planInfo() additionally parses the potentially-multi-MB ~/.claude.json profile cache,
// so it stays reserved for the rare check-in/report path).
function billingKind() {
  if (process.env.ANTHROPIC_API_KEY) return 'api';
  try {
    const cred = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8'));
    if (cred && cred.claudeAiOauth && cred.claudeAiOauth.subscriptionType) return 'subscription';
  } catch (_) { /* Keychain platforms / not logged in */ }
  return null;
}

// Should user-facing copy carry $ figures? Subscription users: no — tokens are the unit that
// drives their decisions; $ is noise. API/unknown: yes — $ is the real bill.
function wantDollars(cfg) {
  if (cfg.showDollars === true || cfg.showDollars === false) return cfg.showDollars;
  return billingKind() !== 'subscription';
}

function planInfo() {
  const info = { billing: null, plan: null, tier: null, extraUsage: null };
  try {
    if (process.env.ANTHROPIC_API_KEY) info.billing = 'api';
    const home = os.homedir();
    try {
      const cred = JSON.parse(fs.readFileSync(path.join(home, '.claude', '.credentials.json'), 'utf8'));
      const oa = cred && cred.claudeAiOauth;
      if (oa && oa.subscriptionType) {
        info.plan = String(oa.subscriptionType);
        if (!info.billing) info.billing = 'subscription';
        const tier = /_(\d+x)$/.exec(String(oa.rateLimitTier || ''));
        if (tier) info.tier = tier[1];
      }
    } catch (_) { /* no file (Keychain platforms) / not logged in */ }
    try {
      const cj = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
      if (cj && cj.oauthAccount && typeof cj.oauthAccount.hasExtraUsageEnabled === 'boolean') {
        info.extraUsage = cj.oauthAccount.hasExtraUsageEnabled;
      }
    } catch (_) { /* profile cache absent — omit the overage clause */ }
  } catch (_) { /* never throw */ }
  return info;
}

function planLine(info) {
  if (info.billing === 'api') return 'Billing: API key — the $ figures above are real charges';
  if (!info.plan) return null;
  const name = info.plan[0].toUpperCase() + info.plan.slice(1) + (info.tier ? ` ${info.tier}` : '');
  if (info.extraUsage === true) {
    return `Plan: ${name} · overage billing ON — usage past your limit is charged for real`;
  }
  // OFF gets no explanation (Andrew 2026-07-12): the user knows what OFF means — spelling out
  // "never a charge" is TMI and wastes tokens. ON keeps its clause: that one's a warning.
  if (info.extraUsage === false) {
    return `Plan: ${name} · overage billing OFF`;
  }
  return `Plan: ${name}`;
}

// ---------------------------------------------------------------------------
// Official usage (2026-07-12) — Anthropic's server-computed window percentages, the same
// numbers the built-in /usage shows. THE lead block: measured, nameable provenance
// ("Anthropic's meter"), unlike our transcript-derived estimates — satisfies the ux-repo
// "never print an unmeasured number" decision outright. Undocumented OAuth endpoint
// (community-verified, claude-code GH #31021/#31637): needs the Bearer token from the
// credentials file, the oauth beta header, and a claude-code User-Agent (without it, an
// aggressively rate-limited bucket). Cached ≥180s per community etiquette; 4s timeout;
// any failure -> stale cache or null (callers fall back to labeled estimates or omit).
// Never throws, never logs the token.
const OFFICIAL_USAGE_TTL_MS = 180 * 1000;
const CLAUDE_CODE_UA = 'claude-code/2.1.207';

function officialUsageCachePath(projectDir) { return path.join(stateDir(projectDir), 'official-usage.json'); }

async function fetchOfficialUsage(projectDir) {
  try {
    let cached = null;
    try { cached = JSON.parse(fs.readFileSync(officialUsageCachePath(projectDir), 'utf8')); } catch (_) { /* none */ }
    if (cached && Date.now() - cached.at < OFFICIAL_USAGE_TTL_MS) {
      return { data: cached.data, ageMs: Date.now() - cached.at };
    }
    const stale = cached ? { data: cached.data, ageMs: Date.now() - cached.at, stale: true } : null;
    const cred = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8'));
    const tok = cred && cred.claudeAiOauth && cred.claudeAiOauth.accessToken;
    if (!tok) return stale;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    let res;
    try {
      res = await fetch('https://api.anthropic.com/api/oauth/usage', {
        headers: {
          Authorization: `Bearer ${tok}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': CLAUDE_CODE_UA,
        },
        signal: ctl.signal,
      });
    } finally { clearTimeout(timer); }
    if (!res.ok) return stale;
    const data = await res.json();
    try {
      fs.mkdirSync(stateDir(projectDir), { recursive: true });
      fs.writeFileSync(officialUsageCachePath(projectDir), JSON.stringify({ at: Date.now(), data }));
    } catch (_) { /* cache loss just re-fetches */ }
    return { data, ageMs: 0 };
  } catch (_) { return null; }
}

function fmtReset(iso) {
  try {
    const d = new Date(iso);
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString()
      ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  } catch (_) { return ''; }
}

// display lines from the endpoint's limits[] (fallback: the flat five_hour/seven_day fields)
//
// Ordering (2026-07-12): the limit that will bite hardest leads — GENERIC, never a hardcoded
// model priority. Rank: Anthropic's own severity flag, then its is_active marker, then runway
// density = headroom %-points per day until reset (a weekly cap at 81% with days to go is far
// tighter than a 5h window at 55% that resets this afternoon). "Fable first" falls out without
// naming Fable: restricted availability = a tight model-scoped cap = thin runway.
function limitRank(l) {
  const sev = l.severity && l.severity !== 'normal' ? 1 : 0;
  const active = l.is_active ? 1 : 0;
  // missing/unparseable resets_at -> assume a day out; floor at 1h so imminent resets
  // don't divide runway to near-zero and hijack the top slot on their way out the door
  const t = Date.parse(l.resets_at || '') || Date.now() + 864e5;
  const days = Math.max(t - Date.now(), 3600e3) / 864e5;
  const runway = (100 - (typeof l.percent === 'number' ? l.percent : 0)) / days;
  return { sev, active, runway };
}

function officialLines(u) {
  const lines = [];
  const label = { session: '5h window', weekly_all: 'Weekly (all models)' };
  if (Array.isArray(u.limits) && u.limits.length) {
    const ordered = u.limits.slice().sort((a, b) => {
      const ra = limitRank(a), rb = limitRank(b);
      return rb.sev - ra.sev || rb.active - ra.active || ra.runway - rb.runway;
    });
    for (const l of ordered) {
      const name = l.kind === 'weekly_scoped'
        ? `Weekly (${(l.scope && l.scope.model && l.scope.model.display_name) || 'scoped'})`
        : (label[l.kind] || l.kind);
      // severity/is_active feed only the SORT (chopped from display 2026-07-12): once the
      // tightest limit leads, position IS the signal — flags on top of it add nothing.
      lines.push(`${name}: ${l.percent}% used` +
        (l.resets_at ? ` · resets ${fmtReset(l.resets_at)}` : ''));
    }
  } else {
    if (u.five_hour) lines.push(`5h window: ${u.five_hour.utilization}% used · resets ${fmtReset(u.five_hour.resets_at)}`);
    if (u.seven_day) lines.push(`Weekly (all models): ${u.seven_day.utilization}% used · resets ${fmtReset(u.seven_day.resets_at)}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// R12 window guards — two flags read straight off the official meter (Anthropic's own server-side
// window percentages). The insight that makes them cheap: the meter already publishes % used, so
// "% of the window" needs no token/dollar denominator — a subscription's opaque rate-limit cap
// never has to be guessed. Pure + exported so fixtures pin the fire conditions (like driftVerdict).

// A window's resets_at is a FIXED instant within a cycle, but the server recomputes it with
// sub-second jitter each call (observed: 08:20:00.504765 vs 08:19:59.975486 for the same window).
// So cycle identity must be a tolerance match, never string equality — otherwise the spike's
// baseline never lines up (it would never fire) and the threshold one-shot re-nags every prompt.
// A genuine reset moves resets_at by the whole window (5h / 7d), far past this tolerance.
const WINDOW_CYCLE_TOL_MS = 2 * 60 * 1000;
function sameWindowCycle(aIso, bIso) {
  const a = Date.parse(aIso), b = Date.parse(bIso);
  if (!a || !b) return aIso === bIso; // unparseable both sides -> exact match (both '' = same "no data")
  return Math.abs(a - b) <= WINDOW_CYCLE_TOL_MS;
}

// The 5h window ("session" limit) as {pct, resetsAt} — flat five_hour first, limits[] fallback.
// null when the meter carried no 5h figure (unreachable, or an account shape without one).
function fiveHourWindow(u) {
  if (!u) return null;
  if (u.five_hour && typeof u.five_hour.utilization === 'number') {
    return { pct: u.five_hour.utilization, resetsAt: u.five_hour.resets_at || '' };
  }
  if (Array.isArray(u.limits)) {
    const s = u.limits.find(l => l && l.kind === 'session' && typeof l.percent === 'number');
    if (s) return { pct: s.percent, resetsAt: s.resets_at || '' };
  }
  return null;
}

// The tightest live window across EVERY horizon (highest % used) as {pct, name, resetsAt}.
// The threshold flag watches all of them because a throttle can come from the 5h OR the weekly cap.
// null when no data.
function tightestWindow(u) {
  if (!u) return null;
  const label = { session: '5h window', weekly_all: 'Weekly (all models)' };
  const cands = [];
  if (Array.isArray(u.limits) && u.limits.length) {
    for (const l of u.limits) {
      if (!l || typeof l.percent !== 'number') continue;
      const name = l.kind === 'weekly_scoped'
        ? `Weekly (${(l.scope && l.scope.model && l.scope.model.display_name) || 'scoped'})`
        : (label[l.kind] || l.kind);
      cands.push({ pct: l.percent, name, resetsAt: l.resets_at || '' });
    }
  } else {
    if (u.five_hour && typeof u.five_hour.utilization === 'number') {
      cands.push({ pct: u.five_hour.utilization, name: '5h window', resetsAt: u.five_hour.resets_at || '' });
    }
    if (u.seven_day && typeof u.seven_day.utilization === 'number') {
      cands.push({ pct: u.seven_day.utilization, name: 'Weekly (all models)', resetsAt: u.seven_day.resets_at || '' });
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.pct - a.pct);
  const w = cands[0];
  return { pct: w.pct, name: w.name, resetsAt: w.resetsAt };
}

// R12a verdict — did one interval eat >= windowSpikeWarnPct of the 5h window? Primary signal is the
// meter's OWN % delta since the last prompt: self-calibrating, and naturally spike-shaped (a fast
// small turn leaves the 180s-cached % unmoved → delta 0; a heavy turn outlasts the cache and the
// jump shows). Fallback, only when the meter was unreachable this turn, is the Stop-stashed turn $
// against windowBudgetUSD. The <=100 cap drops meter artifacts (a post-outage re-baseline reads as
// a >full-window "jump" that no single turn could produce).
function windowSpikeVerdict(now5h, prev, lastTurnUsd, cfg) {
  const min = cfg.windowSpikeWarnPct;
  if (now5h && prev && prev.pct != null && sameWindowCycle(prev.resetsAt, now5h.resetsAt) && now5h.pct >= prev.pct) {
    const spikePct = now5h.pct - prev.pct;
    if (spikePct >= min && spikePct <= 100) {
      return { fire: true, spikePct, fromPct: prev.pct, toPct: now5h.pct, estimated: false };
    }
    return { fire: false };
  }
  if (!now5h && cfg.windowBudgetUSD > 0 && lastTurnUsd > 0) {
    const spikePct = (lastTurnUsd / cfg.windowBudgetUSD) * 100;
    if (spikePct >= min && spikePct <= 100) {
      return { fire: true, spikePct, fromPct: null, toPct: null, estimated: true };
    }
  }
  return { fire: false };
}

// R12b verdict — has the tightest window crossed a NEW rung of the warn ladder this cycle?
// windowThresholdWarnPct is a ladder (array) or a single number — both normalize here, so a
// user's pinned `80` keeps working. `warned` is the last-fired {name, resetsAt, rung}: the same
// window in the same cycle suppresses rungs at/below the fired one, but an ESCALATION to a
// higher rung still fires; a different window, or the same one a cycle later, starts fresh.
// Pre-ladder state (no .rung) counts as top-rung-fired so an upgrade never double-fires mid-cycle.
function windowThresholdVerdict(worst, warned, cfg) {
  if (!worst) return { fire: false };
  const ladder = [].concat(cfg.windowThresholdWarnPct || [])
    .map(Number).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!ladder.length) return { fire: false };
  const rung = ladder.filter(r => worst.pct >= r).pop();
  if (rung === undefined) return { fire: false };
  const sameCycle = warned && warned.name === worst.name && sameWindowCycle(warned.resetsAt, worst.resetsAt);
  const firedRung = sameCycle ? (typeof warned.rung === 'number' ? warned.rung : Infinity) : -Infinity;
  if (rung <= firedRung) return { fire: false };
  return { fire: true, pct: worst.pct, name: worst.name, resetsAt: worst.resetsAt, rung, topRung: ladder[ladder.length - 1] };
}

// The relayed copy — instructions TO the model (mirrors the idle/bomb notes). NEVER a dollar
// figure: window budget is rate-limit consumption, and on a subscription a $ reads as a phantom
// charge. Pure + exported so a golden test can pin the contract.
function windowSpikeNote(sv, now5h) {
  const reset = now5h && now5h.resetsAt ? ` and resets ${fmtReset(now5h.resetsAt)}` : '';
  const magnitude = sv.estimated
    ? `an estimated ~${Math.round(sv.spikePct)}% of the 5-hour usage window (the meter was ` +
      `unreachable, so this is calibrated from the turn's weighted cost, not measured)`
    : `~${Math.round(sv.spikePct)} points of the 5-hour usage window (it climbed from ~` +
      `${sv.fromPct}% to ~${sv.toPct}% used${reset})`;
  return (
    `window-spike: since the user's last turn, a single stretch of work ate ${magnitude}. Relay ` +
    `this as a STANDALONE warning block, never woven into your answer: open with "⚠️ Hey —" and ` +
    `keep a warm conversational voice (helpful friend, not system log), 2 plain sentences, NO ` +
    `dollar figures (this is rate-limit budget, not money). Sentence 1 names the jump in window %; ` +
    `sentence 2 the out — a lighter next turn, or /clear and a fresh session if that heavy work is ` +
    `done. Then a horizontal rule before the answer itself.`
  );
}

// R12a confirm variant — when windowSpikeConfirm is on, the passive spike note becomes a two-option
// AskUserQuestion card (mirrors driftNote's auto-migrate branch): "keep going" dismisses; "unpack it"
// runs the /analyze-session forensic digest and waits. Same dollar-free throttle framing as the
// passive note (window budget is a rate limit, not money). Because it's a relayed card and NOT a
// `decision:'block'`, it stays a soft interrupt — safe to ship on by default (it never hard-blocks
// a turn, unlike the R12b throttle gate). Pure + exported so a golden test pins it.
function windowSpikeConfirmNote(sv, now5h, sid) {
  const reset = now5h && now5h.resetsAt ? `, resets ${fmtReset(now5h.resetsAt)}` : '';
  const magnitude = sv.estimated
    ? `an estimated ~${Math.round(sv.spikePct)}% of your 5-hour usage window (calibrated from the ` +
      `turn's weighted cost — the meter was unreachable, so it's estimated, not measured)`
    : `~${Math.round(sv.spikePct)}% of your 5-hour usage window (it climbed from ~${sv.fromPct}% to ` +
      `~${sv.toPct}% used${reset})`;
  const analyze = sid ? `/analyze-session ${sid}` : '/analyze-session';
  return (
    `window-spike(confirm): since the user's last turn, one stretch of work used ${magnitude}. Present ` +
    `it as a SINGLE self-contained AskUserQuestion card — do NOT render any warning prose above it. ` +
    `The card's \`question\` field is this line VERBATIM (the agreed copy):\n` +
    `"⚠️ Hey — that last turn used ${magnitude}. That's a big single bite out of your rate-limit ` +
    `window — not a bill, but a throttle (lost access until it resets) if it runs out. Want to keep ` +
    `going, or pause and see where the tokens went?"\n` +
    `Header chip: "Window spike". TWO options, primary first. Option 1 — label "Keep going". Option 2 ` +
    `— label "Unpack it — where did the tokens go?". BOTH options are bare labels with NO description ` +
    `— the labels say it all, do NOT add subtext to either. NEVER narrate any internal mechanism (no ` +
    `state file, meter cache, or budget wiring — that is pure noise to the user; the window % above IS ` +
    `the trigger and stays). On the Option 1 pick, dismiss the card and answer the user's original ` +
    `prompt normally, as if it had never appeared. On the Option 2 pick, run \`${analyze}\` to show the ` +
    `forensic spend digest, then STOP and wait — do NOT answer the original prompt yet (the user is ` +
    `reviewing first). NEVER run \`/analyze-session\` yourself before the user picks Option 2.`
  );
}

function windowThresholdNote(tv, cfg) {
  const reset = tv.resetsAt ? `, resets ${fmtReset(tv.resetsAt)}` : '';
  // Below the top rung: a quiet bearing, deliberately ⚠️-free so the top rung's alarm keeps its
  // punch (wallpaper-proofing). Top rung: the checkpoint styling.
  const quiet = typeof tv.topRung === 'number' && tv.rung < tv.topRung;
  const line = quiet
    ? `"FYI: your ${tv.name} is at ~${tv.pct}% used${reset}."`
    : `"⚠️ Hey — heads up: your ${tv.name} is at ~${tv.pct}% used${reset}."`;
  return (
    `window-threshold: the user's ${tv.name} is at ~${tv.pct}% used${reset} — past the ` +
    `${tv.rung}% ${quiet ? 'rung (informational bearing)' : 'checkpoint'}. The stake is a throttle ` +
    `(losing access until the window resets), not a bill — never quote a $ figure. Answer the ` +
    `prompt normally, then close the response with a STANDALONE one-line heads-up — a horizontal ` +
    `rule, then exactly: ` + line + ` ` +
    `ONE sentence, nothing appended after it — it's a checkpoint, not an emergency.`
  );
}

// R12b gate reason — USER-facing text (Claude never sees it, so no relay instructions) with the
// ↑+Enter escape hatch verbatim like idleGate's block. Tightened 2026-07-18: state + escape hatch
// only — the throttle explainer and the wrap-up coaching were deliberately cut. No $.
function windowThresholdGateReason(tv) {
  const reset = tv.resetsAt ? `, resets ${fmtReset(tv.resetsAt)}` : '';
  return (
    `⚠️ Hey — your ${tv.name} is at ~${tv.pct}% used${reset}.\n\n` +
    `To continue anyway: press ↑ then Enter.`
  );
}

const fmtUSD = v => `$${v.toFixed(2)}`;
const fmtK = v => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`;
// total tokens PROCESSED (in + out + cache read/write) — the unit user-facing check-ins lead
// with. Deliberately unweighted; the dollar figure beside it carries the per-model weighting.
const tokOne = v => v.inp + v.out + v.cr + v.cw;
const tokensOf = pm => Object.values(pm).reduce((a, v) => a + tokOne(v), 0);
const sessionTokens = m => tokensOf(m.main.perModel) + tokensOf(m.agents.perModel);
const shortModel = k => k.split('-')[1] || k;
function mergedPerModel(m) {
  const out = {};
  for (const pm of [m.main.perModel, m.agents.perModel]) {
    for (const [k, v] of Object.entries(pm)) {
      const t = out[k] || (out[k] = { inp: 0, out: 0, cr: 0, cw: 0, searches: 0, usd: 0 });
      for (const f of Object.keys(t)) t[f] += v[f] || 0;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// event handlers
async function onUserPromptSubmit(data, projectDir) {
  const cfg = loadConfig(projectDir);
  const sid = data.session_id || '';
  const st = loadState(projectDir, sid);

  // R8 door 3 — user-typed slash command whose payload is bomb-sized. UserPromptSubmit has no
  // "ask", and an annotation would ship in the same request as the payload — so the preventive
  // form is a block, idleGate-style: ↑ then Enter re-sends, and the one-shot key lets that
  // second send pass. Block reason is USER-facing (Claude never sees it). Default OFF.
  const cmd = /^\/([\w:-]+)/.exec(String(data.prompt || '').trim());
  if (cfg.commandPayloadGate && cmd) {
    if (st.payloadGateOkOnce === cmd[1]) {
      st.payloadGateOkOnce = null; // charge accepted
      saveState(projectDir, sid, st);
    } else {
      const tok = commandPayloadTokens(projectDir, cmd[1]);
      if (tok != null && tok > cfg.bombJumpTokens) {
        st.payloadGateOkOnce = cmd[1];
        // ttl 2: the payload lands only on the re-send's request, so the first post-block
        // prompt legitimately sees no jump — don't let it disarm the R3 suppression early.
        st.approvedPayloadHop = { est: tok, ttl: 2 };
        saveState(projectDir, sid, st);
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason:
            `⚠️ Hey — running /${cmd[1]} will load ~${fmtK(tok)} tokens into this conversation ` +
            `permanently; every message after it will re-read them.\n\n` +
            `To run it anyway: press ↑ then Enter. To keep this session lean: run it in a ` +
            `throwaway session instead, or ask here for just its conclusion via a subagent.`,
        }));
        return;
      }
    }
  }

  // R9 — new turn, new accumulator (persisted by whichever branch saves state below).
  st.turnPayloadTok = 0; st.turnPayloadWarned = false; st.miniBombGateArmed = false;

  const m = meterSession(data.transcript_path, { fleet: cfg.fleetMeter, projectDir });
  if (!m.main.turns) return; // brand-new session — nothing to say
  const notes = [];
  const usd$ = wantDollars(cfg); // false => tokens-only copy (subscription users)

  // R2 receipt — a fleet finished since the last prompt; show the bill once.
  if (st.pendingWfReceipt) {
    notes.push(st.pendingWfReceipt);
    st.pendingWfReceipt = null;
  }

  // R3 context-bomb tripwire — single-hop jump beyond bombJumpTokens since the last prompt.
  // Priced by the turns that will re-read it, not the hop itself.
  if (st.lastLiveContext != null) {
    const jump = m.liveContext - st.lastLiveContext;
    if (jump > cfg.bombJumpTokens && st.approvedPayloadHop) {
      // R8: the user already decided this payload at the pre-gate — one decision, one surface.
      // (Known hole, accepted: an unrelated bomb inside the ttl window rides the suppression.)
      // The landing upgrades the budgets table: measured jump replaces door 1's stat floor.
      if (st.approvedPayloadHop.skill) {
        recordObservedSkill(projectDir, st.approvedPayloadHop.skill, jump, null, cfg);
      }
      st.approvedPayloadHop = null;
    } else if (jump > cfg.bombJumpTokens) {
      const who = attributeJump(data.transcript_path, st.scanOffset);
      const culprit = who ? ` (largest payload: ${who.label}, ~${fmtK(who.chars)} chars)` : '';
      // Attribution named a skill -> record the measured landing so door 1 can gate it next
      // time (built-ins never hit the pre-gate: no files to stat until a landing prices them).
      const skillHit = who && /^Skill\((.+)\)$/.exec(who.label);
      if (skillHit) recordObservedSkill(projectDir, skillHit[1], jump, who.chars, cfg);
      const bombCost = usd$
        ? `so the per-turn floor is now ≥ ${fmtUSD(m.turnFloorUSD)} (50 more turns ≈ ` +
          `${fmtUSD(m.turnFloorUSD * 50)})`
        : `adding ~${fmtK(jump)} tokens to every future turn (50 more turns ≈ ` +
          `${fmtK(jump * 50)} tokens of the plan window)`;
      notes.push(
        `context-bomb: something just loaded +${fmtK(jump)} tokens into this conversation` +
        `${culprit} — every turn from here on re-reads it, ${bombCost}. Relay as ` +
        `a STANDALONE warning block, never woven into your answer: open with "⚠️ Hey —" and ` +
        `keep a warm conversational voice (helpful friend, not system log), 2-3 plain sentences ` +
        `naming what landed and the out (a one-time reference belongs in a disposable subagent; ` +
        `once its useful part is extracted, run /eval-new-session — it judges whether a fresh ` +
        `session pays and preps the structured move), then a horizontal rule before the answer ` +
        `itself.`
      );
      if (cfg.bombGateWhenFat && m.liveContext >= cfg.contextWarnTokens) st.bombGateArmed = true;
    } else if (st.approvedPayloadHop && --st.approvedPayloadHop.ttl <= 0) {
      st.approvedPayloadHop = null; // R8 gate fired but nothing landed (denied) — disarm
    }
  }
  st.lastLiveContext = m.liveContext;
  st.scanOffset = m.main.rawLength;

  // R4 idle-return — cache TTL ≈ 1h; a fat stale context re-WRITES at full write rates.
  // One-shot per gap (keyed on the timestamp we returned to). Thin contexts refill for pennies.
  if (m.lastTs && m.liveContext >= cfg.contextWarnTokens) {
    const gapMin = (Date.now() - m.lastTs) / 60000;
    if (gapMin > cfg.idleWarnMinutes && st.warnedIdleAt !== m.lastTs) {
      st.warnedIdleAt = m.lastTs;
      // Copy-paste recovery arg: walk back until ~15min of real interaction is covered (gaps
      // count at most 5min so idle stretches don't eat the budget), then round the wall-clock
      // offset up to the nearest 5min. --session pins recovery to THIS session's transcript.
      const ts = m.main.tsList || [];
      let i = ts.length - 1;
      for (let acc = 0; i > 0 && acc < 15 * 60000; i--) acc += Math.min(ts[i] - ts[i - 1], 5 * 60000);
      const recoverMin = Math.max(5, Math.ceil((Date.now() - (ts[i] || m.lastTs)) / 300000) * 5);
      const recoverCmd = `/recover-context -${recoverMin}${sid ? ` --session ${sid.slice(0, 8)}` : ''}`;
      const hasCcr = writeRecoverPointer(projectDir, sid, recoverCmd);
      const ccrPart = hasCcr ? `exit and type "ccr" — or ` : '';
      // idleGate: pre-empt the charge — block THIS submission before anything reaches the API.
      // The message stays in the CLI input history (up-arrow + Enter re-sends), and the
      // one-shot key set above lets that second send pass through silently: charge accepted.
      // Block reason is USER-facing text (Claude never sees it), so it follows the warning
      // copy rules directly — future tense, since nothing has been paid yet.
      if (cfg.idleGate) {
        saveState(projectDir, sid, st);
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason:
            `⚠️ Hey — you left this session sitting for over an hour, longer than the API ` +
            `keeps a conversation cached. If you continue here, Claude Code will re-upload ` +
            `all ~${fmtK(m.liveContext)} tokens of it at full price.\n\n` +
            `To continue anyway: press ↑ then Enter. To pick this work up cheaply instead: ` +
            `${ccrPart}start a new session and run "${recoverCmd}" — reloads the last ` +
            `~15 minutes of this conversation.`,
        }));
        return;
      }
      notes.push(
        `idle-return: this session sat untouched for over an hour, longer than the API keeps a ` +
        `conversation cached. Claude Code just re-uploaded all ~${fmtK(m.liveContext)} tokens ` +
        `of it at full price, ~20x what the same turn costs while cached. Relay this as a ` +
        `STANDALONE warning block, never woven into your answer: open with "⚠️ Hey —" and keep ` +
        `a warm conversational voice (helpful friend, not system log). Sentence 1 names the ` +
        `trigger and ENDS on the word "cached" — say "over an hour", never the exact duration ` +
        `(that's TMI). Sentence 2, short and separate: Claude Code (by name — the behavior is ` +
        `Claude Code's, not this guard's/CCA's) re-uploaded it all, ending on the ~20x ` +
        `comparison — NEVER a dollar figure (subscription users would read it as a real ` +
        `charge). Then, on its own line, the out: to continue THIS work cheaply, ` +
        `${hasCcr ? 'exit and type "ccr", or ' : ''}start a new session and run ` +
        `"${recoverCmd}" (reloads the last ~15min of this conversation). Then ` +
        `a horizontal rule before the answer itself.`
      );
    }
  }

  // Fat-context advisory — the core "1 question in a 5h window" guard. Injected on EVERY prompt
  // past the threshold (it's ~50 tokens; the decision is per-prompt by nature).
  if (m.liveContext >= cfg.contextWarnTokens) {
    const floorPart = usd$
      ? `has a ≥ ${fmtUSD(m.turnFloorUSD)} re-read floor before any work happens`
      : `re-reads all ~${fmtK(m.liveContext)} tokens of it against the plan window before any ` +
        `work happens`;
    notes.push(
      `live context ≈ ${fmtK(m.liveContext)} tokens — every turn in this session now ` +
      `${floorPart}. If the user's prompt is a quick one-off unrelated to the ongoing work, ` +
      `answer it, but ALSO tell them it would be much ${usd$ ? 'cheaper' : 'lighter on their ' +
      'usage window'} asked in a fresh session (this context is re-sent on every turn).`
    );
  }

  // R6 scope-drift nudge — when the dominant share of live context belongs to scopes the
  // session has moved past, every turn pays rent on settled work. Scope data comes from the
  // terminal-title per-title ledger ({sid}.history.jsonl) — the same watermarks its /clear
  // advisor reads — so drift and advisor can never disagree about what a topic cost. The nudge
  // fires ONLY above driftMinContextTokens (= /eval-new-session's own STAY floor), so at fire
  // time the cut is a foregone conclusion by construction — hand the user a paste-ready
  // /migrate-new-session {slug(scope)} as the ONE-step out (the keyword is the current scope;
  // migrate self-packages from the ledger boundary, no prep). /eval stays the escape hatch for
  // the dependency case drift can't see (a build->article day reads as two scopes, but the
  // article feeds on the build context). Model relays the block; it NEVER runs either command.
  // Once per scope (nudgedScope).
  if (cfg.driftNudge) {
    const tenures = readLedgerTenures(projectDir, sid);
    const cur = tenures[tenures.length - 1];
    if (cur) {
      // Prompt residency is the one thing the ledger can't carry — counted here in state. The
      // ledger gains the new-scope line at the shift turn's first paint after the title write,
      // so this counter starts on the guard's next prompt — the same "first seen on turn 2"
      // beat the old scopeLog had.
      if (st.curScope === cur.scope) {
        st.curScopePrompts = (st.curScopePrompts || 0) + 1;
      } else {
        st.curScope = cur.scope; st.curScopePrompts = 1;
        if (tenures.length > 1) logLine(projectDir,
          `sid=${sid.slice(0, 8)} scope="${cur.scope}" ctx=${fmtK(m.liveContext)}`);
      }
      cur.prompts = st.curScopePrompts;
      // Defer loop: consume a model-written drift-deferred flag (the in-turn judge refused the
      // staged card — stale premise or open threads), snooze, and re-arm the one-shot when the
      // snooze expires; driftVerdict then re-stages and the model re-judges with a fresh premise.
      const deferred = consumeDriftDeferred(projectDir);
      driftDeferralTick(st, deferred, cfg.driftRetryPrompts);
      if (deferred && st.driftSnooze) logLine(projectDir,
        `sid=${sid.slice(0, 8)} drift-deferred scope="${st.driftSnooze.scope}" retry@${st.driftSnooze.retryAtPrompts}p`);
      const v = driftVerdict(tenures, m.liveContext, cfg);
      if (v.fire && st.nudgedScope !== cur.scope) {
        st.nudgedScope = cur.scope;
        st.driftSnooze = null;
        logLine(projectDir,
          `sid=${sid.slice(0, 8)} drift-nudge from="${v.dominant}" to="${cur.scope}" prior=${v.priorPct}%`);
        notes.push(driftNote(v.dominant, cur.scope, v.priorPct, cfg.driftAutoMigrate, m.liveContext));
        // R11: stage the consent candidate so a later "arm it" + /clear can self-migrate. The
        // current tenure's enteredIso (its first ledger line) is the exact recovery boundary; the
        // marker PINS (sid, boundary) so the SessionStart consumer never has to re-resolve. No
        // commitment until the model writes .armed.
        if (cfg.driftAutoMigrate) writeMigrateCandidate(projectDir, sid, cur.scope, cur.enteredIso);
      }
    }
  }

  // Spend-step check-ins are API-billed-only (2026-07-18): on a subscription the $-equivalent
  // steps map to nothing the user experiences — the R12 window flags below carry the plan-meter
  // story there. Unknown billing keeps the check-ins (the dollars may be real).
  const crossed = billingKind() === 'subscription' ? []
    : (cfg.sessionWarnUSD || []).filter(s => m.usd >= s && st.warnedUSD < s);

  // Anthropic's own window meter — fetched at most ONCE per prompt (cached >=180s, so most prompts
  // are cache-served; the network hit is only every few minutes). Shared by the two window flags
  // below AND the spend-step check-in, so the fetch never happens twice in a turn.
  let official = null;
  if (cfg.officialUsageFetch &&
      (cfg.windowSpikeWarn || cfg.windowThresholdWarn || cfg.windowThresholdGate || crossed.length)) {
    const off = await fetchOfficialUsage(projectDir);
    if (off && off.data) official = off.data;
  }

  // R12 — window guards, both grounded in that meter. The stake here is a THROTTLE (lost access
  // until reset), which is unsayable in dollars, so the copy is always window-% and never $.
  //   R12a window-spike: one turn ate a big slice of the 5h window (the delta of the meter's own
  //     %, so it self-calibrates — no budget to set).
  //   R12b window-threshold: the tightest live window (5h or weekly) crossed the high-water mark
  //     — once per window cycle; re-arms when that window resets. windowThresholdGate (opt-in)
  //     escalates that same one-shot from a note to a BLOCK (mirrors idleGate).
  if (cfg.windowSpikeWarn || cfg.windowThresholdWarn || cfg.windowThresholdGate) {
    const now5h = fiveHourWindow(official);
    if (cfg.windowSpikeWarn) {
      const prev = st.lastWindowPct != null
        ? { pct: st.lastWindowPct, resetsAt: st.lastWindowResetsAt } : null;
      const sv = windowSpikeVerdict(now5h, prev, st.lastTurnDeltaUsd || 0, cfg);
      // windowSpikeConfirm upgrades the passive note to an interactive AskUserQuestion card — a SOFT
      // relay, never a decision:'block', so it can't stall the turn. Off -> the standalone note.
      if (sv.fire) {
        notes.push(cfg.windowSpikeConfirm ? windowSpikeConfirmNote(sv, now5h, sid) : windowSpikeNote(sv, now5h));
      }
      // advance the baseline whenever the meter is live (fired or not) so the next delta is fresh
      if (now5h) { st.lastWindowPct = now5h.pct; st.lastWindowResetsAt = now5h.resetsAt; }
    }
    if (cfg.windowThresholdWarn || cfg.windowThresholdGate) {
      const tv = windowThresholdVerdict(tightestWindow(official), st.warnedWindow, cfg);
      if (tv.fire) {
        st.warnedWindow = { name: tv.name, resetsAt: tv.resetsAt, rung: tv.rung };
        // Gate: pre-empt the turn before anything reaches the API — TOP rung only (lower rungs
        // are FYI bearings and never block). The one-shot key set above lets the ↑+Enter re-send
        // pass through silently next time (charge accepted). Note is the fallback.
        if (cfg.windowThresholdGate && tv.rung === tv.topRung) {
          saveState(projectDir, sid, st);
          process.stdout.write(JSON.stringify({ decision: 'block', reason: windowThresholdGateReason(tv) }));
          return;
        }
        if (cfg.windowThresholdWarn) notes.push(windowThresholdNote(tv, cfg));
      }
    }
  }

  // Session-spend steps — announce once per crossed step. v2: total includes fleets.
  // The trigger stays dollar-weighted (cross-model normalization); the MESSAGE leads with
  // tokens, one metric per line. The 5h scan is fresh-parse (no cache) — acceptable only
  // because step crossings are rare by design.
  if (crossed.length) {
    st.warnedUSD = Math.max(...crossed);
    const split = m.agents.files
      ? ` = main ${fmtK(tokensOf(m.main.perModel))} + ${m.agents.files} agents ` +
        `${fmtK(tokensOf(m.agents.perModel))}` : '';
    // Anthropic's own percentages lead when reachable — the definitive measures; everything
    // after is supporting detail (Andrew 2026-07-12).
    const statLines = [];
    let haveOfficial = false;
    if (official) {
      const ol = officialLines(official);
      if (ol.length) { statLines.push(...ol); haveOfficial = true; }
    }
    statLines.push(
      `This session: ${fmtK(sessionTokens(m))} tokens${split}` +
        (usd$ ? ` (≈ ${fmtUSD(m.usd)} API-list)` : ''),
    );
    // Conditional qualifiers — only when they change the reading, so the block stays scannable.
    const pm = mergedPerModel(m);
    const tot = tokensOf(pm);
    const cr = Object.values(pm).reduce((a, v) => a + v.cr, 0);
    if (tot && cr / tot > 0.7) {
      // raw total dominated by cache re-reads reads scarier than it is (re-reads are
      // discounted against plan limits and billed at a tenth on API)
      statLines.push(`  ↳ ${fmtK(cr)} of those are cached re-reads (weigh far less against ` +
        `your plan) · fresh work ${fmtK(tot - cr)}`);
    }
    const byModel = Object.entries(pm)
      .map(([k, v]) => ({ name: shortModel(k), tok: tokOne(v) }))
      .filter(x => tot && x.tok / tot >= 0.05)
      .sort((a, b) => b.tok - a.tok);
    if (byModel.length > 1) {
      // a Haiku token != a Fable token — flag mixed-model totals
      statLines.push(`  ↳ models: ${byModel.map(x => `${x.name} ${fmtK(x.tok)}`).join(' · ')}`);
    }
    try {
      const win = scanWindow(Date.now() - 5 * 3600 * 1000);
      statLines.push(`Last 5h, all sessions: ${fmtK(win.tokens)} tokens` +
        (usd$ ? ` (≈ ${fmtUSD(win.usd)})` : ''));
      if (!haveOfficial && cfg.windowBudgetUSD) {
        // Estimate fallback only when the official meter is unreachable. % uses the WEIGHTED
        // figure, not raw tokens — Max metering discounts cache reads and weights by model,
        // so the $-equivalent is the mix-robust proxy. "≈" + label: it's calibrated, not measured.
        statLines.push(`Plan target: ≈${Math.round((win.usd / cfg.windowBudgetUSD) * 100)}% ` +
          `of your 5h budget used (estimate — official meter unreachable)`);
      }
    } catch (_) { /* window scan is best-effort — the session line still ships */ }
    if (cfg.planDetect) {
      const pl = planLine(planInfo());
      if (pl) statLines.push(pl);
    }
    notes.push(
      `token check-in: relay to the user in your next reply as a STANDALONE stat block — ` +
      `one metric per line exactly as given (labels, numbers, and indentation verbatim), ` +
      `no drama, no commentary between the lines:\n${statLines.join('\n')}`
    );
  }

  saveState(projectDir, sid, st);
  if (notes.length) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `<token-guard>${notes.join(' | ')}</token-guard>`,
      },
    }));
  }
}

// The visible receipt, printed straight to the user via the `systemMessage` channel on /clear.
// User-chosen copy: names the pinned scope — the bare "most recent context" read as the whole
// session, the opposite of what migrate keeps. No numbers. Pure + exported so a test can pin it.
function migrateReceipt(scope) {
  return `Your "${scope}" context from last session has been preserved.`;
}

// R11 consumer — on a /clear (or fresh tab) that carries an ARMED consent marker, do the migration in
// the hook itself: recover the pinned tail and inject it + a synthesize-handoff directive as
// additionalContext, then consume the one-shot marker. Never throws; any miss emits nothing so a fresh
// session stays clean. The marker pins (sid, boundaryIso), so this is robust to /clear rotating the id.
function onSessionStart(data, projectDir) {
  const cfg = loadConfig(projectDir);
  if (!cfg.driftAutoMigrate) return;
  const cand = resolveMarker(projectDir, data.source || '', cfg);
  if (!cand) return;
  const r = resolveTranscript(cand.sid);
  if (!r || !r.fp) { clearMarker(projectDir); return; } // old transcript gone -> nothing to recover
  const tail = recoverTail(r.fp, cand.boundaryIso, cfg.driftMigrateMaxInjectTokens);
  clearMarker(projectDir); // one-shot: consume regardless so a re-clear can't double-inject
  if (!tail.messages) return;
  const kw = cand.keyword || slug(cand.scope || '');
  const sid8 = String(cand.sid).slice(0, 8);
  logLine(projectDir,
    `sid=${sid8} auto-migrate kw="${kw}" msgs=${tail.messages} tok=${fmtK(tail.tokens)}` +
    `${tail.truncated ? ' (trunc)' : ''}`);
  const receipt = migrateReceipt(cand.scope);
  const directive =
    `<token-guard-automigrate>\n` +
    `You just ran /clear to migrate the "${cand.scope}" thread into this fresh context ` +
    `(keyword "${kw}", from session ${sid8}${tail.truncated ? '; tail truncated to the most-recent slice' : ''}). ` +
    `The recovered conversation tail is below — TREAT IT AS YOUR OWN MEMORY of what you were doing, not ` +
    `as a document to summarize. From it, silently reconstruct: the active task + current state, ` +
    `decisions not yet written to repo docs, files touched (cross-check \`git status --short\` — ` +
    `deterministic), any temp-state gotchas, and the next actions. The user has ALREADY seen a ` +
    `standalone system-message receipt ("${receipt}") — do NOT restate it. Open your reply with ` +
    `a SINGLE line naming the top next action and nothing above it, in a warm plain voice, e.g.:\n` +
    `"Next up: {top next-action}." ` +
    `Then WAIT for the user to direct you — do not start work unprompted.\n` +
    `--- RECOVERED TAIL (${tail.messages} messages, oldest first) ---\n${tail.text}\n` +
    `</token-guard-automigrate>`;
  process.stdout.write(JSON.stringify({
    systemMessage: receipt,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: directive },
  }));
}

function onStop(data, projectDir) {
  const cfg = loadConfig(projectDir);
  const sid = data.session_id || '';
  const m = meterSession(data.transcript_path, { fleet: cfg.fleetMeter, projectDir });
  if (!m.main.turns) return;
  const st = loadState(projectDir, sid);
  const delta = m.usd - (st.lastUSD || 0);
  st.lastUSD = m.usd;
  // Stash the turn's weighted spend so R12a's spike flag has a denominator when the live window
  // meter is unreachable (its only fallback path; the primary path uses the meter's own % delta).
  st.lastTurnDeltaUsd = Math.max(0, delta);

  // R2: workflow growth -> usage-log receipt + queue a one-line receipt for the next prompt +
  // update the project-level history the launch confirm quotes.
  for (const [wfId, g] of Object.entries(m.agents.perWorkflow)) {
    if (wfId === 'ad-hoc') continue;
    const known = (st.knownWf && st.knownWf[wfId]) || 0;
    if (g.usd > known + 0.5) {
      st.knownWf[wfId] = g.usd;
      logLine(projectDir, `wf=${wfId} agents=${g.agents} usd=${fmtUSD(g.usd)} tok=${fmtK(g.tok)}`);
      const amount = wantDollars(cfg) ? fmtUSD(g.usd) : `${fmtK(g.tok)} tokens`;
      st.pendingWfReceipt =
        `workflow ${wfId} receipt: ${g.agents} agents, ${amount} — spent outside the ` +
        `visible transcript; already included in the session totals below.`;
      saveWfHistory(projectDir, { usd: g.usd, tok: g.tok, agents: g.agents, at: new Date().toISOString() });
    }
  }

  saveState(projectDir, sid, st);
  const models = Object.entries(m.main.perModel)
    .map(([k, v]) => `${(k.split('-')[1] || k)}:${fmtUSD(v.usd)}`).join(' ');
  const agentsPart = m.agents.files
    ? ` agents=${fmtUSD(m.agents.usd)}/${m.agents.files}f` : '';
  logLine(projectDir,
    `sid=${sid.slice(0, 8)} turn=+${fmtUSD(Math.max(0, delta))} session=${fmtUSD(m.usd)} ` +
    `tok=${fmtK(sessionTokens(m))}${agentsPart} ctx=${fmtK(m.liveContext)} ` +
    `floor=${fmtUSD(m.turnFloorUSD)}/turn turns=${m.turns} ${models}`);
}

function onPreToolUse(data, projectDir) {
  const cfg = loadConfig(projectDir);
  const sid = data.session_id || '';

  // R2 — Workflow launch confirm. Fires on launch, not on spend; independent of hardGateUSD.
  // No metering here (PreToolUse runs on every tool call — keep the common path instant).
  if ((cfg.workflowConfirm || cfg.workflowFanGuard) && data.tool_name === 'Workflow') {
    const fan = cfg.workflowFanGuard ? fanVerdict(workflowSource(data.tool_input), cfg) : null;
    // The fan guard stays silent on small, bounded workflows: if nothing tripped it AND the
    // fire-on-every-launch confirm (R2) is off, spend no ask here.
    if (!fan && !cfg.workflowConfirm) return;
    const h = loadWfHistory(projectDir);
    const usd$ = wantDollars(cfg);
    const estimate = h
      ? (usd$ || !h.tok
          ? `last workflow in this project cost ${fmtUSD(h.usd)} across ${h.agents} agents`
          : `last workflow in this project ran ${fmtK(h.tok)} tokens across ${h.agents} agents`)
      : (usd$
          ? `rule of thumb ≈ ${fmtUSD(USD_PER_AGENT_RULE_OF_THUMB)}/agent in fresh-context ` +
            `writes (a 45-agent research fleet ≈ $20)`
          : `rule of thumb ≈ 25k fresh tokens/agent (a 45-agent research fleet can draw 1M+ ` +
            `from the usage window)`);
    if (fan) {
      // Two tiers. A concrete fan at/over the hard cap is a DENY — the runaway backstop; below
      // that it's an ASK where the fan signal leads (right-size before launch) and the cost
      // estimate rides along as scale. Both fire even when workflowConfirm is off.
      const hardCap = cfg.fanHardCap || DEFAULTS.fanHardCap;
      if (fan.level === 'block') {
        return deny('PreToolUse',
          `token-guard: blocked — this Workflow declares ${fan.signals.join('; ')}, at or over ` +
          `your hard fan cap of ${hardCap} agents. A fan this wide is far more often an ` +
          `over-provisioning bug than real parallel work, and fleets bill outside the visible ` +
          `transcript (${estimate}). Cut the fan, or raise fanHardCap in cca.config.json to allow it.`);
      }
      return ask('PreToolUse',
        `token-guard: this Workflow looks over-fanned for one task — ${fan.signals.join('; ')}` +
        `${fan.estimate ? ` — ${fan.estimate}` : ''}. A narrow question rarely needs more than ` +
        `~${cfg.fanWarnAgents || DEFAULTS.fanWarnAgents} agents, and fleets bill outside the ` +
        `visible transcript (${estimate}). Cut the fan first, or approve to launch as-is.`);
    }
    return ask('PreToolUse',
      `token-guard: Workflow launch — ${estimate}; fleets spend outside the visible transcript. ` +
      `Approve to launch.`);
  }

  const st = loadState(projectDir, sid);

  // R8 — payload pre-gate, doors 1-2. One ask in the moment the rent is still avoidable;
  // R3 only gets to warn about payloads that never came through here.
  if (cfg.payloadGate && (data.tool_name === 'Skill' || data.tool_name === 'Read')) {
    const ti = data.tool_input || {};
    const sizes = data.tool_name === 'Skill'
      ? skillSizes(projectDir, String(ti.skill || ''))
      : readSizes(String(ti.file_path || ''));
    const v = payloadVerdict(data.tool_name, ti, sizes, cfg);
    if (v) {
      // One decision, one surface: mark the hop so R3 doesn't re-warn what the user just
      // decided at this gate. ttl 1 = disarms at the next prompt if nothing landed (denied).
      // Skill hops carry the name so the landing can be recorded as an observed budget row.
      st.approvedPayloadHop = { est: v.estTokens, ttl: 1 };
      if (v.door === 'skill') st.approvedPayloadHop.skill = String(ti.skill || '');
      saveState(projectDir, sid, st);
      return ask('PreToolUse', v.door === 'skill'
        ? `token-guard: loading the ${ti.skill} skill adds ${v.floor ? 'at least ' : ''}` +
          `~${fmtK(v.estTokens)} tokens to this conversation permanently — every later message ` +
          `re-reads them. If you only need an answer from it, a disposable subagent can read ` +
          `it and return just the conclusion. Approve to load it here anyway.`
        : `token-guard: reading ${path.basename(String(ti.file_path || ''))} in full adds ` +
          `~${fmtK(v.estTokens)} tokens to this conversation permanently — every later message ` +
          `re-reads them. A ranged Read (offset/limit) or a disposable subagent keeps it out. ` +
          `Approve to read it in full anyway.`);
    }
  }

  // R9 — one-shot ask armed by the accumulator (miniBombGate only): the turn already piled up
  // bomb-sized tool results; one conscious approve before more work compounds on top.
  if (st.miniBombGateArmed) {
    st.miniBombGateArmed = false;
    saveState(projectDir, sid, st);
    return ask('PreToolUse',
      `token-guard: this turn's tool results have already piled up ~${fmtK(st.turnPayloadTok)} ` +
      `tokens of new context — bomb-sized in aggregate, and every later message re-reads it. ` +
      `Approve to keep going here; a disposable subagent or ranged reads keep the rest out.`);
  }

  // R3 — one-shot post-bomb gate (armed only when bombGateWhenFat and the bomb landed fat).
  if (st.bombGateArmed) {
    st.bombGateArmed = false;
    saveState(projectDir, sid, st);
    return ask('PreToolUse',
      `token-guard: a context bomb just landed at fat context (see warning above) — one-time ` +
      `confirm before more work compounds on top of it. If the payload isn't needed here, ` +
      `/eval-new-session preps a structured move to a fresh session.`);
  }

  // v1 hard gate on total session spend (v2: fleet-aware total). Default off.
  if (cfg.hardGateUSD == null) return;
  const m = meterSession(data.transcript_path, { fleet: cfg.fleetMeter, projectDir });
  const gate = st.gateArmedAt != null ? st.gateArmedAt : cfg.hardGateUSD;
  if (m.usd < gate) return;
  st.gateArmedAt = gate + (cfg.gateStepUSD || DEFAULTS.gateStepUSD); // re-arm one step higher
  saveState(projectDir, sid, st);
  return ask('PreToolUse',
    `token-guard: session estimate ${fmtUSD(m.usd)} ≥ ${fmtUSD(gate)} gate. ` +
    `Approve to continue (next check at ${fmtUSD(st.gateArmedAt)}), or /clear for a fresh session.`);
}

function ask(event, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event,
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  }));
}

// Hard stop — the runaway backstop (R10 fanHardCap). Unlike ask, the launch cannot be waved
// through inline: the reason goes back to the model, which relays it, and the human re-cuts the
// fan or raises the cap. Reserved for a CONCRETE oversized fan, never an estimate.
function deny(event, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event,
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}

// ---------------------------------------------------------------------------
// R9 mini-bomb accumulator — the aggregate complement to R8: no single payload trips a door,
// but a turn's tool results sum past bombJumpTokens anyway (evidence: cf4d557d's +52k landed
// as several sub-50k reads, largest ~23k chars). PostToolUse can't prevent what already ran,
// but a mid-turn note reaches CLAUDE while the turn is still going — the model course-corrects
// (subagents / ranged reads for the rest) without costing the user a prompt. Runs on every
// tool call, so it must stay cheap: no metering, just state + stringify. Once per turn;
// UserPromptSubmit resets. approvedPayloadHop suppresses the whole turn — the user just
// approved a bomb-sized payload at the R8 gate; nagging about its aggregate is double-billing
// the same decision.
//
// Mutating tools are skipped: their hook payload echoes full file bodies (originalFile,
// patches) that the CONVERSATION never carries — the model's Edit/Write result is one
// "updated successfully" line. Counting them inflated R9's very first live fire (2026-07-12:
// ~58k reported, mostly three spec edits' echoes). The settings matcher already excludes
// them here; this guard keeps a matcher-"" install (the CCA default posture) honest too.
const MUTATING_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit|TodoWrite|TaskCreate|TaskUpdate)$/;
// The subagent-spawning tool — "Task" in stock Claude Code, "Agent" in some harnesses. Anchored
// exactly, so it never catches the TaskCreate/TaskUpdate todo tools handled by MUTATING_TOOLS.
const SUBAGENT_TOOLS = /^(Task|Agent)$/;

function onPostToolUse(data, projectDir) {
  const cfg = loadConfig(projectDir);
  if (!cfg.miniBombWarn && !cfg.miniBombGate) return;
  if (MUTATING_TOOLS.test(String(data.tool_name || ''))) return;
  // Subagent tool calls report agent-*.jsonl transcripts — their context dies with the agent
  // and adds nothing to the main conversation's rent.
  if (/^agent-/.test(path.basename(String(data.transcript_path || '')))) return;
  // The PARENT side of a subagent call is the second over-count trap: its tool_response embeds
  // the agent's FULL disposable payload (every internal tool output it ran), yet only a compact
  // summary lands in the parent transcript. The hook can't isolate the carried summary from the
  // raw payload, so ANY sizing over-reports — measured 2026-07-14: ~50k counted vs ~3.5k actually
  // carried (~14x). Subagents exist precisely to keep bulk OUT of the main thread; counting their
  // return against the turn's payload is backwards. Multi-agent cost is fleetMeter/R10's job, not
  // R9's. Skip, same as the agent-internal case above.
  if (SUBAGENT_TOOLS.test(String(data.tool_name || ''))) return;
  const resp = data.tool_response;
  if (resp == null) return;
  let serialized;
  try { serialized = typeof resp === 'string' ? resp : JSON.stringify(resp); } catch (_) { return; }
  // Image reads (e.g. /gls screenshots) arrive as base64 blobs. The model bills them by pixel
  // dimensions, NOT base64 length — so charge a flat per-image estimate (see IMAGE_TOK_EST) and size only
  // the non-base64 remainder as text. Without this, one screenshot reads as ~189k phantom "tokens"
  // and trips the mini-bomb warning. Mirrors the image discount the bomb-detector already applies.
  const nImg = (serialized.match(/"type":"image"/g) || []).length;
  let chars = serialized.length;
  if (nImg) chars = serialized.replace(/"data":"[^"]*"/g, '""').length; // base64 has no '"' to escape
  const tok = Math.round(chars / CHARS_PER_TOKEN) + nImg * IMAGE_TOK_EST;
  if (!tok) return;
  const sid = data.session_id || '';
  const st = loadState(projectDir, sid);
  if (st.approvedPayloadHop) return;
  st.turnPayloadTok = (st.turnPayloadTok || 0) + tok;
  const crossed = st.turnPayloadTok > cfg.bombJumpTokens && !st.turnPayloadWarned;
  if (crossed) {
    st.turnPayloadWarned = true;
    if (cfg.miniBombGate) st.miniBombGateArmed = true;
  }
  saveState(projectDir, sid, st);
  if (crossed && cfg.miniBombWarn) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          `<token-guard>turn-payload: this turn's tool results have piled up ` +
          `~${fmtK(st.turnPayloadTok)} tokens of new context — no single call was bomb-sized, ` +
          `but the aggregate now is, and every later message re-reads it. For any further bulk ` +
          `reading this turn, use a disposable subagent or ranged reads. This is steering, not ` +
          `news: do NOT mention it to the user — there is nothing for them to do with it ` +
          `(actionable outs ride the fat-context advisory and the scope-drift card, which fire ` +
          `when a cut actually pays).</token-guard>`,
      },
    }));
  }
}

// ---------------------------------------------------------------------------
// 5h window ≈ the subscription rate-limit window (approximation: files touched in 5h, entries
// timestamped within 5h). Fleet-aware — a session whose AGENT dir moved recently counts even if
// its main transcript went quiet. Fresh-parses every fresh transcript (no cache): fine for
// --report and the rare spend-step crossing, too slow to run on every prompt. Throws if
// ~/.claude/projects is unreadable — callers catch.
function scanWindow(cutoff) {
  const out = { usd: 0, tokens: 0, rows: [] };
  const projects = path.join(os.homedir(), '.claude', 'projects');
  for (const proj of fs.readdirSync(projects)) {
    const dir = path.join(projects, proj);
    let files; try { files = fs.readdirSync(dir); } catch (_) { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = path.join(dir, f);
      let fresh = false;
      try { fresh = fs.statSync(fp).mtimeMs >= cutoff; } catch (_) { continue; }
      if (!fresh) {
        try { fresh = fs.statSync(fp.replace(/\.jsonl$/i, '')).mtimeMs >= cutoff; } catch (_) { /* no agent dir */ }
      }
      if (!fresh) continue;
      const m = meterSession(fp, { sinceMs: cutoff });
      if (m.usd < 0.005) continue;
      out.usd += m.usd;
      out.tokens += sessionTokens(m);
      out.rows.push({
        label: `${proj.replace(/^C--/, '')}/${f.slice(0, 8)}`, sid: f.slice(0, 8),
        usd: m.usd, tok: sessionTokens(m),
        agentsUsd: m.agents.usd, agentsTok: tokensOf(m.agents.perModel),
      });
    }
  }
  out.rows.sort((a, b) => b.usd - a.usd);
  return out;
}

// ---------------------------------------------------------------------------
// R7 analyzer: one deterministic pass over a session -> the forensic digest
// (RENT / BOMBS / FLEETS / TTL) that /analyze-session interprets. Pure compute, read-only,
// no LLM — the raw transcript must never reach the model (a 40M-token session is exactly the
// thing you can't paste into a conversation to ask "why was this expensive"). Thresholds
// reuse the live guards' keys (bombJumpTokens, idleWarnMinutes, contextWarnTokens): the
// post-mortem has to agree with the warnings it explains.
const CHARS_PER_TOKEN = 2.6; // observed across the July forensics; R5 uses the same constant
// Flat per-image token estimate. The model bills images by PIXEL DIMENSIONS, not bytes: cost is
// ⌈w/28⌉ × ⌈h/28⌉ visual tokens (28px patches), after downscaling over-cap images. The per-image
// cap is tier-dependent — 1568 tok (standard) up to 4784 tok (high-res: Opus 4.8, Sonnet 5,
// Fable 5); a typical screenshot lands ~2–2.5k. Sizing a base64 blob as chars/2.6 instead over-
// counts ~2 orders of magnitude (a ~370KB /gls PNG read as ~189k "tokens", 2026-07-15). One flat
// figure can't match every tier, so this leans to the high-res typical: it won't under-warn on
// standard tier and stays close to real on high-res. (Verified against the vision docs, 2026-07-15.)
const IMAGE_TOK_EST = 2500;

function analyzeSession(transcriptPath, cfg) {
  const m = meterSession(transcriptPath, {});
  const sid = path.basename(transcriptPath).replace(/\.jsonl$/i, '');
  const res = {
    sid, project: path.basename(path.dirname(transcriptPath)).replace(/^C--/, ''),
    startTs: 0, endTs: m.lastTs, requests: 0, models: Object.keys(m.main.perModel),
    totals: {
      tokens: sessionTokens(m), mainTok: tokensOf(m.main.perModel),
      agentsTok: tokensOf(m.agents.perModel), agentFiles: m.agents.files,
      usd: m.usd, mainUsd: m.main.usd, agentsUsd: m.agents.usd, liveContext: m.liveContext,
    },
    rent: null, bombs: [], topPayloads: [], fleets: m.agents.perWorkflow, ttlGaps: [],
    cfgBombJump: cfg.bombJumpTokens, cfgIdleMin: cfg.idleWarnMinutes,
    cfgCtxWarn: cfg.contextWarnTokens,
  };

  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch (_) { return res; }

  // Single ordered pass. Assistant usage lines mark API requests (the ctx trajectory);
  // everything between two of them is the region a bomb's payload landed in — same
  // finger-pointing as attributeJump, but region-bounded so a later monster line can't
  // steal an earlier bomb's blame.
  const toolNames = {};   // tool_use_id -> "Tool(detail)"
  const seen = new Map(); // message.id -> request entry (streamed rewrites: last usage wins)
  let regionBest = null;  // largest context payload since the previous API request
  const payloads = [];    // every candidate, for the top-payloads table

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch (_) { continue; }
    const msg = o && o.message;
    if (o && o.type === 'assistant' && msg) {
      if (Array.isArray(msg.content)) {
        for (const c of msg.content) {
          if (c && c.type === 'tool_use') {
            const detail = (c.input && (c.input.skill || c.input.file_path)) || '';
            toolNames[c.id] = c.name + (detail ? `(${path.basename(String(detail))})` : '');
          }
        }
      }
      if (msg.usage) {
        const u = msg.usage;
        const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) +
          (u.cache_creation_input_tokens || 0);
        const ts = o.timestamp ? Date.parse(o.timestamp) || 0 : 0;
        const id = msg.id || `line-${seen.size}`;
        if (seen.has(id)) {
          const r = seen.get(id); r.ctx = ctx; if (ts) r.ts = ts;
        } else {
          seen.set(id, { ctx, ts, model: msg.model || '', culprit: regionBest });
          regionBest = null;
        }
      }
      continue; // assistant output is priced as output, not context payload
    }
    if (!o || (o.type !== 'user' && !o.isMeta)) continue; // progress/system noise, not payload
    let label = 'message';
    if (o.isMeta) label = 'meta/skill payload';
    if (msg && Array.isArray(msg.content)) {
      const tr = msg.content.find(c => c && c.type === 'tool_result');
      if (tr) label = toolNames[tr.tool_use_id] || 'tool result';
    }
    // base64 image payloads tokenize ~2 orders of magnitude below chars/2.6 — flag them so
    // the render never prints a fake 260k-token estimate for a 1.6k-token screenshot.
    const cand = { chars: line.length, label, isImage: /"type"\s*:\s*"image"/.test(line),
      ts: o.timestamp ? Date.parse(o.timestamp) || 0 : 0 };
    payloads.push(cand);
    if (!regionBest || cand.chars > regionBest.chars) regionBest = cand;
  }

  const reqs = [...seen.values()];
  res.requests = reqs.length;
  if (!reqs.length) return res;
  res.startTs = reqs[0].ts;

  // RENT — every API request re-reads the live context; the sum is the session's rent bill.
  const q = frac => reqs[Math.min(reqs.length - 1, Math.floor(frac * (reqs.length - 1)))].ctx;
  const totalRent = reqs.reduce((a, r) => a + r.ctx, 0);
  res.rent = {
    quartiles: [q(0), q(0.25), q(0.5), q(0.75), q(1)],
    meanCtx: Math.round(totalRent / reqs.length),
    totalRent,
    share: res.totals.tokens ? totalRent / res.totals.tokens : 0,
  };

  // BOMBS — single-hop ctx jumps. Request 0 counts too: a session that OPENS huge (compaction
  // continuation, fat CLAUDE.md) pays that context all session long and deserves the flag.
  let prev = 0;
  for (const r of reqs) {
    const jump = r.ctx - prev;
    if (jump > cfg.bombJumpTokens) {
      res.bombs.push({ jump, ts: r.ts,
        label: r.culprit ? r.culprit.label : (prev === 0 ? 'opening context (first request)' : 'unknown'),
        chars: r.culprit ? r.culprit.chars : 0, isImage: !!(r.culprit && r.culprit.isImage) });
    }
    prev = r.ctx;
  }

  // TTL — gaps longer than the cache TTL while the context was fat: the return re-uploads
  // everything at full write price (~20x a cached turn).
  for (let i = 1; i < reqs.length; i++) {
    if (!reqs[i].ts || !reqs[i - 1].ts) continue;
    const gapMin = (reqs[i].ts - reqs[i - 1].ts) / 60000;
    if (gapMin > cfg.idleWarnMinutes && reqs[i - 1].ctx >= cfg.contextWarnTokens) {
      res.ttlGaps.push({ gapMin: Math.round(gapMin), endTs: reqs[i].ts, ctx: reqs[i - 1].ctx,
        rewriteUSD: (reqs[i - 1].ctx * priceFor(reqs[i].model).inp * 2) / 1e6 });
    }
  }

  res.topPayloads = payloads.filter(p => p.chars >= 10000)
    .sort((a, b) => b.chars - a.chars).slice(0, 10);
  return res;
}

const fmtWhen = ts => ts
  ? new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  : '?';
const fmtDur = ms => {
  const min = Math.round(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}m` : `${min}m`;
};
const estTok = chars => Math.round(chars / CHARS_PER_TOKEN);

// The digest's wording is a machine interface, not just display text: /analyze-session
// (analyze-session.md) interprets ONLY this output and keys on the literal phrase
// "live context at end" and the RENT / BOMBS / FLEETS / TTL section headers.
function renderAnalysis(a, usd$) {
  const lines = [];
  const t = a.totals;
  lines.push(`SESSION ${a.sid.slice(0, 8)} · ${a.project}`);
  lines.push(`  ${fmtWhen(a.startTs)} → ${fmtWhen(a.endTs)} · ${fmtDur(a.endTs - a.startTs)} wall · ` +
    `${a.requests} API requests · models: ${a.models.map(shortModel).join(', ') || '?'}`);
  lines.push('', 'TOTALS');
  lines.push(`  ${fmtK(t.tokens)} tokens processed` +
    (t.agentFiles ? ` = main ${fmtK(t.mainTok)} + agents ${fmtK(t.agentsTok)} (${t.agentFiles} transcripts)` : '') +
    (usd$ ? ` · ≈ ${fmtUSD(t.usd)} API-list` : ''));
  lines.push(`  live context at end: ${fmtK(t.liveContext)} tokens`);

  if (a.rent) {
    lines.push('', 'RENT  (context re-read by every API request — the per-turn floor)');
    lines.push(`  trajectory ${a.rent.quartiles.map(fmtK).join(' → ')} tokens (session quartiles)`);
    lines.push(`  mean ${fmtK(a.rent.meanCtx)}/request · total re-read ${fmtK(a.rent.totalRent)} ` +
      `tokens = ${Math.round(a.rent.share * 100)}% of everything processed`);
  }

  lines.push('', `BOMBS  (single-hop context jumps > ${fmtK(a.cfgBombJump)} tokens)`);
  if (a.bombs.length) {
    for (const b of a.bombs) {
      lines.push(`  +${fmtK(b.jump)} — ${b.label}` +
        (b.chars ? ` (~${fmtK(b.chars)} chars${b.isImage ? ', image' : ` ≈ ${fmtK(estTok(b.chars))} tok`})` : '') +
        ` — ${fmtWhen(b.ts)}`);
    }
  } else lines.push('  none');
  if (a.topPayloads.length) {
    lines.push('  largest single payloads:');
    for (const p of a.topPayloads.slice(0, 5)) {
      lines.push(`    ${fmtK(p.chars)} chars ${p.isImage ? '(image — tokenizes far smaller)' :
        `≈ ${fmtK(estTok(p.chars))} tok`} — ${p.label} — ${fmtWhen(p.ts)}`);
    }
  }

  lines.push('', 'FLEETS  (agents billed outside the main transcript)');
  const wfs = Object.entries(a.fleets || {});
  if (wfs.length) {
    for (const [wfId, g] of wfs) {
      lines.push(`  ${wfId === 'ad-hoc' ? 'ad-hoc' : `workflow ${wfId}`}: ` +
        `${g.agents} agent${g.agents === 1 ? '' : 's'} · ` +
        (usd$ ? `${fmtK(g.tok)} tok ≈ ${fmtUSD(g.usd)}` : `${fmtK(g.tok)} tok`));
    }
  } else lines.push('  none — no agent transcripts');

  lines.push('', `TTL  (idle > ${a.cfgIdleMin}min at context ≥ ${fmtK(a.cfgCtxWarn)} — the return ` +
    `re-uploads everything, ~20x a cached turn)`);
  if (a.ttlGaps.length) {
    for (const g of a.ttlGaps) {
      lines.push(`  ${fmtDur(g.gapMin * 60000)} gap ending ${fmtWhen(g.endTs)} at ${fmtK(g.ctx)} ctx → ` +
        `re-write ≈ ${fmtK(g.ctx)} tok${usd$ ? ` (≈ ${fmtUSD(g.rewriteUSD)})` : ''}`);
    }
  } else lines.push('  none');
  return lines;
}

// --analyze <sid-prefix|path>: resolve a sid8 (the LAST 5 HOURS row labels) to its transcript.
function resolveTranscript(arg) {
  if (!arg) return { err: 'usage: token-guard.js --analyze <sid-prefix | transcript.jsonl>' };
  if (arg.endsWith('.jsonl') && fs.existsSync(arg)) return { fp: arg };
  const projects = path.join(os.homedir(), '.claude', 'projects');
  const hits = [];
  let dirs; try { dirs = fs.readdirSync(projects); } catch (_) { return { err: 'cannot read ~/.claude/projects' }; }
  for (const proj of dirs) {
    let files; try { files = fs.readdirSync(path.join(projects, proj)); } catch (_) { continue; }
    for (const f of files) {
      if (f.endsWith('.jsonl') && f.startsWith(arg)) {
        hits.push({ fp: path.join(projects, proj, f), label: `${proj.replace(/^C--/, '')}/${f.slice(0, 8)}` });
      }
    }
  }
  if (!hits.length) return { err: `no transcript matches "${arg}" under ~/.claude/projects` };
  if (hits.length > 1) return { err: `ambiguous "${arg}" — matches: ${hits.map(h => h.label).join(' · ')}` };
  return { fp: hits[0].fp };
}

// R11: JS port of recover-context's extraction (Steps 3-4). One transcript JSONL -> the user/assistant
// text at/after cutoffIso, as a compact labeled transcript. tool_result user rows are echoes, not
// conversation, and are skipped. Over maxTokens (chars/4 proxy) it keeps the MOST-RECENT messages (the
// boundary of the thread that matters) and flags truncated. Exported for fixtures + the migrate command.
function recoverTail(transcriptPath, cutoffIso, maxTokens) {
  const empty = { messages: 0, tokens: 0, truncated: false, text: '' };
  const cutoff = Date.parse(cutoffIso) || 0;
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch (_) { return empty; }
  const rows = [];
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    let o; try { o = JSON.parse(s); } catch (_) { continue; }
    const t = o.type;
    if (t !== 'user' && t !== 'assistant') continue;
    const ts = o.timestamp;
    if (!ts || (Date.parse(ts) || 0) < cutoff) continue;
    const c = (o.message || {}).content;
    let text = '';
    if (t === 'user') {
      if (typeof c === 'string') text = c;
      else if (Array.isArray(c)) {
        if (c.some(x => x && x.type === 'tool_result')) continue;
        text = c.filter(x => x && x.type === 'text').map(x => x.text || '').join(' ');
      }
    } else if (Array.isArray(c)) {
      text = c.filter(x => x && x.type === 'text').map(x => x.text || '').join('\n');
    }
    text = String(text || '').trim();
    if (text) rows.push({ t, ts, text });
  }
  rows.sort((a, b) => (Date.parse(a.ts) || 0) - (Date.parse(b.ts) || 0));
  const fmt = r => `### ${r.t.toUpperCase()} @ ${r.ts}\n${r.text}`;
  const cap = maxTokens || 40000;
  let kept = rows;
  let truncated = false;
  if (Math.ceil(rows.reduce((n, r) => n + fmt(r).length + 2, 0) / 4) > cap) {
    truncated = true;
    kept = [];
    let acc = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const cost = Math.ceil((fmt(rows[i]).length + 2) / 4);
      if (acc + cost > cap && kept.length) break;
      kept.unshift(rows[i]);
      acc += cost;
    }
  }
  const text = kept.map(fmt).join('\n\n');
  return { messages: kept.length, tokens: Math.ceil(text.length / 4), truncated, text };
}

// ---------------------------------------------------------------------------
// --report: current session breakdown (main/agents split) + 5-hour cross-project rollup
async function report(transcriptPath) {
  const lines = [];
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const cfg = loadConfig(projectDir);
  const usd$ = wantDollars(cfg);

  // ALLOCATION leads — Anthropic's own meter is the definitive measure; the transcript-derived
  // sections below are the supporting detail (where it went).
  if (cfg.officialUsageFetch) {
    const off = await fetchOfficialUsage(projectDir);
    if (off && off.data) {
      const fetchedAt = Date.now() - off.ageMs;
      const abs = new Date(fetchedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
      const rel = off.ageMs < 5000 ? 'just now' : `${Math.round(off.ageMs / 60000)}m ago`;
      lines.push(`ALLOCATION  (Anthropic's meter — fetched ${abs} · ${rel}${off.stale ? ', STALE' : ''})`);
      for (const l of officialLines(off.data)) lines.push(`  ${l}`);
      lines.push('');
    } else {
      lines.push('ALLOCATION  (unavailable — could not reach Anthropic\'s meter; weighted window estimate below)', '');
    }
  }

  if (transcriptPath && fs.existsSync(transcriptPath)) {
    const m = meterSession(transcriptPath, {});
    lines.push(`THIS SESSION  (${m.main.turns} main turns${m.agents.files ? ` + ${m.agents.files} agent transcripts` : ''})`);
    for (const [model, v] of Object.entries(m.main.perModel)) {
      lines.push(`  ${model}: in ${fmtK(v.inp)} · out ${fmtK(v.out)} · cacheR ${fmtK(v.cr)} · ` +
        `cacheW ${fmtK(v.cw)}${v.searches ? ` · ${v.searches} searches` : ''}  ->  ` +
        (usd$ ? fmtUSD(v.usd) : `${fmtK(tokOne(v))} tok`));
    }
    for (const [wfId, g] of Object.entries(m.agents.perWorkflow)) {
      lines.push(`  ${wfId === 'ad-hoc' ? 'ad-hoc agents' : `workflow ${wfId}`}: ` +
        `${g.agents} agents  ->  ${usd$ ? fmtUSD(g.usd) : `${fmtK(g.tok)} tok`}`);
    }
    lines.push(usd$
      ? `  ${fmtK(sessionTokens(m))} tokens processed = main ${fmtUSD(m.main.usd)}` +
        `${m.agents.files ? ` + agents ${fmtUSD(m.agents.usd)}` : ''} = ${fmtUSD(m.usd)} total · ` +
        `live context ${fmtK(m.liveContext)} tokens (≥ ${fmtUSD(m.turnFloorUSD)}/turn floor from here)`
      : `  ${fmtK(sessionTokens(m))} tokens processed` +
        `${m.agents.files ? ` (main ${fmtK(tokensOf(m.main.perModel))} + agents ${fmtK(tokensOf(m.agents.perModel))})` : ''} · ` +
        `live context ${fmtK(m.liveContext)} tokens (re-read on every turn from here)`);
  } else {
    lines.push('THIS SESSION  (no transcript found — pass a path: --report <transcript.jsonl>)');
  }

  try {
    const win = scanWindow(Date.now() - 5 * 3600 * 1000);
    lines.push('', `LAST 5 HOURS  (all projects — approximates the rate-limit window)`);
    for (const r of win.rows.slice(0, 8)) {
      const amt = (usd$ ? fmtUSD(r.usd) : fmtK(r.tok)).padStart(7);
      const ag = usd$
        ? (r.agentsUsd >= 0.005 ? ` (agents ${fmtUSD(r.agentsUsd)})` : '')
        : (r.agentsTok ? ` (agents ${fmtK(r.agentsTok)})` : '');
      lines.push(`  ${amt}  ${r.label}${ag}` +
        (cfg.analyzeHint ? ` · /analyze-session ${r.sid}` : ''));
    }
    if (win.rows.length > 8) lines.push(`  … +${win.rows.length - 8} more sessions`);
    lines.push(`  window total ${fmtK(win.tokens)} tokens` +
      (usd$ ? ` ≈ ${fmtUSD(win.usd)} (API-list equivalent)` : '') +
      (cfg.windowBudgetUSD
        ? ` · ${Math.round((win.usd / cfg.windowBudgetUSD) * 100)}% of 5h budget (weighted)`
        : ''));
  } catch (_) { lines.push('', 'LAST 5 HOURS  (unavailable — could not scan ~/.claude/projects)'); }
  if (cfg.planDetect) {
    const pl = planLine(planInfo());
    if (pl) lines.push('', `  ${pl}`);
  }

  process.stdout.write(lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
if (require.main === module) {
  if (process.argv[2] === '--report') {
    report(process.argv[3] || null)
      .catch(() => { /* never throw */ })
      .finally(() => process.exit(0));
  } else if (process.argv[2] === '--analyze') {
    // CLI surface (unlike the hooks): errors print instead of vanishing — a human asked.
    try {
      const r = resolveTranscript(process.argv[3]);
      if (r.err) { process.stdout.write(r.err + '\n'); process.exit(0); }
      const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
      const cfg = loadConfig(projectDir);
      process.stdout.write(
        renderAnalysis(analyzeSession(r.fp, cfg), wantDollars(cfg)).join('\n') + '\n');
    } catch (e) { process.stdout.write(`analyze failed: ${e && e.message}\n`); }
    process.exit(0);
  } else if (process.argv[2] === '--budgets') {
    // CLI surface: errors print instead of vanishing — a human asked.
    try {
      const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
      const r = generateBudgets(projectDir, loadConfig(projectDir));
      process.stdout.write(r.out.join('\n'));
      process.stdout.write(`${r.rows} scanned + ${r.observed} observed -> ${r.path}\n`);
    } catch (e) { process.stdout.write(`budgets failed: ${e && e.message}\n`); }
    process.exit(0);
  } else {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => (input += c));
    process.stdin.on('end', async () => {
      try {
        const data = JSON.parse(input);
        const projectDir = process.env.CLAUDE_PROJECT_DIR || data.cwd || process.cwd();
        const ev = data.hook_event_name || '';
        if (ev === 'UserPromptSubmit') await onUserPromptSubmit(data, projectDir);
        else if (ev === 'Stop') onStop(data, projectDir);
        else if (ev === 'PreToolUse') onPreToolUse(data, projectDir);
        else if (ev === 'PostToolUse') onPostToolUse(data, projectDir);
        else if (ev === 'SessionStart') onSessionStart(data, projectDir);
      } catch (_) { /* fail-safe: emit nothing */ }
      process.exit(0);
    });
  }
}

module.exports = { meter, meterSession, priceFor, attributeJump, driftVerdict, ledgerScopes, officialLines,
  analyzeSession, renderAnalysis, payloadVerdict, fanVerdict, workflowSource, skillSizes, recordObservedSkill,
  generateBudgets, slug, driftNote, driftDeferralTick, recoverTail, resolveMarker,
  writeMigrateCandidate, clearMarker, writeRecoverPointer,
  migrateReceipt, resolveConfig, TOKEN_SAVER,
  fiveHourWindow, tightestWindow, windowSpikeVerdict, windowThresholdVerdict,
  windowSpikeNote, windowSpikeConfirmNote, windowThresholdNote, windowThresholdGateReason };
