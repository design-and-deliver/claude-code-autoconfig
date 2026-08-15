---
description: Recover the previous session's last active context on Sonnet, report where it stands, then stop for your go-ahead
argument-hint: [--show]
model: sonnet
---
<!-- @description Recovers where your previous session in this terminal left off — rebuilds its context on a cheap model, reports the state and the precise next action, then stops for your go-ahead. Plan-aware: if that session was executing a substep of a plan doc, the report comes from the plan's Ledger instead of the transcript. -->
<!-- @version 12 -->
<!-- @param --show | flag | optional | Opens the recovered transcript in your default editor (no-op on a clean plan handoff or a fresh checkpoint handoff note — nothing is read). -->
<!-- @response success | Picking up where we left off — {what we were doing}. State summary + the one next action, then a go-ahead question. -->
<!-- @response plan | Picking up where we left off — {plan alias}: substep {N.k} done ({hash}); next: {N.next}. Then a go-ahead question. -->
<!-- @response no-previous | I can't find a previous session for this terminal. -->
<!-- @sideeffect Reads .jsonl transcripts from ~/.claude/projects/, writes temp file -->
<!-- @example /continue | Recover the previous session here, see where it stands, reply "go" to resume -->
Continue where the previous session in this terminal left off.

This is the no-ceremony wrapper around `/recover-context`'s auto mode: no arguments, it
figures everything out itself, and it is plan-aware (below). Since v9 it is pinned to
Sonnet (the `model:` frontmatter above): recovery is mechanical re-reading — probe, read,
reconcile — and a cheap model handles it fully, at a fraction of the cost on a
Fable/Opus session. What the cheap model must NOT do is the resumed work itself.
`model:` scopes to the whole turn, so this command ends its turn at the report: state
recovered, the one next action named, a go-ahead question. The user's next prompt
("go") starts a fresh turn on the session's main model, with the recovered context
already in the conversation — recovery cheap, work at full quality.

⛔ **End the turn on a plain text question — never an AskUserQuestion picker.** A picker
answer continues the SAME turn, so the work it green-lights would run on the cheap
recovery model — exactly what the stop exists to prevent. This overrides any local
end-of-turn convention that prefers a picker for closed choices. Ask in text, end the
message, wait.

**Model check (v11): verify the pin, don't assume it.** Claude Code currently ignores
command `model:` frontmatter at runtime — a known bug (anthropics/claude-code#45191,
closed "not planned"): the pin is parsed into command_permissions as `claude-sonnet-5`,
yet every call in the turn runs on the session's main model. Verified live on 2.1.220,
interactive and headless alike, on Fable and Opus sessions both. Your system prompt
names the model you are actually running on. If it is not a Sonnet-class model, append
one final line to the report:

> ⚠ recovery ran on {model} — the Sonnet pin didn't take.

Nothing else changes — the recovery steps are identical on any model. The line exists so
a failed pin is visible instead of silently costing ~4× per /continue.

It is also **plan-aware**: when the previous session was executing a substep of a phased
plan doc (the plan-authoring pattern — a `docs/*.md` or `.claude/plans/*.md` with a
`## Ledger` section), the plan doc + Ledger is the handoff, not the transcript.

**Every probe runs in ONE call (Step 1).** Recovery cost is `round trips × resident
context`, and this command used to spend eight to fifteen sequential round trips on pure
filesystem reads whose results never changed what the next probe did — while the context
they recovered was ~700 tokens at p50 (measured 2026-08-07 across 245 real `/continue`
sessions). The probes were separate only because this doc used to write them as separate
prose steps. Everything below Step 1 is a DECISION, not a lookup.

## Step 0: Announce (the turn's first output, before any tool call)

Say exactly:

> Recovering the previous session's last active context.

