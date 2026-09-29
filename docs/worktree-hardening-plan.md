# Worktree hardening — plan

**Goal.** Most worktree incidents happen when a branch is **landed** or **cleaned up**, not when a
worktree is created. This plan adds one landing command, makes cleanup actually run, repairs
file claims across worktrees, and adopts the Claude Code features that now cover pieces we
built ourselves.

**Evidence.** The incident list and outside research come from the 2026-09-28 report,
`ARTICLES/worktree-workflow-improvements.html`. That path is gitignored, so it only exists on the
dev box. The facts a substep needs are copied into it.

- JAE has 19 merged worktrees still registered. Its reclaim hook's log shows 1 success and 4
  `Directory not empty` failures.
- Landing from inside a plan's own worktree is refused by Claude Code's isolation guard
  (workflow-rules Ledger, 2026-09-28).
- Claims are keyed by absolute path, so the same file in two worktrees never matches.
- Nothing shows how far a branch is behind `main`. JAE has branches 190–263 commits behind.

## How to execute

- **One substep per fresh session.** For each substep: do the work, run its Verify, commit, and
  append its Ledger entry. Then `/clear` and `/continue`, which reads the Ledger and names the
  next substep.
- **Read this doc in slices, never whole:** the ⛔ trap section (lines 71–106), your own substep,
  and the Ledger tail.
- **Branch:** `plan/worktree-hardening`, in the worktree `.claude/worktrees/worktree-hardening`.
  Re-enter it with `EnterWorktree path=.claude/worktrees/worktree-hardening`. The base branch is
  `main`.
  - **Refresh at every substep boundary:** run `git merge main` on the plan branch before
    starting work.
  - The branch is merged once, in 7.1.
  - Abandoning the plan is one `git branch -D plan/worktree-hardening`.
  - `git log main..plan/worktree-hardening` is the whole reviewable delta.
- **Multi-repo:** every substep commits to CCA, except 7.1 and 7.2. Those also touch JAE
  (`C:\CODE\job-agent-extension`), on a JAE branch of the same name that is created in 7.1.
- **Target environment:** this Windows 11 dev box, verified 2026-09-28: git 2.49.0 (`merge-tree
  --write-tree` needs ≥ 2.38), Claude Code 2.1.280 (junction-safe `ExitWorktree` needs
  ≥ 2.1.205), Node ≥ 18. Nothing in this plan ships to users.
- **Model floor:** Sonnet-class. 4.1 and 6.2 carry `[opus]` because each opens with an
  investigation whose outcome decides the rest of the substep.

### Decisions (no substep reopens these)

- **`/land` runs only from the main checkout.** It refuses to run from a linked worktree and tells
  the session to `ExitWorktree keep` first. Having a script spawn git at the main checkout from
  inside a worktree would get around Claude Code's isolation guard, so we don't.
- **`/land` pushes the base branch by default** (`--no-push` skips it). Local `main` running ahead
  of GitHub causes the drift and is the only reason `baseRef: head` exists.
- **Checking for conflicts before a merge = `git merge-tree --write-tree --name-only`.** It runs in
  memory and needs no working tree.
- **When the main checkout has uncommitted files, use JAE's rule:** compare those files with the
  files the merge changes. If none overlap, merge. If any do, report them and stop. Never stash,
  check out, or restore another session's files.
- **Back up, then dry-run, then ask — before anything is removed.** Every substep and command that
  removes a worktree or deletes a branch first runs `node scripts/snapshot-worktrees.js C:\CODE\claude-code-autoconfig C:\CODE\job-agent-extension` (from outside any worktree), then shows
  the dry-run list of what it would remove, and removes nothing until the user approves that list.
  Code bugs can be fixed forward; a removed worktree's uncommitted files cannot.
- **Worktree removal never uses `--force`.** Unlink a `node_modules` junction first. On Windows,
  if the folder won't delete, move it to `.claude/worktrees/.trash/` (the logic
  `sync-worktrees.js` already has) and run `git worktree prune`.
- **All new files are dev-only.** Add them to `DEV_ONLY_FILES` and to the package.json `files`
  negations. Nothing is added to the tracked `.claude/settings.json`, because it reaches users
  (see ⛔).
- **The gate hook's wiring and `worktree.baseRef` stay in the gitignored `settings.local.json`.**
  A test guards them instead (1.1).
- **`token-guard.js` is not touched.** Cost-control work lives in the private `cca-cost-control`
  repo.
- **Claim record changes are additive only.** New fields are added and `path` stays, because
  `token-guard.js` reads the same files.

## ⛔ Standing trap warnings — read before ANY substep

- **`.claude/settings.json` ships to users.** A fresh install copies it verbatim and an upgrade
  merges it in (`bin/cli.js:708-754`). A dev-only hook wired there becomes a broken hook in every
  user project. Dev wiring goes in `settings.local.json` only, which is never shipped
  (`cli.js:756-757`).
- **`DEV_ONLY_FILES` matches by basename** (`bin/cli.js:529-533`), so choose distinctive names.
  `test/dev-gate-consistency.test.js` also requires an **exact-path** negation in package.json
  `files` for every dev-only file. A directory negation alone fails it (workflow-rules Ledger
  1.1).
- **New test files are not picked up automatically.** `package.json:38` is a hard-coded `&&`
  chain, so add every new `test/*.test.js` to it. Hook suites (`.claude/hooks/tests/*.test.cjs`)
  are discovered on their own.
- **Large files:**
  - `.claude/hooks/token-guard.js` (5,406 lines, 328 KB): **never open it whole, never edit it.**
  - `bin/cli.js` (1,030 lines): Grep, then Read a window around the hit.
