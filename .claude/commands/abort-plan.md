<!-- @description Kill a plan that isn't worth finishing — stamps the doc ABORTED so /continue stops resuming it, writes the post-mortem, tags and deletes the branch, and tables the idea for a future revisit. -->
<!-- @version 1 -->
<!-- @param plan | string | optional | Plan alias, or a path to the plan doc. Omitted: infer from this session's plan work, and confirm before touching anything. -->
<!-- @param reason | string | optional | Why it's being killed. Free text after the plan name. Inferred from the conversation if absent. -->
<!-- @response success | Aborted {alias}: doc stamped, branch tagged aborted/{alias} and deleted, card tabled. Nothing to unwind from main. -->
<!-- @response no-plan | I can't tell which plan to abort. -->
<!-- @sideeffect Edits the plan doc, deletes a branch and worktree, appends a card to .claude/board/tabled.md -->
<!-- @example /abort-plan trial-dual-cap | Kill it, infer the reason from this conversation -->
<!-- @example /abort-plan my-info-removal too much merge churn, revisit after the settings migration | Kill it with an explicit reason -->
Stop a plan for good, and make every piece of tooling agree that it stopped.

The argument is: $ARGUMENTS

An abort that lives only in a chat window is not an abort. A plan killed at 4 of 9 substeps is
byte-identical to one that merely stalled — same unchecked boxes, same Ledger, same branch — so
`/continue`'s plan probe finds it, reconciles it, and reports *"next: substep 2.3"* to a session
weeks later. This command exists to leave a **terminal state** on disk.

## Step 0: Identify the plan, and confirm

Resolve `$ARGUMENTS` to one plan doc — scan **both** `docs/*.md` and `.claude/plans/*.md` (a plan
lives in either; the second is gitignored in some repos). Match on the alias in the filename or
the H1. If the argument is empty, infer from what this session has been executing.

Then read three slices — the header, the substep checkboxes, and the Ledger tail — and report
**before changing anything**:

- how far it got (`N of M substeps checked`),
- its branch and worktree, and whether any of the branch is already in `main`,
- the reason being recorded.

⛔ **Ambiguous or zero matches → stop and ask.** Never guess which plan to kill. And if
`/fleet` shows a live sibling session on this plan's branch, stop: aborting under a session
that is mid-substep destroys uncommitted work. Report the sibling and stand down.

## Step 1: Stamp the doc (the load-bearing step)

Insert a status line **immediately after the H1**, before the `**Goal:**` block:

```
> ⛔ **Status: ABORTED YYYY-MM-DD** — {reason}. Branch retired as tag `aborted/{alias}`.
> Do not resume; `/continue` and any plan probe must treat this doc as terminal.
```

Leave every checkbox exactly as it is. **Do not fake-tick the remaining substeps** — the
half-done state is the honest record, and the stamp is what makes it terminal. Renaming or
moving the doc is also wrong; other docs link to this path.

## Step 2: Write the post-mortem Ledger entry

Append a final entry to `## Ledger`, in the plan's existing grammar:

```
- **YYYY-MM-DD — ⛔ PLAN ABORTED after {N} of {M} substeps.** {reason}.
  **Landed anyway:** {anything already merged to main, or "nothing — the branch never merged"}.
  **Recoverable at:** tag `aborted/{alias}` ({short-sha}).
  **What would have caught this sooner:** {the upstream check that failed}.
```

That last line is the point of the whole exercise. Reach for a concrete process gap — a skipped
per-substep `git merge main`, a substep that blew past its S/M/L rent ceiling, a design decision
left open in the doc that the executing session had to invent. If nothing upstream failed and the
plan was simply overtaken by a priority change, say that plainly; a fabricated root cause is
worse than none.

The Ledger is read by `/continue`'s plan gate even when the header is not, so this entry is the
belt to Step 1's braces. Write both.

## Step 3: Report what already reached `main` — never auto-revert

Under the all-or-nothing merge rule (`.claude/rules/parallel-session-worktrees.md`) a live plan
branch has merged nothing, so this is usually one line: *"nothing landed."*

Legacy plans authored under the old phase-merge policy are the exception. Check:

```bash
git log --oneline main..plan/{alias}      # never landed — dies with the branch
git log --oneline plan/{alias} --not main # already in main — needs a decision
```

If the second is non-empty, list those commits with a ready-to-paste
`git revert -m 1 <merge-sha>` per merge, in reverse order — and **stop there**. Whether to
revert is the user's call: an extracted pure module, a test harness, or a doc fix is often worth
keeping even when the feature it served is dead. Do not run the reverts unprompted.

## Step 4: Retire the branch and worktree

Tag first, so the work is never actually lost:

```bash
git tag aborted/{alias} plan/{alias}
git branch -D plan/{alias}
```

`-D` (not `-d`) is correct and deliberate — the branch is unmerged by definition, and the tag is
what preserves it. Restoring later is `git switch -c plan/{alias} aborted/{alias}`.

Then remove the worktree: `ExitWorktree remove` if this session is inside it, otherwise
`git worktree remove <path>` from the base checkout. On Windows the delete half often fails on a
held `node_modules` handle — if it does, say so and point at `/sync-worktrees`, which reaps the
orphan safely. Do not force it.

Removing the branch is what stops `/eval-worktrees` re-asking about this work on every board;
the reclaim Stop hook will never do it for you, because that hook requires a merged branch.

## Step 5: Table it for the revisit

An abort is usually *"not now"*, not *"never"*. Append one card via the `/table` convention so
the intent survives the teardown:

```
- **{Plan title}** — plan aborted {date}: {one-clause reason}. Doc: `docs/{file}.md`, code: tag `aborted/{alias}`. <!-- YYYY-MM-DD -->
```

Skip this step only if the user says the idea itself is dead, not just deferred.

## Step 6: Confirm

Four lines, no more: what was stamped, what landed in `main` (usually nothing), the recovery tag,
and the tabled card. Then stop — do not offer to start the next plan in the same breath.
