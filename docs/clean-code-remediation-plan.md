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

**How to execute:** one substep per fresh session.
Each substep: make it green (`npm test` before and after), run its **Verify** commands, commit
with a `Changelog:` trailer (dev-gated work → `Changelog: none`), append a Ledger entry, then
`/clear` + `/continue` (plan-aware; resumes at the next unchecked substep).

**⛔ Read this doc in SLICES — never whole.** It runs 800+ lines and the Ledger is more than half
of them; a session that opens it whole pays that on turn one and re-pays it on every request
after (≈360k of rent in a long session — measured 2026-07-25, see `.claude/rules/plan-authoring.md`).
Read exactly three slices and nothing else:

1. the **⛔ trap section** (`this doc:51-89`) — before ANY item, no exceptions;
2. **your own substep** — every heading's Read list names its own line range;
3. the **Ledger tail** — `tail -80 docs/clean-code-remediation-plan.md`, not the whole section.

Every remaining substep carries a **Read list** of exact files and line ranges. Open those
windows only: the two hook files are 3,144 and 1,740 lines and must NEVER be read whole.

**Every Ledger entry records rent.** Close it with a `rent:` line — the session's total token
spend from the `--analyze` digest (`node .claude/hooks/token-guard.js --analyze <sid>`), e.g.
`rent: 1.4M (M ceiling ≈1.5M — tag holds)`. Ceilings are S ≈ 0.5M · M ≈ 1.5M · L ≈ 3M. This is
the only effort budget verifiable after the fact; a substep that lands near or past its tier's
ceiling means the TAG was wrong — correct the tag in the same commit so later ones stay
calibrated.

**Model routing (added 2026-07-25):** each remaining substep title ends with a `[fable]` /
`[opus]` tag — check it and set `/model` accordingly BEFORE `/continue` (model is per-session;
caches are model-scoped, so never switch mid-session). Heuristic: **Opus 5** for well-specified
mechanical extractions with strong test/byte-diff nets (half Fable's price, strongest at
executing a spec); **Fable 5** for ⛔ trap-surface edits and design-judgment seams. Mixed
substep 3.3 is routed per sub-item in its body. If an `[opus]` session flails or the review
finds plan deviations, restart that substep on Fable. **Every substep's closing message must
end with the handoff line for the NEXT unchecked substep** — e.g.
`Handoff: /clear → /model fable → /continue (next: 3.4 · [fable])` — so the model switch is
emitted at the boundary, never left to memory.

---

## ⛔ Standing trap warnings — read before ANY item

- **The `.claude/hooks/` copies here are the fleet-synced canonicals** — `terminal-title.js`,
  `terminal-title.directive.md` AND `token-guard.js` (the manifest in
  `scripts/sync-hook-fleet.js:32`). Edit only these, then `node scripts/sync-hook-fleet.js
  --write`, then check mode for zero drift. **This now covers token-guard too** (added
  2026-07-25 after it drifted 231 lines) — substeps 3.3b/3.3c/3.7/3.8 all owe the sync, which
  the pre-2026-07-25 wording of this plan did not ask for. `scripts/sync-terminal-title.js`
  still works; it is a thin front-end over the same code.
- **Every `.claude/hooks/*.js` must stay a SINGLE standalone file** — hooks are copied
  file-by-file into user projects and to `~/.claude`; a multi-file split breaks deployment.
  ⚠ This VOIDS the "extract before you edit" lever in `.claude/rules/plan-authoring.md` (write
  new logic as a pure module in an earlier substep). You cannot do that here — do NOT
  "helpfully" create a `hooks/lib/`; the Deferred section rejects it deliberately. The
  compensating lever for hook substeps is **land the characterization test in an earlier
  substep**, then extract in-file against it.
- **God files — Grep-then-Read-window ONLY, never opened whole:**
  `.claude/hooks/token-guard.js` (**3,144 lines**, ~42k tokens) and
  `.claude/hooks/terminal-title.js` (**1,740 lines**). Six of the remaining substeps target
  them. Each substep's Read list names the windows; a whole-file read blows the session's
  budget on turn one and stays resident for every turn after.
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

### ☑ 3.1 · L · ~2h — cli.js grows a `main()` (after 2.1 — not before) (DONE 2026-07-24, see Ledger)

- [x] Wrap the require-time flow in `function main()` + `if (require.main === module) main();`
      with NO other change; the literals the contract tests parse stay put.
- [x] Delete the two "cannot require cli.js back" apology comments (plugins.js,
      update-summary.js) once requiring is safe, replacing the `deps` injection only if
      trivially safe — otherwise leave `deps` and note it.

⚠ Trap: module-scope mutable variables become function-scope — verify no helper defined
outside `main()` closes over them. **Verify:** `npm test` (post-2.1 suites are behavioral);
`node bin/cli.js --help`-equivalent smoke in a temp dir; `require('./bin/cli.js')` in `node -e`
must now be side-effect-free.
**Commit:** `refactor(cli): move the install flow into main()` + `Changelog: none`.

### ☑ 3.2 · M · ~60m — cli.js: one `copyTree`, one `boxLine`, one color helper (DONE 2026-07-24, see Ledger)

- [x] Collapse `copyDirForBackup` / `copyDir` / `copyDirIfMissing` + the inline docs-copy
      loop into `copyTree(src, dest, {filter, overwrite})`.
- [x] `boxLine(text)` (padEnd-based) replaces hand-counted box spaces; box tests keep passing
      unchanged (they assert rendered width, which is the point — but see the Ledger: the
      extraction side was source-grep and had to go behavioral).