- **Never run `git worktree remove --force` and never recursively delete a worktree** without
  first checking `node_modules` for a junction:
  `node -e "console.log(require('fs').lstatSync('node_modules').isSymbolicLink())"`. A junction
  once emptied the main checkout's `node_modules` (2026-08-15).
- **⛔ No removal without a fresh snapshot and an approved dry run.** Before removing any worktree
  or deleting any branch (by hand, `land.js`, `sync-worktrees --write`), run `node scripts/snapshot-worktrees.js C:\CODE\claude-code-autoconfig C:\CODE\job-agent-extension` and note
  the backup folder in the Ledger. Then show the user the dry-run list and wait for a yes. A
  snapshot from an earlier session doesn't count — other sessions keep working in between.
- **Never use bare `git stash`.** The stash stack is shared by every worktree and session.
- **JAE usually has live sessions.** Run `node .claude/scripts/fleet.js --project-dir
  C:\CODE\job-agent-extension` before touching any JAE worktree. Never remove a worktree that is a
  live session's working directory.
- **Commands aimed at the main checkout need the session outside the worktree.** The isolation
  guard refuses git commands aimed at the main checkout from inside a worktree. Run
  `ExitWorktree keep` first. Run `sync-hook-fleet.js --write` from the main checkout only, and
  only after the merge.
- **Every commit carries `Changelog: none`.** All of this work is dev-only, and a bullet would
  announce something users can't get.
- `npm test` must pass before every commit. It takes about 4 minutes, so run it with a long
  timeout.

## Phase 1 — Stop the repo lying

### ☑ 1.0 · M · ~30m — Back up every worktree before anything removes one

**Budget:** files 3 · new 1 (+1 test) · trips ≈ 12

**Read:** this doc (⛔ + 1.0) · `package.json:38` · `test/_harness.js:1-20`

- [ ] Create `scripts/snapshot-worktrees.js` (`scripts/` never ships). Per repo it writes, to
  `C:\CODE\_worktree-backups\<YYYY-MM-DD_HHMMSS>\<repo>\`: `all.bundle` (`git bundle create
  --all`), and per worktree a `files/` copy of every staged, modified or untracked non-ignored
  file plus a `manifest.json` (branch, HEAD, raw status). Read-only on the repos: status runs
  with `--no-optional-locks`.
- [ ] Create `test/snapshot-worktrees.test.js` (throwaway repo + worktree: bundle has every
  branch, uncommitted files copied byte-for-byte, ignored/deleted not copied, status unchanged)
  and add it to the `package.json:38` chain before the hook-tests entry.
- [ ] Add the "Back up, then dry-run, then ask" Decision and ⛔ trap, and the snapshot step to
  3.1, 4.1, 4.2, 7.1 and 7.2.
- [ ] `ExitWorktree keep`, run `node scripts/snapshot-worktrees.js C:\CODE\claude-code-autoconfig C:\CODE\job-agent-extension` from the CCA main checkout (by the worktree's path to the
  script), re-enter the worktree, and record the backup folder and sizes in the Ledger.

**Verify:** `node test/snapshot-worktrees.test.js` · `npm test` exit 0 · the real run lists every
worktree of both repos, and `git bundle verify` passes on both bundles

**Commit:** `feat(worktrees): snapshot every worktree before removals` + `Changelog: none`

### ☑ 1.1 · S · ~20m — Guard the dev-box worktree wiring with a test

**Budget:** files 3 · new 0 (+1 test) · trips ≈ 8

**Read:** this doc (⛔ + 1.1) · `.claude/settings.local.json:185-204,217-219` · `package.json:38`

- [ ] Create `test/dev-wiring.test.js`. If `.claude/settings.local.json` is missing (CI, or a
  fresh clone), print `skip: no settings.local.json` and exit 0. Otherwise assert three things:
  (a) a `PreToolUse` entry runs a command containing `worktree-gate.js`; (b) that entry's
  matcher, split on `|`, contains `Write`, `Edit`, `MultiEdit` and `NotebookEdit`; (c)
  `worktree.baseRef === "head"`. Each failure message names the file and the missing piece.
- [ ] Add `node test/dev-wiring.test.js` to the `package.json:38` chain, just before the
  hook-tests entry.
- [ ] Local-only fix (the file is gitignored and is not committed): change the matcher at
  `settings.local.json:196` to `"Write|Edit|MultiEdit|NotebookEdit"`, then copy the updated file
  to the main checkout so later worktrees get it from bootstrap.

**Verify:** `node test/dev-wiring.test.js` passes · temporarily rename `settings.local.json` and
confirm it prints the skip, then rename it back · `npm test` exit 0

**Commit:** `test(dev): guard the worktree gate's wiring on the dev box` + `Changelog: none`

## Phase 2 — Pure modules (extract before building the command)

### ☑ 2.1 · M · ~40m — Extract worktree-safety.js out of sync-worktrees.js

**Budget:** files 4 · new 1 (+1 test) · trips ≈ 13

**Read:** this doc (⛔ + 2.1) · `.claude/scripts/sync-worktrees.js:316-382` (junction unlink, trash, retries) · `test/sync-worktrees.test.js` (first 60 lines, for its throwaway-repo helpers)

