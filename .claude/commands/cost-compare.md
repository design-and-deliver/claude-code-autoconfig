<!-- @description Compare this session's carryover cost against a fresh session's cold-start cost — the on-demand version of the statusline readout, shown even when the statusline is deliberately silent. -->
<!-- @version 2 -->
<!-- @response success | Prints live context, fresh-session cold-start, and a verdict line. -->
<!-- @response no-meter | The repo has no .claude/hooks/token-guard.js — nothing to report. -->
<!-- @example /cost-compare | Compare continuing this session vs starting fresh -->

# Cost Compare

Print the session-vs-fresh cost readout: live context (the per-turn re-read), fresh-session
cold-start cost, and a verdict. Only the forward-looking figures appear — session total is
sunk cost and deliberately omitted (/usage-report owns spend detail). All figures come
deterministically from the repo's token-guard meter — no analysis of your own.

## Step 1: Run the report

```bash
node "$HOME/.claude/hooks/statusline-cost.js" --report "$HOME/.claude/projects/<project-slug>/<session_id>.jsonl"
```

Pass your OWN session's transcript when you know your session id (it appears in paths given
to you at session start, e.g. the terminal-title file name). If you don't know it, run
without the argument — the script picks the newest transcript for the current project.
With parallel sessions on one repo the newest may belong to a sibling; the report's first
line names the session id it metered, so a mismatch is visible.

## Step 2: Display

Show the output verbatim in a code block. Add nothing — the verdict line is the
interpretation. If it reports the repo has no token-guard meter, relay that one line as-is.
