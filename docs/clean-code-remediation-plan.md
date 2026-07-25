# Clean-code remediation plan

**Goal:** work off the 2026-07-24 full-repo code review (four parallel reviewers + an ESLint
complexity census: 67 functions at CC ≥ 10, four files over the repo's own 500-LOC rule) without
breaking the conventions this package's production users depend on.

**Sources:** `ARTICLES/what-the-code-quality-haters-would-knock.html` (the review),
`ARTICLES/first-pass-fixes-what-landed-and-what-waits.html` (the executed first pass),
plus the census data embedded in the review page. The first pass (2026-07-24, see Ledger)
already landed the safe bug/lie/privacy fixes with new regression suites.
`ARTICLES/cyclomatic-complexity-report.html` (2026-07-24 evening re-census, top-10 table)
drove the Phase 3 acceptance bar and substeps 3.6–3.10.

**How to execute:** one substep per fresh session. Read the ⛔ traps below before ANY item.
Each substep: make it green (`npm test` before and after), run its **Verify** commands, commit
with a `Changelog:` trailer (dev-gated work → `Changelog: none`), append a Ledger entry, then
`/clear` + `/continue` (plan-aware; resumes at the next unchecked substep).

---

## ⛔ Standing trap warnings — read before ANY item

- **`.claude/hooks/terminal-title.js` is the fleet-synced canonical.** Edit only this copy, then
  `node scripts/sync-terminal-title.js --write`. It must stay a SINGLE standalone file — hooks
  are copied file-by-file into user projects and to `~/.claude`; a multi-file split breaks
  deployment. Same constraint for every `.claude/hooks/*.js`.
- **token-guard's `--analyze` digest wording is a machine interface** ("live context at end",
  RENT/BOMBS/FLEETS/TTL headers) and the `.titles/{sid}.history.jsonl` ledger field names
  (`ts`, `title`, `tokens`) are read by `/analyze-session` and `/migrate-new-session`. Never
  rename either side.
- **Tests parse `bin/cli.js` literals by regex** (`DEV_ONLY_FILES` etc. must stay one-line,
  single-quoted) until substep 2.1 replaces them. Until then, any cli.js refactor that moves
  those literals breaks the suite — and that is the tests' fault, not a license to reformat.
- **Stored-state / serialized shapes are additive-only** (plugins ledger, settings.json,
  recover.json, update markers). No renames, no type changes, no reordering.
- **Hooks fail silent by design** (swallow + exit 0). "It didn't error" proves nothing — run
  `npm test` (the hook suites only run there) after every hook edit.
- **Generated files:** `CHANGELOG.md` and `.claude/docs/autoconfig.docs.html` are rebuilt by
  scripts; never hand-edit. Any change under `.claude/` needs `node .claude/scripts/sync-docs.js`
  + committing the regenerated docs (the ratchet test enforces byte-parity).
- **`test/golden-endings.json` and `.claude/updates/` numbering are append-only.**
- **The 3-rule eslint floor is a documented decision** (weak-model plan substep 2.6). Substep 2.3
  below must reconcile with it explicitly, not silently override it.

---

## Phase 1 — finish stopping the repo from lying (cheap, no product logic)

### ☑ 1.0 · M · ~60m — First pass (DONE 2026-07-24, see Ledger)

Bug/honesty/privacy fixes + 3 new regression suites. Details in the Ledger entry.

### ☑ 1.1 · M · ~45m — Retire the mothballed R11 block from token-guard

- [x] Verify the R11 dispatch is still commented out and `resolveMarker` / `clearMarker` /
      `onSessionStart` / `migrateReceipt` / `writeMigrateCandidate` have no live callers
      (grep each name across the repo INCLUDING `.claude/commands/*.md` prose — a command
      file may instruct Claude to call one).
- [x] Delete the retired block and its exports; git history is the museum (the banner
      already names the retirement date).
- [x] Re-run the hook suites; update the file-header comment.

⚠ Trap: `/migrate-new-session` reads the drift *ledger*, not these functions — confirm, don't
assume. **Verify:** `npm test`; `grep -rn "resolveMarker\|migrateReceipt" --include="*.md" --include="*.js" .claude bin test` returns only the plan/articles.
**Commit:** `refactor(token-guard): delete retired R11 migration block` + `Changelog: none`.

### ☑ 1.2 · M · ~45m — Name token-guard's magic numbers (DONE 2026-07-24, see Ledger)

- [x] One constants block near the top: dust floors (0.02 / 0.001 / 0.005), materiality 0.85,
      cache-read 0.1× / write 1.25× / 2× multipliers, prune caps (unify `131072` vs `256 * 1024`
      — pick one spelling, keep values), `guard++ < 64`, `2e6`, sid-slice 8.
- [x] Values unchanged — this substep renames, never retunes.

**Verify:** `npm test` (hook suites cover the touched paths); `npx eslint .`.
**Commit:** `refactor(token-guard): name the sizing/threshold constants` + `Changelog: none`.

### ☑ 1.3 · S · ~15m — Stop hardcoding the impersonated client version (DONE 2026-07-24, see Ledger)

- [x] `CLAUDE_CODE_UA = 'claude-code/2.1.207'` (token-guard `fetchOfficialUsage`): derive from
      the installed Claude Code version if cheaply discoverable, else keep the pin but add a
      dated comment with the rotation rule and a test that the fetch degrades silently.

**Verify:** `npm test`. **Commit:** `Changelog: none`.

### ☑ 1.4 · M · ~30m — sync-docs escape hardening (DONE 2026-07-24, see Ledger)

- [x] Replace the single-quote-only escapes (`replace(/'/g, "\\'")` sites in
      `generateTreeInfo` / tree HTML) with one `jsEscape` helper that also handles backslash
      and newline; reuse the existing `escapeTemplateLiteral` where it fits.
- [x] Regenerate docs; the ratchet demands byte-parity — with today's inputs the output must
      not change (no current desc contains a backslash; if one does, the regen diff is the fix
      working — commit it with the code).