- [x] Create `.claude/scripts/worktree-safety.js` and export:
  - `unlinkNodeModulesLink(dir)`, moved from `sync-worktrees.js:316-327`.
  - `trashOrphan(dir, trashRoot)`, moved from `:338-351`.
  - `removeDir(dir, trashRoot)`: the rmSync with `maxRetries: 8` plus the trash fallback, from
    `:353-367`.
  - `safeRemoveWorktree(mainDir, wtPath, trashRoot)`: unlink the junction, then
    `git -C mainDir worktree remove <wtPath>` (never `--force`). If that fails and the folder
    still exists, call `removeDir` and then `git worktree prune`. Return
    `{ok, how: 'git'|'trash'|'failed', error}`.
- [x] Change `sync-worktrees.js` to `require('./worktree-safety')` and delete the moved bodies.
  Its behavior must not change.
- [x] Create `test/worktree-safety.test.js` using throwaway repos from `os.tmpdir()`. Cover: a
  clean worktree is removed by git; a worktree whose `node_modules` is a junction to a sibling
  folder loses only the link, and the target keeps its files; a dirty worktree returns
  `ok:false` and stays in place. Add it to the `package.json:38` chain.
- [x] Add `worktree-safety.js` to `DEV_ONLY_FILES` (`bin/cli.js:529-530`) and add its exact path
  to the package.json `files` negations.

**Verify:** `node test/worktree-safety.test.js` · `node test/sync-worktrees.test.js` (unchanged
and passing) · `npm test` exit 0

**Commit:** `refactor(worktrees): extract junction-safe removal into worktree-safety.js` + `Changelog: none`

### ☑ 2.2 · M · ~45m — land-core.js: conflict check, dirty overlap, worktree lookup

**Budget:** files 3 · new 1 (+1 test) · trips ≈ 14

**Read:** this doc (⛔ + 2.2) · `.claude/scripts/sync-worktrees.js:80-121` (its git helpers and worktree listing) · `C:\CODE\job-agent-extension\.claude\rules\parallel-session-worktrees.md:187-208` (the dirty-tree procedure this implements)

- [x] Create `.claude/scripts/land-core.js`. Every function takes an explicit `mainDir` and runs
  git with `-C mainDir`. Export:
  - `mainCheckoutOf(dir)`: return
    `path.dirname(git rev-parse --path-format=absolute --git-common-dir)`.
  - `isLinkedWorktree(dir)`: true when `git rev-parse --git-dir` ≠ `--git-common-dir`.
  - `conflictCheck(mainDir, base, branch)`: run
    `git merge-tree --write-tree --name-only <base> <branch>`. Exit 0 means `{clean:true}`.
    Exit 1 means `{clean:false, files:[…]}`, where the files are the lines after the tree id up
    to the blank line.
  - `dirtyOverlap(mainDir, base, branch)`: take the paths from `git status --porcelain` and
    intersect them with `git diff --name-only <base>...<branch>`. Return the sorted overlap.
  - `worktreeFor(mainDir, branch)`: parse `git worktree list --porcelain` and return the path
    whose `branch refs/heads/<branch>` matches, or null.
- [x] Create `test/land-core.test.js` (throwaway repos, like 2.1). Cover: a clean merge; a real
  conflict on one file, which is reported by name; dirty main with no overlap (empty) and with
  overlap (the file is named); `worktreeFor` found and not found; `isLinkedWorktree` from both
  sides. Add it to `package.json:38`.
- [x] Add `land-core.js` to `DEV_ONLY_FILES` and its exact path to the `files` negations.

**Verify:** `node test/land-core.test.js` · `npm test` exit 0

**Commit:** `feat(worktrees): land-core — conflict check and dirty-overlap without touching a tree` + `Changelog: none`

## Phase 3 — The landing command

### ☑ 3.1 · L · ~1.5h — land.js CLI and the /land command

**Budget:** files 6 · new 2 (test extended, not new) · trips ≈ 22

**Read:** this doc (⛔ + 3.1) · `.claude/commands/sync-worktrees.md:1-20` (command header format) · `scripts/sync-hook-fleet.js:53-141` (manifest) · `bin/cli.js:522-533`

- [ ] Create `.claude/scripts/land.js`. Usage: `node .claude/scripts/land.js <branch> [--base
  main] [--no-push] [--keep-worktree] [--dry-run] [--json]`. It runs these steps in order and
  stops at the first failure:
  1. **Preflight:** if `isLinkedWorktree(cwd)`, exit 4 with the message *"Run /land from the main
     checkout — call ExitWorktree keep first."* The branch must exist. The main checkout must be
     on `--base`.
  2. **Conflicts:** run `conflictCheck`. If it isn't clean, list the files and exit 2.
  3. **Uncommitted files in main:** if `dirtyOverlap` is not empty, list the files, say *"another
     session's uncommitted work overlaps this merge — not touching it"*, and exit 3.
  4. **Merge:** `git merge --ff-only <branch>`, falling back to `git merge --no-edit <branch>`.
  5. **Remove the worktree**, unless `--keep-worktree`: take the path from `worktreeFor`. If
     `git -C <wt> status --porcelain` is not empty, skip the removal and warn. Otherwise call
     `safeRemoveWorktree`. A failure here exits 5 **after** the merge, and the message says the
     merge landed.
  6. **Delete the branch:** `git branch -d <branch>`.
  7. **Push**, unless `--no-push`: `git push origin <base>`, with stdio inherited. In CCA the
     pre-push hook runs the full suite (about 4 minutes).

  `--dry-run` runs steps 1–3 and prints what would happen. `--json` prints
  `{branch, base, steps:[{step, ok, detail}]}`.
