#!/usr/bin/env node
/**
 * token-guard v2 — session spend meter + tripwires for Claude Code (prototyped in wifi-app,
 * destined for CCA distribution as a module beside terminal-title.js / arcade-beeps.js).
 * Spec-by-example: .claude/hooks/tests/ (the suites pin every guard's contract). Evidence base: the July 10-11 blowup forensics
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
 *                       spike + threshold flags (R12), plan-first steer (R13a); re-baseline
 *                       the R13b turn-spend meter.
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
 *                       (e) R13b: turn-spend tripwire — hard ask once ONE turn's work tokens
 *                           (cache re-reads weighted at their 0.1x billing rate) cross
 *                           turnGateTokens (a normal task lands under ~100k; 10× that
 *                           means the work spiraled past anything consciously chosen);
 *                       (f) R14: in-turn RENT tripwire — hard ask once ONE turn's cache
 *                           re-reads (round trips x resident context) cross turnRentGateTokens.
 *                           The blind spot R13b cannot see by construction: ordinary work done
 *                           over many round trips at a fat context. Every other context guard
 *                           speaks only at a prompt boundary; this one re-checks mid-turn;
 *                       (g) v1 hard gate on total session spend (default off, re-arms stepwise).
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
 *                       Observed rows also mirror to ~/.claude/.token-guard/observed-skills.md:
 *                       machine-wide, so one project's tuition prices the skill everywhere.
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
 *   flags carry the plan-meter story there. billingKind() is the cheap per-prompt read.
 *   hardGateUSD still fires on subscriptions — it's a backstop the user armed — but its copy
 *   goes token-denominated there, per showDollars/wantDollars. 2026-07-20.)
 *   sessionWarnTokens [5M, 10M] — the subscription-side session-total ladder (2026-08-05). The
 *   2026-07-18 suppression removed the EVENT, not just the $ denomination: a 15M-token session
 *   sailed to the hardGateUSD backstop with no earlier session-total voice. Same check-in,
 *   stepped in tokens — read off sessionTokens(m), the figure the gate copy already shows.
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
 *   Spike ATTRIBUTION (2026-07-19): the windows are account-level and the user runs several
 *   sessions at once, so blaming the whole meter jump on "that last turn" is wrong the moment a
 *   second session is busy. Every Stop appends the turn's weighted spend to a global ledger
 *   (~/.claude/.token-guard/spend-ledger.jsonl, pruned to a trailing 6h); when a spike fires, the
 *   interval's ledger slice picks the copy: other sessions materially present -> cumulative
 *   phrasing ("your K open sessions together used X% in the last M min; this one drove ~P% of
 *   that spend"); ledger silent/absent -> neutral "your usage climbed" (never single-turn blame —
 *   web and other-machine sessions never reach the ledger); confirmed-solo -> the original
 *   single-turn copy. The $ figures live only in the ledger; the copy stays %-and-tokens.
 *   windowThresholdWarn true · windowThresholdWarnPct [50, 80] — R12b: a warn LADDER (a single
 *   number still works). Fires once per RUNG per window cycle as the tightest live window (5h OR
 *   weekly) climbs past each mark; an escalation to a higher rung mid-cycle fires again; re-arms
 *   when THAT window resets. The one-shot is GLOBAL (~/.claude/.token-guard/window-warns.json) —
 *   the windows are account-level, so a rung announced in ANY session/project counts everywhere
 *   (per-session memory until 2026-07-19 re-announced mid-ladder readings in every new session). The stake is a throttle, not a bill — the copy never carries a $
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
 *   turnGateTokens 1000000 — R13b: hard ask when a single TURN's work tokens (main + fleet,
 *   delta since the prompt) cross this. The task-sized complement to hardGateUSD: a session
 *   total fires late by design, but one turn at 10× a normal task (<~100k, TASK_NORM_TOK)
 *   means the work spiraled past anything consciously chosen. Work tokens = input + output +
 *   cache writes at full weight, cache re-reads at 0.1x (their billing weight): unweighted,
 *   re-reads are rent — context size × round trips — and cross 1M in ~16 ordinary tool calls
 *   at a 60k context with zero heavy work, so the gate would fire on routine turns instead of
 *   spirals. Re-arms above the observed spend at a width that DOUBLES on each same-turn fire
 *   (base, 2x, 4x…) and the copy names the repeat ("3rd check this turn") — a flat step turned
 *   the gate into wallpaper: five byte-identical modals inside one 48-minute turn, approved
 *   every time (observed 2026-07-25, session c9ad7711, turnGateAt walked 1M -> 6M). Every
 *   prompt resets both the baseline and the fire count. Copy is TOKEN-denominated on every
 *   billing kind — task size is work volume, not price. null disables.
 *   turnRentGateTokens 1000000 — R14: hard ask when a single TURN's cache RE-READS cross this.
 *   The deliberate mirror of the sentence above: R13b discounts re-reads 10x so it can judge
 *   TASK SIZE, which by construction blinds it to the bill — a turn can do 83k of ordinary work
 *   and still burn 2.5M in re-reads across 24 round trips at a 104k context (observed
 *   2026-07-25, $2.62 in one 22-minute turn, R13b's work meter reading ~0.33M). Rent is real
 *   money, so it gets its own unweighted gate. The copy leads with round trips x context rather
 *   than a raw total, because the lever is context size, not task length — and unlike the
 *   fat-context advisory (UserPromptSubmit, once per prompt) this one re-checks mid-turn, which
 *   is the only place rent accrues. Same geometric re-arm and repeat-naming copy as R13b above;
 *   every prompt resets the baseline and the fire count. null disables.
 *   planSteer true — R13a: one-line every-prompt steer telling Claude to gauge the request's
 *   blast radius FIRST and propose a plan (session-sized substeps) before starting work that
 *   plausibly exceeds ~3× a normal task. The predictive half a meter can't do: the hook stages
 *   the words, the model judges the size — it sees meaning where the hook sees arithmetic.
 *   skillBudgetWarnChars 150000 — R5: full-payload ⚠ threshold in the --budgets table
 *   idleWarnMinutes 60 · idleGate false — block (pre-empt) instead of warn on idle-return;
 *   the one gate that saves one-shot money: the warn ships in the request that pays, the gate
 *   fires before it.  (skillBudgetWarnChars is read by the CCA auditor, not this hook)
 *   driftNudge true · driftPriorShareMin 0.6 · driftMinContextTokens 100000 · driftRetryPrompts 4
 *   — R6: the terminal-title trail as a RENT signal; fires only above the STAY floor, so it hands
 *   the user the action-first /clear + /continue out (never runs it); the builds-on-earlier-work
 *   case is a stay-put aside in the copy. The hook's arithmetic only STAGES the card (2026-07-18) — the in-turn model holds the
 *   render gate: it judges RELATEDNESS (current prompt returns to the earlier work → stale premise)
 *   and RESOLUTION (earlier threads actually closed → picks the copy's framing) against the live
 *   conversation, and defers by writing .token-guard/drift-deferred; the guard snoozes
 *   driftRetryPrompts prompts, then re-arms the one-shot so the card re-offers with a fresh premise.
 *   driftAutoMigrate false — R11
 *   (simplified 2026-07-21): the Token-bloat one-liner. When on, the drift nudge renders as a single
 *   locked line handing the user the standard two-step — /clear, then /continue — and the fire site
 *   stages a recover-pointer (recover.json) pinned to the drifted thread's boundary so /continue
 *   recovers exactly that thread. (The earlier Yes/Cancel card is retired: its Yes couldn't run
 *   /clear — only the user can — so the pick just bought a round-trip.) The original SessionStart
 *   injection (consent marker + hook-injected tail) was retired 2026-07-21 and its mothballed code
 *   deleted 2026-07-24 — git history is the museum (recoverTail stays live via /migrate-new-session).
 * Per-session state in .claude/hooks/.token-guard/<sid>.json; usage log + meter cache beside it.
 *
 * Fail-safe like every hook in this family: any error -> exit 0, emit nothing, never break a turn.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// pricing — API list prices per MILLION tokens. Web search $10 per 1k searches.
// First matching regex wins; unknown models fall back to Opus pricing (safe: overcounts never
// undercounts for cheaper tiers... except Fable — hence fable/mythos listed first).
const PRICES = [
  { re: /fable|mythos/i, inp: 10, out: 50 },
  { re: /opus/i, inp: 5, out: 25 },
  { re: /sonnet/i, inp: 3, out: 15 },
  { re: /haiku/i, inp: 1, out: 5 },
];
const FALLBACK_PRICE = { inp: 5, out: 25 };
const CACHE_READ_X = 0.1;       // cache read = 0.1x the model's input list price
const CACHE_WRITE_5M_X = 1.25;  // cache write, 5-minute TTL
const CACHE_WRITE_1H_X = 2;     // cache write, 1-hour TTL (also prices the R7 TTL-gap rewrite estimate)
const WEB_SEARCH_USD_EACH = 0.01;
const USD_PER_AGENT_RULE_OF_THUMB = 0.5; // forensic fleet: 1.05M writes / 45 agents ≈ 23k × $20/MTok

// Sizing constants, declared at module top because their first USE is ~500 lines below
// (payloadVerdict) while their historical home was the R7 analyzer section ~1,700 lines
// further down — a TDZ landmine: any future module-eval-time call would have thrown
// ReferenceError (2026-07-24 review).
const CHARS_PER_TOKEN = 2.6; // observed across the July forensics; R5 uses the same constant
// Flat per-image token estimate. The model bills images by PIXEL DIMENSIONS, not bytes: cost is
// ⌈w/28⌉ × ⌈h/28⌉ visual tokens (28px patches), after downscaling over-cap images. The per-image
// cap is tier-dependent — 1568 tok (standard) up to 4784 tok (high-res: Opus 4.8, Sonnet 5,
// Fable 5); a typical screenshot lands ~2–2.5k. Sizing a base64 blob as chars/2.6 instead over-
// counts ~2 orders of magnitude (a ~370KB /gls PNG read as ~189k "tokens", 2026-07-15). One flat
// figure can't match every tier, so this leans to the high-res typical: it won't under-warn on
// standard tier and stays close to real on high-res. (Verified against the vision docs, 2026-07-15.)
const IMAGE_TOK_EST = 2500;

// Bounds & floors, named 2026-07-24 (clean-code plan 1.2) — renames only, values unchanged.
const SID_SHORT_LEN = 8;                     // session-id prefix in log lines / rollup labels
const SKILL_SCAN_MAX_FILES = 64;             // skillPayloadChars: reference-chase file budget
const SKILL_SCAN_CHASE_MAX_BYTES = 2e6;      // skillPayloadChars: bigger files are counted, never read
const USAGE_LOG_ROTATE_BYTES = 256 * 1024;   // usage.log rolls to .1 past this
const SPEND_LEDGER_PRUNE_BYTES = 128 * 1024; // spend-ledger.jsonl: lazy 6h prune trigger (was spelled 131072)
const BUSY_SESSION_DUST_USD = 0.02;          // spikeAttribution: below this a session "idled through"
const LEDGER_ENTRY_DUST_USD = 0.001;         // Stop path: no-op turns stay out of the spend ledger
const ROLLUP_DUST_USD = 0.005;               // 5h rollup: rows / agent splits below this are noise
const SPIKE_SOLO_SHARE_FLOOR = 0.85;         // spikeCopyMode materiality: above this share the solo story holds
const COLD_START_SAMPLES = 12;               // R15b: rolling window of measured session cold starts
const COLD_START_MIN_N = 3;                  // under 3 samples the median is noise — say nothing
const COLD_START_MAX_TOK = 200000;           // a "first request" above the window is a resumed file, not a cold start
const COLD_START_BACKFILL_FILES = 8;         // newest sibling transcripts sampled to seed the store
const COLD_START_BACKFILL_BYTES = 128 * 1024;// bounded head-read per transcript — never load a fat .jsonl
// COLD_START_PAYBACK_TRIPS retired 2026-07-31 — see restartVerdict. It gated on the same excess the
// fat line now does, and could only bind above a ~113k floor, so it was dead at this machine's ~62k.
const TASK_NORM_TOK = 100000;                // R13: a normal task finishes under this — the spiral yardstick
const PLAN_STEER_TOK = 2 * TASK_NORM_TOK;    // R13a: blast-radius bar quoted in the plan-first steer

const DEFAULTS = {
  tokenSaver: false,                // Cost Control: single on/off toggle. Off = this light default posture;
                                    // on overlays the aggressive TOKEN_SAVER preset (blocks + tighter thresholds).
  contextWarnTokens: 150000,
  // R15c: shed-able excess over the MEASURED cold-start floor — restartVerdict's real threshold
  // (fatAt = coldStart + this). 88000 is back-fit so a ~62k floor reproduces the flat 150k exactly;
  // every other config adapts instead of inheriting this machine's overhead. contextWarnTokens
  // stays the fallback here and the live threshold for its other callers (bombGateWhenFat, the
  // fat-context advisory, the idle check, the analyze digest) — those ask "is this window big",
  // which is a different question from "is it worth clearing".
  contextExcessTokens: 88000,
  sessionWarnUSD: [5, 15, 30],
  sessionWarnTokens: [5000000, 10000000],  // subscription-side session-total ladder (see header)
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
  turnGateTokens: 1000000,          // R13b: hard ask when ONE turn's work tokens cross this (null = off)
  turnRentGateTokens: 1000000,      // R14: hard ask when ONE turn's cache RE-READS cross this (null = off)
  planSteer: true,                  // R13a: every-prompt plan-first steer (model-facing, never relayed)
  skillBudgetWarnChars: 150000,
  idleWarnMinutes: 60,
  idleGate: false,
  driftNudge: true,
  driftPriorShareMin: 0.6,
  driftMinContextTokens: 100000,
  driftRetryPrompts: 4,             // R6 defer loop: prompts to snooze after a model-judged deferral
                                    // before the one-shot re-arms and the card may re-stage
  driftAutoMigrate: false,
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
  analyzeHint: false,            // true restores the per-row "· /analyze-session <sid>" suffix on the
                                 // 5h rollup rows; off (default since 2026-07-24) a single hint line
                                 // above the rows teaches the same move without the per-line noise.
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
  turnGateTokens: 500000,        // R13b: half the default gate-width — spirals stopped at 5× normal, not 10×
  turnRentGateTokens: 500000,    // R14: same halving for rent — ~5 round trips at 100k context
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
//                                  maxInp, lastTs, rawLength, lastCacheWrite, lastCacheRead }
// Resident context of one request: everything the model had to be handed to answer it.
const ctxTokens = u => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) +
  (u.cache_creation_input_tokens || 0);

function collectUsageById(raw, sinceMs, out) {
  const byId = new Map(); // message.id -> {model, usage} — last occurrence wins
  let last = null;        // last assistant usage in file order = live context source
  let first = null;       // FIRST assistant usage = this session's cold-start reading
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch (_) { continue; }
    if (!o || o.type !== 'assistant' || !o.message || !o.message.usage) continue;
    if (sinceMs && o.timestamp && Date.parse(o.timestamp) < sinceMs) continue;
    const id = o.message.id || `line-${byId.size}`;
    byId.set(id, { model: o.message.model || '', usage: o.message.usage });
    if (!first) first = o.message.usage;
    last = o.message.usage;
    if (o.timestamp) { const t = Date.parse(o.timestamp); if (t) { out.lastTs = t; out.tsList.push(t); } }
  }
  return { byId, first, last };
}

function costOfUsage(byId, out) {
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
      (inp * p.inp + outT * p.out + cr * p.inp * CACHE_READ_X + cw5m * p.inp * CACHE_WRITE_5M_X + cw1h * p.inp * CACHE_WRITE_1H_X) / 1e6 +
      searches * WEB_SEARCH_USD_EACH;

    const m = out.perModel[model] || (out.perModel[model] = { inp: 0, out: 0, cr: 0, cw: 0, searches: 0, usd: 0 });
    m.inp += inp; m.out += outT; m.cr += cr; m.cw += cwTotal; m.searches += searches; m.usd += usd;
    out.usd += usd;
    out.turns++;
  }
}

function deriveLiveFloor(out, first, last, sinceMs) {
  for (const model of Object.keys(out.perModel)) out.maxInp = Math.max(out.maxInp, priceFor(model).inp);
  // Cold start: what this session was already carrying on its FIRST request — the fixed payload
  // (system prompt + tool schemas, CLAUDE.md, rules, memory index, skill list) that a /clear +
  // /continue re-pays before it reads a line of code. It is a property of the whole file, so a
  // sinceMs-windowed meter leaves it at 0 rather than reporting a mid-session request as "first".
  if (first && !sinceMs) out.firstContext = ctxTokens(first);
  if (last) {
    out.liveContext = ctxTokens(last);
    // The last request's cache split. A request that WRITES six figures of context instead of
    // reading them is, by definition, a full-price re-upload — R4b's clock-free evidence that
    // the cache TTL lapsed, usable on paths where the elapsed-gap check is already too late.
    out.lastCacheWrite = last.cache_creation_input_tokens || 0;
    out.lastCacheRead = last.cache_read_input_tokens || 0;
    // Floor for the NEXT turn: today's context re-read at cache-read rates on the priciest
    // model seen this session (cheap, honest lower bound — output/thinking comes on top).
    out.turnFloorUSD = (out.liveContext * out.maxInp * CACHE_READ_X) / 1e6;
  }
}

function meter(transcriptPath, sinceMs) {
  const out = { usd: 0, perModel: {}, liveContext: 0, firstContext: 0, turnFloorUSD: 0, turns: 0,
    maxInp: 0, lastTs: 0, rawLength: 0, tsList: [], lastCacheWrite: 0, lastCacheRead: 0 };
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch (_) { return out; }
  out.rawLength = raw.length;

  const { byId, first, last } = collectUsageById(raw, sinceMs, out);
  costOfUsage(byId, out);
  deriveLiveFloor(out, first, last, sinceMs);
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
    maxInp: main.maxInp, lastTs: main.lastTs,
    lastCacheWrite: main.lastCacheWrite, lastCacheRead: main.lastCacheRead };
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
// The finger-pointing vocabulary (tool-name harvest + payload labels) is shared with the
// --analyze scan (scanRequests); the walks stay separate — attributeJump wants one global
// best after an offset, the scan wants every candidate plus per-request regions.

// Record an assistant message's tool_use names: tool_use_id -> "Tool(detail)".
function harvestToolNames(content, toolNames) {
  for (const c of content) {
    if (c && c.type === 'tool_use') {
      const detail = (c.input && (c.input.skill || c.input.file_path)) || '';
      toolNames[c.id] = c.name + (detail ? `(${path.basename(String(detail))})` : '');
    }
  }
}

// Blame label for a non-assistant transcript line: the originating tool when a tool_result
// is present, else meta/skill payload vs plain message.
function payloadLabel(o, toolNames) {
  const msg = o.message;
  if (msg && Array.isArray(msg.content)) {
    const tr = msg.content.find(c => c && c.type === 'tool_result');
    if (tr) return toolNames[tr.tool_use_id] || 'tool result';
  }
  return o.isMeta ? 'meta/skill payload' : 'message';
}

// One parsed line -> the running largest-payload candidate.
function bestPayloadStep(line, o, toolNames, best) {
  if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
    harvestToolNames(o.message.content, toolNames);
    return best; // assistant output is priced as output, not context payload
  }
  if (best && line.length <= best.chars) return best;
  return { chars: line.length, label: payloadLabel(o, toolNames) };
}

function attributeJump(transcriptPath, fromChar) {
  let raw; try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch (_) { return null; }
  const toolNames = {}; // tool_use_id -> "Tool(detail)"
  let best = null;
  for (const line of raw.slice(Math.max(0, fromChar)).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch (_) { continue; }
    best = bestPayloadStep(line, o, toolNames, best);
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
// trigger): moved scope + rent% + a SINGLE ready out, with a stay-put aside for the
// cross-scope-dependency case drift can't see. R11 (simplified 2026-07-21): when autoMigrate is on,
// the out is a single locked one-liner naming the standard two-step — /clear, then /continue (a
// hook-staged recover-pointer makes /continue land on this thread's boundary). The earlier
// Yes/Cancel AskUserQuestion card is retired — its Yes couldn't run /clear (only the user can), so
// the pick just bought a round-trip where the model told them to type it anyway.
// The lead is identical in both modes.
// 2026-07-18: the arithmetic only STAGES the card — the in-turn model holds the render gate, because
// it sees meaning where the hook sees sizes. Two judged tests: RELATEDNESS gates the render (a
// current prompt that returns to the earlier work = stale premise — the failure we watched live was
// the card claiming a topic change in the very turn the user pivoted back); RESOLUTION picks the
// copy's framing (settled-and-safe vs never-closed-but-moved-on). The auto-migrate nudge demands BOTH
// (it sends the user straight to /clear, so the destructive path stays conservative). A refusal is not a
// kill: the model writes the drift-deferred flag and the caller snoozes, then re-offers.
function driftJudge(dominant, autoMigrate) {
  const gate = autoMigrate
    ? `Proceed ONLY if this prompt is UNRELATED to that earlier work AND its threads are RESOLVED ` +
      `(shipped, committed, answered, user-confirmed — nothing still open); this nudge ` +
      `sends the user straight to /clear away the old context, so any doubt defers. `
    : `Relay ONLY if this prompt is UNRELATED to that earlier work; RESOLUTION does not gate the ` +
      `relay — it picks the framing below (an unresolved thread the user has moved past still ` +
      `deserves the nudge). `;
  return `The numbers here are ARITHMETIC — you hold the render gate, because you can see what the ` +
    `hook cannot: meaning. Before relaying anything, judge two tests against the conversation and ` +
    `the user's CURRENT prompt: (1) RELATEDNESS — does this very prompt return to, build on, or ask ` +
    `about the earlier "${dominant}" work? (2) RESOLUTION — were the "${dominant}" threads actually ` +
    `closed (shipped, committed, answered, user-confirmed), or is something still open? ${gate}` +
    `To DEFER instead: write the contentless flag file ` +
    `".claude/hooks/.token-guard/drift-deferred" (the guard snoozes and re-offers in a few ` +
    `prompts) and render NOTHING about drift this turn — no warning block, no aside. `;
}

function driftNote(dominant, scope, priorPct, autoMigrate, liveContext) {
  if (autoMigrate) {
    // Fixed one-line nudge (no picker): the verbatim warning line printed as a standalone block, not
    // an AskUserQuestion question. Two-number framing (total / keep): keep = the current scope's live
    // share; the drop (prior scopes left behind) is named "the unused context", not a third number.
    // 2026-07-21: names the standard two-step — /clear, then /continue — instead of arming the retired
    // SessionStart injection; the fire site has already staged a recover-pointer so /continue lands on
    // this thread's exact boundary. (The earlier Yes/Cancel card is gone — its Yes couldn't run /clear,
    // only the user can, so the pick just bought a round-trip.)
    const drop = Math.round((liveContext || 0) * priorPct / 100);
    const keep = Math.max(0, (liveContext || 0) - drop);
    return `scope-drift(auto-migrate, staged): this session moved from "${dominant}" to "${scope}", and the ` +
      `earlier scopes are ~${priorPct}% of the live context every turn re-reads. ` +
      driftJudge(dominant, true) +
      `If proceeding: relay a STANDALONE warning block, never woven into your answer — NOT a picker, ` +
      `NOT an AskUserQuestion card, just this line printed VERBATIM (the agreed copy), then a ` +
      `horizontal rule before your answer:\n` +
      `"⚠️ Hey — this session has ~${fmtK(liveContext)} of context, but the current topic only needs ` +
      `~${fmtK(keep)} of that. /clear to drop the unused context, then /continue to resume the ` +
      `conversation."\n` +
      `NEVER narrate the internal mechanism (no recover-pointer, cutoff ladder, or lineage wiring — ` +
      `that plumbing is pure noise to the user). NEVER run \`/clear\` or \`/continue\` yourself.`;
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
    `Then give the ONE-step out, ACTION-FIRST (ux copy/action-lines-lead-with-the-action): ` +
    `"/clear, then /continue to leave the settled ${dominant} work behind and keep this ` +
    `${scope} thread" — a recovery pointer is already staged, so /continue picks up exactly ` +
    `this thread; name the two commands, never the pointer. As a brief closing aside, note ` +
    `that if "${scope}" actually builds on the earlier work, staying put is the right call — ` +
    `a cut only pays when the threads are independent. NEVER run the commands yourself. Then ` +
    `a horizontal rule before the answer itself.`;
}

// Pure fire-rule (exported for fixtures, like meter). Input = ledgerScopes() tenures, the LAST one
// stamped with `prompts` by the caller. Token share per scope = watermark deltas (tenure i owns
// [its watermark, next tenure's watermark)); the last tenure runs to liveContext; the window's
// FIRST tenure starts at 0 (it claims the pre-title baseline, so shares sum to liveContext). The
// window RE-BASES after any watermark SHRINK (auto-compact replaced the context; earlier
// watermarks describe a context that no longer exists — same rule as terminal-title's /clear
// advisor). Fires only when ALL hold:
//   - live context ≥ driftMinContextTokens (the STAY floor: below it a cut can't pay for
//     itself — recovery overhead eats the savings — so nudging is pointless by construction)
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

// Skill payload estimate, best source first: the project's .claude/skill-budgets.md (R5's audit
// output doubles as the runtime lookup table — zero scanning); else the machine-wide observed
// table (a landing measured in ANY project prices the skill here before this project pays the
// tuition itself); else stat SKILL.md and mark it a floor (referenced files are unknowable
// pre-expansion — and a name that resolves on disk is the skill that actually loads, so the
// floor outranks any seed); else a shipped seed for known-fat built-ins. Everything else ->
// null: never guess.
function budgetTableLookup(filePath, name) {
  try {
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
      const mt = line.match(/^(\S+)\s+.*?≈\s*([\d.]+)\s*(k|M)?\s*tok/);
      if (mt && mt[1] === name) {
        const mul = mt[3] === 'M' ? 1e6 : mt[3] === 'k' ? 1e3 : 1;
        return { skillTok: Math.round(parseFloat(mt[2]) * mul), skillFloor: false };
      }
    }
  } catch (_) { /* no table */ }
  return null;
}

