<!-- @description Reap what the worktree loop leaves behind: orphaned directories, stale registrations, merged branches. -->
<!-- @version 1 -->
<!-- @param write | flag | optional | Actually delete. Without it this is a dry run. -->
<!-- @param keep-branches | flag | optional | Reap directories only; leave merged branches alone. -->
<!-- @response report | Orphan directories with a per-directory verdict, then stale registrations, merged branches, and (under --write) what was actually removed. -->
<!-- @example /sync-worktrees | Show what is reapable. Changes nothing. -->
<!-- @example /sync-worktrees write | Delete the provably-safe orphans and merged branches -->
<!-- @example /sync-worktrees write keep-branches | Reclaim the disk, leave the refs -->

# /sync-worktrees

`/fleet` tells you who is working where. This is its **write counterpart**: the thing that cleans up
after the worktree loop is done.

The specific mess it exists for: `ExitWorktree remove` de-registers a worktree and *then* deletes its
tree. On Windows the second half loses — something holds a handle inside `node_modules` (esbuild,
vite, a watcher), the recursive delete aborts, and git has already forgotten the entry. So the
directory becomes invisible to git forever:

```
git worktree list   → only the base checkout
git worktree prune  → nothing to do
.claude/worktrees/  → five full working trees, node_modules and all
```

**`prune` is not the fix.** Orphans are found by walking `.claude/worktrees/` and subtracting what
git still knows about.

## Step 1 — run it

```bash
node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/sync-worktrees.js"
```

Append `--write` if `$ARGUMENTS` contains `write`, and `--keep-branches` if it contains
`keep-branches`. **Default is a dry run** — run the bare form first whenever the user hasn't
explicitly asked to delete.

## Step 2 — report it

Print the script's output **verbatim in a fenced block**. It is already a report; re-narrating it
row by row makes it longer than the thing it summarizes.

Add interpretation only when a directory is not `REAP`:

- **BLOCKED** — files exist there and nowhere in git. Those are named in the output. Say what they
  are and that the directory was left alone; the user decides whether to salvage or force it.
- **HELD** — a session wrote to that tree in the last 3 minutes. Say which one is still live
  (`/fleet` names it) rather than suggesting a retry.
- **PARTIAL** — the delete started and Windows kept some files. Say that a process still holds a
  handle (usually a dev server or an editor with the folder open) and that re-running finishes it.

## Step 3 — what it will not do

**It never merges.** Landing an unlanded branch needs a per-session handoff record — *what I
finished, what's unlanded, what blocks it* — that nothing currently writes. Inferring it from a
branch name and a diff is the guess that loses work. If the user asks this command to land
something, say that and point at `/fleet` for the roster.

## Safety model

| Guard | Behavior |
|---|---|
| Content proof | Every non-ignored file is hashed and looked up in the object store. One miss → `BLOCKED`, directory untouched. |
| Gitignored files | Filtered out first — `crx-key.ts`, `.env`, `dev-build-number.json` are never in the object store, and counting them would make every orphan permanently undeletable. |
| Liveness | A tree whose session transcript was written in the last 3 min is `HELD`. |
| Registered worktrees | Anything in `git worktree list` is skipped entirely. |
| Branches | `git branch -d`, never `-D` — if the merge math is wrong, git refuses. `main`/`master` are protected outright, as is any branch checked out in a worktree. |
| Default | Dry run. `--write` is the only thing that deletes. |

Unmerged branches are never touched, so an old parked branch (`dev/andrew`) survives every run.
