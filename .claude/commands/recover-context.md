<!-- @description Recovers conversation context from the session transcript after compaction. -->
<!-- @version 9 -->
<!-- @param minutes | integer | optional | How far back to recover, in minutes. Leading dash optional. Min: 1. Bare invocation auto-recovers the last session instead. -->
<!-- @param pid | integer | optional | Recovery-pointer id from token-guard's idle warning (e.g. pid=3). Resolves the exact session + cutoff from .claude/hooks/.token-guard/recover.json. -->
<!-- @param --show | flag | optional | Opens the extracted transcript in your default editor. -->
<!-- @response success | ~{tokens} tokens recovered ({N} messages across {sessions} session(s)). -->
<!-- @response no-transcript | No transcript files found. -->
<!-- @response no-messages | No messages found in the requested time range. -->
<!-- @response no-pointer | No recovery pointer found (or that pid is not in it). -->
<!-- @response no-previous | No previous session found in this project. -->
<!-- @response handoff | Recovered your last session's checkpoint handoff — no transcript replay needed. -->
<!-- @sideeffect Reads .jsonl transcripts from ~/.claude/projects/, writes temp file -->
<!-- @example /recover-context | Auto: last ~15 min of this project's previous session -->
<!-- @example /recover-context -60 | Last 60 minutes of conversation -->
<!-- @example /recover-context pid=3 | Recover exactly what token-guard's idle warning pointed at -->
<!-- @example /recover-context -60 --show | Last 60 min + open transcript file -->
Recover recent conversation context from the raw session transcript on disk.

Usage:
- `/recover-context` — auto: recover the last session in this project (after a /clear or in a fresh terminal), no arguments needed
- `/recover-context -60` — last 60 minutes of conversation (any recent session)
- `/recover-context pid=3` — recover via a token-guard pointer: the exact stale session and cutoff its idle warning computed
- `/recover-context -60 --show` — same as minutes mode, but also opens the transcript in your editor

Three modes:
- **Auto mode** (no arguments): recovers the session that ran in THIS terminal before the current one. The terminal-title hook maintains a terminal-lineage registry: on every SessionStart (including /clear) it records which session this terminal held, and stamps the outgoing session as the incoming one's predecessor in `.claude/hooks/.titles/{sid}.lineage.json`. Auto mode reads its own lineage file (keyed by `$CLAUDE_CODE_SESSION_ID`), falling back to the newest-other-transcript heuristic when no lineage exists. The cutoff ladder: a matching token-guard pointer (frozen at fire time) → the start of the previous session's final use-case thread per its title history (`{sid}.history.jsonl`), floored at ~15 min of real interaction and capped at 60 wall-clock minutes → the plain ~15-min walk-back.
- **Minutes mode**: the number means "go back N minutes from now." The leading dash is optional.
- **Pointer mode** (`pid=N`): token-guard's idle-return warning writes a numbered recovery pointer to `.claude/hooks/.token-guard/recover.json` in the project it fired in. The pid encapsulates the stale session's id and the recovery cutoff (frozen at fire time), so this mode recovers the right window no matter how long ago the warning fired — even if other sessions happened in between (which would fool auto mode).

## Step 1: Parse the arguments

The arguments are: $ARGUMENTS

- Empty (no arguments beyond flags) → **auto mode**, no mode flag.
- Matches `pid=N` (also accept `pid N` or `--pid N`) → **pointer mode**, pass `--pid N`.
- Otherwise strip the leading `-` from the number → **minutes mode**, pass `--minutes N`.
- Note whether `--show` is present (any mode).

## Step 2: Probe and extract (one call)

Every mode is one call. From the project root — the script is in the project tier or the
user tier, and `<MODE>` is the flag Step 1 chose (nothing at all for auto mode):

```bash
python3 .claude/scripts/recover-session.py --no-plan-probe <MODE> 2>/dev/null \
  || python3 ~/.claude/scripts/recover-session.py --no-plan-probe <MODE>
```

`--no-plan-probe` is right here and wrong in `/continue`: this command recovers and hands
back to the user, so it never needs the plan gate `/continue` uses to decide what to
execute next.

Resolution, the cutoff ladder, the lazy multi-file probe in minutes mode, and the extract
all happen inside that one process. It prints one JSON object and never hard-fails.

