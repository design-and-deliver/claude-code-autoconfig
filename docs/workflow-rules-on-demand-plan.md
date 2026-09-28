# Workflow rules on demand — plan

**Goal.** Stop paying for ~520 lines of workflow instructions in every session. The two
unscoped workflow rules load at every session start, so they add to CLAUDE.md's length and
dilute every other instruction. Their content matters only at specific *moments*: writing or
running a plan, or entering and landing a worktree.

- (A) Convert `.claude/rules/plan-authoring.md` (329 lines) into an on-demand skill.
- (B) Cut `.claude/rules/parallel-session-worktrees.md` (193 lines) down to what
  `worktree-gate.js` doesn't already enforce.

Evidence: `ARTICLES/workflow-rules-across-projects.html` (rule inventory, 2026-09-28) and
`ARTICLES/what-claude-code-loads-and-when.html`. Unscoped rules load exactly like CLAUDE.md,
and a skill's body loads only when it is invoked.

**Branch:** `plan/workflow-rules` (worktree `.claude/worktrees/workflow-rules`), cut from and
merged back to `main`. **Multi-repo:** substep 3.1 also commits in `C:\CODE\job-agent-extension`
and `C:\CODE\wifi-app` on a branch with the same name, each merged once in 3.1. Every other
substep commits only in CCA. Abandoning the plan is `git branch -D plan/workflow-rules`, and
`git log main..plan/workflow-rules` is the whole delta.

**Model floor:** Sonnet-class. Every substep is mechanical once the decisions below are
applied.

**Target environment:** this dev box only (Windows, Node ≥ 18). Verified: both files are
dev-only in practice. `bin/cli.js` has no `copyTree` for `.claude/rules`, and the worktree rule
is in `DEV_ONLY_FILES`. Nothing here reaches a CCA user install.

**How to execute.** One substep per fresh session: re-enter the worktree (`EnterWorktree`
with `path`), `git merge main`, do the substep, run Verify, commit, add a Ledger entry, then
`/clear` + `/continue`.

**Read this doc in slices, never whole:** the ⛔ section (lines 54–78), your own substep, and
the Ledger tail.

### Decisions (no substep reopens these)

- **plan-authoring becomes a skill, not a path-scoped rule.** Plan work happens at a moment,
  not in a particular file, so no `paths:` glob fits it.
- **Skill path:** `.claude/skills/plan-authoring/SKILL.md`, frontmatter `name: plan-authoring`.
  The name stays the same because token-guard's steer (`token-guard.js:3290`,
  "plan-authoring grammar") and `/continue` refer to it by that concept name. token-guard.js
  is **not edited**.
- **The skill stays dev-only:** add `SKILL.md` to `DEV_ONLY_FILES` and negate
  `.claude/skills/` in package.json `files`. `dev-gate-consistency.test.js` requires both.
- **The worktree rule stays a rule**, still unscoped, cut to ≤ 80 lines. Its plan-branch
  section (L31–80) is replaced by a one-line pointer to the skill, because it duplicates
  plan-authoring's "Branch discipline" almost word for word.
- **Fleet sync:** the manifest entry moves from `subdir: 'rules'` to the skill path. JAE and
  wifi-app adopt the new path in 3.1 with `git mv`, since the sync is adopt-only and would
  otherwise skip them.
- **Every commit carries `Changelog: none`**, since the work is dev-only.

## ⛔ Standing trap warnings — read before ANY substep

- **`token-guard.js` (5,406 lines): never open it and never edit it.** This plan doesn't need to.
- **`bin/cli.js` (1,030 lines):** Grep, then read a window. `DEV_ONLY_FILES` is at ~line 529.
- **`scripts/sync-hook-fleet.js --write` runs ONLY from the main checkout, after the merge**
  (substep 3.1). Run from a worktree, it publishes stale copies to the whole fleet. Check mode
  (no `--write`) is safe anywhere.