**Verify:** `node .claude/scripts/sync-docs.js && git diff --stat .claude/docs` then `npm test`.
**Commit:** `fix(sync-docs): escape backslashes/newlines in generated JS strings` + `Changelog: none`.

---

## Phase 2 — make wrong edits fail loudly (unblocks Phase 3)

### ☑ 2.1 · L · ~2h — Replace the 44 source-grep assertions with behavior (split a/b/c)

The single highest-leverage item: `test/cli-install.test.js` asserts literal source strings
("pass VACUOUSLY" per `cli-behavior.test.js:7-9`), which both misses real breakage and blocks
every cli.js refactor. Pattern to copy: `cli-behavior.test.js` (drives the real binary against
temp fixtures).

- [x] 2.1a — copy/force semantics: behavioral tests for fresh install vs `--force` overwrite
      vs preserve-user-edits, per file class. (DONE 2026-07-24, see Ledger)
- [x] 2.1b — upgrade vs first-install flows (version marker, `/autoconfig-update` vs
      `/autoconfig` messaging) as behavior. (DONE 2026-07-24, see Ledger)
- [x] 2.1c — delete each grep assertion ONLY as its behavioral replacement lands (map them
      1:1 in the commit message); keep the DEV_ONLY_FILES literal-parsing helpers — those are
      a data contract (contracts.test.js), not vacuous. (DONE 2026-07-24, see Ledger)

**Verify:** `npm test`; then mutation-check one behavior per cluster (e.g. flip `copyDirIfMissing`
to `copyDir` locally → the new tests must fail; revert).
**Commit:** per sub-item, `test(cli): replace source-grep assertions with behavior — <cluster>` + `Changelog: none`.

### ☑ 2.2 · M · ~60m — One shared test harness for `test/*.js` (DONE 2026-07-24, see Ledger)

- [x] Extract `test/_harness.js` (`test`, `assert`, counters, exit summary, `runCli`) and
      migrate the 12 copy-pasted harnesses to it. Keep the `node --test` hook suites as-is
      (their runner bridge is fine) — document that the repo has exactly TWO frameworks on
      purpose: one for CLI suites, `node:test` for hooks.

**Verify:** `npm test` (same pass counts per suite as before the migration).
**Commit:** `test: extract the shared harness` + `Changelog: none`.

### ☑ 2.3 · M · ~45m — Complexity ratchet (reconcile with the 3-rule lint decision) (DONE 2026-07-24, see Ledger)

