<!-- @description Show this session's usage report: token spend with cache/model splits, the last-5-hours rollup across all projects, and the plan/overage line. The report standard /usage doesn't give you. -->
<!-- @version 2 -->
<!-- @response success | Prints per-model session breakdown, live-context floor, 5h window total, and plan line. -->
<!-- @example /usage-report | Show current usage report -->

# Usage Report

Show the current session's usage report — tokens first (with the cache-read and per-model
splits that make raw totals honest), the weighted $-equivalent beside them, the 5-hour
cross-project rollup, and the plan/overage-billing line.

Renamed from `/token-guard-report` 2026-07-12 — the built-in `/usage` shows quota bars;
this shows where the usage went.

## Step 1: Run the meter

Run via Bash (the session transcript lives at `~/.claude/projects/<project-slug>/<session_id>.jsonl` — derive the path from the current project directory and session; if unsure, run without an argument and pass the transcript path only when known):

```bash
node .claude/hooks/token-guard.js --report "$HOME/.claude/projects/<project-slug>/<session_id>.jsonl"
```

## Step 2: Display

Show the report output verbatim in a code block — do not summarize away the numbers. Add ONE line of interpretation at most (e.g. whether a fresh session is advisable given the live-context floor).

Notes for interpretation:
- The ALLOCATION block leads and is authoritative — those are Anthropic's own server-computed
  percentages (same source as the built-in /usage), fetched live with severity flags and reset
  times. Everything below it is supporting detail: WHERE the usage went. If it shows
  "unavailable", the estimate lines below are calibrated guesses, marked "≈ ... (estimate)".
- Tokens lead; dollars are API-list-price equivalents. On a subscription they proxy for rate-limit consumption, not billing — and the final `Plan:` line says which applies (the overage-OFF case means worst-case throttling, never a charge).
- "live context" is re-read on EVERY turn — that is the per-turn floor cost of continuing this session.
- The session total INCLUDES subagent/workflow fleet transcripts (the `main $X + agents $Y` split line) — fleets bill outside the main transcript and historically hid 63% of a session's spend.
- Thresholds are configured in `.claude/cca.config.json` → `tokenGuard` (`contextWarnTokens`, `sessionWarnUSD`, `hardGateUSD`, `gateStepUSD`, plus v2: `fleetMeter`, `workflowConfirm`, `bombJumpTokens`, `bombGateWhenFat`, `idleWarnMinutes`, `windowBudgetUSD`, `planDetect`).