- **The sync is adopt-only** (`sync-hook-fleet.js:46-51`): a target without the file is skipped,
  never created. That's why 3.1 `git mv`s the old rule into the skill path in JAE and wifi-app
  *before* running `--write`.
- **`dev-gate-consistency.test.js` pairs every `DEV_ONLY_FILES` entry with a package.json
  negation.** Add both in the same substep, or `npm test` goes red.
- **`bootstrap-worktree.js:119` prints a user-facing string that names section "⛔9"** of the
  worktree rule. If 2.1 renumbers or retitles that section, update the string in the same
  substep.
- **Don't hand-edit JAE's or wifi-app's copy of the plan-authoring content.** The 3.1 sync
  writes the canonical text over it.
- **Out of scope:** `C:\CODE\alliant` (300 lines) and `C:\CODE\claude-code-cad` (47 lines) hold
  divergent, unsynced copies (see Deferred). So does the JAE worktree rule (208 lines, with
  sections CCA lacks).
- **The main checkout holds an untracked `docs/cheap-continue-plan.md` belonging to another
  session.** Never stage or touch it.
- `CHANGELOG.md` and `.claude/docs/autoconfig.docs.html` are generated. Never hand-edit them;
  run `node .claude/scripts/sync-docs.js` after changing files under `.claude/`.

## Phase 1 — the skill exists and everything points at it

### ☑ 1.1 · M · ~40m — Move plan-authoring into a dev-only skill

**Budget:** files 3 · new 0 (1 moved) · trips ≈ 11

**Read:** this doc (⛔ section + this substep) · `.claude/rules/plan-authoring.md:1-12` (header) ·
`bin/cli.js` Grep `DEV_ONLY_FILES = ` (~529) · `package.json:54-98` (`files`)

- [x] `mkdir -p .claude/skills/plan-authoring && git mv .claude/rules/plan-authoring.md .claude/skills/plan-authoring/SKILL.md`
- [x] Prepend this frontmatter to SKILL.md (the description is the trigger, so keep every clause):
  ```
  ---
  name: plan-authoring
  description: Plan-doc grammar for multi-session work. Use BEFORE authoring, reviewing, sizing, or re-tagging a plan doc (docs/*.md or .claude/plans/*.md with a "## Ledger"), when a task is beyond small (~100k tokens, multi-file, multi-repo) and needs a plan first, and when executing or landing a plan substep (branch discipline, Verify, Ledger entry format).
  ---
  ```
- [x] Change the body's self-reference "Adopting repos hold a byte-identical copy at
  `.claude/rules/plan-authoring.md`" to `.claude/skills/plan-authoring/SKILL.md`.
- [x] `bin/cli.js`: append `'SKILL.md'` to `DEV_ONLY_FILES`. Add
  `"!.claude/skills/"` to package.json `files`, next to line 98.

**Verify:** `npm test` green · `test -f .claude/skills/plan-authoring/SKILL.md && ! test -e .claude/rules/plan-authoring.md` · `npm pack --dry-run 2>&1 | grep -c skills` prints `0`

**Commit:** `refactor(plans): move plan-authoring from an always-loaded rule to an on-demand skill` + `Changelog: none`

### ☐ 1.2 · L · ~1h — Repoint every reference at the skill

**Budget:** files 6 · new 0 · trips ≈ 18

**Read:** this doc (⛔ + this substep) · then Grep each, and open one file at a time right before editing it:
`.claude/commands/plan-progress.md:14` · `.claude/scripts/plan-progress.js:12,217` ·
`scripts/run-plan.js:9,82` · `.claude/rules/parallel-session-worktrees.md:80,171` ·
`.claude/hooks/worktree-gate.js:35,201,225` (comments only) · `.claude/commands/continue.md:38,133`

- [ ] `plan-progress.md:14`: change the path to `.claude/skills/plan-authoring/SKILL.md`, and bump `@version`.
- [ ] `plan-progress.js:12,217` and `run-plan.js:9,82`: change the path in comments and in the error string. Don't change any logic.
- [ ] `worktree-gate.js` comments (35, 201, 225): "plan-authoring rule" → "plan-authoring skill".
- [ ] `parallel-session-worktrees.md:80,171`: point at the skill path. (2.1 rewrites this file anyway, so keep the edit minimal.)
- [ ] `continue.md:38,133`: where it says "the plan-authoring pattern", add "(invoke the `plan-authoring` skill)", and bump `@version`.