- [ ] Create `.claude/commands/land.md` with `@description`, `@version 1`, `@param`
  lines for each flag, and `@example`. Its body tells the agent:
  - If the session is in a worktree, call `ExitWorktree keep` first.
  - Run `node scripts/snapshot-worktrees.js C:\CODE\claude-code-autoconfig C:\CODE\job-agent-extension`, then `land.js <branch> --dry-run`. Show the user what would be merged and
    removed, and run the real `land.js` only after they approve.
  - Run `land.js` **in the background** with a timeout of at least 10 minutes, because of the push.
  - Report each step's result.
  - Exit 2 or 3: stop and show the files. Never resolve by stashing or checking out.
  - Exit 5: the merge landed; point the user to `/sync-worktrees`.
- [ ] Add `land.js` and `land.md` to `DEV_ONLY_FILES`, with exact-path `files` negations. Add
  manifest entries: `{file:'land.js', global:false, subdir:'scripts'}`,
  `{file:'land-core.js', …scripts}`, `{file:'worktree-safety.js', …scripts}`,
  `{file:'land.md', global:false, subdir:'commands'}`.
- [ ] Extend `test/land-core.test.js` with end-to-end runs of `land.js --no-push` on a throwaway
  repo plus worktree:
  - The happy path: merged, worktree gone, branch deleted, exit 0.
  - A conflict exits 2 and leaves main unchanged.
  - A dirty overlap exits 3.
  - Running from inside the worktree exits 4.
  - `--dry-run` changes nothing.
- [ ] Update `test/hook-fleet-sync.test.js` wherever it counts or lists manifest entries.

**Verify:** `node test/land-core.test.js` · `node test/hook-fleet-sync.test.js` ·
`node test/dev-gate-consistency.test.js` · `npm test` exit 0

**Commit:** `feat(worktrees): /land — conflict-checked merge, safe removal, push` + `Changelog: none`

### ☑ 3.2 · M · ~30m — Point the rule, the skill and /fleet at /land

**Budget:** files 3 · new 0 · trips ≈ 9

**Read:** this doc (⛔ + 3.2) · `.claude/rules/parallel-session-worktrees.md:18-28` · `.claude/skills/plan-authoring/SKILL.md:37-77` · `.claude/commands/fleet.md` (whole file, 60 lines)

- [ ] Rule, "The loop", steps 4–5: replace the prose merge and removal with *"`ExitWorktree keep`,
  then `/land <branch>` from the main checkout. It checks for conflicts, won't touch another
  session's uncommitted files, merges, removes the worktree, deletes the branch and pushes. Stop
  and ask only when it exits 2 or 3."* Keep the file ≤ 70 lines.
- [ ] Skill, Branch discipline: add one sentence saying a plan's final substep lands with `/land`
  from the main checkout, because the isolation guard refuses landing from inside the plan's own
  worktree. The skill is repo-agnostic, so phrase it as "the repo's landing command, where one
  exists (CCA: `/land`)".
- [ ] `fleet.md`: where it says the board has no LAND action, point to `/land`. Bump `@version`.

**Verify:** `wc -l .claude/rules/parallel-session-worktrees.md` ≤ 70 · `grep -n '/land'` hits in
all three files · `npm test` exit 0

**Commit:** `docs(worktrees): land with /land` + `Changelog: none`

## Phase 4 — Cleanup that actually runs

### ☑ 4.1 · M · ~45m — Find why JAE's reclaim hook fails with "Directory not empty" [opus]

**Budget:** files 2 (read) · new 0 · trips ≈ 12

**Read:** this doc (⛔ + 4.1) · `C:\CODE\job-agent-extension\.claude\hooks\reclaim-merged-worktrees.js:152-216` (guards, `reclaim()`, log) · `C:\CODE\job-agent-extension\.claude\hooks\.worktree-reclaim.log`

This substep gathers evidence first (per CLAUDE.md, Debugging Methodology). Don't write a fix
until the cause is shown.

- [x] Read the log's 4 failure lines. For each worktree it names, check whether the folder still
  exists and what is in it: `ls -la`, and the `node_modules` junction check.
