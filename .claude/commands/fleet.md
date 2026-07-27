<!-- @description Read-only board of every Claude session on this repo: who's live, who's waiting on you, what will collide. -->
<!-- @version 1 -->
<!-- @param all | flag | optional | Include idle sessions (default: active only). -->
<!-- @response board | Prints hazards first (same-tree, duplicate title, file overlap), then the session roster and unlanded branches. -->
<!-- @example /fleet | Show active sessions, collisions, and what's unlanded -->
<!-- @example /fleet all | Include idle sessions in the roster -->

# /fleet

Several Claude sessions run against this repo at once. Some hold while others finish, and there
is no single place that says who is doing what — so the state feels invisible even though every
signal is already on disk. This joins them into one board.

**READ-ONLY.** It never merges, moves a branch, or writes to a worktree. Safe to run at any
moment, including while everything is busy — which is exactly when you need it.

DEV-ONLY: gated out of user installs (`DEV_ONLY_FILES` in `bin/cli.js`), dogfooded from the CCA
repo like `token-guard` and `whats-happening`.

## Step 1 — run the board

```bash
node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/fleet.js"
```

If `$ARGUMENTS` contains `all`, append `--all` to include idle sessions.

## Step 2 — report it

Print the script's output **verbatim in a fenced block**. It is already formatted as a board;
re-narrating it row by row makes it longer and harder to scan than the raw output.

Then add **at most two lines** of interpretation, and only if there is a hazard block:

- **SAME-TREE COLLISION** — the one that loses work. Say which sessions should move to a worktree
  (the newest, since they have the least invested), and that the fix is `EnterWorktree` +
  `node scripts/bootstrap-worktree.js` in those sessions.
- **DUPLICATE TITLE** — say which session appears furthest along (most recent write) and that the
  others are candidates to stop.
- **OVERLAP** — name the branch to land first (the one the board already ordered first).

If there are no hazards, say nothing beyond the block. A clean board speaks for itself.

## Step 3 — do NOT act on it

Do not merge, do not `EnterWorktree` on the user's behalf, do not stop another session. The board
tells the **user**; they are the scheduler. Landing is a separate explicit step they ask for.

## What it reads

| Signal | Source |
|---|---|
| session title, when it changed | `.claude/hooks/.titles/{sid}.txt` |
| awaiting-you flag | `.claude/hooks/.titles/{sid}.ask` |
| colliding twins (precomputed) | `.claude/hooks/.titles/{sid}.dupe.json` |
| liveness | mtime of `~/.claude/projects/*/{sid}.jsonl` |
| session → working tree | the transcript's project-slug directory, matched forward against each known worktree path |
| worktrees, branches, unlanded commits, file overlap | `git worktree list` / `log` / `diff --name-only` |

Nothing new is instrumented — the hooks already wrote all of it.