**Verify:** `git grep -n "rules/plan-authoring" -- ':!docs/' ':!CHANGELOG.md' ':!ARTICLES/'` prints nothing · `node .claude/scripts/sync-docs.js` · `npm test` green

**Commit:** `chore(plans): point plan tooling at the plan-authoring skill` + `Changelog: none`

### ☑ 1.3 · M · ~40m — Fleet sync manifest: rules → skills

**Budget:** files 2 · new 0 · trips ≈ 10

**Read:** this doc (⛔ + this substep) · `scripts/sync-hook-fleet.js:40-140` (the adopt-only rule at 46–51, the manifest at 99–105) · `test/hook-fleet-sync.test.js:195-225`

- [x] Manifest entry at 99–105: `{ file: 'SKILL.md', global: false, subdir: 'skills/plan-authoring' }`. Check that the path join handles a nested subdir. If it assumes a single segment, generalize it to `path.join(...subdir.split('/'))`. Don't change anything else.
- [x] Tests at 200–222: point `canonRule` and both cases at `.claude/skills/plan-authoring/SKILL.md`. Keep both assertions: the file syncs into the skills dir, and a target without it is skipped.

**Verify:** `node test/hook-fleet-sync.test.js` green · `node scripts/sync-hook-fleet.js` (check mode) runs without crashing. Drift *is* expected here, because JAE and wifi-app still hold the old rule until 3.1 · `npm test` green

**Commit:** `chore(fleet): sync plan-authoring as a skill` + `Changelog: none`

## Phase 2 — the worktree rule carries only what isn't enforced

### ☐ 2.1 · M · ~45m — Cut parallel-session-worktrees.md to ≤ 80 lines

**Budget:** files 2 · new 0 · trips ≈ 10

**Read:** this doc (⛔ + this substep) · `.claude/rules/parallel-session-worktrees.md` (193 lines, read whole) · `scripts/bootstrap-worktree.js:115-122`

For each section, keep or cut it as listed. Keep the imperative sentence and drop the history and rationale:

| Lines | Section | Action |
|---|---|---|
| 1–6 | dev-only header | keep, as 2 lines |
| 7–22 | collision problem; enter before the first write | keep the mandate in 3 lines. The gate only *asks*, and Bash writes aren't gated |
| 24–29 | one worktree per session | keep, 2 lines |
| 31–80 | plan branch | replace with one line: "Plan work: one `plan/<alias>` branch and worktree per plan, refreshed per substep, merged once. See the `plan-authoring` skill, Branch discipline." |
| 82–103 | the loop | keep steps 1–5 as terse numbered lines, including auto-merge when clean and ask on conflict |
| 105–119 | bootstrap | keep the list of missing gitignored files, 5 lines |
| 121–147 | junction | keep the three imperatives (default off; unlink before remove; no npm through a junction). Cut 128–138 (history) |
| 149–163 | baseRef head | keep, 3 lines. Drop "8 commits" |
| 165–186 | not isolated | keep all 5 bullets, one line each |
| 188–193 | conflicts | keep the "don't reach into another worktree" line |

- [ ] Rewrite the file following the table. Target ≤ 80 lines, and keep every ⛔ heading that `bootstrap-worktree.js:119` names. If its number changes, update that string in the same commit.
- [ ] `grep -n "parallel-session-worktrees" CLAUDE.md .claude/commands/abort-plan.md .claude/scripts/sync-worktrees.js scripts/bootstrap-worktree.js`: check that each pointer still lands on a section that exists.

**Verify:** `wc -l .claude/rules/parallel-session-worktrees.md` ≤ 80 · `npm test` green

