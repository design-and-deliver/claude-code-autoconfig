---
description: Analyze one session's token spend — deterministic digest + efficiency read-out
argument-hint: [sid8 | project/sid8 | transcript-path]
allowed-tools: Bash(node .claude/hooks/token-guard.js --analyze:*)
---
<!-- @description Analyze one session's token spend — deterministic RENT/BOMBS/FLEETS/TTL digest plus an efficiency read-out: dominant cost category, named causes, and what to change in future sessions. -->
<!-- @version 5 -->
<!-- @response success | Prints the digest verbatim, then interpretation: dominant category, top causes, forward recommendations. -->
<!-- @example /analyze-session cf4d557d | Analyze that session's efficiency -->

# Analyze Session

Explain where a session's tokens went and what to change next time. The heavy lifting is
deterministic (the `--analyze` digest — pure node, no LLM, ~free) and has ALREADY RUN: the
injected output below was generated at prompt time, before the model saw this prompt. The
model interprets ONLY the digest.

Argument: `$ARGUMENTS` — a session-id prefix, the exact `project/sid8` label shown on
`/usage-report`'s LAST 5 HOURS rows (both forms resolve), or a full transcript path.

## Digest (injected at prompt time — zero model round trips)

!`node .claude/hooks/token-guard.js --analyze $ARGUMENTS`

## Step 1: check the injected digest

The digest above already ran — re-running it via Bash wastes the round trip the injection
exists to save. Route on its first line:

- Starts with `SESSION` → healthy; go straight to Step 2.
- Says `usage:` → the command was invoked with no argument: derive the CURRENT session's
  transcript path (`~/.claude/projects/<project-slug>/<session-id>.jsonl`, same derivation
  as `/usage-report`) and run `node .claude/hooks/token-guard.js --analyze <path>` via
  Bash — the only case that needs a model-driven run.
- Says `ambiguous` → show the candidate list and ask which one was meant.
- Says `no transcript matches` → report that verbatim and point at `/usage-report`'s row
  labels as the source of valid sids.

## Step 2: interpret — the digest ONLY

**Hard rule: never read the raw transcript.** Analyzing a 40M-token session must not itself
load 40M tokens — if the digest can't answer something, say what's missing instead of digging.
(Targeted transcript digging is future work, behind an explicit user approval.)

Show the digest verbatim in a code block first. Then, in prose:

1. **Dominant cost category** — RENT / BOMBS / FLEETS / TTL, with its share taken from the
   digest.
2. **Top causes, named** — specific skills/tools/workflows from the digest lines, never bare
   categories ("the claude-api skill payload, +302k" — not "a big skill").
3. **2–3 forward recommendations** for future sessions, each citing a digest number (house
   rule: never print an unmeasured number). Draw from: cut to a fresh session earlier
   (`/clear`, then `/continue` when live context is fat with settled work),
   avoid or defer a named
   payload bomb (one-time references belong in a disposable subagent), scope or skip a
   workflow fleet, batch screenshot Reads, don't leave a fat session idle past an hour.

Tokens lead; mention $ only where the digest itself shows dollar figures (API-billed
sessions). Keep the interpretation to a few short paragraphs — the digest carries the numbers.

## Step 3: zero-token tip (fat sessions only)

If the digest's "live context at end" is ≥ 150k tokens, close with ONE extra line — the
zero-token path for next time (this run was already paid for; the tip is for the next one):

> Tip: in a session this fat, you can skip the model entirely — run
> `node .claude/hooks/token-guard.js --analyze <sid8>` in a terminal (or prefix with `!` in
> the prompt) to read the digest for zero tokens, or run `/analyze-session <sid8>` from a
> fresh session to get interpretation without this session's per-turn context rent.

Below 150k, omit the tip — the rent saving is too small to be worth the noise.
