<!-- @description Show progress of the in-flight plan doc(s) in this project — an effort-weighted dashboard of phases and substeps, completed steps struck through, the current step highlighted, with % done and time remaining. -->
<!-- @version 1 -->
<!-- @response success | Renders one dashboard per detected plan: title, effort-weighted %, done/total substeps, ~time left, next step, then phases with struck-through done substeps and a highlighted current step. -->
<!-- @response none | No plan docs found — reports that and how to make a plan trackable. -->
<!-- @sideeffect Read-only. Runs a deterministic parser over .md files in docs/, .claude/plans/, and the repo root; writes nothing. -->
<!-- @example /plan-progress | Show where every in-flight plan in this project stands -->

# Plan Progress

Show, at a glance, where the project's phased plan doc(s) stand — the read-only twin of
`/continue`. `/continue` *runs* the next unchecked substep; this just *shows* the map, cheaply,
without spending tokens on execution.

It reads the plan-authoring format (`.claude/rules/plan-authoring.md`): phases
(`## Phase N — title`), substeps (`### ☑|☐ N.k · S|M|L · ~time — title`), and a `## Ledger`
that marks a doc as an executable plan rather than a design doc. Because the effort tags carry
time estimates, the percentage is **effort-weighted**, not a naive substep count.

## Step 1: run the deterministic digest

All parsing and arithmetic is done by a pure-node script — no LLM math:

```bash
node .claude/scripts/plan-progress.js
```

It scans `docs/`, `.claude/plans/`, and the repo root for `## Ledger` plan docs, and prints
ready-to-show Markdown (one dashboard per plan, in-progress plans first).

## Step 2: present the output

Show the script's Markdown output **as-is** — it already renders the way it should: strikethrough
on completed substeps, a bold `▶ … ← you are here` on the current step, a `▓▓▓░░` bar with the
percent, `done/total` substeps, and `~time left`. The view is the value; don't rewrite it into a
paragraph.

You may add **one** short line of read after it if there's something genuinely useful to flag —
e.g. the current step's size ("next up is a ~45m M step") or that a plan just crossed a phase
boundary. Keep it to a sentence; skip it if there's nothing to add.

## Step 3: the empty case

If the script prints "No plan docs found here.", relay that plainly and pass along its hint (a
plan becomes trackable once it has a `## Ledger` section and `### ☐ N.k · S|M|L · ~time — title`
substeps — the format `/up-to-snuff` produces). Don't invent progress for work that has no plan
doc.

Notes:
- If the script reports a **count-based** percentage (no effort tags found) or that some substeps
  carry no effort tag, that's expected for loosely-formatted plans — the percent falls back to a
  substep count. Mention it only if the user seems to expect time-weighting.
- Never edit the plan doc from this command — it's read-only. To *advance* a plan, that's
  `/continue`.