- [x] Pick one merged, clean JAE worktree that is **not** a live session's working directory
  (check fleet first). Run `node .claude/hooks/reclaim-merged-worktrees.js --dry-run`, then
  run `node scripts/snapshot-worktrees.js C:\CODE\claude-code-autoconfig C:\CODE\job-agent-extension`, get the user's yes on the one worktree you'll remove, and reproduce the removal by hand with `git worktree remove <path>`, and record the exact error.
  If the folder is left behind, list its contents and check which process holds it open
  (`handle.exe` if installed; otherwise note that it's unknown).
- [x] Write the cause in the Ledger with evidence. Typical suspects are gitignored files left in
  the folder, a locked file, or a junction. State which fallback fixes it:
  `worktree-safety.safeRemoveWorktree`'s trash fallback, or something else.
- [x] If the fix is a call to `safeRemoveWorktree`, or a small (≤ 10-line) change to
  `reclaim()`, make it in JAE on branch `plan/worktree-hardening` (create it) and commit. Don't
  merge; 7.1 merges it. If the fix is bigger, record it for 4.2.

**Verify:** the Ledger entry shows the observed error and folder contents · if JAE was edited,
`node .claude/hooks/reclaim-merged-worktrees.js --dry-run` runs clean on the JAE branch

**Commit:** JAE only, and only if edited: `fix(worktrees): reclaim falls back to trash when Windows won't delete` + `Changelog: none`

### ☑ 4.2 · M · ~50m — sync-worktrees reaps merged worktrees that are still registered

**Budget:** files 3 · new 0 · trips ≈ 15

**Read:** this doc (⛔ + 4.2) · the 4.1 Ledger entry · `.claude/scripts/sync-worktrees.js:98-140,229-309,383-404` · `C:\CODE\job-agent-extension\.claude\hooks\reclaim-merged-worktrees.js:152-201` (its guard list is the spec)

- [x] Add a RECLAIM class to `sync-worktrees.js`: a registered worktree (today it is always
  skipped at `:233`) qualifies only when **all** of these hold:
  - its branch is merged into base (`git merge-base --is-ancestor`);
  - `git status --porcelain` is empty, apart from a modified `settings.local.json`, which is
    ignored;
  - it isn't locked (no `locked` line in the porcelain list);
  - its newest transcript is more than 30 minutes old (reuse `newestTranscriptMs` at `:126`);
  - it isn't the cwd of the process running the script.
- [x] Under `--write`, remove each RECLAIM worktree with `worktree-safety.safeRemoveWorktree`,
  then run `branch -d` as today. The dry run lists the candidates, each with the guard that
  passed or failed.
- [x] Unlanded report (`:296-309`, printed at `:460-467`): print `N behind` next to ahead. The
  `rev-list --left-right --count` output is already computed at `:300`.
- [x] `sync-worktrees.md`: before any `--write`, run `node scripts/snapshot-worktrees.js C:\CODE\claude-code-autoconfig C:\CODE\job-agent-extension` and the dry run, show the user the
  RECLAIM list, and run `--write` only after they approve it.
- [x] Add `sync-worktrees.js` and `sync-worktrees.md` to the fleet manifest (`subdir:'scripts'`
  / `'commands'`). JAE's copy is a 365-line hand copy that has diverged; 7.1 replaces it.
- [x] Extend `test/sync-worktrees.test.js`: a merged, clean, idle worktree is reclaimed; a dirty
  one, a locked one and an unmerged one are each kept, and the kept one names its guard.

**Verify:** `node test/sync-worktrees.test.js` · `node test/hook-fleet-sync.test.js` ·
`node .claude/scripts/sync-worktrees.js` (dry run) on CCA lists the two merged registered
worktrees (`worktree-agent-matcher`, `worktree-quiet-verdict-cards`) · `npm test` exit 0

**Commit:** `feat(worktrees): reclaim merged registered worktrees; show behind counts` + `Changelog: none`

### ☐ 4.3 · M · ~35m — /fleet flags stale branches and worktree pile-up

**Budget:** files 2 · new 0 · trips ≈ 10

**Read:** this doc (⛔ + 4.3) · `.claude/scripts/fleet.js:169-214,288-297,403-429` · `test/fleet.test.js` (the fixture setup)

- [ ] In `enrich` (`:187-214`), add `behind` (`git rev-list --count HEAD..<base>`) beside the
  existing unlanded count. Include it in `--json` (`:288-297`).
- [ ] UNLANDED rows (`:403-429`): print `N behind`, and add a `STALE` marker when behind > 50.
- [ ] After the board: when registered worktrees > 12, print one line: *"N worktrees registered
  — run /sync-worktrees"*.
- [ ] Extend `test/fleet.test.js`: a branch 60 commits behind shows `STALE`, and 13 worktrees
  show the pile-up line.

**Verify:** `node test/fleet.test.js` · `node .claude/scripts/fleet.js --project-dir C:\CODE\job-agent-extension`
shows `STALE` on `plan/autonomous-scan` (263 behind) · `npm test` exit 0

**Commit:** `feat(fleet): show behind counts, flag stale branches and worktree pile-up` + `Changelog: none`

## Phase 5 — Claims that match across worktrees

### ☐ 5.1 · M · ~50m — Key claims by repo and relative path

**Budget:** files 3 · new 0 · trips ≈ 14

**Read:** this doc (⛔ + 5.1) · `.claude/hooks/claim-registry.js` (whole file, 165 lines) · `.claude/scripts/fleet.js:339-364` · `.claude/hooks/tests/claim-registry.test.cjs`

- [ ] Add `repoKeyOf(absPath)`, using fs only, no git spawn. Walk up to the first `.git`:
  - If `.git` is a directory, the repo is its parent.
  - If `.git` is a file, read `gitdir: X`, then read `X/commondir`, resolve it against X, and
    take the parent of the result.

  Return `{repo, rel}` with forward slashes and a lower-cased drive letter, or null when there is
  no repo.
- [ ] `writeClaim` (`:23-47`): also write `repo` and `rel` (additive). `path` stays.
- [ ] Matching (`claimsOfFile`, `:118-127`): when both claims have `repo` and `rel`, match on those
  two. Otherwise fall back to `normPath`.
- [ ] Staleness (`isStaleSid`, `:81-84`): a sid with **no glyph** is now stale once its claim
  file's mtime is more than 30 minutes old. Today a sid with no glyph never goes stale.
- [ ] Tests in `claim-registry.test.cjs`:
  - the same `rel` in a main checkout and in a linked worktree matches;
  - different repos don't match;
  - an old claim record with no `repo` field still matches by path;
  - a claim with no glyph and a 31-minute-old file is stale.
- [ ] `fleet.js:344-364` uses `claimantsOf`. Confirm it picks up the fix with no edit, and
  record that in the Ledger.

**Verify:** `node .claude/hooks/tests/claim-registry.test.cjs` · `node test/fleet.test.js` · `npm test` exit 0

**Commit:** `fix(claims): match the same file across worktrees; expire glyphless claims` + `Changelog: none`

## Phase 6 — Let Claude Code do what it now does

### ☐ 6.1 · M · ~40m — .worktreeinclude for the files bootstrap copies

**Budget:** files 3 · new 1 · trips ≈ 12

**Read:** this doc (⛔ + 6.1) · `scripts/bootstrap-worktree.js:27-38,79-152`

- [ ] Create a tracked `.worktreeinclude` listing bootstrap's `COPY_FILES` (`:27-33`) and
  `COPY_MATCHING` (`:36-38`) in gitignore syntax.
- [ ] Test it empirically on 2.1.280. Merge this branch into a scratch branch, run
  `EnterWorktree name=wti-probe` from the main checkout, and check whether
  `.claude/settings.local.json` and `scripts/hook-fleet.local.json` arrived. Then `ExitWorktree
  remove`. Record the result in the Ledger.
- [ ] **If the files arrived:** bootstrap skips any file that already exists and says so. Its job
  shrinks to `installDeps` plus a fallback copy. The rule's bootstrap section says
  `.worktreeinclude` copies the files and bootstrap installs dependencies.
  **If they did not arrive:** keep `.worktreeinclude`, since `claude -w` and subagent worktrees
  honor it per the docs, and leave bootstrap unchanged.
- [ ] Confirm `.worktreeinclude` is not in package.json `files`. It must not ship.

**Verify:** the probe result is in the Ledger · `node scripts/bootstrap-worktree.js` in the
worktree prints the skip lines when the files are already present · `npm test` exit 0

**Commit:** `chore(worktrees): .worktreeinclude for dev-box files` + `Changelog: none`

### ☐ 6.2 · M · ~40m — /fleet reads `claude agents --json` when it is safe [opus]

**Budget:** files 2 · new 0 (+1 fixture) · trips ≈ 12

**Read:** this doc (⛔ + 6.2) · `.claude/scripts/fleet.js:108-153`

- [ ] Probe before building anything. Run `claude agents --help` and read what `--json` does.
  If listing starts the supervisor daemon, opens a UI, or takes more than 3 seconds, **stop**:
  record that in the Ledger, move this item to Deferred, and commit the Ledger entry only.
- [ ] If it's safe, save one real output to `test/fixtures/claude-agents.json` with sids and paths
  replaced by placeholders. In `readSessions`/`locate` (`:108-153`), prefer each agent's reported
  cwd when the command is available, with a 3-second timeout. Fall back to the transcript-folder
  mapping (`:148`) on any error.
- [ ] Extend `test/fleet.test.js` to use the fixture: a session whose cwd is outside its
  transcript folder's tree is placed correctly.

**Verify:** `node test/fleet.test.js` · `node .claude/scripts/fleet.js` output unchanged or
better on CCA · `npm test` exit 0

**Commit:** `feat(fleet): place sessions by claude agents cwd when available` + `Changelog: none` (or a Ledger-only commit if the probe stops)

## Phase 7 — Land and adopt

### ☐ 7.1 · M · ~50m — Merge once with /land, sync the fleet, adopt in JAE

**Budget:** files 4 · new 0 · trips ≈ 15

**Read:** this doc (⛔ + 7.1) · Ledger tail

- [ ] `ExitWorktree keep`, then run `node scripts/snapshot-worktrees.js C:\CODE\claude-code-autoconfig C:\CODE\job-agent-extension` and record the backup folder in the Ledger.
- [ ] Use the plan's own command to land it: `ExitWorktree keep`, then from the CCA main checkout
  run `node .claude/scripts/land.js plan/worktree-hardening --keep-worktree`. Keep the worktree
  until 7.2 is done. If it exits 2 or 3, stop and ask.
- [ ] Check fleet for live sessions in JAE. In JAE's main checkout, switch to
  `plan/worktree-hardening` (4.1 may have created it) and copy in the files that are new to it:
  `land.js`, `land-core.js`, `worktree-safety.js`, `land.md`. Sync is adopt-only and skips files
  a target doesn't already have.
- [ ] From the CCA main checkout, run `node scripts/sync-hook-fleet.js --write`. This overwrites
  the new JAE copies and JAE's diverged `sync-worktrees.js`/`.md` with the canonical versions.
- [ ] JAE rule: replace the body of the "merge is REFUSED because main's tree is dirty" section
  (`:187-208`) with a pointer to `/land`, which now does that check.
- [ ] In JAE, commit `chore: adopt /land and canonical sync-worktrees (synced from CCA)`, then
  land JAE's branch with JAE's new `land.js`.

**Verify:** `node scripts/sync-hook-fleet.js` (check mode) shows no drift · `npm test` passes in
CCA · `git branch --merged main | grep plan/worktree-hardening` is empty in both repos, because
`/land` deleted the branches

**Commit:** none of its own in CCA (the landing merges the plan). JAE gets the commit above.

### ☐ 7.2 · S · ~20m — Clear the worktree backlog in CCA and JAE

**Budget:** files 0 · new 0 · trips ≈ 8

**Read:** this doc (⛔ + 7.2) · Ledger tail

- [ ] Run `node scripts/snapshot-worktrees.js C:\CODE\claude-code-autoconfig C:\CODE\job-agent-extension` and record the backup folder in the Ledger.
- [ ] CCA: run `node .claude/scripts/sync-worktrees.js`, show the user the list, and run it with
  `--write` only after they approve.
  Expected results: 5 empty orphan folders reaped; the merged `worktree-agent-matcher` and
  `worktree-quiet-verdict-cards` reclaimed; and this plan's worktree reclaimed, since it is now
  merged. Use `git worktree prune` for the stray `pub226` registration from the
  `cca-cost-control` scratchpad if its path is gone. If the path exists, ask first.
- [ ] JAE: run fleet first, then `sync-worktrees.js --project-dir C:\CODE\job-agent-extension`
  (dry run), get the user's yes on the list, then `--write`. Expected: most of the 19 merged worktrees reclaimed, and any live
  session's worktree kept, with its guard named.
- [ ] Report JAE's unmerged branches with their behind counts (`worktree-anon-cap`,
  `plan/autonomous-scan`, `worktree-bounce-once`, `plan/synced-prefs`,
  `plan/token-saver-rename`). Land, refresh or abandon is the user's decision; don't act on
  them.

