<!-- @description Analyze one session's token spend — deterministic RENT/BOMBS/FLEETS/TTL digest plus an efficiency read-out: dominant cost category, named causes, and what to change in future sessions. -->
<!-- @version 4 -->
<!-- @response success | Prints the digest verbatim, then interpretation: dominant category, top causes, forward recommendations. -->
<!-- @example /analyze-session cf4d557d | Analyze that session's efficiency -->

# Analyze Session

Explain where a session's tokens went and what to change next time. The heavy lifting is
deterministic (the `--analyze` digest — pure node, no LLM, ~free); the model interprets ONLY
the digest.

Argument: `$ARGUMENTS` — a session-id prefix (the sid8 shown on `/usage-report`'s LAST 5 HOURS
rows) or a full transcript path. No argument → analyze the CURRENT session (derive the
transcript path the same way `/usage-report` does).

## Step 1: generate the digest (deterministic)

```bash
node .claude/hooks/token-guard.js --analyze <sid8-or-path>
```

If it reports ambiguity, show the candidate list and ask which one was meant.

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
