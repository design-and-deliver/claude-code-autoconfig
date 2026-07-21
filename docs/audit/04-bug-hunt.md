# Correctness Bug Hunt — 2026-07-20

**Scope:** a *correctness* pass (real defects: wrong output / data loss / crash / silently-wrong
behavior), distinct from the maintainability audits (`00`–`03`) which targeted lies, silent
failures, and god-files. Five parallel hunters, one per subsystem: `bin/cli.js` install flow;
the extracted `bin/lib/*` modules; the hook scripts; the build/support scripts + `sync-docs.js`;
and `token-guard.js`.

**Status:** IDENTIFICATION ONLY — nothing is fixed. This is a first pass with per-finding
confidence, **not** adversarially re-verified. Before fixing any `CONFIDENCE: low` or `LATENT`
item, reproduce it first. Fixes on user-facing state must stay additive-only (see the plan's
standing traps).

**Severity key:** `high` = data loss / crash / wrong install for real users · `med` = wrong
behavior in a real but narrower path · `low` = narrow, cosmetic, or belt-only. token-guard is
dev-gated (never shipped), so its severities are capped at "misleads the maintainer."

**Counts:** 21 findings — 2 that already misbehave or lose data on a real path, 3 high-impact
landmines that are latent today, the rest narrower/dev-facing. 0 crashes on the normal
fresh-install / routine-upgrade paths (those were traced end-to-end and are sound).

---

## Tier 1 — fix first (real impact or high-value landmine)

### BH-1 · settings unmerge deletes the user's OWN config · `bin/lib/settings-merge.js:136`
- **Severity:** med · **Confidence:** high
- **Failure:** user's `settings.json` already has `env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE:"1"`.
  A plugin whose fragment sets the same key/value is installed — `mergeSettingsInto` sees it
  present and does NOT add it (correct), but the ledger stores the whole fragment
  (`plugins.js:114`). `plugin remove` → `unmergeSettingsFrom` finds the value equal to the
  fragment's and **deletes the user's own key**. Same class for a hook command (:125) or a
  permission rule (:145) the user hand-added that a plugin also declares.
- **Root cause:** unmerge assumes "value equals fragment ⇒ the fragment added it," but merge is
  dedup-safe and never records which keys it *actually* created — it can't tell user-owned from
  plugin-added. Fix needs merge to record the true delta (only keys it added) into the ledger.

### BH-2 · a `};` inside any code preview breaks the whole docs page · `.claude/scripts/sync-docs.js:721` (twin :678; escape gap :237-242)
- **Severity:** high · **Confidence:** high mechanism / LATENT (no scanned file's preview
  contains `};` today — verified)
- **Failure:** document any command/hook whose first ~30 lines contain `};` (routine in JS:
  `const cfg = {…};`, `() => {…};`). `escapeTemplateLiteral` does not escape `}`, so it lands
  verbatim in `content:` `` `…};…` ``. The next sync's `fcEnd = html.indexOf('};', fcInsertPoint)`
  anchors on that in-preview `};`, not the object terminator → `fileContents` closes early, the
  leftover entries become bare syntax → the docs `<script>` throws → page renders blank.
  `assertMarkersUnique` misses it (same `indexOf('};')`).
- **Root cause:** `};` treated as a unique structural terminator, but it's ordinary text inside
  the previews the tool itself embeds. Fix: escape `}`/anchor differently, or terminate on a
  marker that can't appear in content.

### BH-3 · install refills `@applied`, silently marking pending/skipped updates done · `bin/cli.js:640`
- **Severity:** med · **Confidence:** med · LATENT (all 3 current updates also run via `/autoconfig`)
- **Failure:** a future instruction-only `005-*.md` ships. User upgrades via the documented
  `npx …@latest` / `/autoconfig` (bootstrap). `copyDir` (cli.js:482) overwrites the user's
  `autoconfig-update.md` with the shipped empty-`@applied` copy; the pre-mark block (640-663)
  then matches that empty block and writes `001,003,004,005` as applied. `/autoconfig-update`'s
  `--pull-updates` sees `005` already applied → "up to date." **Update 005 never runs.** Same
  mechanism breaks the "skip → reappears next run" contract.
- **Root cause:** the "safe to run unconditionally" comment assumes an upgrade leaves the block
  non-empty, but `copyDir` blanks it *before* pre-mark. The `--pull-updates` path (`updates.js`)
  re-injects the user's block to avoid exactly this — the bootstrap path has no such guard.

---

## Tier 2 — real correctness bugs, narrower or dev-facing

### BH-4 · merge double-adds a hook under a new matcher → hook fires twice · `bin/lib/settings-merge.js:72`
- **Severity:** med · **Confidence:** med
- **Failure:** user's `Notification` event has `{matcher:"",hooks:[terminal-title]}`. Upgrade
  fragment ships `permission_prompt=[terminal-title,arcade-beeps]`. For `terminal-title` the
  event-wide existence scan skips it; for `arcade-beeps` no `permission_prompt` matcher exists so
  line 72 pushes the **entire** matcher — re-introducing `terminal-title`. Now it lives under both
  `""` and `permission_prompt` → title hook runs twice on a permission prompt.
