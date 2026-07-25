---
description: One-session structural cleanup — refactor the hottest oversized file along a real seam
argument-hint: [path-to-file]
---
<!-- @description One-session maintenance refactor: ranks source files by git churn × size × branch density, picks the worst HOT offender (or the file you pass), and refactors it along responsibility seams — behavior-preserving, full test suite green before and after. -->
<!-- @version 1 -->
<!-- @response success | Reports the ranking, the seam split performed, before/after size + branching, test results, and the next-worst candidate for a future run. -->
<!-- @example /refactor | Rank hot files, refactor the worst one -->
<!-- @example /refactor bin/cli.js | Refactor that file specifically -->

# Refactor

One session, one target: make the codebase structurally cheaper for every future session.
The thresholds (~500 LOC per file, ~CC 10 per function) **nominate** targets — they never
grade the output. Never split code just to move a number.

Argument: `$ARGUMENTS` — optional path to the target file. Empty → rank and pick (Step 1).

## Step 0: preconditions (hard gates)

1. Read CLAUDE.md and `.claude/rules/` for invariants and trap lists (canonical-copy files,
   generated files, machine-parsed wording, append-only files). Anything named there is
   OFF LIMITS as a target unless the user explicitly passed it — and then flag the trap
   before touching it.
2. Run the project's test suite. Not green → STOP and report; a refactor never starts from red.
3. `git status` — uncommitted changes in the target file → stop and ask.

## Step 1: pick the target (skip if a path was passed)

Rank candidate source files by payoff = churn × structural weight:

- **Churn**: commits touching each file in the last 90 days —
  `git log --since="90 days ago" --name-only --pretty=format: | sort | uniq -c | sort -rn`
- **Size**: LOC.
- **Branch density**: count of branch tokens (`if`, `else if`, `case`, `catch`, `&&`, `||`,
  ternary `?`) — a cheap complexity proxy; good enough for ranking, no linter needed.

Exclude: generated files, vendored code, tests, lockfiles, and the Step-0 trap list.
Show the top 5 with their numbers; target = #1.

**If no hot file is oversized or heavily branched, say so and stop.** Cleaning cold or
already-tidy code never pays back the session it costs.

## Step 2: find the seam

Read the target fully. List its distinct responsibilities, then propose the split in 2–4
bullets (what moves where, what stays) BEFORE editing:

- Extract along responsibility seams — units that make sense on their own.
- A cohesive function at CC 12 stays. A single-responsibility 550-line file stays.
- Never shatter one flow into fragments that force cross-file hopping to follow it.

## Step 3: coverage gate

If the target has no meaningful test coverage, write characterization tests pinning its
current behavior FIRST — that may be this session's entire job. Refactoring untested code
is where cleanup regressions come from.

## Step 4: refactor

- Behavior-preserving ONLY: no public API, CLI flag, output format, or stored/serialized
  shape changes. Structure moves; contracts don't.
- Match the surrounding code's naming, idiom, and comment density.
- Session-sized: one file, one seam per invocation. Tempted to keep going → that's the
  next run's target.

## Step 5: verify + commit

1. Full test suite green.
2. Note before/after LOC and branch counts (informational — NOT acceptance criteria).
3. Commit per the repo's conventions (in this repo: conventional subject + `Changelog:`
   trailer per CLAUDE.md — a pure structural refactor is usually `Changelog: none`).

## Step 6: report

- The ranking and why this target won (or "nothing worth refactoring — stopped").
- The seam: what moved where.
- Before/after numbers and test results.
- What was deliberately left alone (and why), plus the next-worst candidate for a future run.
