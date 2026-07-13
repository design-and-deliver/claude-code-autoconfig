<!-- @description Analyze one session's token spend — deterministic RENT/BOMBS/FLEETS/TTL digest plus an efficiency read-out: dominant cost category, named causes, and what to change in future sessions. -->
<!-- @version 1 -->
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
   (`/eval-new-session` when live context is fat with settled work), avoid or defer a named
   payload bomb (one-time references belong in a disposable subagent), scope or skip a
   workflow fleet, batch screenshot Reads, don't leave a fat session idle past an hour.

Tokens lead; mention $ only where the digest itself shows dollar figures (API-billed
sessions). Keep the interpretation to a few short paragraphs — the digest carries the numbers.
