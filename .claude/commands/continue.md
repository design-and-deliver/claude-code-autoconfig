<!-- @description Continues where your previous session in this terminal left off — recovers its context and resumes the work. Plan-aware: if that session was executing a substep of a plan doc, resumes from the plan's Ledger instead of the transcript. -->
<!-- @version 3 -->
<!-- @param --show | flag | optional | Opens the recovered transcript in your default editor. -->
<!-- @response success | Picking up where we left off — {what we were doing}. Then the work resumes. -->
<!-- @response plan | Picking up where we left off — {plan alias}: substep {N.k} done ({hash}); starting {next}. Then the next substep runs. -->
<!-- @response no-previous | I can't find a previous session for this terminal. -->
<!-- @sideeffect Reads .jsonl transcripts from ~/.claude/projects/, writes temp file -->
<!-- @example /continue | Recover the previous session here and resume its work -->
Continue where the previous session in this terminal left off.

This is the no-ceremony wrapper around `/recover-context`'s auto mode: recover the last
session's context, then RESUME the work — unlike `/recover-context`, which recovers and
waits for direction. No arguments; it figures everything out itself.

It is also **plan-aware**: when the previous session was executing a substep of a phased
plan doc (the plan-authoring pattern — a `docs/*.md` or `.claude/plans/*.md` with a
`## Ledger` section), the plan
doc + Ledger is the handoff, not the transcript. Recovery shrinks to a sliver and this
session starts the next substep, so `/clear` → `/continue` is the intended loop between
plan substeps.

## Step 1: Resolve the previous session

Read `.claude/commands/recover-context.md` (fall back to `~/.claude/commands/recover-context.md`
if the project doesn't ship it) and run its **Step 2c** (auto mode) exactly as written to
resolve the previous session: terminal lineage first, newest-other-transcript fallback. Store
`$SID`, `$FILES_TO_PARSE` (the `FILE=` path), and `$CUTOFF_ISO`.

If it reports no previous session: say "I can't find a previous session for this terminal." and
suggest `/recover-context -60` for time-window recovery instead — then stop.

## Step 2: Plan check — was that session executing a plan substep?

Two cheap probes BEFORE extracting anything:

1. **Last title**: read the final line of `.claude/hooks/.titles/{$SID}.history.jsonl`
   (fall back to `~/.claude/hooks/.titles/`). Plan-driven sessions title as
   `{plan alias} — {area} — {goal}`.
2. **Plan docs**: list the plan docs — `grep -l '^## Ledger' docs/*.md .claude/plans/*.md
   2>/dev/null` (no hits in either place → not plan-driven). `.claude/plans/` is typically
   gitignored — a plan doc there still counts, and its edits will NOT show in `git status`.

**Plan-driven** = a Ledger-bearing plan doc exists AND the last title's first segment reads
as an alias of that doc (the alias's words appear in the doc's filename or title). If the
title is missing, ambiguous, or matches NO plan doc, do not conclude "not plan-driven" yet —
tiebreak by grepping the previous transcript's final ~100 lines for each plan doc's filename
(an Edit/Write touching a plan doc there is decisive: that session WAS plan-driven; sessions
don't always title by the plan-alias convention). Only when both probes and the tiebreak come
up empty is the session NOT plan-driven — then continue to Step 3 unchanged.

When plan-driven, shrink the recovery window — the Ledger is the handoff and the transcript
is only color: raise `$CUTOFF_ISO` to (the transcript's last timestamp − 10 minutes) if that
is later than the resolved cutoff.

## Step 3: Recover

Run recover-context's **Step 4** (extract) with `$CUTOFF_ISO` and `$FILES_TO_PARSE`. Honor
`--show` via its Step 6. Do NOT use its Step 5 confirmation or Step 7 wait — /continue
replaces both below.

## Step 4: Internalize

Read the extracted temp file and treat the recovered exchanges as your own memory of the
conversation you were just having with this user — not a document to summarize.

## Step 5: Resume (ordinary session)

If Step 2 found the session plan-driven, use Step 6 instead.

Silently reconstruct from that memory: the active task and its state, the next action that was
in flight, and what was already completed. Before acting, cross-check reality — `git status
--short`, plus a quick look at any file the tail claims was mid-edit — the recovered tail may
predate work that already landed.

Then open your reply with exactly this line (bold, em-dash clause naming the work):

> **Picking up where we left off** — {one short clause: what we were doing}.

And continue, by ending state:

- **Work was mid-flight** (a task underway, a named next step): carry on with it now, under the
  same rules as any turn — proceed with reversible work; confirm first before anything
  destructive or outward-facing.
- **The session ended waiting on the user** (an open question, a pending decision): re-ask that
  question, refreshed with anything you can now verify yourself.
- **The work was finished**: say so in one line, then ask what's next.

Never re-do work the tail (or git) already shows as done.

## Step 6: Resume (plan-driven session)

Read the plan doc IN FULL — its standing trap warnings, the substep checklist, and the
`## Ledger`. Then reconcile three sources before acting:

- the Ledger's latest entry (which substep, which commit hash),
- `git log --oneline -15` (does that hash exist?),
- `git status --short` (uncommitted work?).

Open your reply with the same line, plan-flavored:

> **Picking up where we left off** — {plan alias}: substep {N.k} done ({hash}); starting {N.next}.

Then act by state:

- **Clean handoff** (last substep committed + ledgered, working tree clean): execute the next
  unchecked substep start-to-finish per the plan doc — including its Verify step, its commit,
  and appending its Ledger entry. Close by prompting the user to `/clear` then `/continue`.
- **Mid-flight substep** (uncommitted changes, or work done but its Verify / commit / Ledger
  entry missing): FINISH that substep — complete the work, run its Verify, commit, append the
  Ledger — then stop and prompt `/clear` + `/continue`. Do not also start the next substep.
- **Plan complete** (every substep checked): say so in one line, then ask what's next.

Traps: never re-do a substep the Ledger + git already show done; never run two substeps in
one session (one-substep-per-fresh-session is the plan's token-hygiene lever); where the doc
and the code disagree, trust git and fix the doc.
