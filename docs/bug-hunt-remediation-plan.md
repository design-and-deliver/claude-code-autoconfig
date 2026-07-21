# Bug-Hunt Remediation Plan

**Goal:** fix the 21 correctness defects found in the 2026-07-20 bug hunt, safest-and-cheapest
first, each behind a **fail-first test** that proves the bug was real and the fix closes it.

**Source evidence:** `docs/audit/04-bug-hunt.md` (the ranked ledger — every finding below cites
its `BH-N` id, file:line, severity, confidence, and failure scenario there). Human-readable
summary: `ARTICLES/correctness-bug-hunt.html`.

**How to execute this plan**

- **One substep per fresh session**, in order, top to bottom. Each substep is self-contained:
  read only this doc's header (traps + rails), the substep, and the `BH-N` finding(s) it cites in
  `docs/audit/04-bug-hunt.md`.
- Every substep ends with a **Verify** step (real commands, fail-first where noted) and a
  **commit**. Do not start the next substep in the same session.
- **After Verify + commit: append a Ledger entry** (bottom of this doc), check the substep's box,
  then `/clear` and `/continue` — /continue is plan-aware: it reads the Ledger, verifies the last
  commit hash, and starts the next unchecked substep.
- This repo is a **published npm package with real users**. Nothing here is deployed: per
  `.claude/rules/deploy-approval.md`, never run `npm version`/`npm publish` without the user
  explicitly saying so.
- **Fail-first is the honest gate** (the bug-fix analog of the maintainability plan's re-verify
  grep): for each fix, first write/extend a test and confirm it **fails against current code**
  (stash the fix or check out HEAD to prove it), then apply the fix and confirm it passes. For a
  `CONFIDENCE: low` or `LATENT` finding, the fail-first test IS the reproduction that decides
  whether the bug is real — if it can't be made to fail, say so in the Ledger and skip the fix.

---

## ⛔ Standing trap warnings — read before ANY substep

These fixes touch the exact trap surfaces catalogued in `CLAUDE.md` (Invariants & Landmines) and
`docs/weak-model-maintainability-plan.md` (its 12-item trap list). Read those in full before a
substep that edits a trap surface. The load-bearing ones for THIS plan:

1. **Additive-only serialized state (BH-1, BH-3, BH-10).** Never rename/repurpose a field in any
   file that lives in user projects: `.claude/.autoconfig-plugins.json` (the plugins ledger),
   `autoconfig-update.md`'s `@applied` block, `.claude/settings.json`, `cca.config.json`,
   `.autoconfig-whats-new.json`. Fixes that need to remember more (e.g. BH-1's "which keys did we
   actually add") **add a new optional field with a safe default** — old files without it must
   still behave correctly (fall back to today's behavior).
2. **`.claude/hooks/terminal-title.js` is the canonical fleet copy (BH-5, BH-16).** Edit only this
   file, then run `node scripts/sync-terminal-title.js --write`, then `npm test`. The parity test
   `live-twin-parity.test.js` **skips on CI** — CI green ≠ fleet in sync. Never split the file.
3. **`.claude/scripts/sync-docs.js` writes a generated file (BH-2, BH-14, BH-15).** Never
   hand-edit `.claude/docs/autoconfig.docs.html` — fix the generator and regenerate. The `MARKERS`
   table + `assertMarkersUnique` (and the byte-for-byte docs ratchet in `test/contracts.test.js`,
   made idempotent in the maintainability plan's 3.5) must survive; these fixes change escaping /
   anchoring, not the marker anchors. Run sync-docs twice — output must stay byte-identical.
4. **Hook `command` strings in settings.json are identity (BH-4, BH-17).** `mergeSettingsInto`
   dedups by exact command string; the two Notification entries must stay distinct (`--idle-rescue`
   selects a different code path — never merge them). A fix that changes dedup granularity must not
   make an upgrade ADD a duplicate hook (that's the very bug being fixed — regression-test it).
5. **token-guard `--analyze` digest headers + ledger field names are a frozen machine interface
   (BH-6, BH-7).** `RENT`/`BOMBS`/`FLEETS`/`TTL`/"live context at end" and the `.titles/*.history.jsonl`
   `ts`/`title`/`tokens` fields are read by `/analyze-session`, `/eval-new-session`,
   `/migrate-new-session`. Fix the LOGIC that produces/consumes them; never rename them.
6. **Hooks fail silent by design.** token-guard, terminal-title, auto-guard, format swallow errors
   and exit 0. A regression won't crash — it silently stops warning/painting. "It didn't error"
   proves nothing: run the hook suites (`npm run test:hooks`, fanned out from `npm test`).
7. **Changelog discipline.** Keep the `feat:`/`fix:` subject prefix; user-facing wording goes in a
   `Changelog:` body trailer written for a CCA user (name the visible outcome, no internals).
   **Dev-gated work carries `Changelog: none`** — token-guard (BH-6, BH-7), `ccr` (BH-11),
   `sync-terminal-title` (BH-12), and any maintainer-only script are never shipped, so announcing
   them on the upgrade screen is a bug.
8. **`bin/cli.js` has no `main()` (BH-3, BH-8, BH-18, BH-19, BH-21).** Correctness is top-level
   statement order (previousVersion before copy, snapshot before copyDir, whats-new before the
   `--bootstrap` early-exit, pin gate before any copy). Never reorder top-level statements without
   re-verifying these. Never extract the ANSI boxes or `DEV_ONLY_FILES` literal (tests regex the
   source).
9. **New `test/*.test.js` → append it to the `npm test` chain in package.json** (nothing
   auto-discovers it). New `.claude/hooks/tests/*.test.cjs` IS auto-discovered by
   `test/hook-tests.test.js` — verify it matches the `!.claude/hooks/tests/**` tarball negation.

**Global safety rails for every substep**

- Where docs and code disagree, **fix the docs to match the code** — never the reverse.
- `npm test` starts green and must be green before every commit (full suite, incl. hook suites).
- Fixes to user-facing serialized state are **additive-only** (trap 1) — flag any violation
  instead of writing it.
- Deleting/renaming a file a doc or rule references → update that doc **in the same substep**.

---

## Phase 1 — Stop the active bleeding (confirmed-live + one-line guards)

Cheapest real fixes; one is already visible to users today. No serialized-state or trap surface.

### ☑ 1.1 · S · ~15m — Keep `revert:`/merge commits out of the changelog + upgrade screen (BH-9)

`scripts/generate-changelog.js:57-60` — `isHousekeeping`/`SKIP_TYPES` enumerate
`chore/docs/test/ci/build/style` but never `revert` or merge commits, so they leak into
`CHANGELOG.md` and (via `bin/update-summary.js:23` `classifyBullet`) onto users' upgrade screens.
**Confirmed live:** `CHANGELOG.md:173` currently shows `- revert: remove /extract-rules …`.

- [x] Add `revert` to `SKIP_TYPES` (or `isHousekeeping`) in `generate-changelog.js`; run the log
      query with `--no-merges` (or filter `^Merge ` / `^Revert ` subjects) so merge commits drop too.
- [x] Mirror the same skip in `bin/update-summary.js:classifyBullet` so an already-committed
      `revert:` (like the live one) doesn't surface on upgrade — OR add a `CHANGELOG.md` OVERRIDES
      `null` row in `generate-changelog.js` for the existing leaked bullet (it's already in git).
- [x] Extend the changelog-generation test (`test/*changelog*`) with a `revert:` + a `Merge branch`
      fixture commit → assert neither appears in the generated output.

**Verify:** the new fixture asserts fail against current code (spot-check), pass after; regenerate
is NOT run here (no `npm version`) — just assert the generator's output on fixtures; `npm test` green.
**Commit:** `fix(changelog): drop revert/merge commits from the changelog and upgrade summary` +
body `Changelog: Revert and merge commits no longer clutter the release notes`.

### ☑ 1.2 · S · ~15m — Platform-guard `cleanupNulFile` so it can't delete a real `nul` on POSIX (BH-8)

`bin/cli.js:57` — the `nul` artifact is Windows-only (`> nul` residue), but `cleanupNulFile` runs
on every platform (also on Claude exit, :819), so a legitimately-named `nul` file on Linux/macOS
is silently `unlinkSync`'d with no backup.

- [x] Gate the unlink on `process.platform === 'win32'` (smallest correct fix; no top-level
      reorder — trap 8).
- [x] Add a behavioral assertion in `test/cli-behavior.test.js`: on a non-win32 run (or by calling
      the guarded helper), a file named `nul` in a fixture root **survives**. If the helper isn't
      exported, assert via the `--bootstrap` fixture that a pre-seeded `nul` is untouched.

**Verify:** the new assertion fails against current code on this Windows box only if simulated —
so drive it by faking `process.platform` or by unit-testing the guard; `npm test` green.
**Commit:** `fix(cli): only clean up the Windows nul artifact on Windows` + body
`Changelog: A file named 'nul' in your project is no longer removed on macOS/Linux`.

---

## Phase 2 — Settings merge/unmerge data loss (the plugin path)

Real user-facing config loss. Touches the plugins ledger (trap 1 additive-only) and hook dedup
(trap 4). Each fix is a fail-first regression test first.

### ☑ 2.1 · L · ~1.5h — Stop `plugin remove` from deleting the user's OWN config (BH-1)

`bin/lib/settings-merge.js:136` — `unmergeSettingsFrom` removes any key whose value equals the
fragment's, but `mergeSettingsInto` is dedup-safe and never records which keys it **actually
added**, so a key the user already had (env/hook/permission) matching the fragment is wrongly
deleted on remove.

- [x] Make merge record the true delta: when `mergeSettingsInto` adds a key/hook/permission, record
      it (e.g. the plugins ledger entry at `plugins.js:114` gains an **additive optional**
      `addedKeys`/`addedPaths` field — trap 1: old ledgers without it must fall back to today's
      value-equality behavior, so absence ≠ "delete nothing" unless you choose that as the safe
      default; decide and document which).
- [x] `unmergeSettingsFrom` removes only what the ledger says was added; never a user-owned key.
- [x] Fail-first test (extend `test/plugin-system.test.js`, already end-to-end): fixture user
      settings with `env.X:"1"` pre-existing → install a plugin whose fragment also sets `env.X:"1"`
      → `plugin remove` → assert `env.X` **survives**. Add the hook (:125) and permission (:145)
      variants. Confirm it fails on HEAD, passes after.

⚠ Trap 1: the ledger shape is serialized in user projects — the new field is additive, defaulted,
and old ledgers must round-trip. ⚠ Trap 4: don't change hook dedup semantics here (that's 2.2).

**Verify:** fail-first proven (test red on HEAD, green after); `npm test` green (plugin-system
end-to-end must pass).
**Commit:** `fix(plugins): plugin remove no longer deletes settings the user set themselves` +
body `Changelog: Removing a plugin now keeps any env/hook/permission you had configured yourself`.

### ☐ 2.2 · M · ~45m — Fix the hook that gets added twice on merge (BH-4, BH-17)

`bin/lib/settings-merge.js:72` — the per-hook existence scan is event-wide but the insert pushes
the **whole fragment matcher**, so a hook already present under a different matcher is re-added and
fires twice. `:36` (BH-17, **low-confidence** — verify first) — `migrateLegacyHookCommands`'s
`$`-anchored regex misses a relative command carrying an arg (`--idle-rescue`), so it isn't
rewritten and merge then adds the anchored form alongside it.

- [ ] BH-4: merge at hook granularity — when introducing a new matcher, drop hooks whose command
      already exists elsewhere in that event (or dedup post-merge). Preserve exact-string dedup
      (trap 4) and the two distinct Notification entries.
- [ ] BH-17 (verify-first): construct the relative `…terminal-title.js --idle-rescue` input and
      confirm the current regex fails to anchor it. If real, widen the pattern to tolerate a
      trailing arg; if no such relative form ever shipped, record that in the Ledger and skip.
- [ ] Fail-first test (extend `cli-install.test.js`'s settings-merge tests, now `require`-ing
      `bin/lib/settings-merge.js`): a user Notification hook + an overlapping fragment matcher →
      assert the command appears **once** after merge. Red on HEAD, green after.

⚠ Trap 4: an upgrade must never ADD a duplicate hook — that's the bug; regression-test it.

**Verify:** fail-first proven; `npm test` green.
**Commit:** `fix(settings): merging a new matcher no longer duplicates an existing hook` + body
`Changelog: Upgrades no longer register a hook twice when settings share a hook across matchers`.

### ☐ 2.3 · M · ~45m — Make plugin re-install clean up its old files (BH-10)

`bin/lib/plugins.js:111` — re-install replaces `ledger[name].files` with only the new manifest's
list, so files a previous version installed become orphans `plugin remove` can never delete.

- [ ] On re-install, diff old vs new file lists and remove files the new manifest dropped (or make
      the ledger cumulative). Keep the ledger shape additive (trap 1). Guard against a mid-copy
      throw leaving an untracked orphan (write-ledger-after-copy already exists; consider recording
      intent first).
- [ ] Fail-first test (extend `test/plugin-system.test.js`): install v1 `[a,b]`, re-install v2
      `[a]`, `plugin remove` → assert `b` is gone. Red on HEAD, green after.

**Verify:** fail-first proven; `npm test` green.
**Commit:** `fix(plugins): re-installing a plugin removes files its old version left behind` + body
`Changelog: Reinstalling then removing a plugin no longer leaves orphaned files behind`.

---

## Phase 3 — Update delivery

### ☐ 3.1 · M · ~45m — Don't mark not-yet-run updates as applied on bootstrap (BH-3)

`bin/cli.js:640` — on an upgrade, `copyDir` (:482) overwrites the user's `autoconfig-update.md`
with the shipped empty-`@applied` copy, then the pre-mark block refills it with **all** bundled
update ids — so a pending/skipped update is silently marked done and never runs. `LATENT` today
(all 3 current updates also run via `/autoconfig`), but a real hole for any future instruction-only
update.

- [ ] Guard the pre-mark: only mark ids as applied when they genuinely have been (mirror the
      `--pull-updates` path in `bin/lib/updates.js`, which re-injects the user's real `@applied`
      block before copy). Preserve the user's pre-existing `@applied` across the `copyDir` overwrite
      instead of refilling from empty. ⚠ Trap 1 (the `@applied` block is user-serialized) + trap 8
      (no top-level reorder in cli.js).
- [ ] Fail-first test (extend `test/cli-behavior.test.js`'s upgrade-with-`@applied` fixture): a
      fixture with a **pending** update id not in the user's `@applied` → run `--bootstrap` upgrade
      → assert that id is NOT marked applied (so `--pull-updates` would still deliver it). Red on
      HEAD, green after.

**Verify:** fail-first proven; `npm test` green (the @applied fixture exercises cli.js:87-153).
**Commit:** `fix(updates): an upgrade no longer marks pending updates as already applied` + body
`Changelog: Configuration updates that haven't run yet are no longer skipped after an upgrade`.

---

## Phase 4 — sync-docs generator landmines (latent, high-impact)

All in `.claude/scripts/sync-docs.js`. Generated file (trap 3): fix the generator, regenerate, and
keep the byte-for-byte ratchet green. The shared test surface is `test/contracts.test.js`'s docs
ratchet — extend it with adversarial-preview fixtures.

### ☐ 4.1 · L · ~1.5h — Escape preview content so a `};` or `</script>` can't break the docs page (BH-2, BH-15)

`sync-docs.js:721/678` — the object-end anchor `indexOf('};', …)` mis-anchors on a `};` inside a
discarded entry's template literal (`escapeTemplateLiteral` at :237-242 doesn't escape `}`), so any
documented JS preview containing `};` silently blanks the docs page on the next sync. `:479-482` —
the same escaping never neutralizes an HTML `</script>` inside a preview, which would terminate the
docs `<script>` block.

- [ ] Fix the anchoring/escaping so preview content can't be mistaken for structure: escape `}` (or
      anchor the object end on a marker that cannot appear in content), and neutralize `</script>`
      (e.g. `<\/script>`) in `escapeTemplateLiteral` since output is injected into HTML.
- [ ] Keep `MARKERS` + `assertMarkersUnique` intact (trap 3); if the end-anchor changes, update
      `assertOnceInSection`/`assertMarkersUnique` to match in the same substep.
- [ ] Regenerate: `node .claude/scripts/sync-docs.js` twice — output must stay **byte-identical**
      (idempotency from maintainability-plan 3.5 must hold), commit the regenerated HTML if changed.
- [ ] Fail-first test (extend `test/contracts.test.js`): a temp fixture command/hook whose preview
      contains `};` and `</script>` → run sync-docs → assert the produced HTML still parses/round-
      trips (object closes at the real terminator; no early break). Red on HEAD, green after.

⚠ Trap 3: never hand-edit `autoconfig.docs.html`. The byte-for-byte ratchet must still pass.

**Verify:** fail-first proven; sync-docs idempotent (two runs byte-identical); `npm test` green.
**Commit:** `fix(docs): preview content containing }; or </script> can no longer break the docs page` +
body `Changelog: none` (internal docs generator; no user-visible docs change).

### ☐ 4.2 · M · ~45m — Make the brace-walker ignore braces inside kept structural entries (BH-14)

`sync-docs.js:657-666` (treeInfo) and `:703-712` (fileContents) — the brace-depth walker that finds
the end of the kept `claude-md`/`claude-dir` entry counts every literal `{`/`}` including those in
string/template values, so a brace in those hand-authored entries mis-locates the boundary. LATENT
(kept entries are brace-free today; the `rules` static desc already ships inline `<div style=…>`).

- [ ] Make the boundary detection value-aware (skip braces inside strings/template literals) or
      anchor the kept-entry end on a marker rather than raw brace-counting. ⚠ Trap 3.
- [ ] Regenerate twice → byte-identical; commit HTML if changed.
- [ ] Fail-first test (extend `test/contracts.test.js`): temporarily give a kept-entry desc a `{` in
      a fixture → assert the splice still finds the right boundary. Red on HEAD, green after.

**Verify:** fail-first proven; idempotent; `npm test` green.
**Commit:** `fix(docs): sync-docs boundary detection ignores braces inside entry values` + body
`Changelog: none`.

---

## Phase 5 — Hook correctness (title / lineage / beeps)

### ☐ 5.1 · L · ~1.5h — terminal-title lineage + watchdog correctness (BH-5, BH-16)

Both edit the canonical fleet copy `.claude/hooks/terminal-title.js` (trap 2 — sync + parity once
covers both). BH-5 (`:834`) — a flaked ancestry walk returns early **before** writing the terminal
occupant, so the next session records the wrong predecessor and bare `/recover-context` recovers the
wrong session. BH-16 (`:1338/1344`, **low-confidence — repro first**) — before a title is authored
the find-needle is the bare folder name, so with two tabs on one repo the watchdog may latch the
sibling's pid and paint/probe the wrong console.

- [ ] BH-5: refresh (or invalidate) the terminal-occupant record even when the ancestry walk
      misses, so a transient flake can't poison the next session's lineage. ⚠ Trap 1 (lineage/occupant
      files are serialized — additive/behavioral fix, no field rename).
- [ ] BH-16 (verify-first): reproduce the two-tab, pre-title needle collision; if real, add a
      uniqueness/"block-not-act" safeguard to the paint/liveness path (mirror the kill decision's
      block-don't-act). If not reproducible, record in the Ledger and skip.
- [ ] After editing: `node scripts/sync-terminal-title.js --write`, then `npm test` (parity).
- [ ] Fail-first test (extend `.claude/hooks/tests/` terminal-title suites): simulate a walk-miss →
      assert the occupant record is not left stale (predecessor resolves correctly). Red on HEAD,
      green after.

⚠ Trap 2: edit only the canonical copy; the parity test skips on CI — verify on this machine.

**Verify:** fail-first proven; `node scripts/sync-terminal-title.js` (check mode) reports no drift;
`npm test` green (live-twin parity passes here).
**Commit:** `fix(terminal-title): a flaked ancestry walk no longer corrupts session lineage` + body
`Changelog: /continue and /recover-context more reliably find the previous session in a terminal`.

### ☐ 5.2 · M · ~45m — Make the arcade beep agree with the tab glyph on awaiting (BH-13)

`.claude/hooks/arcade-beeps.js:132` — a turn ending on a formulaic offer (no `?`, no `.ask` flag)
paints ◐ awaiting in terminal-title but reads only `q.ends` in arcade-beeps, so it plays the
"complete" tone. Reuse the `solicits` field terminal-title branches on so sound and glyph agree.

- [ ] Read `inspectLastResponse`'s `solicits` (the lexical-awaiting path), not just `q.ends`; mirror
      terminal-title's Stop decision. Watch the `.ask` one-shot race noted in BH-13 (don't depend on
      a flag terminal-title may have already consumed).
- [ ] Fail-first test (extend `.claude/hooks/tests/` beep/arcade suite, if present, else add one and
      it's auto-discovered — trap 9): a formulaic-offer Stop payload → assert the awaiting tone, not
      complete. Red on HEAD, green after.

**Verify:** fail-first proven; `npm run test:hooks` + `npm test` green.
**Commit:** `fix(arcade-beeps): play the awaiting tone when the tab shows awaiting` + body
`Changelog: The awaiting/complete status beep now matches the tab indicator`.

---

## Phase 6 — token-guard + dev tooling (dev-gated — `Changelog: none`)

Never shipped to users (trap 7). Fixes here improve the maintainer's own experience only.

### ☐ 6.1 · M · ~45m — token-guard: stop dropping queued warnings + fix the spike runway (BH-6, BH-7)

`.claude/hooks/token-guard.js:1731/1874` (BH-6) — a `decision:'block'` early-return discards the
already-populated `notes[]` after its one-shots were consumed, losing fleet-receipt/bomb/drift/idle/
spike warnings for good. `:1859` (BH-7) — the spike baseline timestamp advances on 180s-cache HITS,
so the rate denominator can span less time than the numerator accrued over → wrong (too-short)
runway and spurious confirm-card interrupts.

- [ ] BH-6: emit the accumulated `notes` even on a block (or don't burn the one-shots before the
      emit). ⚠ Trap 5: don't touch the digest header strings/ledger fields.
- [ ] BH-7: only advance `lastWindowAtIso` when the pct baseline actually changes (a fresh fetch),
      not on cache hits — keep numerator and denominator on the same interval.
- [ ] Fail-first tests in `.claude/hooks/tests/` (auto-discovered — trap 9): (a) a blocked prompt
      with a queued note → assert the note still emits; (b) a cache-hit sequence → assert the runway
      denominator spans the true interval. Red on HEAD, green after.

**Verify:** fail-first proven; `npm run test:hooks` + `npm test` green.
**Commit:** `fix(token-guard): don't drop queued warnings on a blocked turn; fix spike-runway math` +
body `Changelog: none`.

### ☐ 6.2 · S · ~20m — Dev-tool loudness: ccr corrupt-pointer message + fleet CRLF drift (BH-11, BH-12)

`bin/ccr.js:26-32` (BH-11) — absent / unparsable / invalid all collapse to `null`, so a corrupt
`recover.json` is reported as "no pointer here." `scripts/sync-terminal-title.js:39,66` (BH-12) —
`norm()` strips `\r`, so a CRLF-vs-LF-only drift reads "in sync" and never gets rewritten (and
`driftLines` is one-directional → "0 lines behind" for a strict-subset divergence).

- [ ] BH-11: distinguish absent from corrupt in `readPointer`; print a "pointer is corrupt" message
      for the parse-error case.
- [ ] BH-12: make the drift comparison byte-exact (don't strip `\r`) so the "byte-derived artifact"
      promise holds; count drift in both directions.
- [ ] Small assertions: a corrupt `recover.json` fixture → ccr prints the corrupt message; a
      CRLF-only-divergent target → sync-terminal-title check-mode reports drift (exit 1).

**Verify:** the assertions fail against current code, pass after; `npm test` green.
**Commit:** `fix(devtools): ccr distinguishes a corrupt pointer; fleet drift check is byte-exact` +
body `Changelog: none`.

---

## Phase 7 — Narrow mop-up (low severity / confidence)

### ☐ 7.1 · M · ~45m — Backup correctness: timestamp collision + nested-name exclusion (BH-18, BH-19)

`bin/cli.js:317` (BH-18) — two installs in the same clock minute reuse `migration/<timestamp>/`
(no seconds) and the second copy overwrites the first backup. `:281` (BH-19) — `copyDirForBackup`
applies the top-level `AUTOCONFIG_FILES` name filter at every recursion depth, so
`.claude/mynotes/scripts/build.sh` is skipped and an all-such-names folder yields an empty backup
that still prints "Backup triggered by user content."

- [ ] BH-18: make the backup folder unique (append seconds or a counter) before `mkdirSync`.
- [ ] BH-19: apply the `AUTOCONFIG_FILES` exclusion only at the top level of the walk, not at depth.
      ⚠ Trap 8 (no top-level reorder in cli.js).
- [ ] Fail-first test (extend `test/cli-behavior.test.js`): a nested `scripts/` under a user folder
      → assert it's included in the backup. Red on HEAD, green after. (Collision is timing — assert
      via the naming helper.)

**Verify:** fail-first proven; `npm test` green.
**Commit:** `fix(cli): backups are unique-per-run and include nested user files` + body
`Changelog: Backups during upgrade are now unique per run and capture nested files you added`.

### ☐ 7.2 · S · ~20m — Small guards: pin-gate null + pipe-to-shell deny (BH-21, BH-20)

`bin/cli.js:182` (BH-21, **low-confidence — TOCTOU**) — `delete cfg.pinVersion` on a `null`
`readCcaConfig()` throws uncaught; the sibling gls migration (:518) guards with `|| {}`.
`.claude/hooks/auto-guard.js:42` (BH-20, belt-only/fail-open) — the single-stage `download|shell`
deny regex is evaded by `… | tee | bash`, `bash <(curl url)`, `sh -c "$(curl url)"`.

- [ ] BH-21: guard the re-read (`readCcaConfig() || {}`) to match :518. ⚠ Trap 8.
- [ ] BH-20: widen the deny to catch multi-pipe stages and command/process substitution (it's a
      belt over tool-level deny rules — keep it fail-open, just less porous). If widening risks
      false-denies, record the trade-off in the Ledger.
- [ ] Small assertions: null-config path doesn't throw; the evasion strings are denied (or the
      decision recorded).

**Verify:** assertions fail against current code where applicable, pass after; `npm test` green.
**Commit:** `fix: guard pin-gate against corrupt config; tighten pipe-to-shell deny` + body
`Changelog: none` (internal robustness; no user-visible behavior change).

---

## Deferred — considered and deliberately not planned

- **BH-16 hard fix without a repro:** if 5.1 can't reproduce the sibling-tab pid collision, do NOT
  speculatively rewrite the watchdog's pid resolution — the "block-not-act" safeguard is the bounded
  fix; a full per-session pid handshake is a redesign, out of scope for a bug-fix pass.
- **A uniform corrupt-JSON policy across all readers:** the maintainability plan's 2.3 already made
  the dangerous cli.js JSON reads loud; the remaining dev-tool cases (BH-11) are handled in 6.2. A
  blanket `swallow(tag, err)` channel stays deferred (it touches the fleet + token-guard contracts).
- **Escaping every possible HTML-injection vector in sync-docs previews:** 4.1 fixes the two known
  breakers (`};`, `</script>`); a full HTML-sanitizer on preview text is over-engineering for a
  generator whose inputs are the repo's own files.

---

## Ledger

Append one entry after each substep, newest last. Format:

```
### YYYY-MM-DD — substep N.N — <done|partial|blocked>
- Commit: <hash> <subject>
- Fail-first: <how the bug was reproduced red before the fix, or why not>
- Deviations: <what differed from the plan and why, or "none">
- Discoveries: <anything a later step needs, with file:line pointers>
```

### 2026-07-21 — substep 1.1 — done
- Commit: bb84636 fix(changelog): drop revert/merge commits from the changelog and upgrade summary
- Fail-first: added two red assertions before the fix — `changelog-gen.test.js` (isHousekeeping
  must catch `revert:`, `revert(scope):`, git `Revert "…"`, `Merge branch`, `Merge pull request`,
  while a feat/fix merely *mentioning* revert/merge survives) failed with `Error: revert:`, and
  `update-summary.test.js` (a `revert:` bullet sitting in a committed CHANGELOG.md must not surface
  on the upgrade screen) failed with `Error: the revert bullet is dropped`. Both green after the fix.
- Deviations: took BOTH mitigations rather than the "OR". In `generate-changelog.js`, `isHousekeeping`
  now matches `^(chore|revert)(:|\()` plus git's own `^(Merge |Revert )` subjects, AND the log query
  runs with `--no-merges` (structural belt for merges whose subject isn't the default). Chose the
  update-summary `SKIP_TYPES` add over a CHANGELOG.md OVERRIDES `null` row — it drops the leaked
  bullet from the live upgrade screen immediately without hand-editing the generated CHANGELOG.md
  (trap: never hand-edit generated files; regen was intentionally NOT run — no `npm version`).
- Discoveries: the confirmed-live leak is still physically present at `CHANGELOG.md:173`
  (`- revert: remove /extract-rules from deployed build`). It is now inert (SKIP_TYPES hides it on
  upgrade; the next `npm version` regen will drop it via isHousekeeping) — no action needed, but a
  later reader shouldn't be alarmed to still see the line in the file. Full suite green (EXIT=0).

### 2026-07-21 — substep 1.2 — done
- Commit: b634230 fix(cli): only clean up the Windows nul artifact on Windows
- Fail-first: proven RED→GREEN in-process. Wrote two assertions in `test/cli-behavior.test.js`
  ("a real `nul` file survives cleanup on POSIX (linux + darwin)" and "the stray `nul` artifact is
  still removed on Windows") that drive the extracted helper with an INJECTED platform. Against the
  unguarded logic the POSIX case failed (`Error: a `nul` file on Linux must not be deleted`); after
  the `win32` guard both pass. This is the honest cross-platform gate — see Deviation for why a
  `--bootstrap` fixture couldn't do it on this box.
- Deviations: (1) Rather than gate INLINE in cli.js (plan's smallest-fix wording), extracted
  `cleanupNulFile` to `bin/lib/nul-cleanup.js` with an injectable `platform` param (default
  `process.platform`) — idiomatic to this repo (bin/lib/ already holds plugins/settings-merge/
  updates) and the ONLY honest way to fail-first the guard: cli.js has no `main()`/`require.main`
  guard and no `module.exports`, so it can't be required in-process; and a child-process
  `--bootstrap` fixture can't fake `process.platform`. No top-level statement reorder (trap 8): the
  require sits with the other lib requires (cli.js:11); both invocation sites (:63 startup, :819
  Claude-exit) still fire in the same order, now `cleanupNulFile(cwd)`. (2) Test lives in
  cli-behavior.test.js as the plan specified, but as a direct-require unit test rather than a
  tree-driven fixture (that suite already mixes require-based lib checks per its own header).
- Discoveries: on THIS Windows box a real file named `nul` CAN be created in a mkdtemp temp dir
  (`fs.writeFileSync(dir/nul)` succeeds, `existsSync` true, `readdir` shows it, `unlinkSync` removes
  it) — the reserved-device interception did not apply for that temp path. So the post-fix behavior
  on Windows is unchanged (win32 still deletes the artifact); the guard only spares POSIX. No test
  grepped for the inline `cleanupNulFile` (safe to extract). Full suite green (NPM_TEST_EXIT=0,
  incl. hook suites 206/206).

### 2026-07-21 — substep 2.1 — done
- Commit: 469a031 fix(plugins): plugin remove no longer deletes settings the user set themselves
- Fail-first: proven RED→GREEN. Added three assertions to `test/plugin-system.test.js` (a fresh
  project whose settings.json has a user-set `env.SHARED_KEY`, a user Stop hook, and a user
  `WebSearch` allow rule; a plugin declares the exact same three; install → remove → all three must
  survive). `git stash push -- bin/lib/settings-merge.js bin/lib/plugins.js` (keeping the test) →
  all three RED against HEAD (`SHARED_KEY`/Stop hook/WebSearch each deleted); `git stash pop` →
  16/16 green. Full suite green (NPM_TEST_EXIT=0, hook suites 206/206).
- Deviations: (1) Named the additive ledger field `added` (not the plan's illustrative
  `addedKeys`/`addedPaths`) — one object holding the whole delta:
  `{ env:[key], hooks:{event:[command]}, permissions:{allow:[rule],deny:[rule]} }`. (2) **Decided the
  trap-1 fallback** the plan left open: a ledger entry with NO `added` field (pre-fix install) falls
  back to today's **value-equality** behavior on remove — NOT "delete nothing." Rationale: old plugins
  stay removable exactly as before (no regression, and no orphaned contributions left behind); only
  NEW installs gain the precise user-config-safe revert. Documented in the `unmergeSettingsFrom`
  header. (3) `mergeSettingsInto`/`unmergeSettingsFrom` gained an **optional third arg** — the
  upgrade path (`cli.js:593`, two-arg) and the direct merge tests in `cli-install.test.js` (two-arg)
  are untouched and record nothing, so behavior there is byte-identical. (4) Re-install unions the
  new delta onto the prior one (`seedAddedDelta` in plugins.js seeds the accumulator from the prior
  ledger entry) — a re-install adds nothing, so without the seed a post-re-install remove would
  revert nothing; the existing idempotency+remove test exercises exactly this path and stays green.
- Discoveries: `pluginAdd` now reads the ledger ONCE up front (was at old :110, after copy) to get
  the prior delta; write still happens at the end — no behavior change on the error path (a mid-copy
  throw still writes no ledger). The BH-4 "push the whole fragment matcher" quirk (2.2) means a
  multi-hook NEW matcher could otherwise under-record its later commands; guarded here by recording
  every command in a freshly-pushed matcher (`settings-merge.js` merge branch) — so 2.1's recording
  is already correct ahead of the 2.2 dedup fix. Note for 2.3 (BH-10): file cleanup on re-install is
  still unaddressed; the `added` union handles settings only, not orphaned files.