- [x] Decision first (record in this plan's Ledger): the 3-rule eslint floor is documented as
      deliberate. The ratchet that fits that philosophy is NOT a style rule but a no-growth
      gate: a test that runs eslint's `complexity` rule programmatically and asserts the
      violation count/set does not GROW past the checked-in baseline (67 as of 2026-07-24).
- [x] Add `test/complexity-ratchet.test.js` + `test/complexity-baseline.json`; shrinking the
      baseline is allowed and updates the file in the same commit.

**Verify:** `npm test`; add a scratch function with CC 12 → suite must fail; remove it.
**Commit:** `test: complexity no-growth ratchet` + `Changelog: none`.

### ☑ 2.4 · S · ~20m — Coverage visibility (c8, no thresholds yet) (DONE 2026-07-24, see Ledger)

- [x] `npm i -D c8`, `npm run coverage` script wrapping the existing chain; record the
      baseline number in the Ledger. No gating yet — visibility first.

**Verify:** `npm run coverage` prints a summary; `npm test` unaffected.
**Commit:** `chore: add c8 coverage script` + `Changelog: none`.

### ☑ 2.5 · M · ~45m — Tests for plan-progress (the last untested script with logic) (DONE 2026-07-24, see Ledger)

- [x] Characterization tests for `parsePlan` / `render` against fixture plan docs (this file
      is a natural fixture: effort tags, microsteps, Ledger).

**Verify:** `npm test`. **Commit:** `test(plan-progress): characterization suite` + `Changelog: none`.

---

## Phase 3 — shrink the god files (each substep shippable; order matters)

**Acceptance bar for every complexity substep (3.3–3.10):** the substep's target function(s)
AND every helper extracted from them end at **CC ≤ 9**, measured by
`npx eslint --no-config-lookup --rule '{"complexity":["warn",9]}' <file>` — zero hits for the
touched functions. If the first cut leaves a piece ≥ 10, split that piece further — a
"decomposed" function still over the repo's own limit does not close its box. Once 2.3 lands,
the ratchet baseline must SHRINK by exactly the substep's cleared violations in the same
commit. Behavior stays frozen: byte-identical outputs wherever a Verify says so.

### ☐ 3.1 · L · ~2h — cli.js grows a `main()` (after 2.1 — not before)

- [ ] Wrap the require-time flow in `function main()` + `if (require.main === module) main();`
      with NO other change; the literals the contract tests parse stay put.
- [ ] Delete the two "cannot require cli.js back" apology comments (plugins.js,
      update-summary.js) once requiring is safe, replacing the `deps` injection only if
      trivially safe — otherwise leave `deps` and note it.

⚠ Trap: module-scope mutable variables become function-scope — verify no helper defined
outside `main()` closes over them. **Verify:** `npm test` (post-2.1 suites are behavioral);
`node bin/cli.js --help`-equivalent smoke in a temp dir; `require('./bin/cli.js')` in `node -e`
must now be side-effect-free.
**Commit:** `refactor(cli): move the install flow into main()` + `Changelog: none`.

### ☐ 3.2 · M · ~60m — cli.js: one `copyTree`, one `boxLine`, one color helper

- [ ] Collapse `copyDirForBackup` / `copyDir` / `copyDirIfMissing` + the inline docs-copy
      loop into `copyTree(src, dest, {filter, overwrite})`.
- [ ] `boxLine(text)` (padEnd-based) replaces hand-counted box spaces; box tests keep passing
      unchanged (they assert rendered width, which is the point).
- [ ] `paint(color, text)` helper for the 61 raw ANSI literals in cli.js.

**Verify:** `npm test` (box + install suites); visual smoke of the READY box in a temp dir.
**Commit:** `refactor(cli): copyTree/boxLine/paint helpers` + `Changelog: none`.

### ☐ 3.3 · L · ~6h — token-guard: decompose the three worst handlers in place (~2h per sub-item)

Single-file constraint stands (hook deployment); the split is INTO per-rule functions within
the file, anchored on the pure verdict functions that already exist.

- [ ] 3.3a — `onUserPromptSubmit` (CC 89, 2026-07-24 re-census): one `r<N>...Guard(ctx)`
      function per rule (R8, R9, meter, R2, R3, R4, fat-context, R6, R12a, R12b, spend-step),
      each returning `{notes, block}`; the handler becomes a fold over them. Digest wording
      byte-identical.
- [ ] 3.3b — `onPreToolUse` (CC 44, 2026-07-24 re-census): same shape.
- [ ] 3.3c — `analyzeSession` (CC 52): extract the per-concern accumulators; dedupe the
      region-attribution logic it shares with `attributeJump` into one helper.

**Verify:** `npm test` after EACH sub-item (206 hook tests as of substep 1.3); `--analyze`
output on a real transcript diffed byte-for-byte against pre-refactor output; the Phase 3
CC ≤ 9 bar on each cleared function + its helpers.
**Commit:** one per sub-item + `Changelog: none`.

### ☐ 3.4 · L · ~2h — terminal-title: explicit event dispatch + handle() split

⚠ Highest-trap substep: fleet-synced file, cross-process sidecar protocol.

- [ ] First, the safety fix from the review: `handle()`'s fall-through treats ANY unknown
      event as Stop — add an explicit `event === 'Stop'` guard (unknown events exit quietly)
      with a hook-suite test.
- [ ] Then split `handle()` (CC 97 — the repo's worst) into `onUserPromptSubmit` /
      `onPostToolUse` / `onNotification` / `onStop` functions in-file; each resulting handler
      + its helpers must meet the Phase 3 CC ≤ 9 bar — a 97 split four ways can still leave a
      25, so expect per-event helper extraction too. `turnWatch()` waits for 3.6.
- [ ] `node scripts/sync-terminal-title.js --write` after; live-twin parity green.

**Verify:** `npm test`; `node scripts/sync-terminal-title.js` (check mode, zero drift);
the Phase 3 CC ≤ 9 bar on `handle`'s replacements;
manual smoke: one prompt in a scratch session paints working→idle correctly.
**Commit:** `fix(terminal-title): explicit Stop dispatch; split handle()` +
`Changelog: More reliable terminal tab status updates`.

### ☐ 3.5 · M · ~60m — settings-merge: per-domain split

- [ ] `mergeSettingsInto` / `unmergeSettingsFrom` (CC 30 each) → `mergeEnv/mergeHooks/
      mergePermissions` + unmerge twins; the `added`-delta contract (BH-1) is byte-frozen —
      plugin-system suite is the guard.

**Verify:** `npm test` (plugin suite incl. the 2026-07-24 corrupt-settings tests).
**Commit:** `refactor(settings-merge): per-domain helpers` + `Changelog: none`.

### ☐ 3.6 · L · ~2h — terminal-title: decompose turnWatch (CC 79)

⚠ Same trap surface as 3.4 (fleet-synced single file, cross-process sidecar protocol) —
execute right after it, while that session's traps are fresh.

- [ ] First seam is free: the grace+recheck+rescue tail is DUPLICATED verbatim today
      (~1329–1335 ≈ ~1354–1360) — extract one `confirmStallAndRescue(...)`.
- [ ] Extract per-verdict handlers out of the probe dispatch: `classifyProbeEligibility`,
      `handleDeadStreak`, `handleCpuQuiet`, plus the debug-gated console-title readback.
- [ ] Byte-frozen strings: glyph-file tokens (`working` / `idle` / the awaiting token — must
      stay byte-identical to the real Notification paint), watch-log note names
      (`watch-start`, `watch-exit`, `dialog-flip`, `int-rescue` — `audit-titles` /
      `show-title-history` parse them), sidecar filenames
      (`.glyph/.watch/.probe/.needle/.found/.cpu/.live/.ask`).
- [ ] `node scripts/sync-terminal-title.js --write`; live-twin parity green.

⚠ The turn-watch E2E (test/terminal-title.test.js) is Windows-only and spawns the real
detached child — run on the dev box; CI green proves nothing here.
**Verify:** `npm test`; check-mode sync (zero drift); the Phase 3 CC ≤ 9 bar.
**Commit:** `refactor(terminal-title): decompose turnWatch` + `Changelog: none`.

### ☐ 3.7 · L · ~2h — token-guard: meter (CC 33) + fanVerdict (CC 31)

- [ ] Test FIRST — `meter` has no direct unit test (coverage today is incidental through the
      event handlers): fixture transcript → exact `perModel` keys (`inp/out/cr/cw/searches/usd`),
      the 5m/1h cache-write TTL split, web-search surcharge, `liveContext` / `turnFloorUSD`.
      Written green on HEAD before touching the function.
- [ ] Extract from `meter`: `collectUsageById` (line scan + last-wins dedupe), `costOfUsage`
      (the pricing fold — `CACHE_READ_X` / `CACHE_WRITE_5M_X` / `CACHE_WRITE_1H_X` stay the
      single source), `deriveLiveFloor`. The returned struct's field names are a contract —
      `meterSession`, `report`, and `renderAnalysis` all read them.
- [ ] Extract from `fanVerdict`: `scanFanConstants` / `detectMultiplicativeFan` /
      `composeCeiling` / `scanLiteralFans` / `tierVerdict`. The returned
      `{level, signals, estimate, ceiling, concrete}` shape and the `block|high|warn` enum are
      pinned by token-guard-fan.test.cjs — keep both.

**Verify:** `npm test` after each function; the Phase 3 CC ≤ 9 bar.
**Commit:** one per function + `Changelog: none`.

### ☐ 3.8 · L · ~90m — token-guard: the --report renderer (CC 32) — test first, it has none

- [ ] Characterization test spawning `--report` on a fixture transcript with `global.fetch` +
      credentials stubbed (reuse the 1.3 pattern in token-guard-official-usage.test.cjs). Pin
      the `ALLOCATION` / `THIS SESSION` / `LAST 5 HOURS` headers and the
      `/analyze-session <sid>` hint format — usage-report.md and analyze-session.md consume
      those literally.
- [ ] Extract `allocationLines` / `sessionLines` / `formatModelRow` / `windowLines` /
      `formatWindowRow`; the dollars-vs-tokens display branch collapses into ONE place.

**Verify:** `npm test`; `--report` on a real transcript diffed byte-for-byte pre/post
(fetch stubbed to the cached allocation so the diff is deterministic); the Phase 3 CC ≤ 9 bar.
**Commit:** `refactor(token-guard): decompose the --report renderer` + `Changelog: none`.

### ☐ 3.9 · M · ~45m — whats-happening: decompose analyze (CC 33)

- [ ] Extract `sliceCurrentTurn` / `buildResultMap` / `buildSteps` / `classifyState`. The
      `state` enum (`running-tool` | `thinking` | `idle-or-done`) and the `--json` object keys
      are the contract — call sites branch on the former, the skill consumes the latter.
- [ ] The 5 CLI characterization tests (test/whats-happening.test.js) pass unchanged.

**Verify:** `npm test`; the Phase 3 CC ≤ 9 bar.
**Commit:** `refactor(whats-happening): decompose analyze` + `Changelog: none`.

### ☐ 3.10 · M · ~45m — plan-progress: decompose render (CC 32) — after 2.5, never before

- [ ] Hard dependency: 2.5's characterization suite is the only safety net this file gets —
      do not start this substep without it landed.
- [ ] Extract `computeProgress` / `renderHeader` / `renderPhase` / `windowDoneSubs` /
      `renderSub` / `renderMicrosteps`. Output is human Markdown (no machine contract); the
      INPUT format (`### ☐ N.k · S|M|L · ~time — title`, `## Ledger`) is `parsePlan`'s
      contract and stays untouched.

**Verify:** `npm test`; the Phase 3 CC ≤ 9 bar.
**Commit:** `refactor(plan-progress): decompose render` + `Changelog: none`.

---

## Deferred — considered, deliberately not planned

- **Shared hook-lib for the stdin/rotation/delay duplication across hooks** — hooks deploy as
  standalone files (copyDir + fleet sync); a require()'d lib breaks that model. Revisit only
  with a build step, which this repo deliberately doesn't have.
- **arcade-beeps grader dedup with terminal-title** — same standalone-file constraint; the
  drift risk is real but accepted. A cheaper alternative (parity test asserting the two QTAIL
  regexes match) can ride along with 3.4 if trivial.
- **TypeScript / `checkJs`** — high churn across 13k LOC for a repo whose contracts are mostly
  runtime JSONL shapes; revisit after Phase 3 shrinks the surfaces.
- **Prettier reformat** — would break sync-docs' exact string markers and destroy blame across
  the whole repo. At most an `.editorconfig` later.
- **Changing exit-0-on-refusal paths in cli.js to exit 1** — visible behavior change for
  production users' scripts; needs an explicit product decision + changelog entry first.
- **Replacing the embedded C# painter (PAINTER_CS)** — works, version-bump protocol documented;
  a rewrite risks the one Win32 capability the repo can't test in CI.
- **Unifying the two test frameworks into one** — 2.2 documents the two-framework split
  instead; `node:test` is right for hooks, the shared harness is right for CLI suites.

---

## Ledger

- **2026-07-24 — 1.0 first pass — DONE.** Commits `27b1dc4` (plugins), `b751fa4` (ccr),
  `23146fd` (gls-downscale), `b570d8d` (whats-happening), `3814be6` (token-guard),
  `37fb79a` (sync-docs), `1919a5e` (fleet privacy), `20f4e2e` (test chain), plus the
  docs/plan commit that follows. Landed, all with `npm test` green (full suite + 207 hook tests):
  - `bin/lib/plugins.js` — `pluginRemove` no longer claims success when the settings revert
    fails: keeps the ledger entry (retryable), warns, exits non-zero. 3 new tests in
    `test/plugin-system.test.js` (red on HEAD → green).
  - `bin/ccr.js` — `SAFE_RECOVER_CMD` regex now ENFORCES the "no quotes/metacharacters"
    property the old comment merely asserted. New `test/ccr.test.js` (6 tests; metachar
    rejection was red on HEAD).
  - `.claude/hooks/token-guard.js` — TDZ landmine defused: `CHARS_PER_TOKEN` / `IMAGE_TOK_EST`
    hoisted to module top (were declared 1,685 lines after first use); `recoverTail`'s bare
    `/4` named `PROSE_CHARS_PER_TOKEN` (value unchanged, deliberately ≠ CHARS_PER_TOKEN — see
    comment).
  - `.claude/scripts/gls-downscale.js` — SKIP note now prints pre-computed `$m` instead of
    reading `$img.Width` after `Dispose()`. **Discovery:** the review's "confirmed latent bug"
    claim did NOT reproduce on real Windows PowerShell — the SKIP path worked on HEAD; this is
    hardening, not a bug fix. New `test/gls-downscale.test.js` (5 behavioral tests, win32-real,
    CI-skips elsewhere).
  - `.claude/scripts/whats-happening.js` — `readTitles`/`allTitles` 30-line duplication merged
    into `scanTitles(predicate)`. New `test/whats-happening.test.js` (5 characterization tests,
    written green on HEAD before the refactor).
  - `.claude/scripts/sync-docs.js` — dead comment-only loop branch in `generateTreeInfo`
    removed; regen byte-identical (ratchet green).
  - `scripts/sync-terminal-title.js` — personal repo paths moved out of the tracked file into
    gitignored `scripts/terminal-title-fleet.local.json` (created on this box with the current
    3 targets; check mode verified: 8/8 targets in sync). Header's false "stays private" claim
    corrected. **Note:** the old paths remain in git HISTORY; scrubbing history was judged not
    worth it (they reveal folder names only).
  - `CLAUDE.md` — Node requirement corrected to `>=18.0.0` (docs now match package.json).
  - `package.json` — the three new suites wired into the `npm test` chain (before hook-tests).
  - Deviations: none. Next: 1.1.

- **2026-07-24 — 1.1 retire the mothballed R11 block — DONE.** Commit `d59e6a7`, `npm test`
  green (full chain; hook suites now **196** tests — the 11 mothballed-unit tests went with
  the code).
  - Deleted from `.claude/hooks/token-guard.js`: the mothball banner, `MIGRATE_CANDIDATE` /
    `MIGRATE_ARMED`, `writeMigrateCandidate`, `resolveMarker`, `clearMarker`, `migrateReceipt`,
    `onSessionStart`, the commented-out SessionStart dispatch in `main()`, their exports, and
    the two knobs only that path read (`driftMigrateMarkerTTLmin`, `driftMigrateMaxInjectTokens`
    — dropped from DEFAULTS; a user config still setting them is silently ignored, no crash).
    `driftAutoMigrate` stays (drives `driftNote`'s one-liner branch), and `recoverTail` / `slug`
    / `writeRecoverPointer` stay live (`/migrate-new-session`, R6 keyword contract, drift
    staging). File-header R11 paragraph + the fire-site comment updated to name the deletion.
  - `.claude/hooks/tests/token-guard-r11-automigrate.test.cjs` trimmed to the live units
    (driftNote / recoverTail / writeRecoverPointer); header rewritten.
  - Verified before deleting: dispatch was still commented out; the five names had zero live
    callers anywhere incl. `.claude/commands/*.md` prose (the ⚠ trap held —
    `/migrate-new-session` reads the drift ledger, not these functions). Verify grep now
    returns only this plan doc. `sync-docs` regen: byte-identical, nothing to commit.
  - Doc fix riding along: 3.3's Verify said "207 hook tests" — updated to 196 so a future
    session doesn't chase a phantom count.
  - Deviations: none. Next: 1.2.

- **2026-07-24 — 1.2 name token-guard's magic numbers — DONE.** Commit `209104b`, `npm test`
  green before and after (full chain, 196 hook tests), `npx eslint .` clean, sync-docs regen
  byte-identical.
  - Pure rename, zero value changes. Cache multipliers (`CACHE_READ_X` 0.1 / `CACHE_WRITE_5M_X`
    1.25 / `CACHE_WRITE_1H_X` 2) now live beside `PRICES`; the rest in one block after
    `IMAGE_TOK_EST` (~`token-guard.js:186`): `SID_SHORT_LEN` 8, `SKILL_SCAN_MAX_FILES` 64,
    `SKILL_SCAN_CHASE_MAX_BYTES` 2e6, `USAGE_LOG_ROTATE_BYTES` 256·1024,
    `SPEND_LEDGER_PRUNE_BYTES` 128·1024 (the old `131072`, respelled — the two byte caps are
    DIFFERENT values, 128K vs 256K; "unify the spelling" meant the notation, not the numbers),
    `BUSY_SESSION_DUST_USD` 0.02, `LEDGER_ENTRY_DUST_USD` 0.001, `ROLLUP_DUST_USD` 0.005
    (covers both the rollup row skip and the agents-display floor), `SPIKE_SOLO_SHARE_FLOOR` 0.85.
  - Discoveries: the analyzer's TTL-gap `rewriteUSD` (`* 2`, token-guard.js:2345 pre-edit) is
    the same 1h cache-write rate — folded into `CACHE_WRITE_1H_X`. The report's
    `win.rows.slice(0, 8)` is a top-8 DISPLAY cap, not a sid slice — deliberately left literal.
    Verified no test parses token-guard source literals before renaming (the cli.js regex trap
    does not extend to hooks).
  - Deviations: none. Next: 1.3.

- **2026-07-24 — 1.3 stop hardcoding the impersonated client version — DONE.** Commit
  `36badc7`, `npm test` green (full chain; hook suites now **206** tests — 10 new),
  `npx eslint .` clean, sync-docs regen byte-identical.
  - The version IS cheaply discoverable — two ways, both wired in as a ladder in the new
    `claudeCodeUA(env)` (token-guard.js, replaces the `CLAUDE_CODE_UA` const): (1) the
    `CLAUDE_CODE_EXECPATH` env var points inside the npm package, so `dirname/../package.json`
    is one fs read (guarded: name must be `@anthropic-ai/claude-code`, version must be
    semver-shaped); (2) the `AI_AGENT` env stamp (`claude-code_2-1-210_agent`) parses to the
    version; (3) dated pin fallback `CLAUDE_CODE_UA_PIN`, re-pinned 2.1.207 → 2.1.210 with the
    rotation rule in its comment. Derivation runs only on cache miss (≤1 per 180s TTL), never
    spawns a process. Exports grew `claudeCodeUA` + `fetchOfficialUsage` (additive, for tests).
  - New `.claude/hooks/tests/token-guard-official-usage.test.cjs` (10 tests, auto-discovered
    by the runner): the 6 derivation-ladder cases (pin asserted by SHAPE, not value, so
    re-pinning never breaks it) + 4 silent-degradation cases for `fetchOfficialUsage`
    (no credentials → null, network throw → null, non-OK → stale cache, fresh cache → no
    network), with `os.homedir` + `global.fetch` swapped out so tests can't touch real
    credentials or the endpoint.
  - Discoveries: the hardcoded pin was already stale (running install is 2.1.210); the
    on-disk `lastOnboardingVersion` in `~/.claude.json` is NOT a usable source (says 1.0.128).
    Noted, out of scope: a network-level fetch failure returns null even when a stale cache
    exists (the `return stale` only covers missing-token and non-OK paths) — behavior change,
    would need its own item.
  - Deviations: none. Next: 1.4.

- **2026-07-24 — 1.4 sync-docs escape hardening — DONE.** Commit `d3310f1`, `npm test` green
  before and after (full chain, 206 hook tests), `npx eslint .` clean.
  - New `jsEscape(str)` helper beside `escapeTemplateLiteral` (`.claude/scripts/sync-docs.js:244`):
    backslash first, then `'`, `\r`, `\n` — replacing all five single-quote-only sites (four in
    `generateTreeInfo`: empty-folder desc, folder desc, file `escapedDesc`, trigger; one in
    `generateFileContents`: emptyMessage). The template-literal sites already used
    `escapeTemplateLiteral` — untouched, as the item anticipated. Values/output unchanged.
  - Byte-parity held: regen after the edit produced an empty `git diff --stat .claude/docs`
    (no current desc/trigger/emptyMessage contains a backslash or newline), so nothing to
    commit under `.claude/docs`.
  - Sanity-checked beyond the suite: round-trip eval of a hostile string (Windows path
    backslashes, apostrophe, CRLF, trailing backslash) survives jsEscape; the old escape
    SyntaxErrors on the same input. Note for anyone re-checking by shell one-liner: Git Bash
    eats the backslashes in inline `node -e` args — use a script file.
  - Deviations: none. Next: 2.1 (Phase 2 — split a/b/c; consider dedicating the session to
    2.1a alone, the substep is L and pre-split).

- **2026-07-24 — 2.1a copy/force behavioral tests — DONE.** Commit `de23723`, `npm test`
  green before and after (full chain, 206 hook tests), `npx eslint .` clean. Took ~M, not L —
  the harness (shim + runCli + fixtures) already existed in `cli-behavior.test.js`; extending
  it beat a new file (which would have added a 13th copy-pasted harness for 2.2 to migrate).
  - `test/cli-behavior.test.js` 30 → 42 tests: Fixture 1 gains per-class presence (docs html,
    agents, feedback, format.js, terminal-title.js, sync-docs.js, sounds), dev-gated scripts
    absent (`whats-happening.js`/`plan-progress.js`), and an html-only docs pin (weak — package
    ships only .html today; comment in the test says so). New Fixture 7 (upgrade, no --force):
    user-edited FEEDBACK.md + format.js preserved; user-edited `continue.md` + `sync-docs.js`
    refreshed to shipped bytes. New Fixture 8 (`--bootstrap --force`): feedback + format.js
    refreshed, settings.json REPLACED byte-identical (no merge, MY_VAR gone), user's own
    hook/file survive (--force is not a wipe).
  - Mutation-checked per Verify: `copyDirIfMissing` → always-overwrite failed exactly the two
    preserve tests; dropping `forceMode` from the settings branch failed exactly the
    force-replace test. Both reverted, `git diff bin/cli.js` empty.
  - Fixture traps discovered (bake into 2.1b): the FEEDBACK.md→Discoveries migration fires on
    upgrade fixtures whose CLAUDE.md lacks `## Discoveries` — both new fixtures include it to
    stay on the copy layer. `--force` without `--bootstrap` hangs on the interactive ENTER
    prompt; always pair them in runCli. The commit body carries the grep→behavior map 2.1c
    will delete against.
  - Deviations: none. Next: 2.1b (upgrade vs first-install flows as behavior).

- **2026-07-24 — 2.1b upgrade vs first-install flows — DONE.** Commit `ab740ef`, `npm test`
  green before and after (full chain, 206 hook tests), `npx eslint .` clean, `bin/cli.js`
  untouched (mutations all reverted; `git diff bin/cli.js` empty).
  - `test/cli-behavior.test.js` 42 → 59 tests: Fixture 1 gains the version-marker write
    (`.autoconfig-version` == installer version) + the "Install type: fresh" report line;
    Fixture 2 gains the CLAUDE.md-marker detection line, the marker advance
    (1.0.100 → current), whats-new `segments` ({kind, text} array — the formatUpdateSummary
    output /autoconfig-update renders), and no-unsupported-notice-on-configured. New
    Fixture 9 (docs-html-only project → upgrade detected + upgrade-only whats-new appears;
    `.from` deliberately unpinned — it is null with no marker), Fixture 10 (marker already
    current → NO whats-new; pins the `previousVersion !== currentVersion` gate), Fixture 11
    (old marker + unconfigured → "no longer supported" notice names both versions AND the
    sweep still lands commands + advances the marker), Fixture 12 (interactive no-flag runs,
    fresh + upgrade: READY box fork, `auto-run` line, `Launching Claude Code with …` line,
    fresh-only approval hint).
  - Mutation checks (each failed EXACTLY its intended test, then reverted): `launchCommand`
    hardcoded → F12(upgrade); whats-new gate widened to bare `isUpgrade` → F10; notice's
    `if (configured) return` removed → F2's no-notice test.
  - Discovery: the interactive path IS drivable headlessly — `execFileSync` with
    `input: '\n'` answers the ENTER prompt, and the PATH shim absorbs the
    `spawn('claude', [launchCommand])` instantly (F12's `runCliInteractive`, with a 120s
    timeout so a prompt-flow regression fails loud instead of hanging). 2.1a's
    "always pair --force with --bootstrap" trap note stands as the default, but it is a
    convenience, not a hard limit — use the interactive runner when the messaging itself
    is under test.
  - Trap for F12-style assertions: `auto-run /autoconfig` is a string PREFIX of
    `auto-run /autoconfig-update` — the fresh-box assert must also exclude the latter
    (regex `\b` does not help: `-` is a word boundary).
  - Deviations: none. Next: 2.1c (delete the superseded grep assertions 1:1 — the map is
    in `ab740ef`'s commit body; keep the DEV_ONLY_FILES literal-parsing helpers and the
    command-file prose asserts).

- **2026-07-24 — 2.1c delete the superseded grep assertions — DONE.** Commit `12bbacb`,
  `npm test` green before and after (full chain, 206 hook tests; cli-behavior holds at 59).
  Substep 2.1 now fully checked.
  - `test/cli-install.test.js` 53 → 40 tests: the 13 mapped source-greps deleted (the union
    of `de23723`'s and `ab740ef`'s maps, restated 1:1 in `12bbacb`'s body), plus
    `assertCliCopies` (its last user went with them). The two MIXED tests were trimmed, not
    deleted: the whats-new test kept only its autoconfig-update.md prose half (renamed
    "/autoconfig-update renders + consumes the what's-new file"), the unsupported-notice
    test kept only the autoconfig.md relay half — each with a comment naming the fixtures
    that now own the cli.js halves.
  - Deviation (deliberate, small): `'CLI copies commands/'` was in NEITHER prior map but
    rode along — its behavioral twin (F1 "shipped commands are present") predates 2.1a, and
    keeping it would have kept the dead helper alive. Mapped in the commit body like the rest.
  - Kept, per the item: the DEV_ONLY_FILES literal-parsing docs-sync tests (data contract),
    all command-file prose asserts, and five cli.js greps with NO full behavioral twin yet —
    MANAGED_HOOKS list shape, the --bootstrap pin gate, deprecated-alias pruning logic, the
    insideClaude guard condition, migrate-before-merge ordering. These are now enumerated in
    the file header; Phase 3 sessions: they assert literal names/shapes, so 3.1's main()
    wrap is safe but 3.2-style renames will hit them — replace behaviorally as you go.
  - Mutation checks re-run AFTER the deletions (proving the surviving net, not the greps,
    catches breakage): `copyDirIfMissing`→`copyDir` at both copyFn sites → the two F7
    preserve tests fail (+ collateral F11 failures); `launchCommand` hardcoded → exactly
    F12(upgrade) fails. Both reverted, `git diff bin/cli.js` empty.
  - Environment note: repo-wide `npx eslint .` currently fails on an UNCOMMITTED
    token-guard.js edit (unused `PLAN_STEER_TOK`) belonging to a live twin session's R13
    work — not this substep's file; left strictly untouched, eslint verified clean on the
    changed file alone.
  - Next: 2.2 (extract the shared test harness — the CLI suites still carry 12 copy-pasted
    `test`/`assert` harnesses).

- **2026-07-24 (evening) — plan amendment, no substep executed.** Trigger: a fresh ESLint v9
  complexity census (`ARTICLES/cyclomatic-complexity-report.html` — 1,203 functions, 58 files,
  54 over CC 10, avg 2.84) + an explicit ask to get the top-10 under CC 10. Top-10:
  `handle` 97, `onUserPromptSubmit` 89, `turnWatch` 79, `analyzeSession` 52, `onPreToolUse` 44,
  `meter` 33, `analyze` (whats-happening) 33, `report` 32, `render` (plan-progress) 32,
  `fanVerdict` 31. Five of those had no substep — added 3.6–3.10 (turnWatch; meter+fanVerdict;
  --report; analyze; render), seams from a code profile of each (dup rescue-tail in turnWatch
  at ~1329/~1354 is the first free extraction). Added the Phase 3 CC ≤ 9 acceptance bar
  (targets + extracted helpers; ratchet baseline shrinks per substep once 2.3 lands) and wired
  it into 3.3/3.4 Verify. Refreshed stale numbers: 3.3a CC 88→89, 3.3b CC 38→44, 3.3's hook
  count 196→206. Census caveat: run on a tree carrying the twin session's uncommitted
  token-guard R13 edit, so token-guard numbers may move ±1–2. Coverage findings for the new
  substeps: `meter` and `report` have NO direct tests (test-first items baked in);
  `fanVerdict` is unit-pinned; `analyze` has 5 CLI tests; `render` waits on 2.5.
  Execution order unchanged: 2.2 is still next unchecked.
  - **Discovery (load-bearing): this plan was INVISIBLE to /plan-progress and /continue's
    plan probe until tonight.** The SUBSTEP regex (`plan-progress.js:50`) accepts only
    `~<N>m` / `~<N>h` time tags with ` — ` immediately after; this doc used `~45 min` /
    `~2 hr` / `~2 hr each` / `~2 hr (split a/b/c)`, so zero substeps parsed and the doc was
    silently skipped — `/clear` + `/continue` would never have resumed it. Fixed all 20
    headings to the parser grammar (3.3 retagged `~6h` total, was "2 hr each"; 2.1's
    parenthetical moved into the title); `.claude/rules/plan-authoring.md` now documents the
    grammar. Verified: plan-progress renders 19% · 6/20 · next → 2.2.

- **2026-07-24 — 2.2 one shared test harness — DONE.** Commit `08be629`, `npm test` green,
  `npx eslint .` clean. Executed as a reconciliation: the working tree arrived carrying the
  full migration uncommitted from a session that died pre-commit (plus the evening plan
  amendment, committed separately first as `079b5ec`); this session verified the work per
  the Verify line and landed it rather than redoing it.
  - `test/_harness.js` (new): `test` / `assert` / `assertExists` / counters / `summary`,
    plus `makeClaudeShim` / `runCli` lifted verbatim from cli-behavior.test.js. Its header
    documents the deliberate two-framework split (this harness for CLI suites, `node:test`
    for hooks) and the standalone exceptions (box-alignment, live-twin-parity, the
    hook-tests bridge). **15** suites migrated — the substep said "the 12 copy-pasted
    harnesses"; the real count was 15.
  - Deliberately NOT unified (different contracts, kept local with comments):
    plugin-system's `runCli` (returns stdout, THROWS on non-zero exit) and corrupt-json's
    (shimless). Cosmetic output change: auto-guard / dev-gate / contracts now print the
    standard `ALL TESTS PASSED (N tests)` banner instead of their bespoke summaries.
  - Verify: per-suite pass counts byte-compared pre/post — baseline `npm test` in a temp
    worktree at HEAD + HEAD versions of the last four suites re-run in the main tree
    (`git show HEAD:test/<f> > tmp`, run, delete). Identical:
    40/13/15/22/122/62/1/9/10/4/4/59/4/5/6/5, hooks 213 (up from 2.1c's 206 via the twin
    session's R13 commits `38cc78c`/`7e8cffb`/`03c3922`, already at HEAD — not this substep).
  - **Discovery (load-bearing for re-verifiers): the docs ratchet (contracts.test.js)
    cannot pass in a fresh worktree/checkout on this box** — byte-parity is line-ending
    sensitive twice over: a fresh autocrlf checkout smudges `autoconfig.docs.html` to CRLF
    (regen writes LF → whole-file mismatch), and after forcing an all-LF checkout the regen
    STILL diverges (format.js's `@description` parse yielded the fallback desc under LF).
    Baseline-testing old revisions must run inside the real dev tree, not a scratch clone.
  - Deviations: none beyond the reconciliation framing. Next: 2.3 (complexity ratchet —
    decision about the 3-rule lint floor goes in this Ledger).

- **2026-07-24 — 2.3 complexity ratchet — DONE.** Commit `4f85c91`, `npm test` green before
  and after (full chain, 213 hook tests), `npx eslint .` clean.
  - **The decision (recorded per the item):** the 3-rule eslint floor stays exactly 3 rules —
    complexity is NOT a fourth lint rule. The ratchet is a no-growth GATE in the test chain:
    `test/complexity-ratchet.test.js` runs eslint's `complexity` rule programmatically at the
    Phase 3 bar (max 9), REUSING eslint.config.js's own files/ignores/languageOptions at
    runtime so the two scopes can never drift. Exact-match in BOTH directions: growth fails
    naming the offender; a cleared violation also fails until the baseline is tightened
    (`node test/complexity-ratchet.test.js --write-baseline`) in the same commit — Phase 3's
    shrink-per-substep bar is now mechanical, not prose.
  - Baseline reality vs the item's "67": today's census in the lint-floor scope is
    **64 violations in 13 files** (`test/complexity-baseline.json`). The raw repo-wide count
    is 65, but `pilots/deny-reads-pilot.js` sits outside the lint floor's scope and the
    ratchet inherits that exclusion by design; the rest of the 67→64 drift is post-review
    refactors already landed (e.g. 1.1's R11 deletion).
  - Violation identity = file + function label only (no CC value), compared as multisets —
    an offender drifting 97→95 doesn't churn the baseline; two anonymous arrows in one file
    still count as two.
  - Verify ran per the item: scratch CC-12 function → exactly the no-growth test failed
    (named `test/scratch-cc.js: Function 'scratchComplexity'`, exit 1); removed, green again.
    Suite wired into `npm test` after contracts.test.js.
  - Note for later sessions: an eslint version bump can legitimately shift CC math — if the
    census moves with zero code edits, re-baseline in the upgrade commit and say so there
    (documented in the suite header).
  - Deviations: none. Next: 2.4 (c8 coverage visibility, ~20m).

- **2026-07-24 — 2.4 c8 coverage visibility — DONE.** Commit `71b2da3`, `npm test` green
  before and after (full chain, 213 hook tests), `npx eslint .` clean.
  - `npm run coverage` = `c8 npm test` (c8@12.0.0, zero config). Works on Windows; c8's
    `NODE_V8_COVERAGE` propagates through npm → cmd → node children, so the spawned
    behavioral CLI runs and hook-test children ARE counted (bin/cli.js at 88.96% is the
    proof — it only ever executes as a child process). `coverage/` gitignored; eslint's
    file-glob scope already excludes it. No thresholds, no gating, per the item.
  - **Baseline (recorded per the item): All files 85.42% stmts / 74.67% branch /
    85.65% funcs / 85.42% lines.** Notables: `token-guard.js` 79.24%,
    `terminal-title.js` 91.09%, `cli.js` 88.96%, `settings-merge.js` 94.00%,
    `scripts/generate-changelog.js` 51.09% (the floor — its `--postversion` half only
    runs on real version bumps).
  - Discovery (matters for reading the report): c8 defaults to `all: false` — a file the
    suite never loads is ABSENT from the table, not shown as 0%. Absent today:
    `.claude/scripts/plan-progress.js` (untested until 2.5) and
    `.claude/scripts/sync-docs.js` (the contracts ratchet compares committed bytes; it
    does not execute the generator). Test files themselves are already excluded by c8's
    default exclude globs (`test/**`, `**/*.test.*`) — no config needed.
  - Deviations: none. Next: 2.5 (tests for plan-progress — the characterization suite
    that 3.10 hard-depends on).

- **2026-07-24 — 2.5 tests for plan-progress — DONE.** Commit `9e2e639`, `npm test` green
  before and after (full chain, 213 hook tests), `npx eslint .` clean.
  - New `test/plan-progress.test.js` (20 tests, shared harness): the script exports nothing
    (parses/renders at require time), so the suite spawns it as a child process against
    fixture plan docs in temp dirs — the cli-behavior pattern, not unit tests of `parsePlan`
    / `render` directly. Wired into `npm test` between whats-happening and hook-tests.
  - The load-bearing test for 3.10: **full render pinned byte-exact** on a full-featured
    fixture (goal line, collapsed done phase, done-substep elision `_… 1 earlier done_`,
    `▶ … ← you are here` marker, 1/3 microstep widget). Its failure message names the first
    diverging line. Also pinned: effort-weighted (57% = 180/315 min) vs count-based vs
    mixed-tag percent + both caveat lines, not-started/complete status suffixes, next-pointer
    suppression when complete, filename-fallback title + `(unphased)` phase, title truncation,
    CRLF parsing, discovery in all three scan locations, in-progress-first sort, and the
    invisibility contract (no `## Ledger` → not a plan; `~45 min` grammar → doc invisible —
    the 2026-07-24 plan-amendment discovery is now a regression test).
  - Mutation check: dropping the elision logic failed exactly the elision + byte-exact tests;
    reverted, `git diff .claude/scripts/plan-progress.js` empty.
  - Coverage note (ties off 2.4's discovery): plan-progress.js was ABSENT from the c8 table
    because nothing loaded it; it now appears via the spawned child runs.
  - Deviations: none. Phase 2 complete. Next: 3.1 (cli.js grows a `main()` — Phase 3 opens).