- [x] `paint(color, text)` helper for the 61 raw ANSI literals in cli.js.

**Verify:** `npm test` (box + install suites); visual smoke of the READY box in a temp dir.
**Commit:** `refactor(cli): copyTree/boxLine/paint helpers` + `Changelog: none`.

**3.3 family — token-guard's three worst handlers.** The single-file constraint stands (hook
deployment); every split is INTO per-rule functions WITHIN the file, anchored on the pure
verdict functions that already exist. Was one `L · ~6h` substep until 2026-07-26 — that is an
XL, which the authoring rules forbid; it is now three first-class substeps, one per session,
exactly as 3.2's Ledger entry already advised executing it.

### ☑ 3.3a · L · ~2h — token-guard: decompose `onUserPromptSubmit` (CC 89) (DONE 2026-07-25, see Ledger)

- [x] One `r<N>...Guard(ctx)` function per rule (R8, R9, meter, R2, R3, R4, fat-context, R6,
      R12a, R12b, spend-step), each returning `{notes, block}`; the handler becomes a fold over
      them. Digest wording byte-identical.

### ☑ 3.3b · L · ~2h — token-guard: decompose `onPreToolUse` (CC 44) (DONE 2026-07-26, see Ledger)

**Read list** (~330 lines — do NOT open token-guard.js whole, it is 3,067):
`this doc:252-272` · `.claude/hooks/token-guard.js:2288-2498` (`onPreToolUse`, the target) ·
`:2191-2242` (3.3a's `emitBlock` + `PROMPT_GUARDS` fold — **the template to copy**) ·
`:2500-2543` (`ask` / `deny` — the return shapes the guards must produce). Grep, don't read,
for the pure verdicts it already calls (`payloadVerdict`, `fanVerdict`, `commandPayloadTokens`).

- [x] Same shape as 3.3a: one guard function per rule, each `{notes, block}`, handler becomes
      a fold. Reuse `emitBlock`'s save+block+return beat rather than re-inventing it.
- [x] CRLF trap (3.1/3.3a's note): the file is fully CRLF — go in via a marker-anchored splice
      script, not hand edits, and check for stray LFs after.
- [x] `node scripts/sync-hook-fleet.js --write`, then check mode for zero drift.

**Verify:** `npm test` (240 hook tests as of 3cf38d3); a real PreToolUse payload smoke in a
sandboxed `CLAUDE_PROJECT_DIR` composing at least two rules in their original order; the
Phase 3 CC ≤ 9 bar on `onPreToolUse` + every helper; ratchet baseline shrinks by exactly the
cleared violation in the same commit.
**Commit:** `refactor(token-guard): decompose onPreToolUse into per-rule guards` +
`Changelog: none`.

### ☐ 3.3c · L · ~2h — token-guard: decompose `analyzeSession` (CC 52) · [fable]

⚠ Trap surface: the `--analyze` digest wording is a machine interface (`/analyze-session` keys
on the literal "live context at end" and the RENT/BOMBS/FLEETS/TTL headers). Byte-identical
output is the acceptance bar, not a nicety.

**Read list** (~230 lines): `this doc:273-294` ·
`.claude/hooks/token-guard.js:2738-2867` (`analyzeSession`, the target) ·
`:2869-2935` (`renderAnalysis` — owns the frozen wording) ·
`:472-506` (`attributeJump` — the region-attribution logic to dedupe against).

- [ ] Extract the per-concern accumulators out of `analyzeSession`.
- [ ] Dedupe the region-attribution logic it shares with `attributeJump` into one helper. This
      is a design seam, not a mechanical extraction — the two callers want different outputs
      from the same walk; if one helper makes both awkward, say so in the Ledger and leave them.
- [ ] `node scripts/sync-hook-fleet.js --write`, then check mode for zero drift.

**Verify:** `npm test`; `--analyze` on a real transcript diffed **byte-for-byte** pre/post
(3.3a used the 41.9M-token `13065f1d` transcript); the Phase 3 CC ≤ 9 bar on each cleared
function + its helpers.
**Commit:** `refactor(token-guard): decompose analyzeSession` + `Changelog: none`.

**3.4 family — terminal-title's `handle()`.** Highest-trap surface in the repo: fleet-synced
single file, cross-process sidecar protocol. Split 2026-07-26 because the safety fix is a
shippable user-facing bug fix (its own `Changelog:` line) that does not need to ride with the
repo's worst decomposition — and 3.4b starts from a file whose dispatch is already pinned by
3.4a's test.

### ☐ 3.4a · L · ~45m — terminal-title: explicit Stop dispatch (unknown events exit quietly) · [fable]

Sized L not for its diff but because it edits a ⛔ trap surface — the authoring rules make that
automatic, regardless of how small the change looks.

**Read list** (~175 lines): `this doc:301-323` ·
`.claude/hooks/terminal-title.js:99-135` (handle's entry, `event` read at :100, the
`needsTranscript` gate at :130) · `:233-372` (the Notification branch and the **unguarded
fall-through** that follows it) · the hook-suite test dir listing (`ls .claude/hooks/tests/`).

- [ ] The review's safety fix: dispatch matches `UserPromptSubmit` (:135), `PostToolUse`
      (:172) and `Notification` (:233), then everything else falls through to the Stop path —
      so ANY unknown/new event is treated as Stop. Add an explicit `event === 'Stop'` guard;
      unknown events exit quietly (0).
- [ ] Hook-suite test, red on HEAD first: an unknown `hook_event_name` must NOT paint idle.
- [ ] `node scripts/sync-hook-fleet.js --write`; live-twin parity green.

**Verify:** `npm test` (the hook suites run ONLY there); `node scripts/sync-hook-fleet.js`
(check mode, zero drift); manual smoke: one prompt in a scratch session still paints
working→idle correctly.
**Commit:** `fix(terminal-title): only Stop dispatches the Stop path` +
`Changelog: More reliable terminal tab status updates`.

### ☐ 3.4b · L · ~90m — terminal-title: split `handle()` (CC 97, the repo's worst) · [fable]

**Read list** (~275 lines): `this doc:324-342` ·
`.claude/hooks/terminal-title.js:99-372` (`handle()` in full — 274 lines, the one whole-function
window this plan permits in that file) · 3.4a's new dispatch test (grep `.claude/hooks/tests/`
for the name the Ledger records). `turnWatch` (:1162-1374) is **3.6's** — do not open it here.

- [ ] Split into `onUserPromptSubmit` / `onPostToolUse` / `onNotification` / `onStop` in-file,
      on the dispatch boundaries 3.4a made explicit.
- [ ] Each resulting handler + its helpers must meet the Phase 3 CC ≤ 9 bar — a 97 split four
      ways can still leave a 25, so expect per-event helper extraction too. `turnWatch()`
      waits for 3.6.
- [ ] `node scripts/sync-hook-fleet.js --write`; live-twin parity green.

**Verify:** `npm test`; check-mode sync (zero drift); the Phase 3 CC ≤ 9 bar on `handle`'s
replacements; manual smoke: one prompt in a scratch session paints working→idle correctly.
**Commit:** `refactor(terminal-title): split handle() into per-event handlers` +
`Changelog: none`.

### ☐ 3.5 · M · ~60m — settings-merge: per-domain split · [opus]

**Read list** (~220 lines): `this doc:343-356` · `bin/lib/settings-merge.js` **whole** (217
lines — under the 800-line limit, the only whole-file read left in Phase 3) · grep
`test/plugin-system.test.js` for `added` to find the delta assertions, don't read it whole.
Not a hook: no fleet sync, no single-file constraint here.

- [ ] `mergeSettingsInto` / `unmergeSettingsFrom` (CC 30 each) → `mergeEnv/mergeHooks/
      mergePermissions` + unmerge twins; the `added`-delta contract (BH-1) is byte-frozen —
      plugin-system suite is the guard.

**Verify:** `npm test` (plugin suite incl. the 2026-07-24 corrupt-settings tests).
**Commit:** `refactor(settings-merge): per-domain helpers` + `Changelog: none`.

### ☐ 3.6 · L · ~2h — terminal-title: decompose turnWatch (CC 79) · [fable]

⚠ Same trap surface as 3.4a/3.4b (fleet-synced single file, cross-process sidecar protocol) —
execute right after them, while that session's traps are fresh.

**Read list** (~330 lines): `this doc:357-383` ·
`.claude/hooks/terminal-title.js:1162-1374` (`turnWatch`, the target — the duplicated
grace+recheck+rescue tail is at ~1329-1335 ≈ ~1354-1360) · `:1375-1390`
(`rescueFromWatch` — what the extracted tail must call) · `:887-992` (`spawnTurnWatch` — the
payload contract it is launched with). `handle()` is 3.4b's; do not open it here.

- [ ] First seam is free: the grace+recheck+rescue tail is DUPLICATED verbatim today
      (~1329–1335 ≈ ~1354–1360) — extract one `confirmStallAndRescue(...)`.
- [ ] Extract per-verdict handlers out of the probe dispatch: `classifyProbeEligibility`,
      `handleDeadStreak`, `handleCpuQuiet`, plus the debug-gated console-title readback.
- [ ] Byte-frozen strings: glyph-file tokens (`working` / `idle` / the awaiting token — must
      stay byte-identical to the real Notification paint), watch-log note names
      (`watch-start`, `watch-exit`, `dialog-flip`, `int-rescue` — `audit-titles` /
      `show-title-history` parse them), sidecar filenames
      (`.glyph/.watch/.probe/.needle/.found/.cpu/.live/.ask`).
- [ ] `node scripts/sync-hook-fleet.js --write`; live-twin parity green.

⚠ The turn-watch E2E (test/terminal-title.test.js) is Windows-only and spawns the real
detached child — run on the dev box; CI green proves nothing here.
**Verify:** `npm test`; check-mode sync (zero drift); the Phase 3 CC ≤ 9 bar.
**Commit:** `refactor(terminal-title): decompose turnWatch` + `Changelog: none`.

**3.7 family — token-guard's two verdict engines.** Was one `L · ~2h` covering a brand-new
`meter` unit test PLUS eight extractions across two unrelated functions. Split 2026-07-26 on
the function boundary: the binding budget on hook substeps is **round trips** (L caps ≈25), not
new files — extractions in a single-file hook create none, which is exactly why the old tag
passed a step that could not fit. `fanVerdict` already has its test net; `meter` has none.

### ☐ 3.7a · L · ~90m — token-guard: test-first, then decompose `meter` (CC 33) · [opus]

**Read list** (~200 lines): `this doc:390-412` ·
`.claude/hooks/token-guard.js:337-402` (`meter`, the target) · `:422-471` (`meterSession` —
one of the three field-name consumers) · `:198-211` (the `PRICES` / `CACHE_*_X` block the
pricing fold must keep as the single source — grep `CACHE_READ_X` if the range has drifted) ·
`.claude/hooks/tests/token-guard-official-usage.test.cjs` head for the fixture-transcript
pattern to copy.

- [ ] Test FIRST — `meter` has no direct unit test (coverage today is incidental through the
      event handlers): fixture transcript → exact `perModel` keys (`inp/out/cr/cw/searches/usd`),
      the 5m/1h cache-write TTL split, web-search surcharge, `liveContext` / `turnFloorUSD`.
      Written green on HEAD before touching the function.
- [ ] Extract `collectUsageById` (line scan + last-wins dedupe), `costOfUsage` (the pricing
      fold — `CACHE_READ_X` / `CACHE_WRITE_5M_X` / `CACHE_WRITE_1H_X` stay the single source),
      `deriveLiveFloor`. The returned struct's field names are a contract — `meterSession`,
      `report`, and `renderAnalysis` all read them.
- [ ] `node scripts/sync-hook-fleet.js --write`, then check mode for zero drift.

**Verify:** `npm test`; the Phase 3 CC ≤ 9 bar on `meter` + its helpers.
**Commit:** `test(token-guard): pin meter's pricing fold` then
`refactor(token-guard): decompose meter` — both `Changelog: none`.

### ☐ 3.7b · L · ~60m — token-guard: decompose `fanVerdict` (CC 31) · [opus]

Cheaper half — `token-guard-fan.test.cjs` already pins the shape, so no new suite.

**Read list** (~120 lines): `this doc:413-430` ·
`.claude/hooks/token-guard.js:803-873` (`fanVerdict`, the target) · `:874-895`
(`workflowSource` — its caller-side input) · grep `.claude/hooks/tests/token-guard-fan.test.cjs`
for `level` to find the pinned assertions.

- [ ] Extract `scanFanConstants` / `detectMultiplicativeFan` / `composeCeiling` /
      `scanLiteralFans` / `tierVerdict`. The returned `{level, signals, estimate, ceiling,
      concrete}` shape and the `block|high|warn` enum are pinned by token-guard-fan.test.cjs —
      keep both.
- [ ] `node scripts/sync-hook-fleet.js --write`, then check mode for zero drift.

**Verify:** `npm test` (fan suite unchanged); the Phase 3 CC ≤ 9 bar.
**Commit:** `refactor(token-guard): decompose fanVerdict` + `Changelog: none`.

**3.8 family — the `--report` renderer.** Was one `L · ~90m` — a tag *below* 3.7's while
carrying the harder problem (a characterization harness stubbing `global.fetch` AND
credentials, which nothing in the suite does yet). Split 2026-07-26: the test is independently
valuable and is the only "extract before you edit" move available inside a single-file hook.

### ☐ 3.8a · L · ~60m — token-guard: characterization test for `--report` (it has none) · [opus]

**Read list** (~190 lines): `this doc:436-454` ·
`.claude/hooks/token-guard.js:3019-3144` (`report`, to end of file — the thing being pinned) ·
`.claude/hooks/tests/token-guard-official-usage.test.cjs` (the 1.3 fetch/credentials stub
pattern to reuse).

- [ ] Characterization test spawning `--report` on a fixture transcript with `global.fetch` +
      credentials stubbed. Pin the `ALLOCATION` / `THIS SESSION` / `LAST 5 HOURS` headers, the
      `run /analyze-session <id> …` hint line above the rollup rows, and the sid8 in the row
      labels — analyze-session.md resolves those sid8s. (The per-row `· /analyze-session <sid>`
      suffix is opt-in via `analyzeHint: true` since 2026-07-24; usage-report.md never parsed
      the hint, contrary to this bullet's earlier wording.)
- [ ] Written green on HEAD — no production edit in this substep at all.

**Verify:** `npm test`; deliberately break one pinned header locally and confirm the new test
goes red (a characterization test that cannot fail is not a net).
**Commit:** `test(token-guard): characterize the --report renderer` + `Changelog: none`.

### ☐ 3.8b · L · ~45m — token-guard: decompose the `--report` renderer (CC 32) · [opus]

Hard dependency: 3.8a's suite is the only safety net this function gets — do not start without
it landed.

**Read list** (~130 lines): `this doc:455-470` ·
`.claude/hooks/token-guard.js:3019-3144` (`report`) · 3.8a's new test file.

- [ ] Extract `allocationLines` / `sessionLines` / `formatModelRow` / `windowLines` /
      `formatWindowRow`; the dollars-vs-tokens display branch collapses into ONE place.
- [ ] `node scripts/sync-hook-fleet.js --write`, then check mode for zero drift.

**Verify:** `npm test`; `--report` on a real transcript diffed byte-for-byte pre/post
(fetch stubbed to the cached allocation so the diff is deterministic); the Phase 3 CC ≤ 9 bar.
**Commit:** `refactor(token-guard): decompose the --report renderer` + `Changelog: none`.

### ☐ 3.9 · M · ~45m — whats-happening: decompose analyze (CC 33) · [opus]

**Read list** (~340 lines): `this doc:471-484` · `.claude/scripts/whats-happening.js` **whole**
(331 lines — under the 800-line limit) · grep `test/whats-happening.test.js` for `state` to
find the 5 characterization assertions. Not a hook: no fleet sync.

- [ ] Extract `sliceCurrentTurn` / `buildResultMap` / `buildSteps` / `classifyState`. The
      `state` enum (`running-tool` | `thinking` | `idle-or-done`) and the `--json` object keys
      are the contract — call sites branch on the former, the skill consumes the latter.
- [ ] The 5 CLI characterization tests (test/whats-happening.test.js) pass unchanged.

**Verify:** `npm test`; the Phase 3 CC ≤ 9 bar.
**Commit:** `refactor(whats-happening): decompose analyze` + `Changelog: none`.

### ☐ 3.10 · M · ~45m — plan-progress: decompose render (CC 32) — after 2.5, never before · [opus]

**Read list** (~230 lines): `this doc:485-501` · `.claude/scripts/plan-progress.js` **whole**
(224 lines — under the 800-line limit) · grep `test/plan-progress.test.js` for the fixture
plans. Not a hook: no fleet sync. ⚠ This script parses THIS doc — a regex change here can make
every plan in the repo invisible to `/plan-progress` and `/continue`.

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

- **2026-07-24 — 3.1 cli.js grows a main() — DONE.** Commit `3afefc4`, `npm test` green
  before and after (full chain, 213 hook tests), `npx eslint .` clean on the touched files.
  Took ~S, not L — the wrap was scripted (uniform re-indent), and every contract grep
  proved indentation-tolerant on inspection before the edit.
  - The wrap: everything after the requires — constants, helpers, AND flow, interleaved
    as they were — moved verbatim into `function main()` + `if (require.main === module)
    main();`. Nothing but the requires remains at module scope, which satisfies the ⚠
    closure trap trivially: there IS no helper outside main() left to close over anything
    (`persistTimings`/`mark`, the risky closures, moved in with their state). No statement
    reordering; hoisting semantics unchanged (all function declarations sat at top level,
    now at main()'s top level).
  - Verified per the item: `require('./bin/cli.js')` in a clean temp dir → exit 0, no
    output, ZERO files created; `--bootstrap` smoke in a temp dir → exit 0, full install
    tree; the five surviving cli.js source greps + DEV_ONLY_FILES parsers all green
    (their regexes are unanchored, as 2.1c's ledger predicted).
  - **Deviation (deliberate, documented): the complexity baseline GREW by exactly one
    entry** — `bin/cli.js: Function 'main'` (64 → 65, `--write-baseline`, diff inspected).
    Measurement artifact, not new complexity: eslint's `complexity` rule only measures
    functions, so the flow's ~50 branches were invisible at module top level and became
    visible inside main(). The Phase 3 CC ≤ 9 bar scopes 3.3–3.10 (not 3.1); 3.2 starts
    shrinking main(). Anyone tempted to "fix" the growth: the alternative was leaving the
    installer's complexity unmeasured forever.
  - Apology comments deleted (plugins.js header, update-summary.js header); the `deps`
    injection STAYS — cli.js requires plugins.js at the top, so plugins.js requiring
    cli.js back would be a circular require (partial exports), not the "trivially safe"
    replacement the item required. cli.js's own plugin-boundary + pull-updates comments
    reworded to match reality.
  - Note for 3.2+: the working-copy cli.js is CRLF on this box (autocrlf smudge — same
    2.2 discovery); scripted transforms must detect and preserve EOL, or the diff
    explodes.
  - Next: 3.2 (cli.js: one `copyTree`, one `boxLine`, one color helper).

- **2026-07-24 — 3.2 cli.js: copyTree/boxLine/paint — DONE.** Commit `8a94b78`, `npm test`
  green before and after (full chain, 213 hook tests), `npx eslint .` clean, ratchet green
  with the baseline UNTOUCHED (every deleted helper was under CC 10; every new helper lands
  under the Phase 3 bar — `main` stays the sole cli.js entry, identity-matched).
  - `copyTree(src, dest, {filter, overwrite})` replaces more than the item listed: besides
    `copyDirForBackup` / `copyDir` / `copyDirIfMissing` + the docs loop, the per-entry
    backup loop collapsed into ONE `copyTree(claudeDest, migrationPath, …)` — the
    SKIP_BACKUP/AUTOCONFIG_FILES filter applies at every depth and excluding 'migration'
    keeps the backup from nesting into itself. The filter is REQUIRED (all 8 call sites
    pass one): the first cut with optional filter + defaulted opts measured CC 10 — one
    over the bar — and dropping the two unused branches fixed it honestly.
  - `paint(color, text)` + the ANSI name map: the 38 `'\x1b[NNm%s\x1b[0m'` sites were
    converted by a scripted within-line transform (CRLF untouched — the 3.1 EOL trap held);
    the embedded-literal sites, whats-new segment renderer, and `rl.question` by hand.
    Raw `\x1b` literals left in cli.js: exactly 2 (paint's body, boxLine's stripper).
  - `boxLine`/`printReadyBox` collapse the duplicated 9-line box halves to one function;
    non-blank box lines verified byte-identical to the old literals (raw title line
    inspected); blank border lines shifted color placement (border-only vs whole-line
    yellow) — same 46-char render, invisible to stripAnsi width checks.
  - **Deviation (load-bearing): the item's "box tests keep passing unchanged" was wrong
    about the extraction side.** test/box-alignment.test.js regex-extracted box literals
    from cli.js SOURCE (`console.log('…║…')`), with an explicit ≥2-boxes vacuous-pass
    guard — runtime-built boxes would have failed it with zero boxes found. Rewrote it
    behavioral per 2.1c's standing note: it now runs the real CLI twice (fresh + configured
    fixture, ENTER piped, claude shim on PATH — the F12 pattern), extracts box lines from
    stdout, and keeps the same width/structure assertions plus an explicit
    `EXPECTED_WIDTH = 46` pin. It borrows `makeClaudeShim` from `test/_harness.js`
    (header updated) but keeps its bespoke whole-run structure.
  - Docs updated in-substep: CLAUDE.md Box Drawing Guidelines rewritten for
    boxLine/paint + the behavioral test; Update System Guidelines `copyDir` → `copyTree`;
    stale in-file comment references (BH-3 @applied, hooks preserve rationale) reworded.
  - sync-docs regen: nothing under `.claude/` changed; contracts ratchet green in the suite.
  - Next: 3.3 (token-guard: decompose the three worst handlers — dedicate the session to
    3.3a alone; the substep is L and pre-split a/b/c).

- **2026-07-25 — 3.3a decompose onUserPromptSubmit — DONE.** Commit `5722145`, `npm test`
  green before and after (full chain; hook suites now **217** tests — up from 3.2's 213 via
  the twin session's analyze-session/R13 commits already at HEAD), `npx eslint .` clean,
  sync-docs regen: nothing to commit.
  - The CC-89 handler is now ~30 lines: `r8CommandPayloadGuard` runs pre-meter as its own
    call (its ok-once mid-flight `saveState` preserved inside the guard), then a fold over
    `PROMPT_GUARDS` = [r2ReceiptGuard, r3ContextBombGuard, r4IdleReturnGuard,
    fatContextGuard, r6ScopeDriftGuard, officialUsagePrep, r12aWindowSpikeGuard,
    r12bWindowThresholdGuard, spendStepGuard, r13aPlanSteerGuard], each reading/mutating a
    shared per-turn ctx and returning `{notes, block}`; `emitBlock()` centralizes the three
    gates' save+block+return beat. `officialUsagePrep` is the one non-rule member: it
    computes `ctx.crossed` + `ctx.official` once so R12a/R12b/spend-step share a single
    fetch, at the exact point in rule order the inline code fetched.
  - Second-level extractions the CC ≤ 9 bar forced: `bombLandingNote` (R3's landed-bomb
    branch), `recoverWindowMinutes` (R4's walk-back), `trackScopeResidency` +
    `fireDriftNudge` (R6), `crossedSpendSteps`, `spikeNoteFor` (R12a), `sessionStatLines` +
    `windowStatLines` (spend-step). Handler CC 6; no new function above 8.
  - Verify per the item: `--analyze` byte-identical pre/post on the 41.9M-token `13065f1d`
    transcript; live UserPromptSubmit smoke (sandboxed CLAUDE_PROJECT_DIR, real fat
    transcript) composed R4 idle-return + fat-context + plan-steer in the original order;
    ratchet baseline shrank by exactly `Async function 'onUserPromptSubmit'` (65 → 64,
    `--write-baseline` in the same commit).
  - CRLF trap held (3.1's note): the file is fully CRLF, so the refactor went in as a
    marker-anchored splice script, not hand edits; zero stray LFs after, syntax-checked.
  - Deviation (tiny, deliberate): fixed a PRE-EXISTING `no-empty` lint error at
    `projectNameOf`'s bare catch (shipped in `2fe95a4` by a different session) with the
    house-style fail-silent comment — `npx eslint .` was red on HEAD without it.
  - Flake note (not this change): one full-suite run had cli-behavior fail 2 tests
    transiently; twice green in isolation immediately after and green in both later full
    runs, `bin/cli.js` untouched here. If it recurs, suspect environment (temp-dir /
    interactive timing), not token-guard.
  - Doc fix riding along: 3.3's Verify hook count refreshed 206 → 217.
  - Next: 3.3b (`onPreToolUse`, CC 44 — same guard shape).

- **2026-07-25 — plan amendment: model routing tags (no substep executed).** A Fable 5 session
  tagged every remaining substep with its executing model — `· [opus]` / `· [fable]` at the END
  of the title, after the ` — `, so the SUBSTEP regex (`plan-progress.js:50`) never sees it;
  verified post-edit with a full plan-progress render (all 20 substeps parse, next → 3.3).
  Rationale: Opus 5 is half Fable's price ($5/$25 vs $10/$50 per MTok) and implementation burns
  ~75% of a session's tokens; Fable stays on plan/review work and trap-surface edits.
  Assignments: **3.3b opus** (3.3a's guard pattern is the template, byte-diff net),
  **3.3c fable** (`--analyze` digest machine interface + the attributeJump dedupe is a design
  seam), **3.4 + 3.6 fable** (the plan's own "highest-trap" flags: fleet-synced single file,
  cross-process sidecar protocol, byte-frozen strings), **3.5 / 3.7 / 3.8 / 3.9 / 3.10 opus**
  (pinned contracts + characterization/byte-diff nets make them execution tasks). Borderline
  call: 3.7 — the meter pricing fold is subtle, but its test-FIRST spec is prescriptive enough
  for Opus; restart on Fable if the fixture test drags. Also recommended, not added (user's
  call): a phase-end `[fable]` review substep over the accumulated Phase 3 diff
  (`git diff 8a94b78..HEAD` at the time), findings routed back to an Opus fix session.
  Addendum (same day): the legend now also requires every substep's closing message to end
  with the next-substep handoff line (`Handoff: /clear → /model <tag> → /continue`), so the
  switch instruction is emitted at each boundary instead of relying on the user's memory.
  Next: 3.3b (on Opus 5). Handoff: /clear → /model opus → /continue (next: 3.3b · [opus]).

- **2026-07-26 — plan amendment: refit to the four-budget authoring rules (no substep executed).**
  The plan was authored 2026-07-24; `.claude/rules/plan-authoring.md` gained the four binding
  budgets, the rent ceilings and the read-in-slices rule on 2026-07-25 (`0ad323b`, `ef5824e`).
  Audited the plan against them and applied six fixes. **Resume point unchanged: next → 3.3b**
  (verified by a full `plan-progress` render — all 25 substeps parse; the SUBSTEP regex's
  `(\d+\.\w+)` accepts letter suffixes, so nothing renumbered).
  - **Read-in-slices header** added (traps `this doc:51-89` + own substep + `tail -80`), and
    every remaining substep gained a **Read list** with exact file line ranges. The god files
    are now named in the trap section with their sizes — token-guard.js **2,986** lines,
    terminal-title.js **1,740** — as Grep-then-Read-window only.
  - **Splits** (all were over-budget; none renumbered existing steps): 3.3 `L·~6h` → 3.3a/b/c
    (an XL, which the rules forbid); 3.4 → 3.4a (Stop guard + test, ships its own user-facing
    `Changelog:` line) / 3.4b (split handle()); 3.7 → 3.7a (meter, test-first) / 3.7b
    (fanVerdict, already has its net); 3.8 → 3.8a (characterization test) / 3.8b (extraction).
    20 substeps → 25; ~16h → ~15h left (the work is the same, the tags are honest).
  - **Discovery — a trap the plan was missing:** `token-guard.js` joined the fleet manifest on
    2026-07-25 (`scripts/sync-hook-fleet.js:32`, `global: false`). Every token-guard substep now
    owes `node scripts/sync-hook-fleet.js --write` + check mode; the old wording asked for it
    only on terminal-title. **Verified 2026-07-26: the fleet is ALREADY drifted** — check mode
    reports `wifi-app token-guard.js 6 lines behind` (job-agent-extension is in sync; `test` has
    no token-guard, correctly skipped). Left unsynced deliberately — it is another repo's copy
    and out of scope for a doc amendment — but the dev-box pre-push guard will block a push
    until `node scripts/sync-hook-fleet.js --write` runs. Clear it before/with 3.3b.
  - **Discovery — `/continue` contradicted the read budget:** its Step 3 said "Read the plan doc
    IN FULL". Fixed in the same change (`.claude/commands/continue.md` v5 → v6, three slices,
    defers to a plan's own header instruction). This is user-facing — it ships.
  - **Rent is now recorded**: every Ledger entry closes with a `rent:` line from the `--analyze`
    digest, checked against S ≈ 0.5M · M ≈ 1.5M · L ≈ 3M. No prior entry has one, so Phase 3's
    tags are still authoring-time guesses; correct a tag in the same commit if its rent misses.
  - Deliberately NOT applied: plan-authoring's "extract before you edit" (pure module in an
    earlier substep) — the ⛔ single-file hook constraint voids it. The trap section now says so
    explicitly, and names test-first-in-an-earlier-substep as the compensating lever (that is
    what 3.8a is). Completed substeps were not re-tagged; the model-routing legend is untouched.
  - rent: **5.2M processed / ≈673k effective** (97% cached re-reads), 49 requests, 32m wall,
    mean 105k resident, ending at 144k live context. Biggest single read was this doc at 9k
    tokens — which is the read-in-slices rule paying for itself in the very session that wrote
    it. ⚠ **First rent line in this repo, and it exposes an ambiguity in the rule:** tagged M
    (ceiling ≈1.5M), which the *headline* blows past 3.5× and the *effective* figure clears
    comfortably. `.claude/rules/plan-authoring.md` says to "read it off the session's own token
    usage" without saying WHICH number, and at 97% cache the two differ by ~8×. Later entries
    must record both until the rule picks one. Caveat on this datum: the session also carried
    the audit and the write-up, not just the edits.
  - Next: 3.3b (on Opus 5). Handoff: /clear → /model opus → /continue (next: 3.3b · [opus]).

- **2026-07-26 — Read-list re-pointing (no substep executed).** A `/continue` aimed at 3.3b
  found the working tree dirty and `token-guard.js` being written live by another session.
  Stood down rather than execute; that session landed `3cf38d3` (R14 gate verdicts) and
  `df538aa` (fleet drift direction), both of which moved the line numbers this plan points at.
  Re-verified every token-guard range by grepping the function starts and corrected them:
  - 3.3b `onPreToolUse` `:2225-2418` → **`:2288-2498`** (the function itself grew ~17 lines —
    `gateVerdict` is now called at the top and `choiceBullet` renders R13b's and R14's Choice
    bullet, so the decomposition has two more collaborators than the substep anticipated);
    `emitBlock`/`PROMPT_GUARDS` `:2128-2179` → `:2191-2242`; `ask`/`deny` `:2419-2462` →
    `:2500-2543`; Read-list total ~310 → ~330 lines; Verify's hook-test count 217 → **240**.
  - 3.3c `analyzeSession` `:2580-2710` → `:2661-2790`; `renderAnalysis` `:2711-2777` →
    `:2792-2858`. 3.8a/3.8b `report` `:2861-2986` → `:2942-3067`. File size 2,986 → **3,067**
    lines (header line 29 + trap section + both Read lists).
  - **Pre-existing error, unrelated to the shift:** 3.7a pointed at `:270-336` for the
    `PRICES` / `CACHE_*_X` block, which actually lives at **`:198-211`** — 270-336 is the
    config DEFAULTS block. Its own "grep `CACHE_READ_X` if the range has drifted" hedge is
    what kept this from biting; corrected anyway.
  - Unshifted and re-verified as still correct: `meter` `:337-402`, `meterSession` `:422-471`,
    `fanVerdict` `:803-873`, `workflowSource` `:874-895`, `attributeJump` `:472-506` — every
    one sits ABOVE the insertion point, which is why only the tail moved.
  - **Discovery — a plan's Read lists rot silently.** Nothing in the repo checks them: they are
    prose, so a stale range costs the executing session a wrong window and a re-read, and the
    session cannot tell it was misled. Any commit that edits a god file must re-point the plan
    ranges below it in the same commit, the way a doc/rule reference is already required to be.
  - Resume point unchanged: **next → 3.3b**, on Opus 5.

- **2026-07-26 — 3.3b decompose `onPreToolUse` — DONE.** Commit `b93e701`, `npm test` green
  before and after (EXIT=0; **240** hook tests, 20 `ALL TESTS PASSED` banners), fleet sync
  written + re-checked at zero drift, `sync-docs` regen byte-identical (nothing to commit).
  - The CC-44 handler is now **6 lines**: a `ctx` literal plus a fold over `PRETOOL_GUARDS` =
    [`r2WorkflowLaunchGuard`, `r8PayloadDoorGuard`, `r9MiniBombGateGuard`, `r3PostBombGateGuard`],
    with the single exit mapping the winning guard's `kind` to `ask`/`deny`.
  - **Deviation from 3.3a's shape, deliberate:** these guards RETURN a decision (`{kind, reason}`
    or nothing) instead of accumulating `{notes, block}`. PreToolUse has no notes channel — it
    asks, denies, or stays silent — so `emitBlock`'s save+block+return beat had nothing to
    centralize here. State stays lazy (`preState(ctx)` loads on first use), which is what keeps
    the common path — every tool call in the session — off disk, exactly as the original did.
  - Second-level extractions the CC ≤ 9 bar forced: `gateAsk`, `skipVerdict`, `wfEstimate`,
    `fanDecision` (R2's two-tier deny-vs-ask), `doorSizes`, `payloadAskCopy`. Measured:
    `onPreToolUse`=5 · `preState`=2 · `gateAsk`=1 · `skipVerdict`=2 · `wfEstimate`=5 ·
    `fanDecision`=5 · `r2WorkflowLaunchGuard`=8 · `doorSizes`=4 · `payloadAskCopy`=4 ·
    `r8PayloadDoorGuard`=8 · `r9MiniBombGateGuard`=2 · `r3PostBombGateGuard`=2. Nothing above 8.
  - Verify per the item: a **byte-parity smoke** — six real PreToolUse payloads, each composing
    several rules (R2 winning over R9+R3; the R8 skill door; the R8 read door; the R9
    accumulator; the R3 post-bomb gate; the silent fall-through) — run against the new hook AND
    against `git show HEAD:` of the old one. All six preserved the original rule order and were
    byte-identical old-vs-new. Ratchet baseline shrank by exactly `Function 'onPreToolUse'` in
    the same commit. CRLF trap held: 3,144 LF = 3,144 CRLF, zero strays.
  - The smoke's first run reported one FAIL that was **the fixture's bug, not the hook's**: R8's
    read door got a relative path, so `readSizes` found nothing and fell through. Absolute path
    fixed it. Worth repeating in 3.3c/3.8a — a path-shaped fixture must be absolute.
  - **Fleet sync — the gap was 36× what the last entry saw.** Both `job-agent-extension` and
    `wifi-app` were **219 lines** behind on token-guard.js (the 2026-07-26 entry measured 6, on
    wifi-app only); `3cf38d3`/`52ea8c0`/`50bfb9a` widened it in between. Written and re-checked
    at zero drift, so the dev-box pre-push guard is clear. Lesson: the drift number in a Ledger
    entry is stale the moment another session commits — re-check, never trust the recorded one.
  - **Read lists re-pointed in this commit** per the rule the last entry established. The file
    grew 3,067 → **3,144**, a uniform **+77** below the edit point: 3.3c `analyzeSession`
    `:2661-2790` → **`:2738-2867`**, `renderAnalysis` `:2792-2858` → **`:2869-2935`**; 3.8a/3.8b
    `report` `:2942-3067` → **`:3019-3144`**; header + trap-section file size 3,067 → 3,144.
    Re-verified as unshifted (every one sits ABOVE the edit): `meter` `:337-402`, `meterSession`
    `:422-471`, `attributeJump` `:472-506`, `fanVerdict` `:803-873`, `workflowSource` `:874-895`,
    `PRICES`/`CACHE_*_X` `:198-211`.
  - **Substep spanned two sessions** — the first (`49548749`) did the whole refactor and the
    entire Verify gate, then was interrupted at the `--write` fleet-sync call; the second
    (`82d1afa7`, `/continue` on a mid-flight tree) re-ran the suite, synced, committed, ledgered.
    The split cost little because the handoff was mechanical, but note the asymmetry: session 1
    paid ~27k on `/continue`'s full-recovery path (`Read(recover-context.md)` 14k +
    `Read(recovered-context.json)` 13k, its two largest payloads), session 2 paid ~0 by
    extracting the transcript tail inline. A mid-flight recovery does not need the full ladder
    when the plan doc + `git status` already say what is unfinished.
  - rent: **4.1M processed / ≈596k effective** across both sessions (2.5M/353k over 26 requests,
    then 1.6M/243k over 21), 47 requests, 25m wall, 95% cached both times, ending at 95k live
    context. L ceiling ≈3M: the tag **holds on the effective figure and misses 1.4× on the
    headline** — the same ambiguity 3.3a's entry flagged, now on a second data point. Tag left
    at L; `.claude/rules/plan-authoring.md` still needs to say WHICH number the ceiling means.
  - Next: 3.3c (`analyzeSession`, CC 52 — the frozen-wording trap surface).
    Handoff: /clear → /model fable → /continue (next: 3.3c · [fable]).