function sharedObservedPath() {
  return path.join(os.homedir(), '.claude', '.token-guard', 'observed-skills.md');
}

// Shipped priors for built-in skills, which ship no files to stat — without one, the machine's
// very FIRST landing of a fat built-in is ungateable (null -> never guess -> silent). Any
// measured row outranks a seed. claude-api: ~245k, observed live 2026-07-25.
const SEED_SKILL_TOK = { 'claude-api': 245000 };

function skillSizes(projectDir, name) {
  if (!name) return null;
  const hit = budgetTableLookup(budgetsPath(projectDir), name)
    || budgetTableLookup(sharedObservedPath(), name);
  if (hit) return hit;
  for (const dir of [projectDir, os.homedir()]) {
    try {
      const bytes = fs.statSync(path.join(dir, '.claude', 'skills', name, 'SKILL.md')).size;
      return { skillTok: Math.round(bytes / CHARS_PER_TOKEN), skillFloor: true };
    } catch (_) { /* try next */ }
  }
  return SEED_SKILL_TOK[name] ? { skillTok: SEED_SKILL_TOK[name], skillFloor: false } : null;
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
//     survive regeneration. Each observed row is also mirrored to the machine-wide table
//     (~/.claude/.token-guard/observed-skills.md, read by skillSizes after the project table):
//     built-ins cost the same everywhere, so one project's tuition prices them for all.
function budgetsPath(projectDir) { return path.join(projectDir, '.claude', 'skill-budgets.md'); }

function upsertObservedRow(filePath, name, row) {
  let lines = [];
  try { lines = fs.readFileSync(filePath, 'utf8').split('\n'); } catch (_) { /* new table */ }
  const at = lines.findIndex(l => l.split(/\s+/)[0] === name);
  if (at >= 0) lines[at] = row; else {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push(row, '');
  }
  fs.writeFileSync(filePath, lines.join('\n'));
}

function recordObservedSkill(projectDir, name, tok, chars, cfg) {
  try {
    if (!name || !tok) return;
    const row = `${name}  ${chars ? `${fmtK(chars)} chars ` : ''}≈ ${fmtK(tok)} tok` +
      `${tok > cfg.bombJumpTokens ? '  ⚠' : ''}  (observed ${new Date().toISOString().slice(0, 10)})`;
    upsertObservedRow(budgetsPath(projectDir), name, row);
    try {
      fs.mkdirSync(path.dirname(sharedObservedPath()), { recursive: true });
      upsertObservedRow(sharedObservedPath(), name, row);
    } catch (_) { /* shared mirror is best-effort — the project row already landed */ }
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
  while (queue.length && guard++ < SKILL_SCAN_MAX_FILES) {
    const fp = path.resolve(queue.shift());
    const key = fp.toLowerCase();
    if (seen.has(key) || (fp !== path.join(root, 'SKILL.md') && !fp.startsWith(root + path.sep))) continue;
    seen.add(key);
    let size; try { size = fs.statSync(fp).size; } catch (_) { continue; }
    total += size;
    if (!/\.(md|txt)$/i.test(fp) || size > SKILL_SCAN_CHASE_MAX_BYTES) continue;
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
  const blank = { warnedUSD: 0, warnedTok: 0, warnedCtx: false, gateArmedAt: null, lastUSD: 0,
    lastLiveContext: null, scanOffset: 0, warnedIdleAt: 0, knownWf: {},
    warnedColdWriteAt: 0, idleFiredAt: 0,
    pendingWfReceipt: null, bombGateArmed: false, curScope: null, curScopePrompts: 0,
    nudgedScope: null, driftSnooze: null,
    approvedPayloadHop: null, payloadGateOkOnce: null,
    turnPayloadTok: 0, turnPayloadWarned: false, miniBombGateArmed: false,
    lastWindowPct: null, lastWindowResetsAt: null, lastWindowAtIso: null, warnedWindow: null,
    lastTurnDeltaUsd: 0, turnStartWorkTok: null, turnGateAt: null, turnGateFires: 0,
    turnStartCr: null, turnStartReqs: null, rentGateAt: null, rentGateFires: 0 };
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

// R4 idle-return recovery pointer: each idle fire writes a numbered pointer that
// `/recover-context pid=N` resolves from a fresh session back to (sid + absolute cutoff) —
// the short command replaces retyping `-<min> --session <sid>` by hand. pid is monotonic
// per project so an older warning's "run /recover-context pid=3" stays valid after later
// fires; the previous 4 fires ride along under history[]. Top level stays flat (sid,
// recoverCmd, writtenAt) so the legacy ccr bin still round-trips. cutoffIso is the
// recovery boundary frozen at fire time — minutes-from-now would drift if the user runs
// the command an hour later. An explicit boundaryIso overrides the minutes-derived cutoff
// (additive, 2026-07-21): the drift card stages the drifted thread's exact start this way,
// so a post-card /continue recovers precisely that thread via its pointer rung.
function writeRecoverPointer(projectDir, sid, minutes, boundaryIso) {
  try {
    fs.mkdirSync(stateDir(projectDir), { recursive: true });
    const file = path.join(stateDir(projectDir), 'recover.json');
    let prior = null;
    try { prior = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* first fire */ }
    const pid = ((prior && prior.pid) || 0) + 1;
    const rec = {
      pid, sid, recoverCmd: `/recover-context pid=${pid}`, minutes,
      cutoffIso: boundaryIso || new Date(Date.now() - minutes * 60000).toISOString(),
      projectDir, writtenAt: Date.now(),
      history: prior && prior.pid
        ? [{ pid: prior.pid, sid: prior.sid, minutes: prior.minutes, cutoffIso: prior.cutoffIso,
             writtenAt: prior.writtenAt }, ...(prior.history || [])].slice(0, 4)
        : [],
    };
    fs.writeFileSync(file, JSON.stringify(rec, null, 2));
    return rec;
  } catch (_) { return null; /* pointer is a convenience — the fallback command still shows */ }
}

// R4 idle-return relay copy (warn mode — the re-upload already landed when the user returned).
// Prose warning ending on the recovery out: /clear, then /continue (the fire path stages a
// recover-pointer that /continue's ladder consumes; terminal lineage resolves the session).
// The earlier ccr new-terminal Yes/No card was retired 2026-07-18 — spawning a terminal from
// the model was too hacky; the /recover-context pid=N wording left the copy 2026-07-21 (one
// metaphor everywhere: /clear + /continue — the pid pointer stays on disk as the manual out).
// Copy rules: trigger named, ~20x comparison, never a dollar figure, never the exact idle
// duration, out written action-first (ux copy/action-lines-lead-with-the-action).
function idleReturnNote(liveContext) {
  return (
    `idle-return: this session sat untouched for over an hour, longer than the API keeps a ` +
    `conversation cached. Claude Code just re-uploaded all ~${fmtK(liveContext)} tokens ` +
    `of it at full price, ~20x what the same turn costs while cached. Relay this as a ` +
    `STANDALONE warning block, never woven into your answer: open with "⚠️ Hey —" and keep ` +
    `a warm conversational voice (helpful friend, not system log). Sentence 1 names the ` +
    `trigger and ENDS on the word "cached" — say "over an hour", never the exact duration ` +
    `(that's TMI). Sentence 2, short and separate: Claude Code (by name — the behavior is ` +
    `Claude Code's, not this guard's/CCA's) re-uploaded it all, ending on the ~20x ` +
    `comparison — NEVER a dollar figure (subscription users would read it as a real ` +
    `charge). Then, on its own line, the out ACTION-FIRST: "/clear, then /continue to pick ` +
    `this work back up cheaply" (a recovery pointer is staged, so /continue reloads the right ` +
    `slice — name the two commands, never the pointer). Then ` +
    `a horizontal rule before the answer itself.`
  );
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
    try { if (fs.statSync(log).size > USAGE_LOG_ROTATE_BYTES) fs.renameSync(log, `${log}.1`); } catch (_) { /* none yet */ }
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

// The UA must look like a real Claude Code build or the endpoint serves the aggressively
// rate-limited bucket. Derived from the RUNNING install at fetch time (at most one fs read
// per cache miss, never a spawn):
//   1. CLAUDE_CODE_EXECPATH → the npm package's own package.json (absent on native installs,
//      where nothing sits beside the binary);
//   2. the AI_AGENT stamp Claude Code puts in hook env ("claude-code_2-1-210_agent");
//   3. the dated pin — last resort. Rotation rule: whenever you touch this area, re-pin to
//      the current `claude --version` and re-date. Last verified 2026-07-24 against 2.1.210.
const CLAUDE_CODE_UA_PIN = 'claude-code/2.1.210';

function claudeCodeUA(env = process.env) {
  try {
    if (env.CLAUDE_CODE_EXECPATH) {
      const pkgPath = path.join(path.dirname(env.CLAUDE_CODE_EXECPATH), '..', 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name === '@anthropic-ai/claude-code' && /^\d+\.\d+\.\d+/.test(String(pkg.version))) {
        return `claude-code/${pkg.version}`;
      }
    }
  } catch (_) { /* native install or moved package — fall through */ }
  const m = /^claude-code[_-](\d+)-(\d+)-(\d+)/.exec(String(env.AI_AGENT || ''));
  if (m) return `claude-code/${m[1]}.${m[2]}.${m[3]}`;
  return CLAUDE_CODE_UA_PIN;
}

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
          'User-Agent': claudeCodeUA(),
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

// R12b rung memory is GLOBAL — cross-session AND cross-project — because the windows themselves
// are account-level. Per-session memory (the shape until 2026-07-19) made every fresh session
// re-announce the already-crossed rung, so a user sitting at 75% got a "~75% used" FYI in each
// new session — a random-looking mid-ladder number instead of the two crossings they signed up
// for. Keyed by window name; a new cycle (resets_at moved a full window) starts fresh via the
// same tolerance identity the verdict uses.
function windowWarnsPath() { return path.join(os.homedir(), '.claude', '.token-guard', 'window-warns.json'); }

function loadWindowWarn(name) {
  try { return JSON.parse(fs.readFileSync(windowWarnsPath(), 'utf8'))[name] || null; } catch (_) { return null; }
}

function saveWindowWarn(name, entry) {
  try {
    let all = {};
    try { all = JSON.parse(fs.readFileSync(windowWarnsPath(), 'utf8')); } catch (_) { /* first write */ }
    all[name] = entry;
    fs.mkdirSync(path.dirname(windowWarnsPath()), { recursive: true });
    fs.writeFileSync(windowWarnsPath(), JSON.stringify(all));
  } catch (_) { /* lost memory just re-announces at the next rung check */ }
}

// The union of the global memory and this session's legacy warnedWindow field: whichever entry
// suppresses MORE for the window under test wins (missing .rung = pre-ladder shape = top-fired).
// Honoring the session field keeps an in-flight session from double-firing right after an
// upgrade deploys (its own fire predates the global file). Pure + exported for tests.
function effectiveWarn(worst, a, b) {
  if (!worst) return a || b || null;
  const score = w => (w && w.name === worst.name && sameWindowCycle(w.resetsAt, worst.resetsAt))
    ? (typeof w.rung === 'number' ? w.rung : Infinity) : -Infinity;
  return score(a) >= score(b) ? (a || b || null) : b;
}

// R12a spike attribution — the account-level meter can jump because of ANY session, not just this
// one (the user runs several at once; Andrew 2026-07-19, four concurrent). Each Stop appends that
// turn's weighted spend here; the spike copy then splits the interval's observed spend by session
// instead of blaming the local turn. JSONL, one line per turn, lazily pruned so it never grows
// unbounded. Web / other-machine sessions never write here — readers treat "no entries" as
// UNKNOWN, never as proof this session did it.
function spendLedgerPath() { return path.join(os.homedir(), '.claude', '.token-guard', 'spend-ledger.jsonl'); }

function appendSpendLedger(entry) {
  try {
    const p = spendLedgerPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify(entry) + '\n');
    // prune lazily, only once the file is big enough to matter (keeps the Stop path cheap);
    // trailing 6h covers the 5h window + slack
    if (fs.statSync(p).size > SPEND_LEDGER_PRUNE_BYTES) {
      const keepAfter = Date.now() - 6 * 3600 * 1000;
      const kept = fs.readFileSync(p, 'utf8').split('\n').filter(l => {
        if (!l) return false;
        try { return Date.parse(JSON.parse(l).ts) >= keepAfter; } catch (_) { return false; }
      });
      fs.writeFileSync(p, kept.join('\n') + (kept.length ? '\n' : ''));
    }
  } catch (_) { /* attribution degrades to the neutral copy, never blocks the turn */ }
}

function readSpendLedger(sinceIso) {
  if (!sinceIso) return null;                     // no interval anchor -> attribution unknown
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) return null;
  try {
    return fs.readFileSync(spendLedgerPath(), 'utf8').split('\n').flatMap(l => {
      if (!l) return [];
      try {
        const e = JSON.parse(l);
        return Date.parse(e.ts) >= since && typeof e.usd === 'number' ? [e] : [];
      } catch (_) { return []; }
    });
  } catch (_) { return null; }                    // no ledger yet -> unknown, not solo
}

// Pure: split an interval's ledger entries into this session vs the rest. Null when nothing is
// attributable (callers fall back to the neutral copy). `busyOthers` counts only sessions above
// a dust floor — a session that idled through the interval doesn't change the story. `share` is
// this session's fraction of the LEDGERED spend (unledgered web/other-machine work is invisible
// here, which is exactly why the unknown branch exists).
function spikeAttribution(entries, sid) {
  if (!entries || !entries.length) return null;
  let thisUsd = 0; const others = {};
  for (const e of entries) {
    if (e.sid === sid) thisUsd += e.usd;
    else others[e.sid] = (others[e.sid] || 0) + e.usd;
  }
  const otherUsd = Object.values(others).reduce((a, v) => a + v, 0);
  const busyOthers = Object.values(others).filter(v => v >= BUSY_SESSION_DUST_USD).length;
  const total = thisUsd + otherUsd;
  if (total <= 0) return null;
  return { thisUsd, otherUsd, busyOthers, sessions: busyOthers + 1, share: thisUsd / total };
}

// Copy chooser: 'solo' keeps the single-turn blame, 'multi' switches to cumulative phrasing,
// 'unknown' gets the neutral climbed-since copy — never blame without evidence. 15% other-spend
// is the materiality bar: below it the single-turn story still holds. Pure + exported for tests.
function spikeCopyMode(attr) {
  if (!attr) return 'unknown';
  if (attr.busyOthers >= 1 && attr.share <= SPIKE_SOLO_SHARE_FLOOR) return 'multi';
  return 'solo';
}

// The relayed copy — instructions TO the model (mirrors the idle/bomb notes). NEVER a dollar
// figure: window budget is rate-limit consumption, and on a subscription a $ reads as a phantom
// charge. Pure + exported so a golden test can pin the contract.
function windowSpikeNote(sv, now5h, attr, mins) {
  const reset = now5h && now5h.resetsAt ? ` and resets ${fmtReset(now5h.resetsAt)}` : '';
  const magnitude = sv.estimated
    ? `an estimated ~${Math.round(sv.spikePct)}% of the 5-hour usage window (the meter was ` +
      `unreachable, so this is calibrated from the turn's weighted cost, not measured)`
    : `~${Math.round(sv.spikePct)} points of the 5-hour usage window (it climbed from ~` +
      `${sv.fromPct}% to ~${sv.toPct}% used${reset})`;
  // The estimated fallback is derived from THIS turn's own weighted cost, so single-turn blame
  // is accurate there by construction; only the meter-delta path needs attribution.
  const mode = sv.estimated ? 'solo' : spikeCopyMode(attr);
  const span = mins ? `in the last ~${mins} min` : `since the user's last turn here`;
  const actor = mode === 'multi'
    ? `${span}, work across the user's ${attr.sessions} concurrent sessions ate ${magnitude} — ` +
      `this session drove ~${Math.round(attr.share * 100)}% of that spend`
    : mode === 'unknown'
      ? `${span}, the account-level meter climbed ${magnitude} — attribution is unknown (other ` +
        `open sessions, devices, or the web app may have contributed)`
      : `since the user's last turn, a single stretch of work ate ${magnitude}`;
  const s1 = mode === 'multi'
    ? `Sentence 1 names the jump as the combined work of their ${attr.sessions} open sessions ` +
      `with this session's ~${Math.round(attr.share * 100)}% share — never "that last turn"`
    : mode === 'unknown'
      ? `Sentence 1 names the climb in window % WITHOUT pinning it on this session's last turn ` +
        `(other sessions may have contributed)`
      : `Sentence 1 names the jump in window %`;
  return (
    `window-spike: ${actor}. Relay ` +
    `this as a STANDALONE warning block, never woven into your answer: open with "⚠️ Hey —" and ` +
    `keep a warm conversational voice (helpful friend, not system log), 2 plain sentences, NO ` +
    `dollar figures (this is rate-limit budget, not money). ${s1}; ` +
    `sentence 2 the out — a lighter next turn, or /clear and a fresh session if that heavy work is ` +
    `done. Then a horizontal rule before the answer itself.`
  );
}

// Runway = minutes until the 5h meter hits 100% at the burn rate observed over the last
// interval, quantized DOWN (never promise more runway than measured; bursty burn makes finer
// precision fake — ux/never-print-an-unmeasured-number): 15-min steps under 2 hrs, half-hours
// past that. beatsReset = projected exhaustion lands BEFORE the window resets — the only case
// worth a card (a missing reset time counts as beating it: warn, don't assume safety).
// Pure + exported so tests can pin the math and the labels.
function windowRunway(sv, now5h, mins) {
  if (!now5h || !mins || !(sv.spikePct > 0) || sv.toPct == null) return null;
  const runwayMin = (100 - sv.toPct) * (mins / sv.spikePct);
  const resetMin = now5h.resetsAt && Number.isFinite(Date.parse(now5h.resetsAt))
    ? (Date.parse(now5h.resetsAt) - Date.now()) / 60000 : null;
  const q = Math.max(15, Math.floor(runwayMin / 15) * 15);
  const label = q < 120
    ? `~${q} min`
    : (h => `~${Number.isInteger(h) ? h : Math.floor(h) + '½'} hrs`)(Math.floor(runwayMin / 30) * 30 / 60);
  return { runwayMin, label, beatsReset: resetMin == null || runwayMin < resetMin };
}

// R12a confirm variant — when windowSpikeConfirm is on, the spike becomes a two-option
// AskUserQuestion card. Reframed 2026-07-20 (Andrew): the old card was a stats dump (delta %,
// interval span, per-session share) with no "so what" — now it leads with RUNWAY (time-to-empty
// at the observed rate) and returns NULL when the window resets before projected exhaustion:
// no throttle risk, no card (the R12b threshold ladder still reports position). The per-session
// share line is gone for good — the meter is account-wide and share is a factoid with no action
// attached (see project_token_guard_multisession_attribution). Same dollar-free framing; still a
// relayed card and never a `decision:'block'`, so it can't stall the turn. Pure + exported so a
// golden test pins the contract.
function windowSpikeConfirmNote(sv, now5h, sid, attr, mins) {
  const analyze = sid ? `/analyze-session ${sid}` : '/analyze-session';
  const reset = now5h && now5h.resetsAt ? ` (resets ${fmtReset(now5h.resetsAt)})` : '';
  let question, lead;
  if (sv.estimated) {
    // Meter unreachable → no rate to project; single-turn blame is accurate by construction
    // (the estimate derives from THIS turn's own weighted cost).
    question = `"⚠️ Hey — that last turn used an estimated ~${Math.round(sv.spikePct)}% of your ` +
      `5-hour usage window (calibrated from the turn's weighted cost — the meter was unreachable, ` +
      `so it's estimated, not measured). Keep going?"`;
    lead = `this turn used an estimated ~${Math.round(sv.spikePct)}% of the 5-hour window ` +
      `(meter unreachable — calibrated from the turn's own weighted cost)`;
  } else {
    const rw = windowRunway(sv, now5h, mins);
    if (rw && !rw.beatsReset) return null;   // resets before projected exhaustion — no throttle risk
    if (rw) {
      const who = attr && attr.busyOthers >= 1 ? ` across ${attr.sessions} open sessions` : '';
      question = `"⚠️ Hey — at your current rate${who}, you'll burn through your 5-hour usage ` +
        `window in ${rw.label}${reset}. Keep going?"`;
      lead = `at the burn rate observed since the user's last turn here (~${sv.fromPct}% → ` +
        `~${sv.toPct}% used), the 5-hour window is projected to hit 100% in ${rw.label} — ` +
        `BEFORE it resets`;
    } else {
      // Measured climb but no usable interval to rate it — can't prove safety, so warn plainly.
      question = `"⚠️ Hey — your 5-hour usage window climbed from ~${sv.fromPct}% to ` +
        `~${sv.toPct}% used${reset}. Keep going?"`;
      lead = `the 5-hour meter climbed ~${Math.round(sv.spikePct)} points but the interval ` +
        `baseline is missing, so the burn rate is unmeasurable this turn`;
    }
  }
  return (
    `window-spike(confirm): ${lead}. Present ` +
    `it as a SINGLE self-contained AskUserQuestion card — do NOT render any warning prose above it. ` +
    `The card's \`question\` field is this line VERBATIM (the agreed copy):\n` +
    question + `\n` +
    `Header chip: "Window spike". TWO options, primary first. Option 1 — label "Yes". Option 2 ` +
    `— label "Wait — where did the tokens go". BOTH options are bare labels with NO description ` +
    `— the labels say it all, do NOT add subtext to either. NEVER narrate any internal mechanism (no ` +
    `state file, meter cache, or budget wiring — that is pure noise to the user). On the Option 1 ` +
    `pick, dismiss the card and answer the user's original ` +
    `prompt normally, as if it had never appeared. On the Option 2 pick, run \`${analyze}\` to show the ` +
    `forensic spend digest, then STOP and wait — do NOT answer the original prompt yet (the user is ` +
    `reviewing first). NEVER run \`/analyze-session\` yourself before the user picks Option 2.`
  );
}

function windowThresholdNote(tv, _cfg) {
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
// 1st/2nd/3rd/4th — only ever used for a same-turn gate repeat count, so n is small; the
// 11/12/13 case is still handled because getting it wrong is more distracting than the rule.
const ordinal = n => {
  const r100 = n % 100;
  if (r100 >= 11 && r100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
};
// Shared "when do I hear from this gate again" clause for the two in-turn tripwires (R13b work,
// R14 rent). The gate WIDTH doubles on every same-turn fire, so the copy has to say so — a flat
// step produced five byte-identical modals inside one 48-minute turn (observed 2026-07-25:
// turnGateAt walked 1M -> 6M in session c9ad7711, approved every time). Five identical asks are
// a keystroke, not a decision; two or three escalating ones stay a decision. The first fire
// keeps the plain forward-looking phrasing — there is no repeat to name yet.
const nextCheckClause = (fires, nextAt, unit = '') => fires <= 1
  ? ` Next check ≈ ${fmtK(nextAt)}${unit} this turn.`
  : ` This is the ${ordinal(fires)} check this turn — each approval doubles the gap to the ` +
    `next (≈ ${fmtK(nextAt)}${unit}).`;
// Geometric re-arm: width = base × 2^(fires-1), measured from what was actually observed (so a
// single huge landing can never re-fire on the very next tool call). fires counts THIS fire.
const reArmAt = (observed, base, fires) => observed + base * Math.pow(2, fires - 1);

// ── gateVerdict: which button the PENDING CALL argues for (R13b/R14) ──────────────────────────
// The token math cannot answer this. "23 round trips, 124k resident, 2.3M of re-reads" is a
// measurement of the turn's STATE — identical whether the next call is a commit or another
// god-file read — so a recommendation derived from it would say the same thing every time, and a
// recommendation that never varies is wallpaper. The discriminator is the SHAPE of the call being
// gated, which PreToolUse already hands us. Two classes are mechanically decidable:
//
//   'skip'  a turn-ender (git add/commit/status/diff --stat). Tiny output, and it IS the
//           "land this turn at a commit point" the gate's own Choice bullet asks for. Firing here
//           would contradict the advice three lines above it — and once a gate has recommended
//           approve, the next real warning gets dismissed by reflex. So the gate does not fire at
//           all, and does NOT re-arm: the next non-turn-ender call takes the check it deferred.
//           Silence is a stronger recommendation than a green label.
//   'deny'  output the turn will then re-read on every remaining trip. Five shapes qualify: a full
//           test suite; a Grep explicitly unbounded (head_limit: 0 — an unset head_limit already
//           caps at 250); a search typed as Bash rg/grep with no -m/-l bound and no head
//           downstream; a `cat` of a big file; and full-patch git history (`git log -p`,
//           `git show`, a bare `git diff`). They share one property, which is what earns the
//           deny: output that is large, unbounded AT CALL TIME, and resident afterward.
//
// Everything else returns null and the copy stays neutral. The hook is a Node script matching a
// command string with no model in the loop — it cannot know whether a `git add` stages the RIGHT
// files, or whether this expensive read is the one that unblocks the task. Narrow is correct.

// Cheap segments that move the turn toward a commit. Deliberately a strict allowlist: an
// unrecognized segment disqualifies the whole command, so a miss costs one extra warning — never
// a silently skipped gate. (Quoted `;`/`&&` inside a commit message split badly and fail closed
// for the same reason.)
const TURN_ENDER_SEG = [
  /^git\s+add\b/, /^git\s+commit\b/, /^git\s+status\b/, /^git\s+rev-parse\b/,
  /^git\s+diff\s+(--stat|--cached\s+--stat|--staged\s+--stat)\b/,
  /^git\s+log\s+--oneline\b/, /^git\s+branch\s+--show-current\b/, /^cd\s/,
];
const shellSegs = cmd => String(cmd || '').split(/&&|\|\||[;|]/).map(s => s.trim()).filter(Boolean);
function isTurnEnder(cmd) {
  const segs = shellSegs(cmd);
  return segs.length > 0 && segs.every(s => TURN_ENDER_SEG.some(re => re.test(s)));
}
// A test runner with no path/pattern argument runs the whole suite. Flags (-t, --coverage, --run)
// and go's ./... wildcard scope nothing, so they don't count as an argument.
const TEST_RUNNER =
  /^(?:(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?test|npx\s+(?:jest|vitest|mocha)|jest|vitest|pytest|mocha|go\s+test)\b(.*)$/;
// …and neither do redirects. Both of these are corrections, not polish: matching the whole command
// string missed `cd repo && pnpm test --run`, and counting `2>&1` / `| tail -30` as path arguments
// made a piped full suite read as scoped. Between them they covered nearly every way a suite is
// actually typed, so the deny verdict was live in the tests and near-dead in practice (observed
// 2026-07-26). Per-segment matching is also what keeps `git commit -m "run pnpm test"` honest —
// isTurnEnder runs first and returns 'skip' before this is reached.
const REDIRECT_ARG = /^(?:\d?>>?|\d?<|&)/;
function isFullSuite(cmd) {
  return shellSegs(cmd).some(seg => {
    const m = TEST_RUNNER.exec(seg);
    if (!m) return false;
    return m[1].split(/\s+/)
      .filter(a => a && !a.startsWith('-') && a !== './...' && !REDIRECT_ARG.test(a)).length === 0;
  });
}
// ── R16: the bomb classes the two-case deny list missed ───────────────────────────────────────
// The original list denied a full suite and an unbounded Grep TOOL call. Everything else returned
// null, so on an ordinary turn the label came from the ratio alone — and the ratio is the same
// answer for every non-bomb call at a given context reading. That is exactly the wallpaper the
// comments above warn about, and it fired that way on a `cd && head && grep` (observed
// 2026-07-27). These classes share the one property that earns a deny: output that is large,
// unbounded AT CALL TIME, and re-read on every remaining trip of the turn.

// Deliberately NOT here: an unranged Read of a god file. R8's payload door already asks on that
// exact shape (payloadVerdict, same offset/limit escape hatch) and runs BEFORE this gate, with a
// real token estimate and a named cheaper lever. Adding it here would need a second threshold
// alongside cfg.bombJumpTokens — two definitions of "god file" that drift apart — to buy a band
// only a few KB wide. The three classes below are Bash, which R8 does not look at at all.
//
// statSync is the only measurement available on the PreToolUse critical path (no child_process).
// A stat that throws means the path is wrong and the call will fail on its own merits: return 0
// and let the real error speak rather than denying on a guess.
const BIG_READ_BYTES = 120 * 1024;          // ≈46k tokens at 2.6 chars/token — a god file
function statBytes(p) {
  if (!p || typeof p !== 'string') return 0;
  try { return fs.statSync(p.replace(/^["']|["']$/g, '')).size; } catch { return 0; }
}

// (b) A search typed as Bash instead of as the Grep tool. The tool caps at 250 lines unless
//     head_limit:0 (already denied); `rg foo src/` has no cap at all. Any explicit bound —
//     -m/--max-count, -l, -c, or a head/tail/wc downstream — clears it, so the escape hatch is the
//     same one the operator would reach for anyway.
const BASH_SEARCH  = /^(?:rg|ag|ack|grep)\b/;
const SEARCH_BOUND = /(?:^|\s)-(?:m\b|l\b|c\b|-max-count\b|-files-with-matches\b|-count\b)/;
function isUnboundedBashSearch(cmd) {
  const segs = shellSegs(cmd);
  return segs.some((s, i) =>
    BASH_SEARCH.test(s) && !SEARCH_BOUND.test(s) &&
    !segs.slice(i + 1).some(t => /^(?:head|tail|wc)\b/.test(t)));
}

// (c) `cat` of a big file — a Read with no ranging and no size check at all. Same threshold as (a);
//     a small cat is genuinely cheap and stays neutral.
function isBigCat(cmd) {
  return shellSegs(cmd).some(seg => {
    const m = /^cat\s+(.+)$/.exec(seg);
    if (!m) return false;
    return m[1].split(/\s+/)
      .filter(a => a && !a.startsWith('-') && !REDIRECT_ARG.test(a))
      .some(a => statBytes(a) >= BIG_READ_BYTES);
  });
}

// (d) Full-patch git history. The --stat / --name-only spellings are turn-enders and return 'skip'
//     before this is reached, so only the patch-printing forms land here — and a full working diff
//     on a fat turn is the same bomb as a god-file read, just spelled differently.
const GIT_FULL_PATCH =
  /^git\s+(?:log\s+[^|]*(?:-p\b|--patch\b)|show\b|diff\b(?![^|]*--(?:stat|name-only|name-status)\b))/;

const isGitFullPatch = (cmd) => shellSegs(cmd).some(s => GIT_FULL_PATCH.test(s));

// The Bash classes as a table rather than a stack of ifs — adding the fifth one is now a row, not
// another branch through gateVerdict. Order is not load-bearing between the bombs (a command that
// is two of them deserves either sentence), but the turn-ender check must stay ahead of all of
// them: 'skip' defers the gate entirely and outranks any deny.
const BASH_BOMBS = [
  [isFullSuite, 'this runs the whole test suite, and its output is re-read on every remaining trip'],
  [isUnboundedBashSearch, 'this search has no result cap, so every match it finds lands in context and stays there'],
  [isBigCat, 'this cats a file big enough to dominate the window — a Read with offset/limit costs a fraction'],
  [isGitFullPatch, 'this prints a full patch rather than a --stat, and the whole diff is re-read on every remaining trip'],
];
function bashVerdict(cmd) {
  if (isTurnEnder(cmd)) return { kind: 'skip' };
  const hit = BASH_BOMBS.find(([matches]) => matches(cmd));
  return hit ? { kind: 'deny', why: hit[1] } : null;
}

function gateVerdict(toolName, toolInput) {
  const ti = toolInput || {};
  if (toolName === 'Bash') return bashVerdict(ti.command);
  if (toolName === 'Grep' && ti.output_mode === 'content' && ti.head_limit === 0) {
    return { kind: 'deny', why: 'this Grep is explicitly unbounded, so its output lands in context and stays there' };
  }
  return null;
}
// ── Recommendation-leading Choice bullet ──────────────────────────────────────────────────────
// The card's whole job is to spare the reader the arithmetic, and a neutral "approve or deny"
// hands it straight back: nothing in "~2.1M of re-reads" tells a human whether to push on or
// clear (Andrew 2026-07-26 — "a user shouldn't be forced to figure out if 2M means they should
// keep going or clear/continue"). So a side is named, always, from whichever of two signals is
// available:
//   1. the CALL — a bomb (full suite, unbounded Grep) is a deny whatever the meter says, because
//      its cost is still in the future and therefore in no number on this card;
//   2. the NUMBERS — `rv`, restartVerdict below: is this window fat enough that clearing it pays?
//      Computed ONCE at the call site and handed to BOTH bullets, so Restart states the reading
//      and Choice states the verdict off the identical object. They cannot argue by construction;
//      the old shape had each bullet re-derive the answer and relied on the two staying in step.
// The call wins when both speak. A dead meter (rv == null, nothing measured) is the only path back
// to the old neutral copy — a recommendation with no evidence behind it is noise, and this script
// does not bluff. The losing option stays spelled out in every branch: advisory, not
// authoritarian.
//
// BOTH recommendations carry their why (Andrew 2026-07-30). Until then only `deny` did, and the
// asymmetry hid behind the Restart bullet, which printed the numbers approve omitted — R14's
// two-bullet cut on 2026-07-29 dropped that bullet and left `approve (recommended)` asserting
// bare, four lines under a headline reading "~4.4M tokens of re-reads". At a glance that is
// "4.4M — keep going (recommended)": the reader fuses the verdict to the nearest big number, and
// the number it actually turns on (liveContext vs the fat line) was nowhere on the card. rv.why
// was already built for this branch and thrown away. Approve is the branch that needs its
// evidence MOST — it is the counterintuitive side of every fire, and the side that looks like
// the script rubber-stamping a spend it just called rent.
const choiceBullet = (verdict, { neutral, denyTail }, rv) => {
  const why = verdict && verdict.kind === 'deny' ? verdict.why : rv && rv.clear ? rv.why : null;
  if (why) return `• Choice: deny (recommended) — ${why}. Approving pushes on; ${denyTail}`;
  // denyTail opens lowercase for the mid-sentence slots above; here it starts a sentence.
  if (rv)  return `• Choice: approve (recommended) — ${rv.why}; push on. ` +
    `${denyTail[0].toUpperCase()}${denyTail.slice(1)}`;
  return `• Choice: ${neutral}`;
};
// ── Cold-start meter: what /clear + /continue actually COSTS on this machine (R15b) ───────────
// Every restart recommendation this script has ever made priced the saving and left the price
// blank — "clearing stops that rent from the next trip on" is true only if a fresh session starts
// at zero, and none does. It starts at the fixed payload this repo hands every session (system
// prompt + tool schemas, CLAUDE.md, .claude/rules, the memory index, the skill list), and that
// payload is re-read on every trip of the new session exactly as the old one's was. So the honest
// saving is liveContext MINUS that floor, and the honest cost of taking the restart is the floor
// itself, paid once (Andrew 2026-07-30 — "include the new session startup cost ... so we can show
// that we considered that aspect").
//
// The number is MEASURED here, never assumed: docs quote ~84k from a hand-measurement on one
// repo/one day, and this file does not hardcode another machine's reading. Each session's own
// first request (meter's firstContext) is one sample; the store keeps the last dozen and the card
// quotes their MEDIAN — a mean would be dragged by the odd resumed transcript that slipped the
// COLD_START_MAX_TOK bound. Under COLD_START_MIN_N samples it returns null and every caller falls
// back to its pre-cold-start copy, same discipline as restartVerdict's dead-meter branch.
function coldStartPath(projectDir) { return path.join(stateDir(projectDir), 'cold-start.json'); }

function loadColdStarts(projectDir) {
  try {
    const j = JSON.parse(fs.readFileSync(coldStartPath(projectDir), 'utf8'));
    return Array.isArray(j.samples) ? j.samples : [];
  } catch (_) { return []; }
}

function saveColdStarts(projectDir, samples) {
  try {
    fs.mkdirSync(stateDir(projectDir), { recursive: true });
    fs.writeFileSync(coldStartPath(projectDir),
      JSON.stringify({ samples: samples.slice(-COLD_START_SAMPLES) }));
  } catch (_) { /* a lost sample just delays the reading — never break the gate */ }
}

// Seed from the sibling transcripts already on disk, so the first card that needs the number is
// not the third one. Deliberately bounded: the newest few files, a HEAD-read each (a mature
// transcript runs to tens of MB and this is the PreToolUse critical path), and it only runs while
// the store is short. A file whose first assistant message is past the head budget is skipped, not
// guessed at.
function backfillColdStarts(projectDir, transcriptPath, samples) {
  let names;
  const dir = path.dirname(transcriptPath || '');
  try { names = fs.readdirSync(dir).filter(f => /\.jsonl$/i.test(f)); } catch (_) { return samples; }
  const have = new Set(samples.map(s => s.sid));
  const newest = names
    .map(f => { try { return { f, t: fs.statSync(path.join(dir, f)).mtimeMs }; } catch (_) { return null; } })
    .filter(Boolean).sort((a, b) => b.t - a.t).slice(0, COLD_START_BACKFILL_FILES);
  for (const { f } of newest) {
    const sid = f.replace(/\.jsonl$/i, '');
    if (have.has(sid)) continue;
    const tok = firstContextOfHead(path.join(dir, f));
    have.add(sid);
    if (tok > 0 && tok <= COLD_START_MAX_TOK) samples.push({ sid, tok });
  }
  return samples;
}

// First assistant usage inside the head of a transcript, or 0 if it isn't there.
function firstContextOfHead(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(COLD_START_BACKFILL_BYTES);
    const n = fs.readSync(fd, buf, 0, COLD_START_BACKFILL_BYTES, 0);
    const lines = buf.slice(0, n).toString('utf8').split(/\r?\n/);
    // Drop the tail line: a head-read almost always slices it mid-JSON.
    lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch (_) { continue; }
      if (o && o.type === 'assistant' && o.message && o.message.usage) return ctxTokens(o.message.usage);
    }
    return 0;
  } catch (_) { return 0; }
  finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) { /* noop */ } } }
}

// Record-then-read: the session that renders a card contributes its OWN cold start first, so the
// median always includes the configuration the reader is actually sitting in.
function coldStartTokens(projectDir, sid, m, transcriptPath) {
  if (!projectDir) return null;
  let samples = loadColdStarts(projectDir);
  const before = samples.length;
  const mine = m && m.main && m.main.firstContext;
  if (mine > 0 && mine <= COLD_START_MAX_TOK && !samples.some(s => s.sid === sid)) {
    samples.push({ sid, tok: mine });
  }
  if (samples.length < COLD_START_MIN_N && transcriptPath) {
    samples = backfillColdStarts(projectDir, transcriptPath, samples);
  }
  if (samples.length !== before) saveColdStarts(projectDir, samples);
  const tok = samples.slice(-COLD_START_SAMPLES).map(s => s.tok)
    .filter(t => t > 0).sort((a, b) => a - b);
  if (tok.length < COLD_START_MIN_N) return null;
  const mid = tok.length >> 1;
  return tok.length % 2 ? tok[mid] : Math.round((tok[mid - 1] + tok[mid]) / 2);
}

// ── restartVerdict / restartBullet: price the option the Choice bullet leaves unpriced (R15) ──
// Approving buys ONE more doubled leg; the standing alternative is /clear + /continue. The rebuild
// PRICE is metered and varies honestly — a 40k context at the 1M fire is nearly free to rebuild, a
// 900k one at the 2M fire is not — so the head sentence states that ratio and stops.
//
// Whether to TAKE the restart is a different question, and until 2026-07-27 this file answered it
// with the wrong one. It asked "is the context cheap to rebuild?" (liveContext × 3 ≤ gap) and
// recommended clearing whenever the answer was yes. Two faults, both measured rather than argued:
//
//   · Backwards. A restart's payoff is not the context it rebuilds, it is the rent it STOPS
//     paying — and /clear + /continue does not reload the window, it re-pays a fixed cold start
//     and carries only the next step. So the LEAN window it called cheap is the one case where
//     clearing sheds almost nothing and pays that cold start anyway, and the FAT window it waved
//     past is the one where clearing pays for itself on the very next trip.
//   · Constant. gap is reArmAt(observed, base, fires) − observed, which reduces to
//     base × 2^(fires−1): the observed spend cancels, leaving ≥1M at defaults. Against a
//     liveContext capped by the model's context window that test is true on every fire — the flip
//     point sits at 333k, unreachable on a 200k window, so `approve (recommended)` was dead code
//     and the label never varied. Exactly the wallpaper gateVerdict's own header warns about.
//
// The line that DOES vary, and already means "this window holds more than the work needs", is the
// script's own fat-context threshold — the number fatContextGuard warns on and bombGateWhenFat
// arms against. Reusing it keeps ONE definition of too-much-context, instead of inventing a second
// one four bullets away from the first and letting them drift.
//
// The part the script CANNOT measure is the seam. It has no child_process (deliberately — this
// runs inside PreToolUse on the critical path), so it cannot ask git whether the tree is clean,
// and a turn's ruled-out paths live only in the window and are on no disk at all. So the clearing
// branch names that condition rather than claiming it holds — same discipline as choiceBullet.
//
// Returns null when nothing was measured: no reading, no recommendation, neutral copy.
//
// coldStart (optional, measured — see coldStartTokens) is the floor a fresh session starts at, and
// it moves the LINE, not just the arithmetic behind it. The SAVING is liveContext − coldStart, not
// liveContext: clearing does not take the per-trip rent to zero, it takes it down to the payload
// every session carries. Only that EXCESS is shed-able — so the threshold belongs on the excess,
// and a flat line on total context mismeasures anyone whose floor differs. Two sessions at an
// identical 150k are opposite situations at a 20k floor (130k of shed-able cruft) and at a 120k
// floor (30k, against a 120k restart price).
//
//     fatAt = coldStart + excessBudget        // measured floor
//     fatAt = cfg.contextWarnTokens           // no floor measured yet — flat fallback
//
// So `excessBudget` is the real constant and 150k was only ever its sum with THIS machine's floor:
// at the measured ~62k here, an 88k budget reproduces 150k exactly, and every other config adapts
// (a 20k floor lands at 108k, a 100k floor at 188k). ADDITIVE deliberately, not multiplicative —
// `coldStart × M` collapses at small floors (a 15k floor would set a 30k line) and would need the
// model's context-window size, which this script has no way to read.
//
// ONE test, on ONE quantity (2026-07-31). This used to AND a second "does clearing repay its own
// startup within COLD_START_PAYBACK_TRIPS trips" gate, which measured the same excess against a
// different constant — and measured across a range of floors it could only ever bind above a ~113k
// floor, so at the floor here it was dead code. Two thresholds on one quantity four lines apart is
// exactly the drift the comments above were written to prevent, so the payback gate is gone rather
// than rebuilt on top of the new line. The excess budget subsumes it: it IS a payback horizon,
// stated in tokens instead of trips.
//
// The line is also bounded ABOVE by auto-compaction (~165k on a 200k window): a fatAt past the
// point where the harness compacts anyway can never fire, which is how the pre-2026-07-27 test
// died. Keep excessBudget small enough that coldStart + excessBudget stays under it.
function restartVerdict(liveContext, gap, fatAt, coldStart, excessBudget) {
  if (!liveContext || !(gap > 0) || !(fatAt > 0)) return null;
  // A measured floor moves the line; an unmeasured one leaves the flat default exactly where it
  // was. Same no-floor-no-claim discipline as the copy branches below.
  const line = coldStart > 0 && excessBudget > 0 ? coldStart + excessBudget : fatAt;
  const here = `~${fmtK(liveContext)} of context`;
  const fat = liveContext >= line;
  // Nothing measured yet (a store under COLD_START_MIN_N samples): the pre-2026-07-30 reading,
  // word for word. An unmeasured floor is not quoted as zero and not guessed at.
  if (!(coldStart > 0)) {
    return fat
      ? { clear: true,
          why: `${here} is past the ~${fmtK(line)} fat line, so clearing stops that rent from ` +
               `the next trip on` }
      // Carries its consequence like the clear branch does — choiceBullet quotes this verbatim as
      // the approve recommendation's evidence, and "under the fat line" alone states a reading
      // without saying what follows from it.
      : { clear: false,
          why: `${here} is under the ~${fmtK(line)} fat line, so clearing sheds little` };
  }
  const net = Math.max(0, liveContext - coldStart);
  // ONE UNIT for the two figures the card weighs against each other (Andrew 2026-07-31, auditing
  // his own card). `net` is RAW cache-read tokens; the startup floor it gets compared to in
  // clearTail is fresh input written to cache — billed ~10x apart, printed as bare "k" apiece.
  // "sheds ~119k a trip" beside "re-pays ~62k of startup" reads as a 2:1 win on the first trip,
  // when the real per-trip saving is ~12k against a ~62k one-time price. Same mistake the Cost
  // bullet already fixed by weighting rent (see rentAskCopy), one clause later — so shed renders
  // CACHE-WEIGHTED too, and now every figure on the card is in the same money.
  const shed = Math.round(net * CACHE_READ_X);
  // ...and the comparison that unit makes possible, in the unit the READER has: trips. This is
  // NOT the payback gate deleted earlier today (see the header above) — that one AND-ed a second
  // threshold onto the fat line and decided things. This decides nothing; it prints the division
  // the reader would otherwise have to do wrong. A FLOOR, not an estimate: the cache-write premium
  // (CACHE_WRITE_5M_X..CACHE_WRITE_1H_X) is charged here at 1x, and a cleared window refills as it
  // works — both push real payback later, never earlier.
  const payback = shed > 0 ? Math.ceil(coldStart / shed) : null;
  // why names the NET and where it came from, never the floor's own figure. The floor is quoted
  // exactly once per card, by whichever line describes the restart itself — restartBullet on
  // R13b, the deny tail on R14 (which has no Restart bullet). Until 2026-07-30 this clause
  // carried it too, so an R13b card printed "~61k of startup" twice inside four lines, and an
  // R14 card printed it only when the recommendation happened to come from the numbers.
  // One test now — `fat` alone, against a line that already knows the floor. The old second
  // condition is folded into where the line sits, not ANDed beside it.
  if (fat) {
    return { clear: true, coldStart, payback,
      why: `${here} is past the ~${fmtK(line)} fat line, so clearing sheds ~${fmtK(shed)} a ` +
           `trip net of startup` };
  }
  return { clear: false, coldStart, payback,
    why: `${here} is under the ~${fmtK(line)} fat line, so clearing nets only ~${fmtK(shed)} a ` +
         `trip after startup` };
}
// The price of the deny option, in the deny option's own sentence. R14 dropped its Restart
// bullet (see rentAskCopy), which left the measured floor reachable ONLY through rv.why — and
// choiceBullet discards rv.why whenever the pending CALL is a bomb, because the call wins. So on
// the branch that fires most (a bomb deny), the card recommended /clear + /continue and priced
// it at nothing (Andrew 2026-07-30 — the tradeoff has to be visible, or "why not clear sooner"
// has no answer on the card). Riding in denyTail puts it on all three branches at once, since
// every branch spells the losing option out. Unmeasured floor => the pre-2026-07-30 wording,
// word for word: this script does not quote a floor it has not measured.
// The payback clause rides HERE, not in rv.why, for the same reason the floor does: this is the
// one sentence on the card that spells the clearing option out, and choiceBullet throws rv.why
// away on a bomb deny. Putting the two halves of the trade in one clause is the whole point —
// a price and the number of trips that price takes to earn back, side by side, in one unit.
const clearTail = rv => rv && rv.coldStart > 0
  ? ` — a fresh session here re-pays ~${fmtK(rv.coldStart)} of startup` +
    (rv.payback ? `, ~${rv.payback} trip${rv.payback === 1 ? '' : 's'} to break even` : '') +
    `, then carries only the next step`
  : ' carrying only the next step';
// Position clause — the reading the bullet opens on. R13b is the only caller: R14 dropped its
// restart bullet on 2026-07-29 (see rentAskCopy), which also retired the pos-less variant this
// used to support for it.
const restartPos = reqs => reqs == null
  ? 'this turn is carrying' : `${reqs} round trip${reqs === 1 ? '' : 's'} carrying`;
function restartBullet(pos, liveContext, gap, rv) {
  if (!liveContext || !(gap > 0)) return '';   // meter came back empty — say nothing over guessing
  // "rebuilds that" was the same fiction restartVerdict carried: a restart does not reload the
  // window, it re-pays the startup floor and carries the next step only. With a measured floor the
  // bullet prices the thing that actually gets paid; without one it keeps the old upper bound.
  const cost = rv && rv.coldStart > 0 ? rv.coldStart : liveContext;
  const pct = Math.round((cost / gap) * 100);
  const price = `~${pct}% of the ~${fmtK(gap)} more this turn spends reaching the next check`;
  const head = rv && rv.coldStart > 0
    ? `• Restart: ${pos} ~${fmtK(liveContext)} of context — /clear + /continue re-pays ` +
      `~${fmtK(cost)} of startup, ${price}.`
    : `• Restart: ${pos} ~${fmtK(liveContext)} of context — /clear + /continue rebuilds ` +
      `that for ${price}.`;
  // Evidence only — the verdict lives in choiceBullet, off the SAME rv this was handed, so the two
  // bullets read as reading-then-recommendation instead of saying "push on" twice in four lines.
  if (!rv) return `${head}\n`;
  return rv.clear
    ? `${head} Past the fat line — but take the restart FROM a commit point: what this turn ` +
      `ruled out is not on disk.\n`
    // Without a floor the only thing that can be said is that the window is small. With one, say
    // WHY it isn't worth clearing — how much of the window a fresh session would just re-pay — so
    // the tail stops repeating the "rebuilds it back" fiction the head just dropped.
    //
    // The SHARE, not a superlative. This branch runs the whole not-fat band, i.e. everything
    // below coldStart + excessBudget, where startup's share ranges from 100% down to
    // coldStart/(coldStart + excessBudget) — 41% at this machine's ~62k floor. "Most of that
    // window is startup" was therefore false across the top third of its own range (a 141k
    // window on a 62k floor is 44%), and this file does not bluff. The share also stays out of
    // rv.why's way: that clause names the shed-able NET, this one names what is not shed-able.
    : rv.coldStart > 0
      ? `${head} Startup alone is ~${Math.round((rv.coldStart / liveContext) * 100)}% of that ` +
        `window.\n`
      : `${head} Lean enough that a restart would rebuild most of it back.\n`;
}
// total tokens PROCESSED (in + out + cache read/write) — the unit user-facing check-ins lead
// with. Deliberately unweighted; the dollar figure beside it carries the per-model weighting.
const tokOne = v => v.inp + v.out + v.cr + v.cw;
const tokensOf = pm => Object.values(pm).reduce((a, v) => a + tokOne(v), 0);
const sessionTokens = m => tokensOf(m.main.perModel) + tokensOf(m.agents.perModel);
// R13b work-volume meter: what a turn actually DID — new input, output, and cache writes at
// full weight; cache re-reads at their 0.1x billing weight. Unweighted, re-reads are rent
// (context size × round trips) and dwarf real work ~16 tool calls into any fat-context turn.
const workOne = v => v.inp + v.out + v.cw + v.cr * CACHE_READ_X;
const workTokensOf = pm => Object.values(pm).reduce((a, v) => a + workOne(v), 0);
const workTokens = m => workTokensOf(m.main.perModel) + workTokensOf(m.agents.perModel);
// R14 rent meter: the OTHER half of the same split — cache re-reads, RAW. workTokens discounts
// these 10× because for judging task SIZE a re-read is not work; this meter keeps them whole
// because for judging RENT a re-read is the entire phenomenon, compounding as context × round
// trips. So the two gates read the same turn through opposite lenses and neither hides the other.
//
// Raw is the right unit to METER in and the wrong unit to PRINT. 0.1× is not a discount this
// script elects to apply — it is the price (CACHE_READ_X, and the real usd math in meter()) — so
// a raw figure overstates the bill 10×, and printed beside the already-weighted workTokens it
// overstated the rent:work ratio by that same factor until 2026-07-30. Thresholds and geometric
// re-arms stay in these raw units; rentAskCopy converts at the point of display, and any new
// caller that PRINTS this number must convert too.
const crTokensOf = pm => Object.values(pm).reduce((a, v) => a + (v.cr || 0), 0);
const crTokens = m => crTokensOf(m.main.perModel) + crTokensOf(m.agents.perModel);
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
// UserPromptSubmit is a fold over the per-rule guards below: each guard reads/mutates the
// shared per-turn ctx {data, projectDir, cfg, sid, st, m, usd$, crossed, official} and returns
// {notes, block}. Notes accumulate into one <token-guard> injection at the end of the fold; a
// truthy block pre-empts the turn instead (state saved, {decision:'block'} emitted, later
// guards never run).

// R8 door 3 — user-typed slash command whose payload is bomb-sized. UserPromptSubmit has no
// "ask", and an annotation would ship in the same request as the payload — so the preventive
// form is a block, idleGate-style: ↑ then Enter re-sends, and the one-shot key lets that
// second send pass. Block reason is USER-facing (Claude never sees it). Default OFF.
function r8CommandPayloadGuard(ctx) {
  const { cfg, st, projectDir } = ctx;
  const cmd = /^\/([\w:-]+)/.exec(String(ctx.data.prompt || '').trim());
  if (!cfg.commandPayloadGate || !cmd) return { notes: [], block: null };
  if (st.payloadGateOkOnce === cmd[1]) {
    st.payloadGateOkOnce = null; // charge accepted
    saveState(projectDir, ctx.sid, st);
    return { notes: [], block: null };
  }
  const tok = commandPayloadTokens(projectDir, cmd[1]);
  if (tok == null || tok <= cfg.bombJumpTokens) return { notes: [], block: null };
  st.payloadGateOkOnce = cmd[1];
  // ttl 2: the payload lands only on the re-send's request, so the first post-block
  // prompt legitimately sees no jump — don't let it disarm the R3 suppression early.
  st.approvedPayloadHop = { est: tok, ttl: 2 };
  return { notes: [], block:
    `⚠️ Hey — running /${cmd[1]} will load ~${fmtK(tok)} tokens into this conversation ` +
    `permanently; every message after it will re-read them.\n\n` +
    `To run it anyway: press ↑ then Enter. To keep this session lean: run it in a ` +
    `throwaway session instead, or ask here for just its conclusion via a subagent.` };
}

// R2 receipt — a fleet finished since the last prompt; show the bill once.
function r2ReceiptGuard(ctx) {
  const notes = [];
  if (ctx.st.pendingWfReceipt) {
    notes.push(ctx.st.pendingWfReceipt);
    ctx.st.pendingWfReceipt = null;
  }
  return { notes, block: null };
}

// R3 context-bomb tripwire — single-hop jump beyond bombJumpTokens since the last prompt.
// Priced by the turns that will re-read it, not the hop itself — at CACHE-READ weight
// (~10%), the same basis as turnFloorUSD: warm turns re-read the payload from prompt cache,
// and full price only recurs on the first turn after a gap longer than the cache TTL (R4's
// story). Numbers stay "~" — the plan meter's exact cache weighting isn't published.
// (Andrew, 2026-07-20: the old ×50 full-price extrapolation overstated ~10× on warm loops.)
function r3ContextBombGuard(ctx) {
  const { cfg, st, m } = ctx;
  const notes = [];
  if (st.lastLiveContext != null) {
    const jump = m.liveContext - st.lastLiveContext;
    if (jump > cfg.bombJumpTokens && st.approvedPayloadHop) {
      // R8: the user already decided this payload at the pre-gate — one decision, one surface.
      // (Known hole, accepted: an unrelated bomb inside the ttl window rides the suppression.)
      // The landing upgrades the budgets table: measured jump replaces door 1's stat floor.
      if (st.approvedPayloadHop.skill) {
        recordObservedSkill(ctx.projectDir, st.approvedPayloadHop.skill, jump, null, cfg);
      }
      st.approvedPayloadHop = null;
    } else if (jump > cfg.bombJumpTokens) {
      notes.push(bombLandingNote(ctx, jump));
    } else if (st.approvedPayloadHop && --st.approvedPayloadHop.ttl <= 0) {
      st.approvedPayloadHop = null; // R8 gate fired but nothing landed (denied) — disarm
    }
  }
  st.lastLiveContext = m.liveContext;
  st.scanOffset = m.main.rawLength;
  return { notes, block: null };
}

// A bomb landed: attribute it, record a skill landing for R8 door 1, arm the fat-context
// escalation, and word the warning.
function bombLandingNote(ctx, jump) {
  const { cfg, st, m } = ctx;
  const who = attributeJump(ctx.data.transcript_path, st.scanOffset);
  const culprit = who ? ` (largest payload: ${who.label})` : '';
  // Attribution named a skill -> record the measured landing so door 1 can gate it next
  // time (built-ins never hit the pre-gate: no files to stat until a landing prices them).
  const skillHit = who && /^Skill\((.+)\)$/.exec(who.label);
  if (skillHit) recordObservedSkill(ctx.projectDir, skillHit[1], jump, who.chars, cfg);
  if (cfg.bombGateWhenFat && m.liveContext >= cfg.contextWarnTokens) st.bombGateArmed = true;
  const bombCost = ctx.usd$
    ? `the per-turn floor is now ≥ ${fmtUSD(m.turnFloorUSD)} (50 more turns ≈ ` +
      `${fmtUSD(m.turnFloorUSD * 50)})`
    : `~${fmtK(Math.round(jump * CACHE_READ_X))} tokens per cache-warm turn (a cache read, ~10% ` +
      `weight), and ${fmtK(jump)} of context-window headroom gone until trimmed`;
  return (
    `context-bomb: something just loaded +${fmtK(jump)} tokens into this conversation` +
    `${culprit} — every future turn re-reads it: ${bombCost}. Relay as ` +
    `a STANDALONE warning block, never woven into your answer: open with "⚠️ Hey —" and ` +
    `keep a warm conversational voice (helpful friend, not system log), 2-3 plain sentences ` +
    `naming what landed, then the out ACTION-FIRST (ux copy/action-lines-lead-with-the-action): ` +
    `"/clear, then /continue to drop this weight and keep the thread" (a one-time reference ` +
    `belongs in a disposable subagent; once its useful part is extracted, /continue picks the ` +
    `thread back up in the fresh session, nothing to prep). Then a horizontal rule before ` +
    `the answer itself.`
  );
}

// R4 idle-return — cache TTL ≈ 1h; a fat stale context re-WRITES at full write rates.
// One-shot per gap (keyed on the timestamp we returned to). Thin contexts refill for pennies.
function r4IdleReturnGuard(ctx) {
  const { cfg, m, st } = ctx;
  if (!m.lastTs || m.liveContext < cfg.contextWarnTokens) return { notes: [], block: null };
  const gapMin = (Date.now() - m.lastTs) / 60000;
  if (gapMin <= cfg.idleWarnMinutes || st.warnedIdleAt === m.lastTs) return { notes: [], block: null };
  st.warnedIdleAt = m.lastTs;
  // Suppression window for R4b: with idleGate on, this BLOCKS before the re-upload happens, so
  // the cold write lands on the user's ↑+Enter re-send moments later. R4b keys on the request
  // AFTER the gap and R4 on the one before, so the keys can't dedupe each other — the clock does.
  st.idleFiredAt = Date.now();
  // The pointer feeds /continue's ladder (and /recover-context pid=N stays usable as the
  // manual form) — staged best-effort; /continue's lineage + walk-back recover without it.
  writeRecoverPointer(ctx.projectDir, ctx.sid, recoverWindowMinutes(m));
  // idleGate: pre-empt the charge — block THIS submission before anything reaches the API.
  // The message stays in the CLI input history (up-arrow + Enter re-sends), and the
  // one-shot key set above lets that second send pass through silently: charge accepted.
  // Block reason is USER-facing text (Claude never sees it), so it follows the warning
  // copy rules directly — future tense, since nothing has been paid yet.
  if (cfg.idleGate) {
    return { notes: [], block:
      `⚠️ Hey — you left this session sitting for over an hour, longer than the API ` +
      `keeps a conversation cached. If you continue here, Claude Code will re-upload ` +
      `all ~${fmtK(m.liveContext)} tokens of it at full price.\n\n` +
      `To continue anyway: press ↑ then Enter. To pick this work up cheaply instead: ` +
      `/clear, then /continue — it reloads the recent thread of this conversation.` };
  }
  return { notes: [idleReturnNote(m.liveContext)], block: null };
}

// Recovery window: walk back until ~15min of real interaction is covered (gaps
// count at most 5min so idle stretches don't eat the budget), then round the wall-clock
// offset up to the nearest 5min.
function recoverWindowMinutes(m) {
  const ts = m.main.tsList || [];
  let i = ts.length - 1;
  for (let acc = 0; i > 0 && acc < 15 * 60000; i--) acc += Math.min(ts[i] - ts[i - 1], 5 * 60000);
  return Math.max(5, Math.ceil((Date.now() - (ts[i] || m.lastTs)) / 300000) * 5);
}

// Fat-context advisory — the core "1 question in a 5h window" guard. Injected on EVERY prompt
// past the threshold (it's ~50 tokens; the decision is per-prompt by nature).
function fatContextGuard(ctx) {
  const m = ctx.m;
  if (m.liveContext < ctx.cfg.contextWarnTokens) return { notes: [], block: null };
  const floorPart = ctx.usd$
    ? `has a ≥ ${fmtUSD(m.turnFloorUSD)} re-read floor before any work happens`
    : `re-reads all ~${fmtK(m.liveContext)} tokens of it against the plan window before any ` +
      `work happens`;
  return { notes: [
    `live context ≈ ${fmtK(m.liveContext)} tokens — every turn in this session now ` +
    `${floorPart}. If the user's prompt is a quick one-off unrelated to the ongoing work, ` +
    `answer it, but ALSO tell them it would be much ${ctx.usd$ ? 'cheaper' : 'lighter on their ' +
    'usage window'} asked in a fresh session (this context is re-sent on every turn).`
  ], block: null };
}

// R6 scope-drift nudge — when the dominant share of live context belongs to scopes the
// session has moved past, every turn pays rent on settled work. Scope data comes from the
// terminal-title per-title ledger ({sid}.history.jsonl) — the same watermarks its /clear
// advisor reads — so drift and advisor can never disagree about what a topic cost. The nudge
// fires ONLY above driftMinContextTokens (the STAY floor below which a cut can't pay for
// itself), so at fire time the cut is a foregone conclusion by construction — hand the user
// the action-first /clear + /continue out (a recover-pointer staged at fire time pins the
// ledger boundary, so /continue self-packages the thread, no prep). The dependency
// case drift can't see (a build->article day reads as two scopes, but the article feeds on
// the build context) is handled in the copy itself: it advises STAYING when the new scope
// builds on the earlier work. Model relays the block; it NEVER runs the command.
// Once per scope (nudgedScope).
function r6ScopeDriftGuard(ctx) {
  const { cfg, st, projectDir, sid } = ctx;
  const notes = [];
  if (!cfg.driftNudge) return { notes, block: null };
  const tenures = readLedgerTenures(projectDir, sid);
  const cur = tenures[tenures.length - 1];
  if (!cur) return { notes, block: null };
  trackScopeResidency(ctx, cur, tenures);
  cur.prompts = st.curScopePrompts;
  // Defer loop: consume a model-written drift-deferred flag (the in-turn judge refused the
  // staged card — stale premise or open threads), snooze, and re-arm the one-shot when the
  // snooze expires; driftVerdict then re-stages and the model re-judges with a fresh premise.
  const deferred = consumeDriftDeferred(projectDir);
  driftDeferralTick(st, deferred, cfg.driftRetryPrompts);
  if (deferred && st.driftSnooze) logLine(projectDir,
    `sid=${sid.slice(0, SID_SHORT_LEN)} drift-deferred scope="${st.driftSnooze.scope}" retry@${st.driftSnooze.retryAtPrompts}p`);
  const v = driftVerdict(tenures, ctx.m.liveContext, cfg);
  if (v.fire && st.nudgedScope !== cur.scope) notes.push(fireDriftNudge(ctx, cur, v));
  return { notes, block: null };
}

// Prompt residency is the one thing the ledger can't carry — counted here in state. The
// ledger gains the new-scope line at the shift turn's first paint after the title write,
// so this counter starts on the guard's next prompt — the same "first seen on turn 2"
// beat the old scopeLog had.
function trackScopeResidency(ctx, cur, tenures) {
  const st = ctx.st;
  if (st.curScope === cur.scope) {
    st.curScopePrompts = (st.curScopePrompts || 0) + 1;
  } else {
    st.curScope = cur.scope; st.curScopePrompts = 1;
    if (tenures.length > 1) logLine(ctx.projectDir,
      `sid=${ctx.sid.slice(0, SID_SHORT_LEN)} scope="${cur.scope}" ctx=${fmtK(ctx.m.liveContext)}`);
  }
}

// The nudge fires: one-shot the scope, word the note, and stage the recover-pointer.
function fireDriftNudge(ctx, cur, v) {
  const { st, projectDir, sid } = ctx;
  st.nudgedScope = cur.scope;
  st.driftSnooze = null;
  logLine(projectDir,
    `sid=${sid.slice(0, SID_SHORT_LEN)} drift-nudge from="${v.dominant}" to="${cur.scope}" prior=${v.priorPct}%`);
  const note = driftNote(v.dominant, cur.scope, v.priorPct, ctx.cfg.driftAutoMigrate, ctx.m.liveContext);
  // R11 (revised 2026-07-21): stage a recover-pointer pinned to the current tenure's
  // enteredIso — the drifted thread's exact boundary. /continue's auto mode reads
  // recover.json before any heuristic rung, so after the nudge's "/clear + /continue"
  // (one-liner and prose branch alike) the fresh session recovers exactly this thread.
  // (Replaces the retired SessionStart-injection candidate, deleted 2026-07-24 —
  // git history is the museum.)
  const ageMin = Math.max(1, Math.round((Date.now() - (Date.parse(cur.enteredIso) || Date.now())) / 60000));
  writeRecoverPointer(projectDir, sid, ageMin, cur.enteredIso);
  return note;
}

// Spend-step check-ins, denominated per billing (2026-08-05): API-billed sessions step in $
// (the real bill); a subscription steps in TOKENS via sessionWarnTokens — the 2026-07-18 $
// suppression stands ($-equivalent steps map to nothing the user experiences), but it had
// removed the session-total EVENT with it, and a 15M-token session then sailed to the hard
// gate unannounced. The token ladder reads sessionTokens(m) — the same figure the gate's
// subscription copy shows. Unknown billing keeps the $ check-ins (the dollars may be real).
// `kind` is injectable for tests only; callers take the default.
function crossedSpendSteps(cfg, m, st, kind = billingKind()) {
  if (kind === 'subscription')
    return (cfg.sessionWarnTokens || []).filter(s => sessionTokens(m) >= s && (st.warnedTok || 0) < s);
  return (cfg.sessionWarnUSD || []).filter(s => m.usd >= s && st.warnedUSD < s);
}

// Anthropic's own window meter — fetched at most ONCE per prompt (cached >=180s, so most prompts
// are cache-served; the network hit is only every few minutes). Shared by the two window flags
// below AND the spend-step check-in, so the fetch never happens twice in a turn.
async function officialUsagePrep(ctx) {
  const cfg = ctx.cfg;
  ctx.crossed = crossedSpendSteps(cfg, ctx.m, ctx.st);
  ctx.official = null;
  if (cfg.officialUsageFetch &&
      (cfg.windowSpikeWarn || cfg.windowThresholdWarn || cfg.windowThresholdGate ||
       ctx.crossed.length)) {
    const off = await fetchOfficialUsage(ctx.projectDir);
    if (off && off.data) ctx.official = off.data;
  }
  return { notes: [], block: null };
}

// R12 — window guards, both grounded in that meter. The stake here is a THROTTLE (lost access
// until reset), which is unsayable in dollars, so the copy is always window-% and never $.
//   R12a window-spike: one turn ate a big slice of the 5h window (the delta of the meter's own
//     %, so it self-calibrates — no budget to set).
//   R12b window-threshold: the tightest live window (5h or weekly) crossed the high-water mark
//     — once per window cycle; re-arms when that window resets. windowThresholdGate (opt-in)
//     escalates that same one-shot from a note to a BLOCK (mirrors idleGate).
function r12aWindowSpikeGuard(ctx) {
  const { cfg, st } = ctx;
  const notes = [];
  if (!cfg.windowSpikeWarn) return { notes, block: null };
  const now5h = fiveHourWindow(ctx.official);
  const prev = st.lastWindowPct != null
    ? { pct: st.lastWindowPct, resetsAt: st.lastWindowResetsAt } : null;
  const sv = windowSpikeVerdict(now5h, prev, st.lastTurnDeltaUsd || 0, cfg);
  // windowSpikeConfirm upgrades the passive note to an interactive AskUserQuestion card — a SOFT
  // relay, never a decision:'block', so it can't stall the turn. Off -> the standalone note.
  if (sv.fire) {
    const spikeNote = spikeNoteFor(ctx, sv, now5h);
    if (spikeNote) notes.push(spikeNote);
  }
  // advance the baseline whenever the meter is live (fired or not) so the next delta is fresh
  if (now5h) {
    st.lastWindowPct = now5h.pct; st.lastWindowResetsAt = now5h.resetsAt;
    st.lastWindowAtIso = new Date().toISOString();
  }
  return { notes, block: null };
}

// Attribute the interval's spend across sessions before wording the flag — the meter is
// account-level, so "that last turn" is only sayable when the ledger shows we were alone.
// The confirm card returns null when the window resets before projected exhaustion —
// provably no throttle risk, so nothing is relayed at all (threshold ladder still runs).
function spikeNoteFor(ctx, sv, now5h) {
  const st = ctx.st;
  const attr = spikeAttribution(readSpendLedger(st.lastWindowAtIso), ctx.sid);
  const mins = st.lastWindowAtIso && Number.isFinite(Date.parse(st.lastWindowAtIso))
    ? Math.max(1, Math.round((Date.now() - Date.parse(st.lastWindowAtIso)) / 60000)) : null;
  return ctx.cfg.windowSpikeConfirm
    ? windowSpikeConfirmNote(sv, now5h, ctx.sid, attr, mins)
    : windowSpikeNote(sv, now5h, attr, mins);
}

function r12bWindowThresholdGuard(ctx) {
  const { cfg, st } = ctx;
  if (!cfg.windowThresholdWarn && !cfg.windowThresholdGate) return { notes: [], block: null };
  const worst = tightestWindow(ctx.official);
  const warned = effectiveWarn(worst, worst ? loadWindowWarn(worst.name) : null, st.warnedWindow);
  const tv = windowThresholdVerdict(worst, warned, cfg);
  if (!tv.fire) return { notes: [], block: null };
  st.warnedWindow = { name: tv.name, resetsAt: tv.resetsAt, rung: tv.rung };
  saveWindowWarn(tv.name, st.warnedWindow);
  // Gate: pre-empt the turn before anything reaches the API — TOP rung only (lower rungs
  // are FYI bearings and never block). The one-shot key set above lets the ↑+Enter re-send
  // pass through silently next time (charge accepted). Note is the fallback.
  if (cfg.windowThresholdGate && tv.rung === tv.topRung) {
    return { notes: [], block: windowThresholdGateReason(tv) };
  }
  return { notes: cfg.windowThresholdWarn ? [windowThresholdNote(tv, cfg)] : [], block: null };
}

// Session-spend steps — announce once per crossed step. v2: total includes fleets.
// The trigger is dollar-weighted on API billing (cross-model normalization) and token-stepped
// on a subscription; the MESSAGE leads with tokens either way, one metric per line. The 5h
// scan is fresh-parse (no cache) — acceptable only because step crossings are rare by design.
function spendStepGuard(ctx) {
  if (!ctx.crossed.length) return { notes: [], block: null };
  if (billingKind() === 'subscription') ctx.st.warnedTok = Math.max(...ctx.crossed);
  else ctx.st.warnedUSD = Math.max(...ctx.crossed);
  // Anthropic's own percentages lead when reachable — the definitive measures; everything
  // after is supporting detail (Andrew 2026-07-12).
  const ol = ctx.official ? officialLines(ctx.official) : [];
  const statLines = [...ol, ...sessionStatLines(ctx), ...windowStatLines(ctx, ol.length > 0)];
  if (ctx.cfg.planDetect) {
    const pl = planLine(planInfo());
    if (pl) statLines.push(pl);
  }
  return { notes: [
    `token check-in: relay to the user in your next reply as a STANDALONE stat block — ` +
    `one metric per line exactly as given (labels, numbers, and indentation verbatim), ` +
    `no drama, no commentary between the lines:\n${statLines.join('\n')}`
  ], block: null };
}

// The check-in's session lines: total (main + fleets), then qualifiers only when they change
// the reading, so the block stays scannable.
function sessionStatLines(ctx) {
  const m = ctx.m;
  const split = m.agents.files
    ? ` = main ${fmtK(tokensOf(m.main.perModel))} + ${m.agents.files} agents ` +
      `${fmtK(tokensOf(m.agents.perModel))}` : '';
  const lines = [
    `This session: ${fmtK(sessionTokens(m))} tokens${split}` +
      (ctx.usd$ ? ` (≈ ${fmtUSD(m.usd)} API-list)` : ''),
  ];
  const pm = mergedPerModel(m);
  const tot = tokensOf(pm);
  const cr = Object.values(pm).reduce((a, v) => a + v.cr, 0);
  if (tot && cr / tot > 0.7) {
    // raw total dominated by cache re-reads reads scarier than it is (re-reads are
    // discounted against plan limits and billed at a tenth on API)
    lines.push(`  ↳ ${fmtK(cr)} of those are cached re-reads (weigh far less against ` +
      `your plan) · fresh work ${fmtK(tot - cr)}`);
  }
  const byModel = Object.entries(pm)
    .map(([k, v]) => ({ name: shortModel(k), tok: tokOne(v) }))
    .filter(x => tot && x.tok / tot >= 0.05)
    .sort((a, b) => b.tok - a.tok);
  if (byModel.length > 1) {
    // a Haiku token != a Fable token — flag mixed-model totals
    lines.push(`  ↳ models: ${byModel.map(x => `${x.name} ${fmtK(x.tok)}`).join(' · ')}`);
  }
  return lines;
}

// The check-in's cross-session lines: the 5h window scan, plus the budget-estimate fallback
// only when the official meter is unreachable.
function windowStatLines(ctx, haveOfficial) {
  const lines = [];
  try {
    const win = scanWindow(Date.now() - 5 * 3600 * 1000);
    lines.push(`Last 5h, all sessions: ${fmtK(win.tokens)} tokens` +
      (ctx.usd$ ? ` (≈ ${fmtUSD(win.usd)})` : ''));
    if (!haveOfficial && ctx.cfg.windowBudgetUSD) {
      // Estimate fallback only when the official meter is unreachable. % uses the WEIGHTED
      // figure, not raw tokens — Max metering discounts cache reads and weights by model,
      // so the $-equivalent is the mix-robust proxy. "≈" + label: it's calibrated, not measured.
      lines.push(`Plan target: ≈${Math.round((win.usd / ctx.cfg.windowBudgetUSD) * 100)}% ` +
        `of your 5h budget used (estimate — official meter unreachable)`);
    }
  } catch (_) { /* window scan is best-effort — the session line still ships */ }
  return lines;
}

// R13a — plan-first steer: the predictive half no meter can do. A hook only sees tokens
// after they're spent; the model can gauge a request's blast radius BEFORE. One short
// model-facing line on every prompt (~70 tokens) — cheap against the 10×-normal spiral it
// exists to preempt (evidence: the 2026-07-24 7M-token session that no gate saw coming).
// Pushed LAST so real warnings lead the note block.
function r13aPlanSteerGuard(ctx) {
  if (!ctx.cfg.planSteer) return { notes: [], block: null };
  return { notes: [
    `plan-steer (silent steering — never mention or relay this note): before starting the ` +
    `work this prompt asks for, gauge its blast radius. If it plausibly needs ` +
    `>~${fmtK(PLAN_STEER_TOK)} tokens of work (repo-wide sweep, multi-repo change, ` +
    `open-ended "fix/migrate everything"), FIRST propose a plan with session-sized substeps ` +
    `and get a go-ahead — a normal task finishes under ~${fmtK(TASK_NORM_TOK)} tokens.`
  ], block: null };
}

// A gate fired: persist state, then pre-empt the turn. Block reasons are USER-facing text
// (Claude never sees them), so they follow the warning copy rules directly.
function emitBlock(ctx, reason) {
  saveState(ctx.projectDir, ctx.sid, ctx.st);
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

function claimAdvisoryGuard(ctx) {
  try {
    if (!claimRegistryMod || !claimRegistryMod.readLiveClaims) return { notes: [], block: null };
    const liveClaims = claimRegistryMod.readLiveClaims({ selfSid: ctx.sid, now: Date.now() });
    if (!liveClaims || !liveClaims.length) return { notes: [], block: null };

    const siblingClaims = new Map();
    for (const c of liveClaims) {
      if (c.sid && c.sid !== ctx.sid) {
        if (!siblingClaims.has(c.normPath)) {
          siblingClaims.set(c.normPath, c);
        }
      }
    }

    if (siblingClaims.size > 0) {
      const sample = [...siblingClaims.values()][0];
      const sidShort = sample.sid.slice(0, 8);
      return {
        notes: [
          `claim-advisory (silent advisory — do not quote verbatim): live sibling session ${sidShort} ` +
          `holds an active claim on ${sample.path}. Consider standing down if your task requires editing this file.`
        ],
        block: null
      };
    }
  } catch (err) {}
  return { notes: [], block: null };
}

// Rule order is note order; officialUsagePrep must precede the three meter consumers after it.
const PROMPT_GUARDS = [claimAdvisoryGuard, r2ReceiptGuard, r3ContextBombGuard, r4IdleReturnGuard, fatContextGuard,
  r6ScopeDriftGuard, officialUsagePrep, r12aWindowSpikeGuard, r12bWindowThresholdGuard,
  spendStepGuard, r13aPlanSteerGuard];

async function onUserPromptSubmit(data, projectDir) {
  const cfg = loadConfig(projectDir);
  const sid = data.session_id || '';
  const st = loadState(projectDir, sid);
  const ctx = { data, projectDir, cfg, sid, st };

  // R8 runs pre-meter: it prices the command's payload from disk before the turn costs anything.
  const gate = r8CommandPayloadGuard(ctx);
  if (gate.block) return emitBlock(ctx, gate.block);

  // R9 — new turn, new accumulator (persisted by whichever branch saves state below).
  st.turnPayloadTok = 0; st.turnPayloadWarned = false; st.miniBombGateArmed = false;

  const m = meterSession(data.transcript_path, { fleet: cfg.fleetMeter, projectDir });
  if (!m.main.turns) return; // brand-new session — nothing to say
  // R13b — new turn: re-baseline the turn-spend meter and disarm any same-turn re-arm.
  // (Turn 1 of a brand-new session never reaches here — PreToolUse lazy-arms the baseline.)
  st.turnStartWorkTok = workTokens(m); st.turnGateAt = null; st.turnGateFires = 0;
  // R14 — same re-baseline for the rent meter (re-reads + round trips since this prompt).
  st.turnStartCr = crTokens(m); st.turnStartReqs = m.main.turns; st.rentGateAt = null;
  st.rentGateFires = 0;
  ctx.m = m;
  ctx.usd$ = wantDollars(cfg); // false => tokens-only copy (subscription users)

  const notes = [];
  for (const guard of PROMPT_GUARDS) {
    const r = await guard(ctx);
    notes.push(...r.notes);
    if (r.block) return emitBlock(ctx, r.block);
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
  // R12a attribution ledger — this turn's spend, visible to every OTHER session's spike check
  // (the meter is account-level; see spendLedgerPath). Dust floor keeps no-op turns out.
  if (cfg.windowSpikeWarn && delta > LEDGER_ENTRY_DUST_USD) {
    appendSpendLedger({ ts: new Date().toISOString(), sid,
      proj: path.basename(projectDir || ''), usd: Math.round(delta * 10000) / 10000 });
  }

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
    `sid=${sid.slice(0, SID_SHORT_LEN)} turn=+${fmtUSD(Math.max(0, delta))} session=${fmtUSD(m.usd)} ` +
    `tok=${fmtK(sessionTokens(m))}${agentsPart} ctx=${fmtK(m.liveContext)} ` +
    `floor=${fmtUSD(m.turnFloorUSD)}/turn turns=${m.turns} ${models}`);
}

// ---------------------------------------------------------------------------
// PreToolUse guards. Each takes the shared ctx and returns null to fall through, or a decision
// { kind: 'ask' | 'deny', reason }; PRETOOL_GUARDS at the bottom folds them in rule order.
// Same shape as the UserPromptSubmit fold above, with one difference: PreToolUse has no notes
// channel — a guard either speaks (ending the fold) or stays silent.

// State is read LAZILY: R2's Workflow doors decide without it, and PreToolUse runs on EVERY
// tool call. Every guard after R2 goes through here, so the file is read at most once per call.
function preState(ctx) {
  if (!ctx.st) ctx.st = loadState(ctx.projectDir, ctx.sid);
  return ctx.st;
}

// A gate armed or re-armed state before speaking: persist it, then hand the ask back to the
// fold. Same save-then-speak beat as emitBlock on the prompt side.
function gateAsk(ctx, reason) {
  saveState(ctx.projectDir, ctx.sid, ctx.st);
  return { kind: 'ask', reason };
}

// A turn-ender defers BOTH in-turn tripwires without re-arming — see gateVerdict for why
// silence beats a green label.
function skipVerdict(verdict) {
  return !!verdict && verdict.kind === 'skip';
}

// The scale clause every fleet ask carries: this project's last workflow bill when one is on
// record, else the per-agent rule of thumb — in the user's own denomination.
function wfEstimate(projectDir, usd$) {
  const h = loadWfHistory(projectDir);
  if (!h) {
    return usd$
      ? `rule of thumb ≈ ${fmtUSD(USD_PER_AGENT_RULE_OF_THUMB)}/agent in fresh-context ` +
        `writes (a 45-agent research fleet ≈ $20)`
      : `rule of thumb ≈ 25k fresh tokens/agent (a 45-agent research fleet can draw 1M+ ` +
        `from the usage window)`;
  }
  return usd$ || !h.tok
    ? `last workflow in this project cost ${fmtUSD(h.usd)} across ${h.agents} agents`
    : `last workflow in this project ran ${fmtK(h.tok)} tokens across ${h.agents} agents`;
}

// R10 — two tiers. A concrete fan at/over the hard cap is a DENY, the runaway backstop; below
// that it's an ASK where the fan signal leads (right-size before launch) and the cost estimate
// rides along as scale. Both fire even when workflowConfirm is off.
function fanDecision(fan, cfg, estimate) {
  const hardCap = cfg.fanHardCap || DEFAULTS.fanHardCap;
  if (fan.level === 'block') {
    return { kind: 'deny', reason:
      `⚠️ Hey — blocked: this Workflow declares ${fan.signals.join('; ')}, at or over ` +
      `your hard fan cap of ${hardCap} agents. A fan this wide is far more often an ` +
      `over-provisioning bug than real parallel work, and fleets bill outside the visible ` +
      `transcript (${estimate}). Cut the fan, or raise fanHardCap in cca.config.json to allow it.` };
  }
  return { kind: 'ask', reason:
    `⚠️ Hey — this Workflow looks over-fanned for one task — ${fan.signals.join('; ')}` +
    `${fan.estimate ? ` — ${fan.estimate}` : ''}. A narrow question rarely needs more than ` +
    `~${cfg.fanWarnAgents || DEFAULTS.fanWarnAgents} agents, and fleets bill outside the ` +
    `visible transcript (${estimate}). Cut the fan first, or approve to launch as-is.` };
}

// R2 — Workflow launch confirm (carrying R10's fan tiers). Fires on launch, not on spend;
// independent of hardGateUSD. No metering here (PreToolUse runs on every tool call — keep the
// common path instant).
function r2WorkflowLaunchGuard(ctx) {
  const { cfg, data } = ctx;
  if (!(cfg.workflowConfirm || cfg.workflowFanGuard) || data.tool_name !== 'Workflow') return null;
  const fan = cfg.workflowFanGuard ? fanVerdict(workflowSource(data.tool_input), cfg) : null;
  // The fan guard stays silent on small, bounded workflows: if nothing tripped it AND the
  // fire-on-every-launch confirm (R2) is off, spend no ask here.
  if (!fan && !cfg.workflowConfirm) return null;
  const estimate = wfEstimate(ctx.projectDir, wantDollars(cfg));
  if (fan) return fanDecision(fan, cfg, estimate);
  return { kind: 'ask', reason:
    `⚠️ Hey — Workflow launch — ${estimate}; fleets spend outside the visible transcript. ` +
    `Approve to launch.` };
}

// Which door R8 is pricing: a Skill's bundled files, or one Read's file.
function doorSizes(projectDir, data, ti) {
  return data.tool_name === 'Skill'
    ? skillSizes(projectDir, String(ti.skill || ''))
    : readSizes(String(ti.file_path || ''));
}

// The R8 door copy — one beat for both doors: what it adds, that it is permanent, the cheaper
// lever, then the approve line.
function payloadAskCopy(ti, v) {
  if (v.door === 'skill') {
    return `⚠️ Hey — loading the ${ti.skill} skill adds ${v.floor ? 'at least ' : ''}` +
      `~${fmtK(v.estTokens)} tokens to this conversation permanently — every later message ` +
      `re-reads them. If you only need an answer from it, a disposable subagent can read ` +
      `it and return just the conclusion. Approve to load it here anyway.`;
  }
  return `⚠️ Hey — reading ${path.basename(String(ti.file_path || ''))} in full adds ` +
    `~${fmtK(v.estTokens)} tokens to this conversation permanently — every later message ` +
    `re-reads them. A ranged Read (offset/limit) or a disposable subagent keeps it out. ` +
    `Approve to read it in full anyway.`;
}

// R8 — payload pre-gate, doors 1-2. One ask in the moment the rent is still avoidable;
// R3 only gets to warn about payloads that never came through here.
function r8PayloadDoorGuard(ctx) {
  const { cfg, data, projectDir } = ctx;
  if (!cfg.payloadGate || (data.tool_name !== 'Skill' && data.tool_name !== 'Read')) return null;
  const ti = data.tool_input || {};
  const v = payloadVerdict(data.tool_name, ti, doorSizes(projectDir, data, ti), cfg);
  if (!v) return null;
  // One decision, one surface: mark the hop so R3 doesn't re-warn what the user just
  // decided at this gate. ttl 1 = disarms at the next prompt if nothing landed (denied).
  // Skill hops carry the name so the landing can be recorded as an observed budget row.
  const st = preState(ctx);
  st.approvedPayloadHop = { est: v.estTokens, ttl: 1 };
  if (v.door === 'skill') st.approvedPayloadHop.skill = String(ti.skill || '');
  return gateAsk(ctx, payloadAskCopy(ti, v));
}

// R9 — one-shot ask armed by the accumulator (miniBombGate only): the turn already piled up
// bomb-sized tool results; one conscious approve before more work compounds on top.
function r9MiniBombGateGuard(ctx) {
  const st = preState(ctx);
  if (!st.miniBombGateArmed) return null;
  st.miniBombGateArmed = false;
  return gateAsk(ctx,
    `⚠️ Hey — this turn's tool results have already piled up ~${fmtK(st.turnPayloadTok)} ` +
    `tokens of new context — bomb-sized in aggregate, and every later message re-reads it. ` +
    `Approve to keep going here; a disposable subagent or ranged reads keep the rest out.`);
}

// R3 — one-shot post-bomb gate (armed only when bombGateWhenFat and the bomb landed fat).
function r3PostBombGateGuard(ctx) {
  const st = preState(ctx);
  if (!st.bombGateArmed) return null;
  st.bombGateArmed = false;
  return gateAsk(ctx,
    `⚠️ Hey — a context bomb just landed at fat context (see warning above) — one-time ` +
    `confirm before more work compounds on top of it. If the payload isn't needed here: ` +
    `/clear, then /continue to shed it and keep this thread.`);
}

// R13b — turn-spend tripwire: ONE turn's work tokens (main + fleet, delta since the last
// prompt) crossing turnGateTokens means the task spiraled ~10× past a normal one — nobody
// consciously chose that spend. Checked before the session gate (the sharper signal), and
// TOKEN-denominated on every billing kind: task size is work volume, not price — which is
// exactly why cache re-reads ride at 0.1x here (rent measures context size, not task size).
function r13bTurnSpendGuard(ctx) {
  const { cfg, m, st, verdict } = ctx;
  if (cfg.turnGateTokens == null) return null;
  const nowTok = workTokens(m);
  if (st.turnStartWorkTok == null) {
    // No baseline yet (turn 1 of a fresh session, or a session whose baseline predates the
    // work-token unit): arm it mid-turn — undercounts the current turn rather than
    // mis-billing the whole session to it (or mixing units across the recalibration).
    st.turnStartWorkTok = nowTok;
    saveState(ctx.projectDir, ctx.sid, st);
    return null;
  }
  const turnTok = nowTok - st.turnStartWorkTok;
  const tGate = st.turnGateAt != null ? st.turnGateAt : cfg.turnGateTokens;
  if (turnTok < tGate || skipVerdict(verdict)) return null;
  // Re-arm ABOVE the observed spend, at a width that DOUBLES each same-turn fire — see
  // nextCheckClause for why a flat step stopped working.
  st.turnGateFires = (st.turnGateFires || 0) + 1;
  st.turnGateAt = reArmAt(turnTok, cfg.turnGateTokens, st.turnGateFires);
  // ONE verdict object, both bullets — see restartVerdict for why they can no longer disagree.
  const rv = restartVerdict(m.liveContext, st.turnGateAt - turnTok, cfg.contextWarnTokens,
    coldStartTokens(ctx.projectDir, ctx.sid, m, ctx.data && ctx.data.transcript_path),
    cfg.contextExcessTokens);
  // Headline reading, then cost / lever / restart / choice, one per line. R14 below runs a
  // tighter two-bullet cut; R13b keeps the lever because "a plan with session-sized substeps"
  // is a different instruction from its headline, not a restatement of it.
  return gateAsk(ctx,
    `⚠️ Hey — this ONE turn has burned ~${fmtK(turnTok)} tokens.\n` +
    `• Cost: a normal task finishes under ~${fmtK(TASK_NORM_TOK)}, so the work has likely ` +
    `spiraled well past what was anticipated.\n` +
    `• Lever: a plan with session-sized substeps, not a longer turn.` +
    `${nextCheckClause(st.turnGateFires, st.turnGateAt)}\n` +
    restartBullet(
      restartPos(st.turnStartReqs == null ? null : Math.max(1, m.main.turns - st.turnStartReqs)),
      m.liveContext, st.turnGateAt - turnTok, rv) +
    choiceBullet(verdict, {
      neutral: 'approve to push on — or deny, and Claude should stop and propose that plan.',
      denyTail: 'denying means Claude stops and proposes that plan.',
    }, rv));
}

// The R14 ask. Headline reading, then TWO bullets — cost, choice. A single wrapped paragraph
// buried the ask under the arithmetic (Andrew 2026-07-26), and four bullets buried it again
// under a briefing (Andrew 2026-07-29). The two that went, and why they must not come back:
//   · `• Lever: a smaller resident context, not a shorter task.` — the headline one line up
//     already reads trips × context; naming the lever a second time is restatement, not advice.
//   · `• Restart: … rebuilds that ~163k for ~16% of the ~1.0M more …` — the ratio is real, but
//     it only means something once the reader holds a second number (the gap to the next check)
//     that nothing else in the message needs. Priced against the Choice bullet, which already
//     says land at a commit point and /clear + /continue, it bought a line and a denominator.
// The one number worth keeping out of them is when this gate speaks again, so nextCheckClause
// rides at the end of the Cost line. This is the only guard message that carries \n; if the
// dialog ever collapses them the bullets still read as "• "-separated clauses.
function rentAskCopy(ctx, rent, rvIn) {
  const { cfg, m, st, verdict } = ctx;
  const reqs = Math.max(1, m.main.turns - (st.turnStartReqs || 0));
  // Still priced even though the Restart bullet is gone — choiceBullet turns this reading into
  // the approve/deny recommendation (see restartVerdict for why one object feeds both).
  // Since 2026-07-31 the guard computes rv FIRST — it decides whether this card speaks at all
  // (see r14TurnRentGuard) — and hands it down, so the reading that let the fire through and the
  // reading the card prints are one object rather than two calls that could disagree. The
  // fallback keeps this function callable on its own, which the copy-contract test relies on.
  const rv = rvIn !== undefined ? rvIn
    : restartVerdict(m.liveContext, st.rentGateAt - rent, cfg.contextWarnTokens,
      coldStartTokens(ctx.projectDir, ctx.sid, m, ctx.data && ctx.data.transcript_path),
      cfg.contextExcessTokens);
  // Work = the turn's work tokens minus the 0.1x-weighted rent already inside them, i.e.
  // input + output + cache writes. Null baseline (turnGateTokens off) => report rent alone.
  const work = st.turnStartWorkTok == null ? null
    : Math.max(0, workTokens(m) - st.turnStartWorkTok - rent * CACHE_READ_X);
  // Named inline, because "actual work" is the one figure on the card with no formula beside it
  // and no way to derive it from the other two (see the equation below for why that matters).
  const vs = work == null ? '' : `, against ~${fmtK(work)} of actual work (new input + output)`;
  // Rent renders CACHE-WEIGHTED so it shares a unit with `work`, which already counts cache
  // reads at 0.1x (workOne). Raw against weighted in one sentence inflated the ratio 10x: the
  // card read "~4.4M of re-reads against ~161k of actual work" — 27:1, where the same-unit
  // reading is ~440k against ~161k, 2.7:1. "Rent, not progress" survives the honest ratio; what
  // it loses is a 7-figure number that reads as alarm (Andrew 2026-07-30 — "we shouldn't scare
  // users with token figures like 4M"). The METER stays raw (see crTokens): this is display
  // only, and the gate fires at exactly the same moment it did before. The weight is named
  // inline rather than given a coined unit. It NO LONGER matches the context-bomb copy's
  // parenthetical (`a cache read, ~10% weight`, ~line 2310) word for word: an operand in a
  // multiplication cannot also be a parenthetical aside, and this line became arithmetic on
  // 2026-07-31. What that parity protected — the weight named in the same breath as the figure
  // it scales — survives; and both lines now render the number FROM CACHE_READ_X, so they
  // cannot drift apart on the value even though they differ on the wrapper.
  const billed = Math.round(rent * CACHE_READ_X);
  // SHOW THE MULTIPLICATION, not just its product (Andrew 2026-07-31, reading his own card:
  // "the diff bt the 2 numbers in the first bullet point is over 200k, not 137k"). Three figures
  // sat side by side measuring three different things — context NOW (headline), rent SO FAR,
  // work SO FAR — with no operator between any two, so the reader tries to reconcile them by
  // subtraction and gets something that is not a quantity: 444k − 146k = 298k means nothing, and
  // it was exactly the reading the card invited. The fix is not a fourth figure; it is the
  // `trips × context × rate =` that was implied all along, printed — which is also the only form
  // the reader can check.
  //
  // The multiplicand is the AVERAGE (rent/reqs), not liveContext, and it has to be: context grew
  // across the turn, so trips × the LIVE figure overstates the product by whatever it grew (44 ×
  // 139k × 10% = 611k against the 445k actually billed). Quoting the headline as the operand
  // would make the multiplication fail to reconstruct the product it claims to explain — a worse
  // lie than the one it replaced. The gap between avg and live is not noise either — it IS the
  // compounding the tail names, which is why the tail prices the NEXT trip at the live size.
  const avg = Math.round(rent / reqs);
  const perTrip = Math.round(m.liveContext * CACHE_READ_X);
  const s = reqs === 1 ? '' : 's';
  return `⚠️ Hey — this turn has made ${reqs} round trip${s}, now carrying ` +
    `~${fmtK(m.liveContext)} of context each.\n` +
    `• Cost: ${reqs} trip${s} × ~${fmtK(avg)}${reqs === 1 ? '' : ' avg'} context × ` +
    // Rate rendered FROM the constant, never a literal "10%": the card's arithmetic and the
    // weight it multiplies by cannot drift apart if only one of them can be edited.
    `${Math.round(CACHE_READ_X * 100)}% (a cache read) = ~${fmtK(billed)} of re-reads${vs} — ` +
    `that is rent, not progress, and it compounds: the next trip bills ~${fmtK(perTrip)} ` +
    `at the current size.` +
    // Same conversion — an unweighted tail would re-mix the units the Cost figure just unified.
    // The ' of re-reads' suffix goes with it: the Cost line now names the unit six words earlier.
    `${nextCheckClause(st.rentGateFires, Math.round(st.rentGateAt * CACHE_READ_X))}\n` +
    choiceBullet(verdict, {
      neutral: 'approve to push on — or deny, and Claude should land this turn at a commit ' +
        `point so you can /clear + /continue${clearTail(rv)}.`,
      denyTail: 'denying lands this turn at a commit point so you can /clear + ' +
        `/continue${clearTail(rv)}.`,
    }, rv);
}

// R14 — in-turn RENT tripwire. The failure R13b structurally cannot see: a turn whose work
// is ordinary (83k on the 2026-07-25 plan re-cut, under TASK_NORM_TOK) but which pays for a
// fat resident context over and over — 24 round trips × ~104k = 2.5M of re-reads raw, which is
// the ~250k cache-weighted the card prints since 2026-07-30, and $2.62, in ONE turn. Every other context guard speaks at a prompt boundary (the fat-context advisory
// fires on UserPromptSubmit, once); rent accrues BETWEEN those boundaries, and a 20-minute
// autonomous turn has no boundary to take. This is the only check that re-reads context size
// mid-turn — which is also why it must stay cheap: it reuses the meter spendGatesGuard took.
function r14TurnRentGuard(ctx) {
  const { cfg, m, st, verdict } = ctx;
  if (cfg.turnRentGateTokens == null) return null;
  if (st.turnStartCr == null) {
    // No baseline (turn 1 of a fresh session, or state written before R14 existed): arm it
    // mid-turn — undercounts this turn rather than billing the whole session's rent to it.
    st.turnStartCr = crTokens(m); st.turnStartReqs = m.main.turns;
    saveState(ctx.projectDir, ctx.sid, st);
  }
  const rent = crTokens(m) - st.turnStartCr;
  const rGate = st.rentGateAt != null ? st.rentGateAt : cfg.turnRentGateTokens;
  if (rent < rGate || skipVerdict(verdict)) return null;
  // Re-arm ABOVE the observed rent, doubling the width each same-turn fire (same rule as
  // R13b — one huge landing must not re-fire on the very next tool call, and repeats must
  // get rarer rather than becoming wallpaper). Computed here but COMMITTED below, only if the
  // card actually speaks: restartVerdict needs a positive gap, and the gate just crossed
  // (rGate − rent ≤ 0) is not it — the reading is against the NEXT check.
  const fires = (st.rentGateFires || 0) + 1;
  const nextAt = reArmAt(rent, cfg.turnRentGateTokens, fires);
  const rv = restartVerdict(m.liveContext, nextAt - rent, cfg.contextWarnTokens,
    coldStartTokens(ctx.projectDir, ctx.sid, m, ctx.data && ctx.data.transcript_path),
    cfg.contextExcessTokens);
  // Silence on the branch that recommends the STATUS QUO (Andrew 2026-07-31). A blocking
  // confirm whose own advice is "push on" spends a round trip and the reader's attention to
  // arrive at what they were already doing — it is the wallpaper this file keeps warning
  // about, now on the branch that fires MOST (a lean window under the fat line). The card is
  // worth an interruption only when the losing option is live, so it speaks exactly when
  // choiceBullet would say `deny (recommended)`: a bomb CALL, or a fat window. rv == null
  // (nothing measured) still speaks — the neutral copy is an honest "no reading", and
  // suppressing on an unmeasured floor would retire the tripwire entirely on a fresh machine.
  //
  // NO re-arm on this path, deliberately: the doubling exists to make repeats rarer, and a
  // fire that never reached the reader is not a repeat. Leaving the threshold where it is
  // keeps the check live on every subsequent call — it costs the meter already taken plus one
  // small JSON read (coldStartTokens is read-only once this sid has a sample) — so the gate
  // speaks on the first call AFTER the window crosses the fat line, instead of sitting out a
  // doubled width that a silent fire would have bought.
  if (!(verdict && verdict.kind === 'deny') && rv && !rv.clear) return null;
  st.rentGateFires = fires;
  st.rentGateAt = nextAt;
  return gateAsk(ctx, rentAskCopy(ctx, rent, rv));
}

// v1 hard gate on total session spend (v2: fleet-aware total). Default off.
function sessionSpendGuard(ctx) {
  const { cfg, m, st } = ctx;
  if (cfg.hardGateUSD == null) return null;
  const gate = st.gateArmedAt != null ? st.gateArmedAt : cfg.hardGateUSD;
  if (m.usd < gate) return null;
  st.gateArmedAt = gate + (cfg.gateStepUSD || DEFAULTS.gateStepUSD); // re-arm one step higher
  if (wantDollars(cfg)) {
    return gateAsk(ctx,
      `⚠️ Hey — session estimate ${fmtUSD(m.usd)} ≥ ${fmtUSD(gate)} gate. ` +
      `Approve to continue (next check at ${fmtUSD(st.gateArmedAt)}), or /clear for a fresh session.`);
  }
  // Subscription copy: the gate still fires (it's a backstop the user armed), but the message is
  // token-denominated — thresholds stay $-weighted internally (that's the normalization) and are
  // back-converted at this session's own effective rate, so the token figures are estimates in
  // exactly the sense the $ figures are.
  const tok = sessionTokens(m);
  const perUSD = m.usd > 0 ? tok / m.usd : 0;
  return gateAsk(ctx,
    `⚠️ Hey — session estimate ${fmtK(tok)} tokens ≥ the ~${fmtK(gate * perUSD)}-token gate. ` +
    `Approve to continue (next check ≈ ${fmtK(st.gateArmedAt * perUSD)} tokens), or /clear for a ` +
    `fresh session.`);
}

// R4b idle-return RECEIPT — the background-wake half of R4. A session re-invoked by a finished
// background task (or any other self-wake) never fires UserPromptSubmit, so R4 never gets to
// look at the gap; measured 2026-07-27 on a session that sat 9h40m at 221k context, woke itself
// on a build completing, and re-uploaded the lot with `warnedIdleAt` still 0.
//
// R4's own condition cannot be reused here: it reads `Date.now() - m.lastTs`, and by the time
// PreToolUse runs, the wake request has ALREADY landed — lastTs is seconds old and the gap
// computes to zero. So detection is the cache split instead of the clock (see meter()).
//
// And unlike R4 this is a receipt, not a gate: no hook fires before a task-notification
// re-invocation, so the charge cannot be pre-empted. It reports the charge that landed and
// offers the /clear out while the context is still worth shedding.
function r4bColdWriteReceiptGuard(ctx) {
  const { cfg, m } = ctx;
  const st = preState(ctx);
  if (m.turns <= 1) return null;                                   // turn 1 writes the baseline fresh
  if ((m.lastCacheWrite || 0) < cfg.contextWarnTokens) return null;
  if (st.warnedColdWriteAt === m.lastTs) return null;              // one-shot per wake
  if (Date.now() - (st.idleFiredAt || 0) < 10 * 60000) return null; // R4 already owned this gap
  st.warnedColdWriteAt = m.lastTs;
  writeRecoverPointer(ctx.projectDir, ctx.sid, recoverWindowMinutes(m));
  return gateAsk(ctx,
    `⚠️ Hey — this session picked itself back up after sitting longer than the API keeps a ` +
    `conversation cached, so Claude Code just re-uploaded all ~${fmtK(m.lastCacheWrite)} ` +
    `tokens of it at full price — about 20x what the same turn costs while cached.\n\n` +
    `To keep going here: approve. To pick this work up cheaply instead: /clear, then ` +
    `/continue — it reloads the recent thread of this conversation.`);
}

// The spend gates share one meter with R4b: PreToolUse runs on every tool call, so meter ONCE
// and only when at least one of them is armed. Order matters — the idle receipt first (it
// explains the very context the others are about to price), then R13b (sharpest), then R14,
// then the session backstop.
const SPEND_GUARDS = [r4bColdWriteReceiptGuard, r13bTurnSpendGuard, r14TurnRentGuard,
  sessionSpendGuard];

function spendGatesGuard(ctx) {
  const { cfg, data } = ctx;
  // Meter only when something in this block can actually speak. R4b rides the same meter but is
  // NOT a spend gate, so a config with every spend gate disabled must still reach it.
  const spendArmed = cfg.hardGateUSD != null || cfg.turnGateTokens != null ||
    cfg.turnRentGateTokens != null;
  if (!spendArmed && !cfg.idleWarnMinutes) return null;
  preState(ctx);
  // What the PENDING call argues for. Computed once; both in-turn tripwires consult it. A
  // turn-ender defers BOTH gates without re-arming — see gateVerdict for why silence beats a
  // green label. The session $ gate is deliberately unaffected: it is a spend backstop the
  // user armed by hand, not a per-turn steer, so a cheap commit should not slip past it.
  ctx.verdict = gateVerdict(data.tool_name, data.tool_input);
  ctx.m = meterSession(data.transcript_path, { fleet: cfg.fleetMeter, projectDir: ctx.projectDir });
  for (const guard of SPEND_GUARDS) {
    const d = guard(ctx);
    if (d) return d;
  }
  return null;
}

// Rule order is decision order: R2's Workflow doors first (they decide without touching state),
// then the one-shot payload/bomb gates, then the metered spend tripwires last.
const PRETOOL_GUARDS = [r2WorkflowLaunchGuard, r8PayloadDoorGuard, r9MiniBombGateGuard,
  r3PostBombGateGuard, spendGatesGuard];

let claimRegistryMod = null;
try {
  claimRegistryMod = require('./claim-registry.js');
} catch (e) {}

function emitWriteClaimGuard(ctx) {
  try {
    if (!claimRegistryMod || !claimRegistryMod.writeClaim || !ctx || !ctx.sid || !ctx.data) return null;
    const name = ctx.data.tool_name || '';
    const input = ctx.data.tool_input || {};
    const isWriteTool = (
      name === 'Write' ||
      name === 'Edit' ||
      name === 'NotebookEdit' ||
      name === 'write_to_file' ||
      name === 'replace_file_content' ||
      name === 'multi_replace_file_content'
    );
    if (isWriteTool) {
      const targetPath = input.file_path || input.path || input.TargetFile || input.file || null;
      if (targetPath && typeof targetPath === 'string') {
        claimRegistryMod.writeClaim({
          sid: ctx.sid,
          path: targetPath,
          intent: `Write via ${name}`
        });
      }
    }
  } catch (err) {}
  return null;
}

function onPreToolUse(data, projectDir) {
  const ctx = { data, projectDir, cfg: loadConfig(projectDir), sid: data.session_id || '', st: null };
  emitWriteClaimGuard(ctx);
  for (const guard of PRETOOL_GUARDS) {
    const d = guard(ctx);
    if (d) return d.kind === 'deny' ? deny('PreToolUse', d.reason) : ask('PreToolUse', d.reason);
  }
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
// Row label = the project's real directory name, read from the transcript's own recorded cwd.
// The ~/.claude/projects slug can't provide it: path separators and in-name hyphens both
// flatten to '-', so the name can't be split back out of the slug. First 64KB is plenty — cwd
// rides on the first entries; any miss falls back to the stripped slug (fail-silent ethos).
function projectNameOf(fp, proj) {
  try {
    const fd = fs.openSync(fp, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const m = /"cwd"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(buf.toString('utf8', 0, n));
    if (m) return path.basename(JSON.parse(m[1]));
  } catch (_) { /* unreadable transcript — fall back to the stripped slug */ }
  return proj.replace(/^C--(?:CODE-)?/, '');
}

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
      if (m.usd < ROLLUP_DUST_USD) continue;
      out.usd += m.usd;
      out.tokens += sessionTokens(m);
      out.rows.push({
        label: `${projectNameOf(fp, proj)}/${f.slice(0, SID_SHORT_LEN)}`, sid: f.slice(0, SID_SHORT_LEN),
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
// (CHARS_PER_TOKEN and IMAGE_TOK_EST — used by this analyzer AND the live payload
// guards — are declared with the other sizing constants at the top of the file.)

const lineTs = o => o.timestamp ? Date.parse(o.timestamp) || 0 : 0;

// input+output+cache split, summed across main and agent per-model tallies.
function tokenSplit(m) {
  const split = { inp: 0, out: 0, cr: 0, cw: 0 };
  for (const pm of [m.main.perModel, m.agents.perModel])
    for (const v of Object.values(pm)) { split.inp += v.inp; split.out += v.out; split.cr += v.cr; split.cw += v.cw; }
  return split;
}

// Streamed rewrites reuse the message id: last usage wins. A NEW id snapshots the current
// region-best payload as its blame culprit and opens a fresh region.
function recordRequest(s, o, msg) {
  const u = msg.usage;
  const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) +
    (u.cache_creation_input_tokens || 0);
  const ts = lineTs(o);
  const id = msg.id || `line-${s.seen.size}`;
  if (s.seen.has(id)) {
    const r = s.seen.get(id); r.ctx = ctx; if (ts) r.ts = ts;
    return;
  }
  s.seen.set(id, { ctx, ts, model: msg.model || '', culprit: s.regionBest });
  s.regionBest = null;
}

// base64 image payloads tokenize ~2 orders of magnitude below chars/2.6 — flag them so
// the render never prints a fake 260k-token estimate for a 1.6k-token screenshot.
function recordPayload(s, line, o) {
  const cand = { chars: line.length, label: payloadLabel(o, s.toolNames),
    isImage: /"type"\s*:\s*"image"/.test(line), ts: lineTs(o) };
  s.payloads.push(cand);
  if (!s.regionBest || cand.chars > s.regionBest.chars) s.regionBest = cand;
}

function scanLine(s, line, o) {
  if (!o) return;
  const msg = o.message;
  if (o.type === 'assistant' && msg) {
    if (Array.isArray(msg.content)) harvestToolNames(msg.content, s.toolNames);
    if (msg.usage) recordRequest(s, o, msg);
    return; // assistant output is priced as output, not context payload
  }
  if (o.type !== 'user' && !o.isMeta) return; // progress/system noise, not payload
  recordPayload(s, line, o);
}

// Single ordered pass. Assistant usage lines mark API requests (the ctx trajectory);
// everything between two of them is the region a bomb's payload landed in — same
// finger-pointing as attributeJump, but region-bounded so a later monster line can't
// steal an earlier bomb's blame.
function scanRequests(raw) {
  const s = {
    toolNames: {},    // tool_use_id -> "Tool(detail)"
    seen: new Map(),  // message.id -> request entry (streamed rewrites: last usage wins)
    regionBest: null, // largest context payload since the previous API request
    payloads: [],     // every candidate, for the top-payloads table
  };
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch (_) { continue; }
    scanLine(s, line, o);
  }
  return s;
}

// RENT — every API request re-reads the live context; the sum is the session's rent bill.
function rentStats(reqs, totalTokens) {
  const q = frac => reqs[Math.min(reqs.length - 1, Math.floor(frac * (reqs.length - 1)))].ctx;
  const totalRent = reqs.reduce((a, r) => a + r.ctx, 0);
  return {
    quartiles: [q(0), q(0.25), q(0.5), q(0.75), q(1)],
    meanCtx: Math.round(totalRent / reqs.length),
    totalRent,
    share: totalTokens ? totalRent / totalTokens : 0,
  };
}

// BOMBS — single-hop ctx jumps. Request 0 counts too: a session that OPENS huge (compaction
// continuation, fat CLAUDE.md) pays that context all session long and deserves the flag.
function findBombs(reqs, bombJumpTokens) {
  const bombs = [];
  let prev = 0;
  for (const r of reqs) {
    const jump = r.ctx - prev;
    if (jump > bombJumpTokens) {
      bombs.push({ jump, ts: r.ts,
        label: r.culprit ? r.culprit.label : (prev === 0 ? 'opening context (first request)' : 'unknown'),
        chars: r.culprit ? r.culprit.chars : 0, isImage: !!(r.culprit && r.culprit.isImage) });
    }
    prev = r.ctx;
  }
  return bombs;
}

// TTL — gaps longer than the cache TTL while the context was fat: the return re-uploads
// everything at full write price (~20x a cached turn).
function findTtlGaps(reqs, cfg) {
  const gaps = [];
  for (let i = 1; i < reqs.length; i++) {
    if (!reqs[i].ts || !reqs[i - 1].ts) continue;
    const gapMin = (reqs[i].ts - reqs[i - 1].ts) / 60000;
    if (gapMin > cfg.idleWarnMinutes && reqs[i - 1].ctx >= cfg.contextWarnTokens) {
      gaps.push({ gapMin: Math.round(gapMin), endTs: reqs[i].ts, ctx: reqs[i - 1].ctx,
        rewriteUSD: (reqs[i - 1].ctx * priceFor(reqs[i].model).inp * CACHE_WRITE_1H_X) / 1e6 });
    }
  }
  return gaps;
}

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
      split: tokenSplit(m), effectiveTok: Math.round(workTokens(m)),
    },
    rent: null, bombs: [], topPayloads: [], fleets: m.agents.perWorkflow, ttlGaps: [],
    cfgBombJump: cfg.bombJumpTokens, cfgIdleMin: cfg.idleWarnMinutes,
    cfgCtxWarn: cfg.contextWarnTokens,
  };

  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch (_) { return res; }

  const s = scanRequests(raw);
  const reqs = [...s.seen.values()];
  res.requests = reqs.length;
  if (!reqs.length) return res;
  res.startTs = reqs[0].ts;
  res.rent = rentStats(reqs, res.totals.tokens);
  res.bombs = findBombs(reqs, cfg.bombJumpTokens);
  res.ttlGaps = findTtlGaps(reqs, cfg);
  res.topPayloads = s.payloads.filter(p => p.chars >= 10000)
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
  lines.push(`SESSION ${a.sid.slice(0, SID_SHORT_LEN)} · ${a.project}`);
  lines.push(`  ${fmtWhen(a.startTs)} → ${fmtWhen(a.endTs)} · ${fmtDur(a.endTs - a.startTs)} wall · ` +
    `${a.requests} API requests · models: ${a.models.map(shortModel).join(', ') || '?'}`);
  lines.push('', 'TOTALS');
  lines.push(`  ${fmtK(t.tokens)} tokens processed` +
    (t.agentFiles ? ` = main ${fmtK(t.mainTok)} + agents ${fmtK(t.agentsTok)} (${t.agentFiles} transcripts)` : '') +
    (usd$ ? ` · ≈ ${fmtUSD(t.usd)} API-list` : ''));
  // "effective" weights each category by its input-rate multiple (re-reads 0.1x) — a scale
  // intuition, not exact billing; the $ figure above carries the per-model/output weighting.
  if (t.split && t.tokens) {
    lines.push(`  ${Math.round((t.split.cr / t.tokens) * 100)}% cached re-reads (billed at 0.1x input) → ` +
      `effective ≈ ${fmtK(t.effectiveTok)} token-equivalents`);
  }
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
// Accepts the exact "project/sid8" label those rows print (users paste it whole), a bare sid
// prefix, or a transcript path: the last segment is the sid, an optional segment before it
// narrows the project — matched against both the display name and the raw projects-dir slug,
// so a pasted stale full path still resolves by its sid.
function resolveTranscript(arg) {
  if (!arg) return { err: 'usage: token-guard.js --analyze <sid-prefix | project/sid-prefix | transcript.jsonl>' };
  if (arg.endsWith('.jsonl') && fs.existsSync(arg)) return { fp: arg };
  const parts = arg.split(/[\\/]/).filter(Boolean);
  let sidArg = parts.length ? parts[parts.length - 1] : arg;
  if (sidArg.endsWith('.jsonl')) sidArg = sidArg.slice(0, -'.jsonl'.length);
  const projArg = parts.length > 1 ? parts[parts.length - 2] : null;
  const projects = path.join(os.homedir(), '.claude', 'projects');
  const hits = [];
  let dirs; try { dirs = fs.readdirSync(projects); } catch (_) { return { err: 'cannot read ~/.claude/projects' }; }
  for (const proj of dirs) {
    let files; try { files = fs.readdirSync(path.join(projects, proj)); } catch (_) { continue; }
    for (const f of files) {
      if (f.endsWith('.jsonl') && f.startsWith(sidArg)) {
        const fp = path.join(projects, proj, f);
        const label = `${projectNameOf(fp, proj)}/${f.slice(0, SID_SHORT_LEN)}`;
        if (projArg && projArg !== proj && projArg !== label.split('/')[0]) continue;
        hits.push({ fp, label });
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
  // Deliberately NOT CHARS_PER_TOKEN (2.6): that constant sizes dense JSON/code payloads;
  // the recovered tail is plain prose, which runs ~4 chars/token.
  const PROSE_CHARS_PER_TOKEN = 4;
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
  if (Math.ceil(rows.reduce((n, r) => n + fmt(r).length + 2, 0) / PROSE_CHARS_PER_TOKEN) > cap) {
    truncated = true;
    kept = [];
    let acc = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const cost = Math.ceil((fmt(rows[i]).length + 2) / PROSE_CHARS_PER_TOKEN);
      if (acc + cost > cap && kept.length) break;
      kept.unshift(rows[i]);
      acc += cost;
    }
  }
  const text = kept.map(fmt).join('\n\n');
  return { messages: kept.length, tokens: Math.ceil(text.length / PROSE_CHARS_PER_TOKEN), truncated, text };
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
    if (win.rows.length && !cfg.analyzeHint)
      lines.push(`  run /analyze-session <id> on any session below to analyze the token usage for that session`);
    for (const r of win.rows.slice(0, 8)) {
      const amt = (usd$ ? fmtUSD(r.usd) : fmtK(r.tok)).padStart(7);
      const ag = usd$
        ? (r.agentsUsd >= ROLLUP_DUST_USD ? ` (agents ${fmtUSD(r.agentsUsd)})` : '')
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
      } catch (_) { /* fail-safe: emit nothing */ }
      process.exit(0);
    });
  }
}

module.exports = { meter, meterSession, priceFor, attributeJump, driftVerdict, ledgerScopes, officialLines,
  claudeCodeUA, fetchOfficialUsage,
  analyzeSession, renderAnalysis, payloadVerdict, fanVerdict, workflowSource, skillSizes, recordObservedSkill,
  generateBudgets, slug, driftNote, driftDeferralTick, recoverTail, restartBullet, restartPos,
  restartVerdict, choiceBullet, rentAskCopy,   // test/token-guard-copy.test.js — R14 copy contract
  crossedSpendSteps,                           // test/token-guard-ladder.test.js — session-total ladder
  coldStartTokens, firstContextOfHead, clearTail,  // R15b cold-start meter
  writeRecoverPointer, idleReturnNote, resolveConfig, TOKEN_SAVER,
  fiveHourWindow, tightestWindow, windowSpikeVerdict, windowThresholdVerdict, effectiveWarn,
  spikeAttribution, spikeCopyMode,
  windowSpikeNote, windowSpikeConfirmNote, windowRunway, windowThresholdNote, windowThresholdGateReason };
