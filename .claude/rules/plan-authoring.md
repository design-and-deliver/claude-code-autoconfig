# Plan authoring rules

Any multi-session remediation/feature plan written in this repo (e.g. by /up-to-snuff) follows
this structure. The plan is a self-contained doc a fresh session can execute with zero prior
conversation context.

**This file is CANONICAL.** Sibling repos (job-agent-extension, etc.) keep a copy at
`.claude/rules/plan-authoring.md` — edit this one, then port. The two copies drifted apart
between 2026-06 and 2026-07-25 and neither was a superset; don't let that happen again.

## Where plans live

`docs/*.md` (tracked — Ledger history rides in git) or `.claude/plans/*.md` (local working
plans; gitignored in this repo). Tooling that discovers plans (/continue's plan probe,
/plan-progress) must scan BOTH directories. A gitignored plan's Ledger-only "commit" steps
are no-ops — there the Ledger entry itself is the durable record, so skip those commits.

## Structure

1. **Header**: goal, links to source audits/evidence, and "how to execute" (one substep per
   fresh session; Verify; commit; Ledger entry; then `/clear` + `/continue` — /continue is
   plan-aware: it detects the plan-substep session via the title history, reads the Ledger,
   verifies the last commit hash against git, and resumes at the next unchecked substep.
   Fallback where /continue is absent: start a fresh session pointed at the plan doc).
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

   | Size | Shape | Read budget | Rough time |
   |------|-------|-------------|-----------|
   | **S** | one file, mechanical, no new tests, no trap surface | < 300 lines | ~10–20 min |
   | **M** | a few files or one new test; bounded logic | < 800 lines | ~30–60 min |
   | **L** | new test suite(s), several coordinated edits, **or** any edit inside a ⛔ trap surface | < 2,000 lines | 1–2 hr |

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

## Why the session boundary is the lever

Token cost ≈ **resident context × turns**. Finer numbering executed back-to-back in one session
saves nothing — the same files stay resident, they just get more headings. What actually cuts
cost is the `/clear`: it drops the resident set to zero and sheds any bombs (large one-shot
dumps) the session accumulated. So size substeps by *what one window can hold*, not by outline
tidiness, and never merge two substeps "since they're both small."

## Read budget (size a step by what it must OPEN, not just what it must write)

The most common way a "session-sized" substep blows past a window is reading, not writing —
one 5,000-line god file costs ~70k tokens on turn one and stays resident for every turn after,
and an edit invalidates the read so it often gets paid twice.

- **Every substep names its Read list** — exact files and line ranges (`modal.tsx:3459-3485`),
  not "the modal". If the plan authored the pointers during discovery, it already knows them;
  writing them down is what converts that spend into savings for the executing session.
- **Whole-file reads only under ~800 lines.** Above that: Grep to locate, then Read a window
  around the hit. State the big files by name in the ⛔ trap section — e.g. *`background.ts`
  (4,581 lines) is Grep-then-Read-window only, never opened whole.*
- **The Read list is part of the size tag** (see the table above). A substep whose Read list
  totals more than ~2,000 lines sizes XL by definition — and there is no XL. Split it.
- **Extract before you edit.** If a substep needs new logic to live inside a god file, write
  that logic as a **pure module in an EARLIER substep**, unit-tested there against its own
  small surface. The god-file substep then shrinks to a call site plus wiring — a thin diff
  instead of a design session inside 5,000 lines. This is the single biggest lever on plans
  that touch god files, so bake it into the phase order rather than leaving it to the executor.
- **Bulk output goes to files.** Probes, subagent discovery, API captures: write full results to
  a file (fixtures dir, scratchpad) and surface only a short key summary. The plan references
  the path; it never inlines the report, and the executing session never prints raw JSON.

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
