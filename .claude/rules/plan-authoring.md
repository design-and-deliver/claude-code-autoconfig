# Plan authoring rules

Any multi-session remediation/feature plan written in this repo (e.g. by /up-to-snuff) follows
this structure. The plan is a self-contained doc a fresh session can execute with zero prior
conversation context.

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
   a commit point (subject + `Changelog:` trailer per CLAUDE.md's changelog rules).
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