**Commit:** `docs(rules): cut the worktree rule to what the gate doesn't enforce` + `Changelog: none`

## Phase 3 — land it

### ☐ 3.1 · M · ~45m — Merge once, sync the fleet, adopt in JAE + wifi-app

**Budget:** files 4 (2 repos × git mv + commit) · new 0 · trips ≈ 14

**Read:** this doc (⛔ + this substep) + Ledger tail

- [ ] From the CCA **main checkout**: `git merge --ff-only plan/workflow-rules`. If it isn't a fast-forward, do a normal merge, and stop and ask if it conflicts.
- [ ] In each of `C:\CODE\job-agent-extension` and `C:\CODE\wifi-app`: `git switch -c plan/workflow-rules`, then `mkdir -p .claude/skills/plan-authoring && git mv .claude/rules/plan-authoring.md .claude/skills/plan-authoring/SKILL.md`. Check `/fleet` first. If a live session is holding one of these repos, stop and ask.
- [ ] From the CCA main checkout: `node scripts/sync-hook-fleet.js --write`. This overwrites both adopted copies with the canonical skill.
- [ ] In JAE and wifi-app: commit (`chore: plan-authoring is now an on-demand skill (synced from CCA)`), merge to their `main`, delete the branch.
- [ ] Manual check: in a fresh Claude session in CCA, `plan-authoring` appears in the available-skills list, and `.claude/rules/` no longer lists it.

**Verify:** `node scripts/sync-hook-fleet.js` (check mode) reports zero drift · `npm test` green in CCA · `git branch --merged main | grep plan/workflow-rules` in all three repos

**Commit:** none of its own in CCA (the merge lands the plan). JAE and wifi-app get the commit above.

## Deferred

- **alliant and claude-code-cad** hold their own divergent copies of plan-authoring. They aren't fleet targets, and converging them is a separate decision.
- **Bringing JAE's worktree rule under fleet sync.** It has three sections CCA lacks: self-healing step 5, Windows `remove` half-working, and a merge refused on a dirty tree. Merging those needs judgment, which is its own plan.
- **Hook-enforcing `deploy-approval` and `readme-sync`** (PreToolUse on `npm publish`). This is a good candidate from the rules review, but it's a separate feature.
- **Fixing `globs:` → `paths:`** in proswitch-api `ats-mappings.md` and parm-shaker `cadquery.md`. These are one-line fixes in other repos, done separately.
- **Removing JAE's copies of CCA's npm-specific rules** (`deploy-approval`, `readme-sync`).
- **Editing token-guard.js** to name the skill. Its string already names the concept, not the path.

## Ledger

- 2026-09-28 — **1.1 + 1.3** — done (`53db665`) [1 session · ~22 trips · peak ~90k · 1.1 was M, combined stays M]
  - **Deviation:** 1.3 folded into 1.1. Moving the file breaks `sync-hook-fleet.js`'s canonical lookup (the manifest named `rules/plan-authoring.md`), so 12 tests in `hook-fleet-sync.test.js` go red. 1.1 can't be green on its own. Authoring gap: the two substeps were never separable.
  - **Deviation:** `dev-gate-consistency.test.js:79-112` matches negations by EXACT path, so `!.claude/skills/` alone doesn't satisfy it. Added `!.claude/skills`, `!.claude/skills/**`, and the exact `!.claude/skills/plan-authoring/SKILL.md`.
  - `subdir: 'skills/plan-authoring'` works unchanged: `path.join` handles the nested segment (`sync-hook-fleet.js:156,163`), so nothing had to be generalized.
  - Fleet check mode is clean. JAE and wifi-app now read `[miss]` for SKILL.md, not drift; 3.1's `git mv` there is still required before `--write`.
  - ⚠ `'SKILL.md'` in `DEV_ONLY_FILES` gates EVERY file named SKILL.md. Harmless today (CCA ships no skills), but the first shipped skill needs a path-aware gate.
  - Next: **1.2** (repoint references). `test/plan-progress.test.js:10` also names the old path; add it to 1.2's sweep.