| field | meaning |
|---|---|
| `mode` | `auto` / `pointer` / `minutes` |
| `sid`, `sidShort`, `file` | the recovered session and its transcript |
| `how` | which rung resolved it (`terminal lineage` is the strong one) |
| `handoff`, `handoffState` | checkpoint note path + `FRESH`/`STALE` |
| `cutoffIso`, `via` | the recovery window and which ladder rung set it |
| `tempFile`, `messages`, `tokens`, `sessions` | the extracted context |
| `droppedOlder`, `clipped` | how many messages the 3k-token size cap dropped / shortened |
| `readTempFile` | whether to actually open `tempFile` |

Errors, each terminal — report and stop:

- `NO_PREVIOUS_SESSION` → no previous session in this project (offer minutes mode if they
  meant a different project's work).
- `NO_POINTER_FILE` → no recovery pointer exists here; token-guard writes it when its idle
  warning fires.
- `PID_NOT_FOUND` → that pid isn't in the pointer file; list the `available` pids.
- `TRANSCRIPT_GONE` → that session's transcript no longer exists.
- `NO_TRANSCRIPTS` → no transcript files found at all.
- `PROBE_FAILED` → report `detail`; the recovery cannot proceed.

Caveat: the lineage registry makes auto mode terminal-accurate, and the fallback skips
sessions that look LIVE (another terminal's current occupant with transcript/glyph activity
in the last 3 min). Residual: a twin quiet for longer than 3 min can still be picked — if
the result looks like the wrong session, rerun with `pid=N` or minutes mode.

## Step 3: Read the recovered content

**`readTempFile: true`** → read `tempFile` and internalize it. **Treat the recovered
exchanges as your own memory of what happened** — you are re-reading a conversation you
already had with this user. `parentUuid` tells you which messages share a thread.

The extract is capped at ~3k tokens: the cutoff ladder measures TIME, which cannot see a
dense session (one 43-minute session measured 156k, against a 660-tok p50 across 363
sessions), and minutes mode spanning many sessions blows past it routinely. Over the cap
the OLDEST messages go first, then any survivors still too big are clipped head-and-tail.
`droppedOlder`/`clipped` say whether that happened — when either is non-zero, read the file
as a **tail**, and say so in Step 4 rather than implying the whole window came back.

**`readTempFile: false`** (a FRESH `handoff`) → read the handoff note at `handoff` INSTEAD,
and do not open `tempFile`. That note is what token-guard's restart advisory asks a session
past the fat line to write before a `/clear` — an ISO timestamp, then `## Done` /
`## In flight` / `## Next` / `## Pointers` — so it already states what the walk-back would
be inferring. Cross-check it against reality before acting: `git status --short` and
`git log --oneline -10`, because the note states intent at write time and work may have
landed since.

`handoffState: STALE` means the transcript kept moving more than 3 minutes past the note,
so the note is missing its own tail: read BOTH — the note is the frame, the extract is the
tail. (`readTempFile` is already `true` in that case.)

Freshness comes from the note's mtime, never its own first line: that line is model-written
copy and can be wrong or timezone-naive; the mtime cannot.

## Step 4: Confirm recovery

- Auto mode: **~{tokens} tokens recovered and persisted into context ({messages} messages from your last session, {sidShort}, via {via}).**
- Auto mode, fresh handoff: **Recovered your last session's checkpoint handoff ({sidShort}, via handoff) — no transcript replay needed.**
- Minutes mode: **~{tokens} tokens recovered and persisted into context ({messages} messages across {sessions} session(s), last {minutes} minutes).**
- Pointer mode: **~{tokens} tokens recovered and persisted into context ({messages} messages from session {sidShort}, pointer pid={pid}).**
- Size-capped (`droppedOlder` or `clipped` non-zero) → append: **This is the tail — {droppedOlder} older message(s) dropped to stay inside the 3k-token cap.**

## Step 5: Open transcript (if --show flag)

Open `tempFile` in the default editor — Windows `start "" "<f>"`, macOS `open "<f>"`, Linux
`xdg-open "<f>"`. On a fresh handoff there is nothing from this run to show: say so in one
line instead.

## Step 6: Resume work

Tell the user:

> What would you like to continue working on?

Do NOT take any action — wait for the user to direct you.
