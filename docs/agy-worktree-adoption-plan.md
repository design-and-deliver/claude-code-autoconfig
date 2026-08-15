# Agy worktree-design adoption plan

**Goal.** Fold the three transferable mechanics from Antigravity's worktree design into CCA's
parallel-session worktree loop: junction-based `node_modules` bootstrap (minutes → seconds),
rename-and-purge Windows cleanup (kills the flakiest delete failure), and shadow-commit dirty
carryover (removes the "uncommitted work doesn't come along" rule users trip on). All of it is
maintainer-only machinery — nothing here ships to users.

**Sources.**
- `docs/agy-worktree-sync-design.md` — agy's raw design answer (§ numbers below refer to it)
- `ARTICLES/agy-worktree-design-review.html` — the review that picked these three steals
  (untracked, local-only; the load-bearing correction from it is restated in trap ⛔4)
- Current machinery: `scripts/bootstrap-worktree.js` (112 lines),
  `.claude/scripts/sync-worktrees.js` + `.claude/commands/sync-worktrees.md`,
  `.claude/rules/parallel-session-worktrees.md`

**How to execute.** One substep per fresh session: do the work, run its Verify commands
verbatim, commit (every commit carries `Changelog: none` — see ⛔2), append a Ledger entry,
then `/clear` + `/continue`. **Read this doc in slices, never whole**: the ⛔ trap section
(lines 25–68), your own substep, and the Ledger tail.

**Model floor:** every substep carries exact file:line pointers and decided designs — a
Sonnet-class session can execute any of them. Keep 3.1 (git plumbing) off Haiku-class.

## ⛔ Standing traps — read before ANY substep

1. **Everything in this plan is dev-only.** `bootstrap-worktree.js` lives in `scripts/`
   (never in the npm tarball); `sync-worktrees.md`/`.js`, `worktree-gate.js`, and
   `parallel-session-worktrees.md` are gated by `DEV_ONLY_FILES` in `bin/cli.js:433`. Do NOT
   "fix" gating by shipping any of it, and do not add new files to the package without
   checking that list.
2. **Every commit needs a `Changelog: none` trailer.** feat/fix subjects surface verbatim on
   users' upgrade screens; announcing maintainer machinery there is a bug.
3. **Fleet-synced canonical copies.** `.claude/rules/parallel-session-worktrees.md` and
   `.claude/hooks/worktree-gate.js` are canonical HERE and adopt-only synced to other repos.
   Edit only the copies in this repo; after the substep's branch merges to main, run
   `node scripts/sync-hook-fleet.js --write` **from the main checkout only** — never from a
   worktree, never by hand-editing an adopting repo. First confirm in
   `scripts/sync-hook-fleet.js` whether the file you touched is in the manifest; if
   `bootstrap-worktree.js` / `sync-worktrees.js` are NOT, adopting repos keep their own
   copies and get nothing automatically — note that in the Ledger rather than hand-porting.
4. **`git write-tree` serializes the INDEX, not the working tree.** Agy's §9 snippet as
   written silently drops unstaged edits and untracked files — the exact things "dirty
   carryover" means. The correct shape uses a throwaway index and never touches the real one:
   ```
   GIT_INDEX_FILE=<tempfile>  git read-tree HEAD
   GIT_INDEX_FILE=<tempfile>  git add -A
   GIT_INDEX_FILE=<tempfile>  git write-tree          → TREE_SHA
   git commit-tree $TREE_SHA -p HEAD -m "shadow base" → SHADOW_SHA   (then delete tempfile)
   ```
   The user's real index and working tree must be byte-identical before and after
   (`git status --porcelain` unchanged is the acceptance check).
5. **Junction deletion hazard — the one mistake that destroys the main checkout.** A
   junctioned `node_modules` points INTO the main checkout. Any delete path that traverses
   the junction (instead of removing the link itself) deletes the main checkout's real
   `node_modules`. Before relying on it, Verify steps must prove on a throwaway tree that
   (a) `git worktree remove`, (b) `fs.rmSync(..., {recursive:true})` in
   `sync-worktrees.js`, and (c) the trash sweep each remove the LINK without recursing
   through it. Never assume; test it.
6. **Never run `npm install`/`npm update` inside a junctioned worktree** — npm writes
   through the junction into the main checkout. Bootstrap must detect an existing
   junction/symlink `node_modules` and refuse the install path with a clear message.
7. **Command versioning.** Any edit to `.claude/commands/sync-worktrees.md` bumps its
   `<!-- @version N -->`.
8. **Full suite before every commit** (`npm test`) — this plan touches `scripts/` and
   `.claude/`, both under the Testing Requirements rule. Hooks and these scripts fail
   silent by design; green-because-it-didn't-crash proves nothing, the suites do.

