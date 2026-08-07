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

### ☑ 1.2 · M · ~45m — recover-context v8: handoff rung atop the recovery ladder

- Read: `.claude/commands/recover-context.md:78-210` (Step 2c auto mode + cutoff ladder);
  `.claude/commands/continue.md` (whole file, ~235 lines).
- [x] After prev-sid resolution: if `.claude/hooks/.titles/<prevSid>.handoff.md` exists and its
  timestamp is ≥ the prev transcript's last activity − 3 min, use it as the PRIMARY recovery
  content (skip the transcript deep-read; still cross-check git status/log against it). If the
  transcript clearly postdates it, call it stale: merge it with the normal walk-back.
- [x] Report the source as `VIA=handoff` in the recovery preamble, parallel to the existing
  pointer/title-thread/walk-back labels.
- [x] Mirror the new rung in continue.md's description of the flow (one short paragraph).

**Verify:** grep both command files for `handoff.md` — naming identical; suite green.

**Commit:** `feat(continue): recovery ladder reads the checkpoint handoff first`.

### ☑ 1.3 · S · ~20m — Fleet sync

- Read: `scripts/sync-hook-fleet.js` header comment only (usage flags).
- [x] Confirm no other session is writing job-agent-extension or wifi-app, then run
  `node scripts/sync-hook-fleet.js --write`.
- [x] Commit each fleet repo's synced files separately (its own conventions apply). ⚠ Both fleet
  repos have unrelated uncommitted WIP right now (job-agent-extension is running a live session):
  stage ONLY the paths the actuator reported, by explicit `git -C <repo> add <path>` — never
  `git add -A`, never `git commit -a/-am`.

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
  - Flake worth knowing (hit twice more in 1.2 — expect it): `cli-behavior.test.js` can fail ENOENT copying
    `.titles/<sid>.needle` — a transient terminal-title writes and unlinks inside `findConsoles`
    (`terminal-title.js:1869-1876`), raced by the fixture's tree copy. Re-run; it passed clean.
- 2026-08-07 — 1.2 — DONE (3410d22). recover-context v8 + continue.md v7. The probe sits ABOVE
  the cutoff ladder, not in it — a handoff is a CONTENT source, not a cutoff — but the ladder
  still runs and `CUTOFF_ISO` still prints, because the stale/unreadable-note fallback needs it
  and the transcript is already parsed by then. Freshness = **file mtime** vs `ts[-1] - 180s`,
  deliberately NOT the note's own ISO first line (model-written copy; can be wrong or
  timezone-naive). Deviations from the written substep, all additive: a skip-guard sentence at
  Step 4's top (`recover-context.md:312`), a fresh-handoff variant of the Step 5 confirmation
  (`:404`), and `@version`/`@sideeffect`/`@response` header updates on both commands.
  Pointers for 1.3/1.4 (corrected 2026-08-07 by the verification pass — the child's originals
  were off by 13–23 lines): probe + freshness `recover-context.md:164-179`, print block
  `:221-226`, FRESH/STALE prose bullets `:231-232`, Step 4 guard `:312`; continue.md's mirror
  paragraph `:179-188`. Path spelling is identical in all three files (`token-guard.js:2358`'s
  `handoffPath`) — that was the Verify, plus a live run of the edited Step 2c block against this
  project (prints `VIA=walk-back` with no note present, no `HANDOFF=` line).
  - ⚠️ **Two pre-existing failures, both confirmed at HEAD by stashing this diff** (it touches
    only `.md` + generated docs HTML, so it cannot reach either): (1) `complexity-ratchet` — the
    16 CC≥10 violations 1.1 already recorded; (2) `.claude/hooks/tests/terminal-title-clear-advice.test.cjs:252`
    "writes belonging only to the LIVE topic do not unlock the advisory" — the advisory FIRES
    where the test expects `''` (`"~140k tokens of 1 earlier topic still ride in context…"`),
    i.e. the live-topic gate stopped gating. Reached only via `npm run test:hooks`/`hook-tests`,
    which is LAST in the `&&` chain — every earlier full-suite run aborted at complexity-ratchet
    and never saw it, which is why 1.1 reported "everything else green". Both are separate jobs;
    together they mean **the pre-push guard will block a push** of 1.1–1.4.
  - `contracts.test.js`'s docs ratchet fails on any command-header edit until
    `node .claude/scripts/sync-docs.js` runs — 1.3/1.4 should just run it before committing.