Not the vaguer "Recovering the previous session's context." — "active" is the accurate
word: what comes back is the in-flight tail of that session (cutoff ladder + 3k cap) or
its plan Ledger, never the whole transcript.

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
| `stopReason` | present only as `unexplained-interrupt` — see Step 4 |
| `cutoffIso`, `via` | the recovery window and which ladder rung set it |
| `tempFile`, `messages`, `tokens`, `readTempFile` | the extracted context |
| `droppedOlder`, `clipped` | how many messages the 3k-token size cap dropped / shortened |

On `{"error": "NO_PREVIOUS_SESSION"}` → say "I can't find a previous session for this
terminal." and suggest `/recover-context -60` for time-window recovery instead, then stop.
On `PROBE_FAILED`, fall back to `/recover-context`'s prose steps.

The extract already ran, to `tempFile` — always THIS run's content, so the stale-leftover
hazard (the extract writes a fixed filename and nothing cleans it up) cannot bite.

**The extract is capped at ~3k tokens**, because every other guard in the cutoff ladder
measures TIME and time is the wrong dimension: a dense session whose title never shifted
(the compass is supposed to change rarely) reaches back over the whole session. Measured
2026-08-07 across 363 sessions, the payload is 660 tok at p50 — but one 43-minute session
extracted 156k. Over the cap, the OLDEST messages go first and any survivors still too big
are clipped head-and-tail; `via` then gains `, size-capped at 3000 tok`. When you see that,
**read `tempFile` as a tail, not as the whole thread** — the head is context you re-derive
from `git log` if it matters. Under the cap (95% of recoveries) the payload is untouched.

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

## Step 4: Report (ordinary session)

Silently reconstruct: the active task and its state, the next action that was in flight, and
what was already completed. Cross-check reality — `git status --short`, plus a quick look at
any file the tail claims was mid-edit — the recovered tail may predate work that already
landed.

Then open your reply with exactly this line (bold, em-dash clause naming the work):

> **Picking up where we left off** — {one short clause: what we were doing}.

Follow with a few lines of state: what's done, what's in flight, and the ONE next action,
named precisely enough that "go" is a sufficient answer. Then end the turn, by ending state:

- **Work was mid-flight** (a task underway, a named next step): ask the go-ahead — "Resume
  {next action}?" — and stop. Do not start the work in this turn (see the ⛔ above: plain
  text question, no picker).
- **The session ended waiting on the user** (an open question, a pending decision): re-ask
  that question, refreshed with anything you can now verify yourself.
- **The work was finished**: say so in one line, then ask what's next.

Never report as pending what the tail (or git) already shows done.

⛔ **`stopReason: unexplained-interrupt` overrides the "ended waiting" branch.** The last
thing the user typed was a bare `[Request interrupted by user…]` — no reason given — and
the dead session, having no idea why, very likely signed off by asking for one ("what made
you stop me?"). That question is stale by construction: an interrupt followed by `/clear`
is usually mechanical (Escape, or a restart the user had already queued), and even when it
wasn't, the user answers by telling you, not by being asked. **Never replay it.** Report the
state, name what was in flight when the interrupt landed, and close on the forward go-ahead
instead — "Resume {next action}?". One neutral clause noting the stop was unexplained is
fine; an interrogation about it is not.

## Step 5: Report (plan-driven session)

The plan doc is read, the Ledger/git reconciliation done, and the concurrency gate cleared
(if it did not clear, you already stopped). Open your reply with the same line,
plan-flavored:

> **Picking up where we left off** — {plan alias}: substep {N.k} done ({hash}); next: {N.next}.

Then report by Step 3's state and STOP — the substep itself runs on the main model after
the go-ahead:

- **Clean handoff**: name the next unchecked substep (number, title, size tag) and its
  first action, ask the go-ahead, and end the turn. The go-turn executes it start-to-finish
  per the plan doc — including its Verify step, its commit, and appending its Ledger entry —
  and closes by prompting the user to `/clear` then `/continue`.
- **Mid-flight**: report exactly what the open substep is missing (work, Verify, commit, or
  Ledger entry), ask the go-ahead to FINISH it, and end the turn. The go-turn completes that
  substep only — it does not also start the next one.
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