## Phase 1 — faster bootstrap

### ☐ 1.1 · M · ~45m — Junction node_modules (lockfile-guarded) in bootstrap

**Read list:** `scripts/bootstrap-worktree.js` (whole, 112 lines);
`.claude/rules/parallel-session-worktrees.md` "⛔ Bootstrap is not optional" section;
this doc:25–68 (traps) + this substep.

- [ ] In `installDeps()` (`bootstrap-worktree.js:71-79`): before falling back to
      `npm install`, junction when BOTH hold — the main checkout has `node_modules`, and the
      worktree's `package-lock.json` is byte-identical to the main checkout's. Create via
      `fs.symlinkSync(target, linkPath, 'junction')` (on non-Windows the type arg is ignored
      and a dir symlink results — same semantics for our purposes). Mismatch or missing →
      existing `npm install` path, with a report line saying why.
- [ ] Guard per ⛔6: if `node_modules` already exists as a junction/symlink, skip install
      entirely and say so; never let npm run through the link.
- [ ] Report lines distinguish `✓ junction node_modules → <main path>` / `– fallback npm
      install (<reason>)`.
- [ ] Update the rule doc's bootstrap section (canonical copy here — ⛔3): bootstrap is now
      seconds when lockfiles match; note the no-npm-inside-junction rule.

**Verify:** `git worktree add .claude/worktrees/smoke-junction HEAD` → run bootstrap inside
it → assert `node_modules` is a link (`node -e "console.log(require('fs').lstatSync('node_modules').isSymbolicLink())"`
prints true) → `npm test` inside the worktree passes → `git worktree remove --force` the
smoke tree → **assert the main checkout's `node_modules` still exists and `npm test` passes
in the main checkout** (⛔5 proof). Then full `npm test` in main.

**Commit:** `feat: junction-based node_modules bootstrap for dev worktrees` + `Changelog: none`.

## Phase 2 — cleanup that survives Windows

### ☐ 2.1 · M · ~45m — Rename-and-purge trash path in /sync-worktrees

**Read list:** `.claude/scripts/sync-worktrees.js:207-247` (orphan classification — where
`.trash` must be excluded) and `:260-290` (the `--write` act section — where the trash path
lands); `.claude/commands/sync-worktrees.md` (whole, ~60 lines); this doc:25–68 + this
substep.

⚠ Owner-liveness ALREADY EXISTS — the `HELD` verdict (`sync-worktrees.js:222-229`) keys off
transcript mtime via the slugify trick. Do not add a second liveness mechanism.

- [ ] In the act section (`sync-worktrees.js:263-278`): when `fs.rmSync` throws or leaves
      survivors (both current `PARTIAL` paths), `fs.renameSync` the directory to
      `.claude/worktrees/.trash/<name>-<epoch>` (NTFS allows renaming a dir with open
      handles even when deletion is denied — agy §8) and report a new `TRASHED` verdict;
      keep `PARTIAL` only when the rename itself also fails.
- [ ] Exclude `.trash` from the orphan scan (`baseNames`, `sync-worktrees.js:210-214`) —
      otherwise the next run classifies the trash dir itself as an orphan.
- [ ] Sweep `.trash/` on every run: dry run reports what is waiting; `--write` retries the
      delete (same `rmSync` retry options), leaving what still won't die for next time.
      Sweep must honor ⛔5 — remove links, never recurse through them.
- [ ] Update `sync-worktrees.md`: document `.trash/` + the `TRASHED` verdict, bump
      `@version` (⛔7).

**Verify:** bare dry run on this repo reports sanely. Synthetic lock test in a scratch dir:
run `node -e "const fs=require('fs');fs.openSync(process.argv[1],'r');setTimeout(()=>{},60000)" <file-inside-target>`
in the background → confirm `fs.rmSync` on the target dir fails or partials → confirm the
rename into `.trash/` succeeds while the holder still runs → kill the holder → confirm the
sweep removes it. Full `npm test`.

**Commit:** `feat: rename-and-purge trash path in /sync-worktrees` + `Changelog: none`.

## Phase 3 — dirty carryover

### ☐ 3.1 · L · ~1.5h — Shadow-commit `--carry-dirty` in bootstrap, with test suite

**Read list:** `scripts/bootstrap-worktree.js` (whole); `docs/agy-worktree-sync-design.md`
§9 (lines 142–158); `test/hook-fleet-sync.test.js` skim for the throwaway-repo test pattern;
`.claude/rules/parallel-session-worktrees.md` carryover language; this doc:25–68 + this
substep.

