# /continue subagent recovery — plan

**Alias:** Continue subagent · **Branch:** `plan/continue-subagent` · **Model floor:** Sonnet-class
(substep 1.1 is tagged `[opus]` — run it on an Opus/Fable-class session).

**Goal:** stop paying main-model prices for /continue's mechanical recovery. The v17 fix
(commit `40fb324`) made the cost VISIBLE — the dead `model:` pin is gone and the probe's
`currentModel` field warns when recovery runs expensive. This plan makes it CHEAP, via the one
lever measured to work: **subagent model overrides ARE honored** (session `d6f29f78`: a
`claude-fable-5` parent spawned subagents served by `claude-haiku-4-5` and `claude-opus-5`),
where command `model:` frontmatter is ignored (anthropics/claude-code#45191, closed).

**Motivation math (estimate — 1.2 validates or kills it):** inline recovery on an Opus session
≈ 8–15 round trips × ~70–84k resident context ≈ 0.6–1.3M expensive tokens. Delegated: 2–3 main
round trips + the subagent's own loop at Sonnet prices — roughly half the cost or better. If
1.2's measured delta is not clearly positive, record that in the Ledger and abandon: v17's
visibility already shipped and stands on its own.

**How to execute:** one substep per fresh session, on branch `plan/continue-subagent`, in a
worktree named `continue-subagent` (`EnterWorktree` → `node scripts/bootstrap-worktree.js`).
Read this doc in slices — the ⛔ Standing traps section (lines 27–48), your own substep, and
the Ledger tail — never whole. Refresh from `main` at each substep boundary; merge to `main`
ONCE, after 1.2's verdict. After each substep: Verify, commit, append a Ledger entry, then
`/clear` + `/continue`. Abandoning is one `git branch -D` at any point;
`git log main..plan/continue-subagent` is the whole reviewable delta.

## ⛔ Standing traps

- **`continue.md` and `recover-session.py` ship to users AND are fleet-synced.** Every edit
  needs: `<!-- @version N -->` bump, a user-facing `Changelog:` trailer (they are NOT
  dev-gated — absent from `DEV_ONLY_FILES` and the package.json negations), a
  `node .claude/scripts/sync-docs.js` run (`.claude/docs/autoconfig.docs.html` is generated —
  never hand-edit), and — post-merge only, from the main checkout — `node
  scripts/sync-hook-fleet.js --write` + commits in the adopting repos, or the dev-box pre-push
  guard blocks the next push (it did exactly this on 2026-08-24).
- **Never reintroduce `model:` frontmatter or any system-prompt self-report.** The harness
  stamps an ignored pin into the system prompt text while routing to the session model, so the
  prompt lies about the model under a pin (session `90eb56c6`: prompt said Sonnet, all 44
  requests billed Opus). The probe's `currentModel` (transcript `message.model`) is the only
  honest source.
- **The stop-at-report contract is load-bearing.** The recovery turn ends on a plain-text
  go-ahead question — never an AskUserQuestion picker, and never work started off the
  subagent's return in the same turn. Delegation must not erode this.
- **The plan-aware `siblingGate: STOP` verdict must survive delegation** — the subagent
  relays it in its report; the main model stands down and asks, exactly as v17 Step 3 does.
- **No god files.** `continue.md` is 281 lines (whole-read fine); `recover-session.py` is
  810 — Grep-then-window only.

## Phase 1 — Delegate the mechanical recovery

### ☐ 1.1 · M · ~45m — [opus] Rework /continue into adaptive subagent delegation (v18)

Read list: `continue.md:1-281` (whole), `recover-session.py:660-810` (output assembly,
Grep-window), this doc:24-48 + this substep.

Design — decided here, not open to the executor:

- **Adaptive branch, decided from the inline probe.** Step 1 (the probe Bash call) stays
  inline and main-turn — it is one round trip and yields `currentModel`. Then:
  - `currentModel` is Sonnet/Haiku-class → recover inline, exactly the v17 path (no
    delegation overhead when the session is already cheap).
  - `handoffState: FRESH` → inline (the checkpoint note is tiny; a subagent cold start
    costs more than it saves).
  - Agent tool unavailable (restricted toolsets, older installs) → inline.
  - Otherwise → delegate Steps 2–3 to a subagent: Agent tool, `model: "sonnet"`,
    `run_in_background: false`, prompt = the delegation template with the probe JSON
    embedded verbatim.
- **The v17 inline path stays in the doc, intact, as the fallback** — delegation is a
  routing layer above it, not a replacement. A null/malformed subagent return falls back to
  inline recovery.
- **Subagent report contract** (the subagent's final text is exactly one JSON object):
  `flavor` (`checkpoint | ordinary | plan-clean | plan-midflight | plan-overtaken |
  plan-aborted | sibling-stop`), `headline` (the em-dash clause for the opening line),
  `done[]`, `inFlight`, `nextAction`, `planInfo` (alias, lastSubstep, hash, nextSubstep —
  null when not plan-driven), `warnings[]` (stopReason, size-cap, sibling details),
  `tempFile`, `tempFileWorthReading` (bool — the subagent's judgment whether the "go" turn
  should Read the raw tail before resuming).
- **Main-turn duties never delegate:** Step 0 announce, terminal title write, the Step 4/5
  report rendering (from the contract fields), the expensive-model warning line, the ask
  flag, ending on the plain-text question.
- **Fidelity valve:** on the user's "go", if `tempFileWorthReading`, the main model Reads
  `tempFile` (≤3k tokens by the extract cap) before resuming — full fidelity, paid only
  when needed.

Microsteps:

- [ ] Write the delegation branch + conditions into `continue.md` (new Step 1.5), keeping
      Steps 2–5 as the inline path and marking them as such
- [ ] Write the delegation prompt template (probe JSON placeholder, Steps 2–3 procedure,
      report contract, sibling-stop/abort handling) as a fenced block in `continue.md`
- [ ] Write the report-rendering rules: map contract fields onto the existing Step 4/5
      wording; warnings relay; fallback-to-inline rule
- [ ] Bump to v18, update `@description` and the frontmatter description
- [ ] `node .claude/scripts/sync-docs.js`

Verify: `npm test` green; `grep -c "model:" .claude/commands/continue.md` shows no
frontmatter pin; docs html regenerated (git shows it modified, no stale "v17").
Commit: `feat(continue): delegate recovery to a cheap subagent on expensive sessions` +
user-facing `Changelog:` trailer. Ledger entry.

### ☐ 1.2 · S · ~20m — Live cost trial, verdict, and landing

Read list: this doc's traps + this substep + Ledger tail only.

- [ ] In the worktree, run `/continue` in a fresh Opus/Fable-class session (delegated path)
      and a fresh Sonnet session (inline path); confirm the delegated report matches
      Step 4/5 shape and the go-turn resumes correctly
- [ ] `token-guard.js --analyze <sid>` on both sessions; record both digests' effective
      spend in the Ledger next to a pre-change baseline (any recent inline /continue on an
      expensive session, e.g. `90eb56c6`)
- [ ] Verdict in the Ledger: keep (delta clearly positive) or abandon (`git branch -D`,
      one line saying why)

On keep: merge `plan/continue-subagent` → `main` from the main checkout (clean merge lands
without asking), then `node scripts/sync-hook-fleet.js --write`, commit the adopting repos,
`git push origin main`. Verify: fleet check green, push accepted. Ledger entry closes the plan.

## Deferred

- **Delegating `/recover-context` and `/migrate-new-session` the same way** — same shape,
  but wait for 1.2's measured numbers before spreading the pattern.
- **Auto-switching the session model** (`/model` from inside the command) — not scriptable;
  the v17 warning line already tells the user the manual move.
- **Writing the subagent's report to a file for the go-turn** — `tempFile` already serves
  the fidelity valve; a second artifact is bookkeeping without benefit.
- **Haiku instead of Sonnet for the subagent** — recovery includes plan reconciliation and
  judgment calls (overtaken vs mid-flight); Sonnet-class is the floor v17 already names.

## Ledger

- 2026-08-24 — plan authored (session 1c5cf231, follows commit `40fb324`). No substeps run.
  Branch not yet created — the 1.1 session creates it. Evidence pointers: dead-pin
  measurement and the system-prompt lie are documented in `continue.md` v17 + the 40fb324
  commit body; subagent-override evidence is session `d6f29f78`.