**Verify:** `git worktree list | wc -l` before and after in both repos is in the Ledger · no
worktree belonging to a live session was removed

**Commit:** Ledger only (`docs(plans): ledger 7.2 — plan complete` + `Changelog: none`)

## Deferred

- **Fixing the claim warning so it names the file being edited.** That code lives in
  `token-guard.js` (`:3303-3330`), which is cost-control work for the private
  `cca-cost-control` repo. After 5.1, the claims it reads will at least match across worktrees.
- **Sharing recovery state across worktrees** (`.titles`, `.token-guard`, handoff notes anchored at
  `git rev-parse --git-common-dir`). This touches terminal-title and token-guard, so it needs its
  own plan.
- **Writing ARTICLES pages and opening files from a worktree** (JAE retro, 2026-09-06). This is a
  helper script plus an allowlist, and a separate small task.
- **Bringing JAE's worktree rule under fleet sync.** After 7.1 its dirty-tree section is a pointer.
  The self-healing and Windows sections still need judgment to merge.
- **JAE's reclaim Stop hook versus `sync-worktrees` RECLAIM.** They overlap after 4.2. Decide
  whether to retire the hook once 7.2 shows how well RECLAIM works.
- **pnpm or Dev Drive block cloning for faster installs.** Only worth doing if install time becomes
  a real cost, and Dev Drive is unverified.
