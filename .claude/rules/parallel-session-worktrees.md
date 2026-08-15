# Parallel sessions work in git worktrees

**Dev-only — this rule is never installed into a user project** (`parallel-session-worktrees.md`
is in `DEV_ONLY_FILES` in `bin/cli.js` and negated in package.json `files`). It describes how
sessions share THIS maintainer repo; a CCA user's project has none of the machinery below.

Several Claude sessions run against this repo at once. Sharing one working tree makes them
collide: a file another session rewrote fails your Edit with "file has been modified since
read", and every session's `npm test` runs against a tree someone else is mid-edit in.

**If another Claude session may be open on this repo, call `EnterWorktree` before your first
write to a repo file** — the first Edit, Write, or file-mutating Bash command, whichever comes
first. This is the project instruction that authorizes the tool — you do not need to ask.

Not "as your first action." Read-only turns stay in the main checkout, so a session that never
writes — Q&A, log reading, a `docs/` read, a plan review — never bootstraps a worktree at all,
and leaves nothing behind to clean up.

Entering *late* is only safe because "before the first write" is still *early enough*: a worktree
does not carry uncommitted work along. The moment you edit a file in the main checkout, you are
stuck there for the rest of the session. So there is exactly one safe boundary — cross it before
the write, never after.

**One worktree per session, not per task.** A worktree exists to stop two *processes* from writing
the same files; within a session there is one writer and the turn loop serializes it, so a second
worktree for a second use case is isolation against nobody — at the cost of another
`npm install` and another Windows delete that may not finish. To land or drop one use case
independently of another, commit at the boundary, or `git switch -c` inside the worktree you
already have.

## The loop

1. `EnterWorktree` with a name describing the work (`token-guard-r16`, `box-widths`) — not a
   random one. It lands in `.claude/worktrees/<name>/`, already excluded via `.git/info/exclude`.
2. `node scripts/bootstrap-worktree.js` — **mandatory, see below.**
3. Work, test, commit inside the worktree. Commit normally; the branch is yours alone.
4. Merge back from the main checkout (`C:\CODE\claude-code-autoconfig`), never from inside the
   worktree — a worktree shares the repo's index and object store, so `git` run there against
   `main` fights whatever the other sessions are doing.
5. `ExitWorktree` with `remove` once merged, or `keep` to resume later.

## ⛔ Bootstrap is not optional

A worktree has every tracked file and **no gitignored one**. Here that costs you four things
that do not announce themselves:

- `.claude/settings.local.json` — **gitignored in this repo** (it is tracked in some others, so
  don't carry that assumption over). Without it the worktree session re-prompts on every Bash call.
- `node_modules/` — `npm test` runs `test/complexity-ratchet.test.js`, which loads **eslint**
  programmatically. No install, no eslint, and the full suite fails on a clean tree.
- `scripts/hook-fleet.local.json` — the per-machine fleet list. Absent, `sync-hook-fleet.js`
  has nothing to check.
- `.claude/cca.config.json` and `.claude/commands/deploy-to-npmjs.md`.

`scripts/bootstrap-worktree.js` copies those from the main checkout and runs `npm install`.
Run it before the first edit.

## ⛔ node_modules junction is opt-in, not automatic

Bootstrap CAN link `node_modules` to the main checkout's instead of installing — seconds
instead of minutes, when the main checkout has `node_modules` and the worktree's
`package-lock.json` is byte-identical to it — but only when `CCA_UNSAFE_NODE_MODULES_JUNCTION=1`
is set in the environment. **Default is `npm install`, unconditionally.**

Why it defaults off: confirmed 2026-08-15 that `git worktree remove --force` — the exact
path `ExitWorktree remove` and every manual cleanup uses — recurses through a Windows
junction and deletes the **target's real contents**, not just the link. It happened for
real: a Verify run against this repo's own main checkout emptied its actual `node_modules`,
and it reproduced again against this very worktree mid-session before the flag existed.
`.claude/scripts/sync-worktrees.js`'s own `--write` reap loop now unlinks a junction before
deleting (see its header comment), but that guards only its own trash sweep — it does
nothing for native `git worktree remove` or `ExitWorktree`, which is what ordinary cleanup
(step 5 above) actually calls. Full writeups: `ARTICLES/junction-verify-emptied-main-node-modules.html`,
`ARTICLES/confirmed-worktree-remove-recurses-through-junction.html`. Open work to make this
safe by default is tracked in `docs/agy-worktree-adoption-plan.md`'s Ledger under substep 1.1.

**If you ever find a worktree's `node_modules` IS a junction** (check with
`node -e "console.log(require('fs').lstatSync('node_modules').isSymbolicLink())"`), unlink it
before that worktree is ever removed: `node -e "require('fs').rmdirSync('node_modules')"` on
Windows (removes only the reparse point — never `rm -rf` or a recursive delete on it), then
`npm install` for a real, independent one. **Never run `npm install`/`npm update` inside a
worktree whose `node_modules` IS a junction** — npm writes through the link into the main
checkout's real `node_modules`; bootstrap refuses the install path itself when it detects one,
but this only matters if you run npm by hand.

