<!-- @description Land a worktree branch: conflict-checked merge into main, safe worktree removal, branch delete, push. -->
<!-- @version 1 -->
<!-- @param branch | string | required | The branch to land. -->
<!-- @param --base | string | optional | Branch to land into (default main). The main checkout must be on it. -->
<!-- @param --no-push | flag | optional | Merge and clean up, but don't push. -->
<!-- @param --keep-worktree | flag | optional | Leave the worktree (and so the branch it holds) in place. -->
<!-- @param --dry-run | flag | optional | Run the checks and say what would happen. Changes nothing. -->
<!-- @param --json | flag | optional | Print {branch, base, steps:[{step, ok, detail}]} instead of lines. -->
<!-- @response report | One line per step (preflight, conflicts, overlap, merge, worktree, branch, push) with ✓/✗ and what it did. -->
<!-- @example /land plan/worktree-hardening | Snapshot, dry run, then land after you approve -->
<!-- @example /land fix-x --no-push | Land locally, push later -->

# /land

Lands one worktree branch into the main checkout the safe way. Most worktree incidents happen at
landing and cleanup, not at creation — a merge over another session's uncommitted edits, a
`--force` removal that follows a `node_modules` junction, a branch deleted before it merged. The
script `.claude/scripts/land.js` makes each of those a checked step that stops instead.

## Steps

1. **Leave the worktree.** If this session is in one, call `ExitWorktree` with `keep` first.
   `land.js` refuses to run from inside a worktree (exit 4), and git commands aimed at the main
   checkout are refused from there anyway.
2. **Check for a live session in it.** Run `node .claude/scripts/fleet.js`. If a live session's
   working directory is the branch's worktree, add `--keep-worktree` — never remove a worktree
   someone is working in.
3. **Snapshot**, fresh every time (another session may have worked since the last one):
   `node scripts/snapshot-worktrees.js C:\CODE\claude-code-autoconfig C:\CODE\job-agent-extension`.
   Note the backup folder it prints.
4. **Dry run:** `node .claude/scripts/land.js <branch> --dry-run` (plus any flags the user gave).
   Show the user the result — commits to land, fast-forward or merge commit, the worktree that
   would be removed, the branch that would be deleted, whether it pushes — and **wait for a yes**.
   If the dry run fails, stop here (see below).
5. **Land:** run `node .claude/scripts/land.js <branch>` with the same flags, **in the background**
   with a timeout of at least 10 minutes: in this repo the pre-push hook runs the full test suite
   (about 4 minutes).
6. **Report** each step's line, and the snapshot folder.

## When it stops

| exit | meaning | what to do |
|---|---|---|
| 1 | usage, preflight (no branch, main not on base), or unexpected error | fix the named problem |
| 2 | the branch would conflict | stop; show the files. The branch's owner resolves it (e.g. `git merge main` in the worktree) |
| 3 | uncommitted files in main overlap the branch | stop; show the files. That is another session's work in progress |
| 4 | run from inside a worktree | `ExitWorktree keep`, then run again |
| 5 | the merge **landed**, but removing the worktree or deleting the branch failed | say the merge landed; point the user to `/sync-worktrees` |
| 6 | the merge **landed** locally, but the push failed | say so; the push can be retried by hand |

⛔ On 2 or 3, never resolve by stashing, checking out, or resetting in the main checkout — those
files belong to someone else's session.

A worktree with uncommitted changes is never removed: `land.js` merges, leaves it (and the branch
it holds) in place, and says so. That is exit 0, not a failure.