- **Ports per worktree, containers, GitButler virtual branches, Jujutsu workspaces.** Ports: no
  project here needs them. GitButler fails when sessions share files, which is our core case.
  Containers are heavy on Windows. Jujutsu would change the team's tooling.
- **Making `claude --bg` the default way to start parallel sessions.** That's a habit to try, not
  code. Revisit after 6.2.

## Ledger

- 2026-09-29 — **1.0** — done (`0b5ab5f`) [1 session · ~30 trips · peak ~110k · stays M]
  - **Added mid-plan at the user's request:** a backup before anything is removed, plus a
    "snapshot → dry run → user approves" rule now written into the Decisions, the ⛔ traps, and
    3.1, 4.1, 4.2, 7.1, 7.2. The trap section moved to lines 71–106.
  - Baseline snapshot: `C:\CODE\_worktree-backups\2026-09-29_003631` (73 MB). CCA: 6 worktrees
    (`pub226` is missing on disk; its commits are in the bundle). JAE: 25 worktrees, most with 1
    uncommitted file (probably local-settings drift; check in 4.1/4.2). JAE main has 26.
    `git bundle verify` passed on both bundles.
  - Old `_worktree-backups` folders are deleted by hand; there is no automatic retention.
  - Running the script needs the session out of the worktree (`ExitWorktree keep`, run it by the
    worktree's path to the script, then `EnterWorktree path=…`).
- 2026-09-29 — **1.1** — done (`91b04bf`) [same session as 1.0 · ~12 trips · peak ~120k · stays S]
  - The new test failed first on the real gap (`worktree-gate matcher is missing MultiEdit`),
    then passed after the local fix. Skip path checked by renaming the file.
  - The main checkout's `settings.local.json` got the same one-line matcher edit rather than a
    whole-file copy. Diffing showed that line was the only difference, and an in-place edit can't
    overwrite another session's local changes.
  - Next: 2.1. Refresh with `git merge main` first.
- 2026-09-29 — **2.1** — done (`015c8a3`) [1 session · ~14 trips · peak ~60k · stays M]
  - **Changed from the plan:** `safeRemoveWorktree` only deletes a leftover folder when git has
    already de-registered the worktree. The plan said "if remove fails and the folder exists,
    call removeDir", but that would delete a dirty worktree git had just refused. On a refusal
    it now returns `ok:false` and puts the node_modules junction back.
  - The exports also include `rmTree` (unlink + delete, no trash) for the `.trash/` sweep.
    `trashOrphan` now returns the new path; `sync-worktrees.js` keeps its verdicts and messages.
  - Next: 2.2. Refresh from main first.
- 2026-09-29 — **2.2** — done (`b96b86f`) [1 session · ~12 trips · peak ~45k · stays M]
  - `dirtyOverlap` reads `git status --porcelain -z --untracked-files=all`, so an untracked file
    the branch adds counts as overlap (the merge would refuse to overwrite it), and both sides of
    a rename are checked.
  - `conflictCheck` throws on any merge-tree exit other than 0/1 (bad ref, old git) rather than
    reporting "clean". Needs git ≥ 2.38; the dev box has 2.49.
  - Next: 3.1. Refresh from main first.
- 2026-09-29 — **3.1** — done (`ebd974a`) [1 session · ~30 trips · peak ~118k · stays L]
  - Exit codes beyond the plan: **1** for usage, a failed preflight (no branch, main not on
    `--base`) or an unexpected error; **6** for a failed push (the merge landed locally). A
    failed `git branch -d` also exits 5, like a failed removal.
  - A dirty worktree, or `--keep-worktree`, also keeps the branch: `branch -d` would fail on a
    checked-out branch, so it reports "kept" instead. Exit stays 0.
  - `merge --abort` runs only when `MERGE_HEAD` exists, so a refused merge never resets anything.
  - The push sends git's stdout to stderr, so `--json` stays one parseable object.
  - `/land` also checks `/fleet` for a live session in the worktree and adds `--keep-worktree`
    if it finds one.
  - `hook-fleet-sync.test.js` needed no change: it counts `MANIFEST.length`. The test fixture
    pins `core.autocrlf false`, because a system-level `true` turned merged files into CRLF.
  - No snapshot this substep: nothing real was removed (tests use throwaway repos only).
  - Next: 3.2. Refresh from main first.
- 2026-09-29 — **3.2** — done (`e54b853`) [1 session · ~8 trips · peak ~40k · stays M]
  - Rule step 5 now says a live plan branch isn't landed until the plan is done, replacing the
    old `remove` vs `keep` prompt, which `/land` answers itself. Rule is 66 lines.
  - Only this repo's copy of the plan-authoring skill was edited. Any hand-ported copy
    elsewhere (e.g. `~/.claude/skills`) still lacks the `/land` sentence.
  - Main had nothing new; the refresh was a no-op.
  - Next: 4.1 [opus]. Refresh from main first.
- 2026-09-29 — **4.1** — done (JAE `315e4c3` on `plan/worktree-hardening`, unmerged) [1 session · ~30 trips · stays M]
  - **Cause, reproduced 3/3 in a scratch repo:** a process still writing inside the worktree
    during `git worktree remove` → `error: failed to delete '<wt>': Directory not empty`, folder
    left behind (`node_modules/`). Git **de-registers before deleting**, so the leftover is an
    unregistered orphan the hook never retries. The hook's header said the opposite; corrected.
  - The 4 logged failures (settings-browser-verify, zr-company-fallback, zr-title-cleanup,
    search-order) no longer exist on disk or in `git worktree list`, so their contents couldn't
    be inspected. search-order's last transcript write was ~52 min before its failure, past the
    30m idle guard, which fits an idle-but-open session or a watcher. Which process held each one
    is unknown, and `handle.exe` can't be used after the fact.
  - Ruled out as the logged error: open file handle (removed cleanly, POSIX delete semantics);
    process cwd inside the tree → `Permission denied`, folder left; paths > 260 chars (JAE has
    12, max 279, `core.longpaths` unset) → `Filename too long`, folder left. The last two are
    real failure modes and leave the same orphan, and the same fallback handles them.
  - **Fix:** a new `trashLeftover()` in the JAE hook runs when git fails, the tree is no longer
    registered, and the leftover folder can be renamed to `%TEMP%/claude-worktree-trash`. Then
    it prunes, and `branch -d` still runs. It is its own hook-local helper, not
    `worktree-safety.safeRemoveWorktree`: JAE has no copy of that file. The change is 13 lines,
    3 over the plan's 10-line cap; the user approved it. It was checked by running the patched
    hook against a live writer: reclaimed, leftover in trash, branch deleted. The JAE dry run is
    clean.
  - **Second bug, deliberately NOT fixed (user call):** `gitTry()` `.trim()`s porcelain output,
    so the first line `" M .claude/settings.local.json"` loses its leading space and `slice(3)`
    yields `claude/settings.local.json`, which misses `CHURN`. That's why 21 of 26 JAE worktrees
    read "has uncommitted changes". The fix is one line (don't trim status output), but it would
    make roughly 17 worktrees auto-reclaimable on the next JAE session, with no snapshot or dry
    run. It belongs in 4.2 and has to be sequenced with 7.2's approved backlog clear.
  - No snapshot: no real worktree was removed (scratch repo only). JAE worktree
    `.claude/worktrees/worktree-hardening` was created for the branch.
  - Next: 4.2. Refresh from main first.
- 2026-09-29 — **4.2** — done (`8cceb56`) [1 session · ~25 trips · stays M]
  - RECLAIM guards live in `worktree-safety.reclaimVerdict` (+ `discardChurn`), not in
    `sync-worktrees.js`: that file is now 523 lines, over the 500 bar, and the guard logic is the
    removal-safety concern that module already owns. All five guards are evaluated every time, so
    a KEEP row names every guard that failed.
  - Porcelain is read with `--untracked-files=all` and never trimmed. Without the flag, a new
    `.claude/settings.local.json` collapses to `?? .claude/` and slips past the churn filter (the
    first test run caught it). This is the same class of bug as the JAE trim bug.
  - Before `git worktree remove`, `discardChurn` restores a modified `settings.local.json` or
    deletes an untracked one. Otherwise git refuses the churn the clean guard allowed (JAE
    tracks the file). Removal stays unforced.
  - The behind-count checkbox needed no code: the unlanded report already printed
    `N unlanded · N behind` (plan line refs predate it).
  - `registeredTrees` hit CC 10 with the `locked` branch; it now uses a prefix table.
  - Verify: CCA dry run → RECLAIM `agent-matcher`, `quiet-verdict-cards`; this worktree is KEEP
    (merged, clean, idle, not-cwd all fail). sync-worktrees 15/15, hook-fleet-sync 24/24,
    `npm test` exit 0.
  - Fleet manifest gains `sync-worktrees.md`/`.js`. JAE's diverged hand copy now reads as drift
    in check mode (so pushes from main will be blocked by the pre-push guard) until 7.1 runs `--write`.
  - Not done here (still open from 4.1): JAE hook's `gitTry().trim()` porcelain bug, sequenced
    with 7.2.
  - No snapshot: nothing real was removed. The fixtures are throwaway repos, and the CCA run was
    a dry run only.
  - Next: 4.3. Refresh from main first.
