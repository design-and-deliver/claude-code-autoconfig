<!-- @description Continues where your previous session in this terminal left off — recovers its context and resumes the work. -->
<!-- @version 1 -->
<!-- @param --show | flag | optional | Opens the recovered transcript in your default editor. -->
<!-- @response success | Picking up where we left off — {what we were doing}. Then the work resumes. -->
<!-- @response no-previous | I can't find a previous session for this terminal. -->
<!-- @sideeffect Reads .jsonl transcripts from ~/.claude/projects/, writes temp file -->
<!-- @example /continue | Recover the previous session here and resume its work -->
Continue where the previous session in this terminal left off.

This is the no-ceremony wrapper around `/recover-context`'s auto mode: recover the last
session's context, then RESUME the work — unlike `/recover-context`, which recovers and
waits for direction. No arguments; it figures everything out itself.

## Step 1: Recover

Read `.claude/commands/recover-context.md` (fall back to `~/.claude/commands/recover-context.md`
if the project doesn't ship it) and follow its **auto mode** exactly as written: Step 2c to
resolve the previous session (terminal lineage first, newest-other-transcript fallback), then
Step 4 to extract. Honor `--show` via its Step 6. Do NOT use its Step 5 confirmation or
Step 7 wait — /continue replaces both below.

If it reports no previous session: say "I can't find a previous session for this terminal." and
suggest `/recover-context -60` for time-window recovery instead — then stop.

## Step 2: Internalize

Read the extracted temp file and treat the recovered exchanges as your own memory of the
conversation you were just having with this user — not a document to summarize.

## Step 3: Resume

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
