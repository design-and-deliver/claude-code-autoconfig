<!-- @description Report what another (possibly stuck) Claude session's current turn is doing + time per step. -->
<!-- @version 1 -->
<!-- @param title | string | optional | Substring of the target session's tab title. Omit to list recent sessions. -->
<!-- @response report | Prints the target turn's live activity, time-per-step rollup, and recent steps. -->
<!-- @response list | With no title, lists recent sessions (live/idle + last write) so you can pick one. -->
<!-- @example /whats-happening | List recent sessions with their live/idle state -->
<!-- @example /whats-happening token-guard | Report on the session whose title contains "token-guard" -->

# /whats-happening

Observe a **different** Claude session that may be running forever on a prompt, and report what
its current turn is doing. It reads that session's live transcript off disk — it does **not**
interrupt or query the busy session (a busy session can't answer a slash command mid-turn).

DEV-ONLY: gated out of user installs (`DEV_ONLY_FILES` in `bin/cli.js`), dogfooded from the CCA
repo like token-guard. Scope is the two reliable outputs — **what the turn is doing right now**
and **time spent per activity**. "Still plans to do" and an ETA are deferred (only knowable if the
target wrote a plan/TaskList; often absent).

## Step 1 — run the observer

`$ARGUMENTS` is a substring of the target session's tab title (the text after the state glyph).

- **If `$ARGUMENTS` is empty**, run the list form so the user can see which sessions are live and
  grab a title:

  ```bash
  node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/whats-happening.js" --list
  ```

- **Otherwise**, pass the title substring (quote it — titles contain spaces and the em-dash):

  ```bash
  node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/whats-happening.js" "$ARGUMENTS"
  ```

The script auto-excludes the current session (via `CLAUDE_CODE_SESSION_ID`), so it never reports
on itself.

## Step 2 — relay the output

The script prints ready-to-read Markdown. **Relay it as-is** — don't re-summarize. The two headline
signals:

- **`▶`/`⏳ … so far`** on a step = that tool is still in flight; its live duration is how long it's
  been stuck there (the "running forever" tell).
- **`⏸ idle or turn finished`** + a stale "last write" = the turn already ended (or is awaiting the
  user), not actually churning.

If no title matched, suggest re-running with `--list` (empty `$ARGUMENTS`) to see the exact titles,
or a shorter substring.

## Notes

- **Title lookup mirrors terminal-title's two tiers:** a copy-shipping repo keeps titles at
  `<project>/.claude/hooks/.titles`; the user-level fallback keeps them at `~/.claude/hooks/.titles`.
  Both are searched. A session in a *different* copy-shipping repo writes titles into that repo's own
  `.titles`, so to observe it, run this from a second terminal **in that repo** (where its titles and
  this dev-only command both live).
- Per-step durations are **produce + run** wall-clock (model generation for that step + the tool's
  execution), so they sum to roughly the whole turn — a real time-budget view, not just tool runtime.
- Subagent (sidechain) internals collapse into their parent `Agent`/`Task` step.
