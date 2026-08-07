# Checkpoint handoff — lossless /clear + /continue for non-plan work

**Goal:** plans resume losslessly because the Ledger records completion explicitly; everything
else falls back to lossy transcript inference. Close the gap: when token-guard's restart verdict
says a /clear pays, the session first writes a compact **handoff note** (done / in flight / next /
file:line pointers), and /continue's recovery ladder reads that note ahead of transcript walk-back.

**Evidence:** 2026-08-07 session (JAE, run-plan live test): restartVerdict already prices clearing
against the measured cold-start floor (the WHEN exists); the WHAT-SURVIVES only exists for plans.

**How to execute:** one substep per fresh session — read ONLY the ⛔ trap section (lines 15–33),
your own substep, and the Ledger tail; never this whole file. Run the substep's Verify commands,
commit, append a Ledger entry, tick the checkbox, then `/clear` + `/continue`.

## ⛔ Standing trap warnings

- **token-guard.js is ~4,060 lines** (`.claude/hooks/token-guard.js`): Grep-then-Read-window
  ONLY, never opened whole.
- **CANONICAL-FIRST**: edit CCA's copy, then `node scripts/sync-hook-fleet.js --write` to fleet
  repos (job-agent-extension, wifi-app). Never hand-edit a fleet copy — the next sync clobbers it.
- **token-guard.js has concurrent writers**: before editing, confirm no other live CCA session is
  mid-edit (check `.claude/hooks/.titles/` mtimes). A partial clobber passes `node --check` but
  throws at runtime.
- **Warning-copy discipline**: tokens not chars; every number needs its threshold; the copy is
  pinned by `test/token-guard-copy.test.js` — update the pin together with the copy.
- **recover-context.md / continue.md are prose commands** executed by the model — changes there
  are doc edits, and continue.md DELEGATES to recover-context.md: keep them consistent in the
  same substep.
- **Fleet sync (substep 1.3) writes into other repos.** job-agent-extension runs parallel
  sessions — sync only when no other session is writing those checkouts, and commit each fleet
  repo separately per its own conventions.
- Full CCA test suite green before every commit (pre-push re-runs it; allow 8–10 min on push).

## Phase 1 — checkpoint handoff

### ☑ 1.1 · M · ~45m — Handoff format + writer instruction in the restart advisory

- Read: `.claude/hooks/token-guard.js:2200-2340` (restartVerdict/restartBullet) and call sites
  `:3170-3230`, `:3300-3320`; `test/token-guard-copy.test.js` (grep for `restartBullet`).
- [x] Define the handoff file: `.claude/hooks/.titles/<sid>.handoff.md` — first line an ISO
  timestamp, then `## Done`, `## In flight`, `## Next`, `## Pointers` (file:line list). Document
  the format in a short comment beside restartBullet — no new module needed.
- [x] Extend restartBullet's restart-pays copy with ONE line instructing the session: before
  /clear, write the handoff note to that path (templated with the live sid).
- [x] Update the `test/token-guard-copy.test.js` pin for the new copy.

**Verify:** `node --check .claude/hooks/token-guard.js` and the full CCA suite green.

**Commit:** `feat(token-guard): restart advisory asks for a checkpoint handoff note`.

### ☐ 1.2 · M · ~45m — recover-context v8: handoff rung atop the recovery ladder

- Read: `.claude/commands/recover-context.md:78-210` (Step 2c auto mode + cutoff ladder);
  `.claude/commands/continue.md` (whole file, ~235 lines).
- [ ] After prev-sid resolution: if `.claude/hooks/.titles/<prevSid>.handoff.md` exists and its
  timestamp is ≥ the prev transcript's last activity − 3 min, use it as the PRIMARY recovery
  content (skip the transcript deep-read; still cross-check git status/log against it). If the
  transcript clearly postdates it, call it stale: merge it with the normal walk-back.
- [ ] Report the source as `VIA=handoff` in the recovery preamble, parallel to the existing
  pointer/title-thread/walk-back labels.
- [ ] Mirror the new rung in continue.md's description of the flow (one short paragraph).

**Verify:** grep both command files for `handoff.md` — naming identical; suite green.

**Commit:** `feat(continue): recovery ladder reads the checkpoint handoff first`.

### ☐ 1.3 · S · ~20m — Fleet sync

- Read: `scripts/sync-hook-fleet.js` header comment only (usage flags).
- [ ] Confirm no other session is writing job-agent-extension or wifi-app, then run
  `node scripts/sync-hook-fleet.js --write`.
- [ ] Commit each fleet repo's synced files separately (its own conventions apply).

