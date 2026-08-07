<!-- @description Continues where your previous session in this terminal left off — recovers its context and resumes the work. Plan-aware: if that session was executing a substep of a plan doc, resumes from the plan's Ledger instead of the transcript. -->
<!-- @version 8 -->
<!-- @param --show | flag | optional | Opens the recovered transcript in your default editor (no-op on a clean plan handoff or a fresh checkpoint handoff note — nothing is read). -->
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
`## Ledger` section), the plan doc + Ledger is the handoff, not the transcript.

**Every probe runs in ONE call (Step 1).** Recovery cost is `round trips × resident
context`, and this command used to spend eight to fifteen sequential round trips on pure
filesystem reads whose results never changed what the next probe did — while the context
they recovered was ~700 tokens at p50 (measured 2026-08-07 across 245 real `/continue`
sessions). The probes were separate only because this doc used to write them as separate
prose steps. Everything below Step 1 is a DECISION, not a lookup.

## Step 1: Probe (one call)

From the project root — the script is in the project tier or the user tier:

```bash
python3 .claude/scripts/recover-session.py 2>/dev/null \
  || python3 ~/.claude/scripts/recover-session.py
```

It prints one JSON object and never hard-fails. Fields:

| field | meaning |
|---|---|
| `sid`, `sidShort`, `file` | the previous session and its transcript |
| `how` | which rung resolved it (`terminal lineage` is the strong one) |
| `lastTitle` | that session's final terminal title |
| `handoff`, `handoffState` | checkpoint note path + `FRESH`/`STALE` |
| `planDriven`, `planDoc`, `planMatchedVia` | plan verdict |
| `planCandidates` | every near-miss, with its evidence — so you can overrule |
| `plan` | `trapSection`, `nextSubstep`, `ledgerTail` line ranges + the substep map |
| `git` | `log` (15) and `statusShort`, on a plan match |
| `liveSiblings`, `siblingGate` | concurrency gate: `STOP` or `CLEAR` |
| `cutoffIso`, `via` | the recovery window and which ladder rung set it |
| `tempFile`, `messages`, `tokens`, `readTempFile` | the extracted context |

On `{"error": "NO_PREVIOUS_SESSION"}` → say "I can't find a previous session for this
terminal." and suggest `/recover-context -60` for time-window recovery instead, then stop.
On `PROBE_FAILED`, fall back to `/recover-context`'s prose steps.

The extract already ran, to `tempFile` — always THIS run's content, so the stale-leftover
hazard (the extract writes a fixed filename and nothing cleans it up) cannot bite.

## Step 2: Read the right source

Exactly one of these is the handoff. Take it and skip the others.

- **`handoffState: FRESH`** → the checkpoint note IS the recovery. Read `handoff` (the note
  token-guard's restart advisory asks a session to write before a `/clear`: ISO timestamp,
  then `## Done` / `## In flight` / `## Next` / `## Pointers`). Do NOT also read `tempFile`
  — `readTempFile` is already `false`. Cross-check `git status --short` before acting.
  `STALE` is different: the note is the frame, the extract supplies the tail — read both.
- **`planDriven: true`** → go to Step 3.
- **otherwise** → read `tempFile` and go to Step 4.

Treat whatever you read as your own memory of the conversation you were just having with
this user — not a document to summarize.

**Overruling the plan verdict.** `planDriven` is deliberately biased toward `false`: it
fires on a plan doc the session actually OPENED, or a two-word title-alias match, because
a single shared word is not evidence (`/Continue command — Cut recovery over-import` shares
"continue" with `clear-and-continue-refinements-plan.md` while executing no plan at all).
If `planCandidates` shows a near-miss and the recovered text plainly describes executing
that plan, treat it as plan-driven and go to Step 3.

## Step 3: Plan gate — clean handoff or mid-flight?

Read the plan doc **in slices, never whole** — a mature plan runs 800+ lines, over half of
it Ledger, and a full read stays resident for every remaining request in the session. The
`plan` object already holds the ranges: read `trapSection`, `nextSubstep`, and `ledgerTail`.
If the plan's header carries its own read-in-slices instruction (the plan-authoring
convention), prefer that — it names exact ranges.