## ⛔ baseRef is `head` here, and the setting is gitignored

`worktree.baseRef` defaults to `fresh` — branch from `origin/<default-branch>`. That default is
wrong for this repo: work lands on local `main` and is pushed in batches, so `origin/main` runs
behind (8 commits on 2026-07-26). A `fresh` worktree would silently branch off a stale base and
conflict on the way back.

So `.claude/settings.local.json` sets `"worktree": { "baseRef": "head" }` — branch from the
current local HEAD. **That file is gitignored**: on a fresh clone, or in any repo copy that
never got one, the default quietly returns. If a worktree comes up missing recent commits,
check that key first.

Consequence of `head`: the worktree branches from **whatever branch you are on**, not `main`.
Check out the intended base before calling `EnterWorktree`. Uncommitted work in the main
checkout still does not come along — commit or stash it first if the task builds on it.

## What worktrees do NOT isolate — still serialize these

Worktrees give each session its own files. They do not give it its own `~/.claude`, its own
npm registry, or its own git remote:

- **`~/.claude` and the hook fleet.** `node scripts/sync-hook-fleet.js --write` copies THIS
  tree's `.claude/hooks/*` and `.claude/rules/plan-authoring.md` out to `~/.claude` and every
  repo in the fleet list. Run from a worktree, it publishes that worktree's possibly-older
  copies over newer work everywhere — `token-guard.js` alone moved 795 lines in the unpushed
  batch. **Main checkout only, after merging.** Check mode (no `--write`) is safe to run anywhere.
- **The live twin.** `test/live-twin-parity.test.js` compares whatever tree you are in against
  the single `~/.claude/hooks/terminal-title.js`. Edit `terminal-title.js` in a worktree and
  that test fails in the main checkout too, until the merge lands and the fleet sync runs.
- **The dev-box pre-push guard.** `.git/hooks/` lives in the common git dir, so the guard is
  shared by every worktree and runs `npm test` + the fleet check against the tree you push
  from. A stale worktree gets blocked — that is the guard working, not a bug.
- **Publishing.** `npm version`, `npm publish`, `/deploy-to-npmjs`, and the README/docs sync
  that precedes them run from the main checkout only, with no other session mid-flight. The
  `postversion` changelog hook rebuilds `CHANGELOG.md` from git history and re-tags.
- **`.claude/updates/` numbers.** They are append-only and globally sequential. Two worktrees
  each adding "the next one" both pick the same number, and the collision only surfaces at
  merge. Claim the number in the main checkout first.

## When a conflict happens anyway

Two sessions merging to `main` will still conflict at merge time if they edited the same region —
worktrees move the conflict from mid-turn (where it aborts the work) to merge time (where it is
a normal rebase). That is the whole win. Resolve it in the main checkout like any other merge;
don't reach into another session's worktree.