- **Root cause:** dedup granularity (per `hook.command`) ≠ insert granularity (whole matcher object).

### BH-5 · flaked ancestry walk leaves a stale terminal occupant → wrong `/recover-context` target · `.claude/hooks/terminal-title.js:834`
- **Severity:** med · **Confidence:** med
- **Failure:** session B relaunches in A's tab; its ancestry PowerShell/ps walk exceeds the 4s
  timeout under load → `[]` → `if (!anchor) return;` fires **before** the occupant write (:851),
  so `terminals/{tid}.json` still says `{sid:A}`. Session C then records `prevSid:A`, skipping B.
  Bare `/recover-context` recovers A's context, not the true predecessor B.
- **Root cause:** the early return is a fail-safe for B's own lineage but leaves the shared
  occupant record stale; commit `60ed60e` added the walk retry only to the test, not production.

### BH-6 · a blocked prompt swallows queued cost/bomb warnings · `.claude/hooks/token-guard.js:1731` & `:1874` (dev-only)
- **Severity:** med · **Confidence:** high
- **Failure:** token-saver on; a fleet finishes (receipt queued, `pendingWfReceipt→null`); the
  maintainer returns idle after >1h and submits. The idle-gate / window-gate branch returns
  `decision:'block'` **before** the `notes.length` emit (:1947), so the queued fleet receipt,
  R3 bomb note, drift nudge, idle note, and spike note are all dropped — and their one-shots are
  already burned, so ↑+Enter won't reproduce them.
- **Root cause:** the gate branches flip one-shot state early, then `return` before emitting the
  accumulated notes. Blocking should suppress the current submission, not unrelated warnings.

### BH-7 · spike runway over-states burn after cache hits → wrong/short runway + spurious confirm card · `.claude/hooks/token-guard.js:1859` (dev-only)
- **Severity:** med · **Confidence:** high
- **Failure:** `officialUsageFetch` caches 180s. Prompts at t=0 (fresh, 40%), t=60/120 (cache
  hits — re-write the same pct but **advance** `lastWindowAtIso`), t=200 (fresh, 70%).
  `spikePct=30` is measured since t=0, but `mins≈1` is measured from t=120 → rate 30/1 instead of
  30/~3.3, projecting exhaustion ~3× too soon; can flip `beatsReset` and fire a spurious
  confirm-card interrupt.
- **Root cause:** numerator (`spikePct`, vs last distinct pct baseline) and denominator (`mins`,
  from `lastWindowAtIso`) advance on different events; cached reads move the timestamp but not
  the pct.

### BH-8 · `cleanupNulFile` deletes a real `nul` file on Linux/macOS · `bin/cli.js:57`
- **Severity:** low · **Confidence:** high
- **Failure:** on POSIX, a project has a legit file named `nul`. Any run (also on Claude exit,
  :819) `unlinkSync`s it silently — no backup (backup only covers `.claude/`).
- **Root cause:** the `nul` artifact is Windows-only (`> nul` residue) but the cleanup has no
  `process.platform==='win32'` guard.

---

## Tier 3 — confirmed-but-low, latent landmines, and belt-only

### BH-9 · `revert:`/merge commits leak into CHANGELOG + the user upgrade screen · `scripts/generate-changelog.js:57-60` (+ `bin/update-summary.js:23`)
- **Severity:** low · **Confidence:** high · **CONFIRMED LIVE** (`CHANGELOG.md:173` shows
  `- revert: remove /extract-rules …`; `classifyBullet` files `revert` under "Fixes & improvements").
- **Root cause:** `isHousekeeping`/`SKIP_TYPES` enumerate `chore/docs/test/ci/build/style` but
  never `revert` or merge commits; log isn't run with `--no-merges`. Cheap fix.

### BH-10 · plugin re-install orphans files that remove can't delete · `bin/lib/plugins.js:111`
- **Severity:** low · **Confidence:** high — re-install replaces `ledger[name].files` with only
  the new manifest's list, so files a prior version installed become undeletable orphans (a
  mid-copy throw at :75-85 leaves the same orphan-with-no-record). Ledger is a snapshot, not
  cumulative; no diff/cleanup on re-install.

### BH-11 · `ccr` reports a corrupt pointer as "no pointer here" · `bin/ccr.js:26-32` (dev-only)
- **Severity:** low · **Confidence:** high — `readPointer` collapses absent / unparsable /
  invalid-`recoverCmd` all to `null`, so a truncated `recover.json` misdirects the maintainer to
  "no recovery pointer … run from the stale project" instead of "pointer is corrupt."