**Verify:** canonical vs fleet copies byte-identical (the sync script's own report, or `diff`).

**Commit:** CCA only if the actuator touched tracked CCA files; otherwise fleet-repo commits.

### ☐ 1.4 · S · ~20m — Fixture smoke: handoff beats walk-back

- Read: this doc's 1.2 substep for the staleness rule.
- [ ] In a scratch project, seed `.claude/hooks/.titles/` with a fake prev sid: a lineage file
  naming it, plus a fresh `<prevSid>.handoff.md` with distinctive Done/Next content.
- [ ] Run a headless `claude -p "/continue"` in that project; assert the output resumes from the
  handoff's content and reports `VIA=handoff` — not walk-back.
- [ ] Append the result (pass or the exact miss) to this Ledger.

**Verify:** the headless output contains the handoff's distinctive Next item.

**Commit:** none (fixture is scratch); Ledger entry is the record.

## Deferred

- **/checkpoint manual command** (write a handoff on demand, no advisory) — add only if the
  advisory-driven path proves out in real use.
- **Handoff retention/cleanup** (consumed-flag or age-based deletion) — revisit once volume exists.
- **npm publish** — batch with CCA's next scheduled publish, not this plan.

## Ledger

<!-- appended after each substep: date — step — outcome (+ commit hash), deviations, pointers -->

- 2026-08-07 — 1.1 — BLOCKED: no code landed; working tree left clean. The runner spawned this
  session with run-plan.js's default `--permission-mode acceptEdits`, which still auto-denies
  writes to sensitive paths — every Edit to `.claude/hooks/token-guard.js` came back "sensitive
  file", and `-p` mode has nobody to approve. All four substeps edit that file: relaunch with
  `node scripts/run-plan.js docs/checkpoint-handoff-plan.md --dangerous` (the unattended flag).
  Analysis is done; prepared edits for the next session: (a) `handoffPath` helper + short format
  comment above `restartBullet`, and an optional 5th param `sid` on it (token-guard.js:2342-2344);
  (b) extend the `rv.clear` branch copy (:2360-2362) with one sentence — before /clear, write the
  handoff note to `handoffPath(sid)` (ISO-timestamp first line, then ## Done / ## In flight /
  ## Next / ## Pointers with file:line) so /continue reads it ahead of transcript walk-back;
  (c) pass `ctx.sid` at the R13b call site (:3194); (d) new pin in test/token-guard-copy.test.js
  (after the floor-quoted-once test): clear branch carries the sid-templated path + the four
  sections, sid-less callers render the `<sid>` placeholder, not-fat branch stays handoff-free.
- 2026-08-07 — 1.1 — DONE (f209371). Landed exactly the prepared (a)–(d) above; `handoffPath`
  is also exported (token-guard.js:4070) so 1.2/1.4 can name the path from one place instead of
  re-spelling it. Pointers for later substeps: `handoffPath` + format comment
  `token-guard.js:2344-2358`, the ask itself in restartBullet's `rv.clear` branch `:2376-2383`,
  R13b call site `:3215`, pin `test/token-guard-copy.test.js:210-235`. Rendered ask reads:
  "Before /clear, write it to .claude/hooks/.titles/<sid>.handoff.md — an ISO timestamp, then
  ## Done / ## In flight / ## Next / ## Pointers (file:line) — so /continue reads that instead
  of guessing from the transcript." 1.2 must match THAT wording, not the plan's paraphrase.
  - ⚠️ **The suite does NOT start green at HEAD** (contra the plan's rail), and 1.2–1.4 will hit
    the same wall: `test/complexity-ratchet.test.js` reports 16 new CC≥10 violations beyond the
    baseline, in `claim-registry.js`, `terminal-title.js`, `token-guard-liveness.js` and
    `token-guard.js`. Verified pre-existing: stashing this substep's diff and re-running gives a
    byte-identical 16-item list, so nothing here added one. Baseline last touched 034d0e6
    (2026-08-05); commits since grew complexity without extracting. Everything else is green
    (token-guard-copy 17/17 incl. the new pin, cli-behavior 59/59, `node --check` clean).
    Consequence: **the dev-box pre-push guard will block a push** until that debt is cleared —
    it is a separate job from this plan, and it is not a licence to regrow the shrink-only
    baseline.
  - Flake worth knowing: `cli-behavior.test.js` can fail ENOENT copying
    `.titles/<sid>.needle` — a transient terminal-title writes and unlinks inside `findConsoles`
    (`terminal-title.js:1869-1876`), raced by the fixture's tree copy. Re-run; it passed clean.
