<!-- @description Reap what the worktree loop leaves behind: orphaned directories, merged worktrees, stale registrations, merged branches. -->
<!-- @version 3 -->
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

**Default is a dry run.** Always run the bare form first, even when `$ARGUMENTS` contains `write`.

⛔ **Before any `--write`**, in this order:

1. Snapshot every worktree:
   `node scripts/snapshot-worktrees.js C:\CODE\claude-code-autoconfig C:\CODE\job-agent-extension`
   (from the CCA checkout). Note the backup folder it prints.
2. Run the dry run and show the user its output, **the REGISTERED WORKTREES list above all**:
   each `RECLAIM` row there is a registered worktree `--write` will remove.
3. Run `--write` only after the user says yes to that list. An approval from an earlier run
   doesn't count, because other sessions keep working in between.

Then append `--write`, plus `--keep-branches` if `$ARGUMENTS` contains `keep-branches`.

## Step 2 — report it

Print the script's output **verbatim in a fenced block**. It is already a report; re-narrating it
row by row makes it longer than the thing it summarizes.

Add interpretation only when a directory is not `REAP`:

- **BLOCKED** — files exist there and nowhere in git. Those are named in the output. Say what they
  are and that the directory was left alone; the user decides whether to salvage or force it.
- **HELD** — a session wrote to that tree in the last 3 minutes. Say which one is still live
  (`/fleet` names it) rather than suggesting a retry.
- **TRASHED** — `--write` couldn't fully delete the directory (a handle was still open), so it was
  *renamed* into `.claude/worktrees/.trash/<name>-<epoch>` instead of left in place under its old
  name — renaming a locked directory succeeds on Windows even when deleting it doesn't. It no
  longer shows as an orphan; every later `--write` run retries deleting it from `.trash/` until
  whatever held it lets go. Say that it's parked, not gone, and that no action is needed.
- **KEEP** (registered worktrees): a registered worktree is reclaimed only if **every** guard
  passes: branch merged into base, `git status` clean apart from `.claude/settings.local.json`,
  not locked, no session transcript write in the last 30 minutes, and not the directory this
  process runs in. A KEEP row names each guard that failed; pass that along as-is.
- **PARTIAL** — even the rename into `.trash/` failed. Rare — say that a process still holds a
  handle (usually a dev server or an editor with the folder open) and that re-running finishes it.

## TRASH — the `.trash/` sweep

Every run (dry or `--write`) also lists what's waiting in `.claude/worktrees/.trash/`: directories
a previous `--write` couldn't delete outright and parked there instead (see TRASHED, above).
`.trash/` itself is excluded from the orphan scan, so it's never mistaken for one. Under
`--write`, each entry gets the same delete attempt as a fresh orphan — unlink a junctioned
`node_modules` first (⛔5, never recurse through the link), then `fs.rmSync` with the same retry
options — and whatever still won't die is left for the next run.

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
| Registered worktrees | Never treated as orphans. Reclaimed only when all five guards pass (merged, clean, unlocked, idle 30m+, not cwd); removal goes through plain `git worktree remove`, never `--force`, with a junctioned `node_modules` unlinked first. |
| Undeletable dirs | A `REAP` directory `--write` can't fully delete is renamed into `.trash/` (`TRASHED`) and retried every later run, instead of left in place forever. |
| Branches | `git branch -d`, never `-D` — if the merge math is wrong, git refuses. `main`/`master` are protected outright, as is any branch checked out in a worktree. |
| Default | Dry run. `--write` is the only thing that deletes. |

Unmerged branches are never touched, so an old parked branch (`dev/andrew`) survives every run.
