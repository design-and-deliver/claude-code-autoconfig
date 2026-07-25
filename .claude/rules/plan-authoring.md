# Plan authoring rules

Any multi-session remediation/feature plan written in this repo (e.g. by /up-to-snuff) follows
this structure. The plan is a self-contained doc a fresh session can execute with zero prior
conversation context.

## Where plans live

`docs/*.md` (tracked — Ledger history rides in git) or `.claude/plans/*.md` (local working
plans; gitignored in this repo). Tooling that discovers plans (/continue's plan probe,
/plan-progress) must scan BOTH directories. A gitignored plan's Ledger-only "commit" steps
are no-ops — there the Ledger entry itself is the durable record, so skip those commits.

## Structure

1. **Header**: goal, links to source audits/evidence, and "how to execute" (one substep per
   fresh session; Verify; commit; Ledger entry; then `/clear` + `/continue` — /continue is
   plan-aware and resumes at the next unchecked substep).
2. **⛔ Standing trap warnings** section at the top: the "never do X" list a fresh session must
   read before ANY item — load-bearing conventions where an innocent refactor runs clean and
   breaks at runtime.
3. **Phases ordered by protection per effort**:
   - Phase 1 — stop the repo from lying (dead code, wrong docs; cheap, no product logic)
   - Phase 2 — make wrong edits fail loudly (tests wired in, CI, lint/type gaps closed)
   - Phase 3 — shrink the god files (per-domain, incremental, each substep shippable)
4. **Session-sized substeps** (N.1, N.2 …) with checkboxes: each executable start-to-finish in
   one fresh session, ending with a **Verify** step (actual commands, not "check it works") and
   a commit point (subject + `Changelog:` trailer per CLAUDE.md's changelog rules). Every substep
   heading carries an **effort tag** — `### ☐ N.N · <S|M|L> · ~<time> — <title>` — so a fresh
   session (and the reader) knows the weight before opening it:

   | Size | Shape | Rough time |
   |------|-------|-----------|
   | **S** | one file, mechanical, no new tests, no trap surface | ~10–20 min |
   | **M** | a few files or one new test; bounded logic | ~30–60 min |
   | **L** | new test suite(s), several coordinated edits, **or** any edit inside a ⛔ trap surface | 1–2 hr |

   **The `~<time>` grammar is machine-parsed** (`/plan-progress`'s SUBSTEP regex is the
   contract): a single `~<N>m` or `~<N>h` token — `~45m`, `~2h`, `~1.5h` — with the ` — `
   IMMEDIATELY after it. `~45 min`, `~2 hr`, `~2h each`, or `~2h (split a/b)` all fail the
   regex, and a plan whose substeps don't parse is silently invisible to `/plan-progress`
   AND `/continue`'s plan probe (discovered 2026-07-24: the clean-code plan shipped unparseable
   and would never have auto-resumed). Qualifiers belong in the title, after the dash.

   The letter leads because it is stable; the time trails because it is only a hint — a step
   balloons the moment it hits a trap, which is exactly why size, not wall-clock, is the anchor.
   **There is no XL**: a substep that sizes XL is too big for one session — split it into
   N.a / N.b until each is ≤ L. (Size a done substep against what it actually took, so the tags
   stay calibrated.)

   **Microsteps (optional — enables a per-substep progress bar):** a substep body MAY list its
   action items as checkbox bullets — `- [ ] <action>` — instead of plain `-` bullets. When it
   does, `/plan-progress` counts the `[x]`/`[ ]` boxes of the **current** substep into a
   per-substep progress bar, and the executing session ticks each box as that microstep lands.
   Only genuine **action bullets** become microsteps; the ⚠ trap notes and the **Verify** /
   **Commit** lines stay prose, outside the count.
5. **Deferred** section: options considered and deliberately not planned, with reasons — so a
   later session doesn't "helpfully" do them.
6. **Ledger** at the bottom, appended after each substep: date — step — outcome (+ commit
   hash), deviations, discoveries with `file:line` pointers, notes a later step needs.

## Safety rails (bake into the items, don't just state them)

- Docs vs code disagree → **fix the docs to match the code**, never the reverse.
- This package has production users: any stored-state / API / serialized shape is
  **additive-only** (no renames, no type changes, no reordering) — flag violations instead of
  writing them as plan items.
- Every "delete dead code" item embeds its own **re-verify grep** (zero live references) — an
  audit's word alone is not enough.
- Deleting/renaming a file that a doc or rule references → update that doc **in the same
  substep**.
- Every substep assumes `npm test` starts green and requires it green before its commit.