Then reconcile three sources — `git.log` and `git.statusShort` are already in the JSON:

- the Ledger's latest entry (which substep, which commit hash),
- `git.log` (does that hash exist? a Ledger entry with NO hash still counts as ledgered —
  gitignored plans skip Ledger-only commits by design),
- `git.statusShort` (uncommitted work? note `.claude/plans/` is typically gitignored, so a
  plan edit there will NOT appear).

**Clean handoff** (latest substep committed + ledgered, tree clean — or every substep
already checked): the Ledger covers everything the transcript would say. Skip `tempFile`
(`--show` has nothing to show — say so in one line if it was passed). Go to Step 5.

**Mid-flight** (uncommitted changes, a Ledger/git mismatch, or work done but its Verify /
commit / Ledger entry missing): the in-flight sliver lives only in the transcript — read
`tempFile`, then go to Step 5.

⛔ **`siblingGate` is not optional.** A plan doc is a shared work queue with no lock, and
the Ledger cannot protect you: it is written *after* a substep, so a sibling mid-substep is
invisible in it by construction, and a sibling that ran two substeps without ledgering the
first makes the Ledger actively wrong. The dupe-session guard misses it too — that keys on
*identical* titles, and two sessions routinely invent different aliases for one plan
("Company Fields" vs "Company info plan").

- `CLEAR` → proceed.
- `STOP` → **do not execute a substep, do not edit the plan doc, do not touch the working
  tree.** Report each `liveSiblings` entry (sid, glyph, title) and what git actually shows —
  including in every OTHER repo the plan's phases commit to, which the probe cannot see (a
  done substep's commit may live entirely elsewhere). Then ask the user how to proceed
  rather than choosing for them; standing down is the default.

## Step 4: Resume (ordinary session)

Silently reconstruct: the active task and its state, the next action that was in flight, and
what was already completed. Before acting, cross-check reality — `git status --short`, plus a
quick look at any file the tail claims was mid-edit — the recovered tail may predate work
that already landed.

Then open your reply with exactly this line (bold, em-dash clause naming the work):

> **Picking up where we left off** — {one short clause: what we were doing}.

And continue, by ending state:

- **Work was mid-flight** (a task underway, a named next step): carry on with it now, under
  the same rules as any turn — proceed with reversible work; confirm first before anything
  destructive or outward-facing.
- **The session ended waiting on the user** (an open question, a pending decision): re-ask
  that question, refreshed with anything you can now verify yourself.
- **The work was finished**: say so in one line, then ask what's next.

Never re-do work the tail (or git) already shows as done.

## Step 5: Resume (plan-driven session)

The plan doc is read, the Ledger/git reconciliation done, and the concurrency gate cleared
(if it did not clear, you already stopped). Open your reply with the same line,
plan-flavored:

> **Picking up where we left off** — {plan alias}: substep {N.k} done ({hash}); starting {N.next}.

Then act by Step 3's state:

- **Clean handoff**: execute the next unchecked substep start-to-finish per the plan doc —
  including its Verify step, its commit, and appending its Ledger entry. Close by prompting
  the user to `/clear` then `/continue`.
- **Mid-flight**: FINISH that substep — complete the work, run its Verify, commit, append
  the Ledger — then stop and prompt `/clear` + `/continue`. Do not also start the next
  substep.
- **Plan complete** (`plan.nextSubstep` is null and every substep is checked): say so in one
  line, then ask what's next.

Traps: never re-do a substep the Ledger + git already show done; never run two substeps in
one session (one-substep-per-fresh-session is the plan's token-hygiene lever — and skipping
the intermediate Ledger entry is what makes the next session's handoff lie); where the doc
and the code disagree, trust git and fix the doc.

## `--show`

Open `tempFile` in the default editor — Windows `start "" "<f>"`, macOS `open "<f>"`, Linux
`xdg-open "<f>"`. Skip it (and say so in one line) whenever `readTempFile` is `false` or the
plan gate resolved to a clean handoff: nothing from this run was read.