- 2026-08-07 — 1.1+1.2 verification — adversarial deep diff review by a fresh Opus instance
  (Fable quota-constrained; user-approved role swap): VERDICT FIX → fixed in 5e7cd63. The
  token-guard.js half was fully clean (`node --check`, copy pin 17/17, render harness: real sid
  templates correctly, sid-less renders `<sid>`; complexity-ratchet unchanged at the same 16).
  Fixed: (1) MAJOR — fresh-handoff path skipped Step 4 but the downstream "read the temp file"
  imperatives stayed unconditional, and the extract's temp name is fixed and never cleaned, so a
  leftover `recovered-context.json` from an EARLIER recovery would be internalized as memory.
  Carve-outs added: `recover-context.md:399` (Step 5) + `continue.md:192-201` (Step 4). (2)
  MAJOR — the STALE bullet said "ALSO run Step 4" without storing `$SID`/`$FILES_TO_PARSE`
  (only the mutually-exclusive no-handoff bullet stored them) → Step 4's script got a literal
  `'$FILES_TO_PARSE'`; bit direct `/recover-context` only, fixed at `recover-context.md:232`.
  (3) MINOR — ctx.sid threading at the R13b call site was unpinned: dropping the 5th arg renders
  literal `<sid>` (illegal in Windows filenames — every checkpoint write fails) with the whole
  suite green; pinned in `.claude/hooks/tests/token-guard-r13.test.cjs:77-81`. (4) MINOR — 1.2's
  recover-context pointers were stale by 13–23 lines; corrected in place above.
  Notes for 1.3/1.4: a live `Write` to `.claude/hooks/.titles/<sid>.handoff.md` in a fleet repo
  (JAE, interactive) succeeded — the sensitive-path denial that BLOCKED 1.1's headless run does
  not cover the note path, so the feature is writable where it matters. Known blind spot,
  accepted: a note written inside a git worktree is invisible to a main-checkout `/continue`
  (probe searches cwd-relative `.titles` + `~`), which falls back to walk-back correctly.
- 2026-08-07 — 1.3 — DONE. Fleet synced; **no CCA commit** (the actuator writes only into targets,
  so CCA's tree stayed clean — the substep's "CCA only if it touched tracked CCA files" branch).
  Fleet commits: job-agent-extension `2d86822`, wifi-app `075c06c`, both
  `feat(hooks): token-guard restart advisory asks for a checkpoint handoff note — sync-down from
  CCA f209371`. Exactly ONE file moved per repo (`.claude/hooks/token-guard.js`, +25/−3 = 1.1's
  diff); 1.2's changes are `.claude/commands/*.md`, which the manifest does not carry, so nothing
  else was due. Verify green: check mode reports "All present targets in sync", `diff` says
  byte-identical both ways, `node --check` clean on both copies.
  - **Live-session judgement call** (the substep's "confirm no other session is writing"): JAE had
    two live sessions — `1baed7ee` idle, and `20d12ef3` `working|PostToolUse` titled "Checkpoint
    handoff — Run-plan — Finish plan on Opus", i.e. the run-plan orchestrator that spawned THIS
    session. It writes CCA, not JAE. Proceeded on three checks: JAE's `token-guard.js` was clean
    vs its own HEAD (nobody had WIP in it), the actuator writes same-dir-temp + rename (never a
    torn read for the hooks executing it live), and the commit used a **pathspec-limited**
    `git -C <repo> commit -F <msg> -- .claude/hooks/token-guard.js`, which ignores the index
    entirely. Confirmed after: both repos' unrelated WIP lists are byte-identical to before.
    That pathspec form is stronger than the plan's `add <path>` rail — prefer it in future syncs.
  - `sync-docs.js` was NOT needed (1.2's note only applies to command-header edits, and 1.3 edits
    no command file).
  - Suite (run for the standing rail even though 1.3 edits no CCA source): the ENOENT
    `.titles/<sid>.needle` flake the 1.1 entry warned about fired again — this time in
    `box-alignment.test.js` (`cca-box-upgrade-*` fixture copy), NOT cli-behavior, so it is the
    tree-copy race generally rather than one suite. Re-ran clean past it. The re-run then stops
    exactly where 1.1 and 1.2 said it would: 15 suites green ("ALL TESTS PASSED" ×15, box
    alignment included), then `complexity-ratchet.test.js` ✗ "no new complexity violations
    (CC >= 10) beyond the baseline" — **the same 16 functions, unchanged**, and the `&&` chain
    aborts there so the hook suites still never run. 1.3 touched zero CCA source files, so it
    provably added none. Both debts (the ratchet, and 1.2's `terminal-title-clear-advice`
    live-topic-gate failure hiding behind the abort) remain separate jobs, and together still
    mean **the pre-push guard will block a push** of 1.1–1.4.