- [ ] Add opt-in `--carry-dirty` flag to `bootstrap-worktree.js`. Sequence: build the shadow
      commit against the MAIN checkout exactly per ⛔4 (throwaway `GIT_INDEX_FILE`, `read-tree
      HEAD`, `add -A`, `write-tree`, `commit-tree -p HEAD`), prefixing these git calls with
      `-c gc.auto=0` (agy §6 — don't let auto-gc prune loose objects mid-write).
- [ ] Materialize in the worktree (the shared object store makes SHADOW_SHA visible there):
      capture `git -c gc.auto=0 diff --binary HEAD <SHADOW_SHA>` and feed it to
      `git apply --whitespace=nowarn` via stdin (`execFileSync` `input:` — no shell pipe).
      Decided over `git restore --source`, which cannot express deletions: a file deleted in
      the dirty state exists in HEAD but not in the shadow tree, and restore never removes
      extras. Result arrives as unstaged dirty state, mirroring the main checkout — the test
      pins all four cases (tracked modify, staged-only modify, untracked add, delete).
- [ ] New `test/bootstrap-carry-dirty.test.js` driving the real script against a throwaway
      repo + worktree in a temp dir: asserts the four dirty cases carry over AND
      `git status --porcelain` + index of the source repo are byte-identical before/after
      (⛔4's acceptance check).
- [ ] Update the rule doc (⛔3) and CLAUDE.md's worktree paragraph: "uncommitted work does
      not come along — commit or stash first" becomes "…or bootstrap with `--carry-dirty`".

**Verify:** `npm test` (new suite included). Live smoke: dirty one scratch file in main,
enter a smoke worktree, `node scripts/bootstrap-worktree.js --carry-dirty`, confirm the file
arrived dirty in the worktree and `git status --porcelain` in main is unchanged.

**Commit:** `feat: shadow-commit dirty carryover (--carry-dirty) for dev worktrees` + `Changelog: none`.

## Deferred — considered, deliberately not planned

- **Single orchestrator process (agy's core architecture).** Rejected: orchestration
  requires a parent that owns the worker processes' lifecycle. Agy has one structurally
  (every agent is a subprocess of its CLI); CCA's sessions are peer processes launched by
  the user with no parent, so an orchestrator here means a daemon — and since sessions must
  keep working when the daemon is down, the choreographed path (gate hook, file signals,
  adopt-only sync) must exist anyway, making the daemon a second implementation rather than
  a replacement. The one property orchestration genuinely buys — serialized reintegration —
  CCA already has by convention: merges happen only from the main checkout, resolved by the
  human, which is a lock with the user as owner. **Flip condition:** if CCA ever spawns
  sessions itself (a fleet runner driving N plan substeps), the parent process exists and
  worktree lifecycle should move into it that day. Full argument:
  `ARTICLES/choreography-vs-orchestration-for-cca.html`.
- **Auto squash-merge + conflict-resolution subagent (agy §5).** Our merges are
  human-driven by design; merge time is the deliberate review point. Automating it trades
  away the step we want.
- **Worktrees outside the repo (`%LOCALAPPDATA%`, agy §2).** The IDE-watcher point is
  real, but `EnterWorktree` is harness-native and owns the location.
- **Hardlinking local configs instead of copying (agy §3).** Two-way instant propagation is
  a per-file policy change (fine for permissions, questionable elsewhere); today's copy
  semantics stay until a file-by-file case is made.
- **Merge lock file (`.git/cca-merge.lock`).** The turn loop plus the main-checkout-only
  convention already serialize reintegration; revisit only if a real merge collision ever
  happens.
- **Shadow-worktree staging when main is dirty at merge time (agy §5).** Heavy machinery
  for a case the workflow avoids by merging from a clean main checkout.
- **pnpm content-addressable store.** Not our stack; the junction gets us the same win.

## Ledger

- 2026-08-14 — Plan authored. Source doc moved from repo root to
  `docs/agy-worktree-sync-design.md` (was untracked at root). No substeps run yet.
- 2026-08-15 — Weak-model hardening pass (author session): read `sync-worktrees.js`
  end-to-end and corrected 2.1 — owner-liveness already exists as the `HELD` verdict, so
  that microstep was dropped; exact line pointers added; `.trash` must be excluded from the
  orphan scan (new microstep). Pre-decided 3.1's materialization primitive
  (`diff --binary` + `apply`; `restore --source` can't delete). Added model-floor note to
  the header. No substeps run.
- 2026-08-15 — Pre-flight (vetting session): all file:line pointers re-verified against the
  code, plan confirmed parseable by `/plan-progress`. Plan + source doc committed to main
  (the `docs:` commit that added this file) so worktree sessions inherit them — 1.1's
  commit is now code-only.