### BH-12 · `sync-terminal-title` drift check is CRLF-blind → fleet never truly byte-identical · `scripts/sync-terminal-title.js:39,66` (dev-only)
- **Severity:** low · **Confidence:** high — `norm()` strips all `\r`, so a target differing only
  by CRLF vs LF reads "in sync" and `--write` skips it, despite the "byte-derived artifact"
  promise (could disagree with a byte-exact parity test). Also `driftLines` counts one direction
  only → "0 lines behind" for a strict-subset divergence.

### BH-13 · arcade beep and tab glyph disagree on a lexical-awaiting close · `.claude/hooks/arcade-beeps.js:132`
- **Severity:** low · **Confidence:** high — a Stop turn ending on a formulaic offer with no `?`
  and no `.ask` flag: terminal-title paints ◐ awaiting (`lex` path), arcade-beeps reads only
  `q.ends` → plays the "complete" GO beep. Tab says awaiting, speaker says done. Reuses
  `inspectLastResponse` but ignores its `solicits` field (secondary `.ask` one-shot race on the
  same line).

### BH-14 · sync-docs brace-walker miscounts on braces in the kept structural entries · `.claude/scripts/sync-docs.js:657-666` & `:703-712`
- **Severity:** med · **Confidence:** high mechanism / LATENT (kept entries are brace-free today)
- If `claude-md`'s preview or `claude-dir`'s `desc` ever gains a `{` (the `rules` static desc
  already ships inline `<div style=…>`), the naive `{`/`}` counter treats string braces as
  structural and mis-locates the entry boundary, swallowing/truncating structural entries.

### BH-15 · a `</script>` inside a preview terminates the docs script tag · `.claude/scripts/sync-docs.js:479-482` / `237-242`
- **Severity:** low · **Confidence:** med · LATENT — `escapeTemplateLiteral` neutralizes JS
  template syntax only, not the HTML `</script>` sequence, though output is injected into HTML.

### BH-16 · watchdog can latch a sibling tab's pid → paints/probes the wrong console · `.claude/hooks/terminal-title.js:1338/1344`
- **Severity:** med · **Confidence:** low — before a title is authored the `--find` needle is the
  bare folder name, so with two tabs on one repo `found[0]` may be the sibling; `sessionPid` is
  cached for the whole turn. The paint/liveness path (unlike the kill decision) has no
  "block-not-act" safeguard or uniqueness check. Needs reproduction.

### BH-17 · `migrateLegacyHookCommands` regex misses an argument-bearing relative command · `bin/lib/settings-merge.js:36`
- **Severity:** med · **Confidence:** low — the `$`-anchored `LEGACY` pattern only matches bare
  `node .claude/hooks/X.js`; a relative `…terminal-title.js --idle-rescue` isn't rewritten, then
  merge adds the anchored form alongside → doubled idle-rescue. Hinges on whether a relative
  `--idle-rescue` ever shipped; the regex gap itself is certain.

### BH-18 · backup folder minute-timestamp collision overwrites the earlier backup · `bin/cli.js:317`
- **Severity:** low · **Confidence:** med — two installs in the same clock minute reuse
  `migration/<timestamp>/` (`formatTimestamp` has no seconds); the second `copyFileSync`
  overwrites the first backup. Originals in `.claude/` are never deleted, so loss is bounded to
  the redundant backup copy.

### BH-19 · backup excludes nested user files named like autoconfig entries · `bin/cli.js:281`
- **Severity:** low · **Confidence:** med — `copyDirForBackup` applies the top-level
  `AUTOCONFIG_FILES.includes(entry.name)` filter at every recursion depth, so
  `.claude/mynotes/scripts/build.sh` is skipped; a folder of only such names yields an empty
  backup yet still prints "Backup triggered by user content."

### BH-20 · download-piped-to-shell deny regex is evaded by a second pipe / command substitution · `.claude/hooks/auto-guard.js:42`
- **Severity:** low · **Confidence:** med — belt-only, fail-open. `curl … | tee /tmp/i | bash`,
  `bash <(curl url)`, `sh -c "$(curl url)"` all slip the single-stage `download|shell` pattern.
  Complements tool-level deny rules, hence low.

### BH-21 · pin-gate `delete cfg.pinVersion` has no null guard · `bin/cli.js:182`
- **Severity:** low · **Confidence:** low — a TOCTOU where `cca.config.json` is corrupted between
  module load and the explicit-install pin gate makes `readCcaConfig()` return `null` and
  `delete cfg.pinVersion` throw uncaught. The sibling gls migration (:518) guards with `|| {}`;
  this one doesn't.

---

## Suggested next step

Group the fixes into a phased remediation plan (the same pattern as
`weak-model-maintainability-plan.md`): Tier 1 first (each with a fail-first repro), then Tier 2,
then Tier 3 as cheap mop-up. BH-9 (confirmed live) and BH-8 (one-line platform guard) are the
lowest-effort real fixes. BH-1 and BH-3 touch serialized state — keep changes additive-only.
