# TokenSaver rename — plan

**Alias:** TokenSaver rename · **Branch:** `plan/token-saver-rename` — one branch of that name in
each code repo the plan touches (public CCA, private `cca-cost-control`, `proswitch-api`; the API
branch forks from `magic-url-deploy`, not `main`) · **Model floor:** Sonnet-class; 1.1 and 2.1 are
tagged `[opus]` (an extraction inside a 5,300-line file).

**Goal:** the internal name `token-guard` stops leaking into anything a customer can open — the
hook command line in `settings.json`, the hook file names, the state directory
`.claude/hooks/.token-guard/`, the `tokenGuard` key in `cca.config.json`, the test-file names —
by renaming the family to `token-saver` everywhere it is wired, with a one-release compatibility
shim so no live session, fleet repo, or half-upgraded project breaks mid-rename. The product
surfaces already say TokenSaver (verdict cards, `/token-saver-rationale`, the web pages, the
plugin name `token-saver`); this plan finishes the job underneath them.

**Why now, not later:** no activated customer exists — the private go-live Ledger shows Phases
6–8 all ⏳ (`C:\CODE\cca-cost-control\PLAN.md:253-255`). Today the rename is a mechanical
transform plus aliases. After activation ships, every activated project needs a per-project
migration of hook entries, state dir and config key, forever. Source of the decision:
`C:\CODE\job-agent-extension\ARTICLES\no-stub-for-unpaid-users-rename-before-phase-7.html`
(2026-09-10).

**Evidence (2026-09-10 inventory):** public CCA 704 hits / 81 files; private repo 748 raw lines;
plus JAE, wifi-app, coldplay-bossa-nova, the global `~/.claude` tier and the proswitch-api bundle.
Regenerate any repo's list with:
```
rg -n --no-heading --hidden -g '!node_modules' -g '!.git' -g '!coverage' -g '!.claude/worktrees' -g '!CHANGELOG.md' -g '!ARTICLES' -e 'token-guard' -e 'tokenGuard' -e 'TOKEN_GUARD' -e '\.token-guard'
```

**How to execute:** one substep per fresh session, rooted in the repo the substep names. Public
CCA substeps run in a worktree named `token-saver-rename` (`EnterWorktree` →
`node scripts/bootstrap-worktree.js`); JAE's substep follows JAE's own worktree rule; the private
repo and the API use a plain branch. Read this doc in slices — the ⛔ Standing traps section
(lines 41–95), your own substep, and the Ledger tail — never whole. Refresh each
plan branch from its base at every substep boundary; merge each repo ONCE, in 5.1a. After each
substep: Verify, commit, append a Ledger entry, then `/clear` + `/continue`. `/continue`'s plan
probe finds this doc only from a CCA-rooted session — for 1.x, 3.1 and 4.x sessions, open it by
path and read the same three slices. Abandoning is one `git branch -D` per repo at any point;
`git log main..plan/token-saver-rename` (per repo) is the whole reviewable delta.

## ⛔ Standing traps

- **Four copies of the engine exist, at four versions, and the rename never merges them.**
  Public CCA HEAD `.claude/hooks/token-guard.js` 5,406 lines (and on 2026-09-10 the main
  checkout held UNCOMMITTED edits to it from another session); private
  `C:\CODE\cca-cost-control\.claude\hooks\token-guard.js` 5,316 (968 diff lines vs public);
  JAE 5,202; the API bundle 5,269. Each copy gets the SAME mechanical transform (1.1's diff,
  transplanted); content drift between copies is a separate decision (Deferred). If a copy is
  dirty from another session at substep start, stop and report — never commit, stash or
  overwrite another session's work.
- **God files — Grep-then-Read-window only, never opened whole:** `token-guard.js` (5,406 /
  5,316), `test/cli-behavior.test.js` (1,100), `test/hook-fleet-sync.test.js` (63 hits),
  `bin/cli.js` (1,009 — windows named per substep), `scripts/sync-hook-fleet.js` (574).
- **The engine only runs under `require.main === module`** (public `:5311`, dispatch `:5312-5347`,
  exports `:5376`). A shim that merely `require()`s the new file runs NOTHING — the hook becomes
  a silent no-op and the liveness canary reports a dead guard. The shim must call an exported
  `main()` when it is the entry point, and pass the exports through when it is required as a
  library (`statusline-cost.js:200,272` and every test `require('../token-guard')`). Exact shim
  text is in 1.1.
- **State-dir rename runs under up to six concurrent sessions per repo.** Every hook event is a
  fresh `node` process reading the file at that moment, so once the file is swapped all sessions
  run the new code — but two events can race the rename, and on Windows a sibling holding a
  handle makes `renameSync` throw EPERM. `resolveStateDir()` must: rename only when the new dir
  is absent and the old exists; catch everything; fall back to whichever dir exists; never
  delete; never throw. `.token-guard/` in JAE held 1,395 files on 2026-09-10.
- **The installer keeps matching the OLD name forever.** 1.0.224 leftovers in the wild carry
  `token-guard.js`; the retraction (`bin/cli.js:663-694`, strip `:724`) and `DEV_ONLY_FILES`
  (`:520-521`, one literal line — `test/dev-gate-consistency.test.js` parses it by regex) list
  BOTH names from 2.3 on. The shims must never ship either: `package.json` `files` negations
  (`:46-52`) gain the new names and keep the old.
- **Config-key migration can strand an OLD engine.** 2.3's installer rewrites `tokenGuard` →
  `tokenSaver` in `cca.config.json`; a pre-rename engine reads only `tokenGuard` and would fall
  to defaults. Fleet repos therefore rename their engine (4.x) BEFORE any `@latest` run (5.1b).
  Free installs have no `tokenGuard` block at all; paid customers do not exist yet.
- **`tokenSaver` already exists as a nested boolean** (`tokenGuard.tokenSaver`, public `:294`,
  resolved `:411` with legacy `mode: 'token-saver'`). After the rename it reads
  `tokenSaver.tokenSaver`. Do NOT rename the nested flag — it is product semantics that the
  activation work owns (Deferred).
- **Shipped-file discipline.** Anything not in `DEV_ONLY_FILES` reaches users: edits to
  `recover-context.md`, `continue.md`, `validate-cca-install.md`, `terminal-title.js`,
  `bin/cli.js`, `bin/lib/plugins.js` need a `Changelog:` trailer — `Changelog: none` here, the
  rename is invisible to users — plus `<!-- @version N -->` bumps on the commands and
  `node .claude/scripts/sync-docs.js` (`autoconfig.docs.html` is generated). Never write "paid",
  "licensed" or pricing words into a public CCA commit subject or body (June leak, `8c57a49`).
- **`terminal-title.js`, `plan-authoring.md` and `recover-session.py` are canonical-first and
  fleet-synced.** Edit the CCA copy; the live `~/.claude` copy and adopting repos receive it via
  `scripts/sync-terminal-title.js --write` / `scripts/sync-hook-fleet.js --write` in 4.2c / 5.1b —
  never hand-edit a synced copy. ⛔ Do not `--write` the fleet if the dry run shows the
  private-vs-public engine drift; that is Deferred, not this plan.
- **Output tag names stay.** `<token-guard>` / `<token-guard-liveness>` in hook stdout are
  parsed (`recover-session.py`, R-rules). Renaming them is cosmetic and Deferred.
- **JAE's hooks live in `.claude/settings.local.json` (tracked), not `settings.json`** —
  entries `:577,:581,:592,:603,:623`, allow-list literals `:494-546`. wifi-app carries them in
  `settings.json`. Don't "normalize" either.

## Phase 1 — Private repo (canonical engine)

Repo `C:\CODE\cca-cost-control`, branch `plan/token-saver-rename` off `main` (clean at `4c8e30d`
on 2026-09-10). No `package.json` here — tests run per file.

### ☑ 1.1 · L · ~1.5h — Rename the engine and liveness hooks, add shims, migrate the state dir, alias the config key [opus]

**Read list** (Grep-then-window; the private copy's line numbers differ from the public ones
quoted elsewhere — grep, never trust a number): `.claude/hooks/token-guard.js` — `function
stateDir`, every `'.token-guard'` literal (home-tier: observed-skills, window-warns,
meter-canary, spend-ledger), `cfg.tokenGuard` (the reader, ~:1330 public), the header doc of
the config key (~:82 public), the `require.main === module` block and the ~20 lines above it,
`module.exports` (tail); `.claude/hooks/token-guard-liveness.js` whole (158 lines; `stateDir()`
at `:33`); this doc: traps + this substep.

- [x] `git mv .claude/hooks/token-guard.js .claude/hooks/token-saver.js` and
      `git mv .claude/hooks/token-guard-liveness.js .claude/hooks/token-saver-liveness.js`.
- [x] In `token-saver.js`: move the body of the `if (require.main === module) { … }` block into
      `function main() { … }`, leave `if (require.main === module) main();`, add `main` to
      `module.exports`. Confirm nothing else at module level starts work.
- [x] Add `resolveStateDir(oldDir, newDir)`: if `newDir` exists → return it; else if `oldDir`
      exists → `try { fs.renameSync(oldDir, newDir); return newDir } catch { return oldDir }`;
      else return `newDir`. `stateDir(projectDir)` → `resolveStateDir(<…/.token-guard>,
      <…/.token-saver>)`. Add `homeStateDir()` the same way for `~/.claude/.token-guard` →
      `~/.claude/.token-saver`, and route the four home-tier literals through it.
- [x] Config reader: `const block = cfg && (cfg.tokenSaver || cfg.tokenGuard); return (block &&
      typeof block === 'object') ? block : {};` — and document `tokenSaver` (read-alias
      `tokenGuard`) in the header comment. Update the file's own usage text
      (`node .claude/hooks/token-guard.js --report` etc.) to the new name.
- [x] Liveness: same `main()` export, same `resolveStateDir` (copied — the liveness hook
      deliberately never requires the engine, `:9`); canary wording "token-guard" →
      "TokenSaver".
- [x] Write the two shims, verbatim shape:
      ```js
      #!/usr/bin/env node
      // Compatibility shim — the engine moved to token-saver.js (TokenSaver rename, 2026-09).
      // Kept one release so settings entries and commands that still name token-guard.js keep
      // working. Remove per docs/token-saver-rename-plan.md → Deferred. Do not add code here.
      const engine = require('./token-saver.js');
      if (require.main === module) engine.main();
      module.exports = engine;
      ```
      (`token-guard-liveness.js` → `./token-saver-liveness.js`.)

**Verify:**
```
cd C:/CODE/cca-cost-control
node --check .claude/hooks/token-saver.js && node --check .claude/hooks/token-guard.js && node --check .claude/hooks/token-saver-liveness.js && node --check .claude/hooks/token-guard-liveness.js
for f in token-saver token-guard; do printf '{"hook_event_name":"Stop","session_id":"rename-probe","transcript_path":"nope","cwd":"%s"}' "$PWD" | node .claude/hooks/$f.js >/dev/null; echo "$f exit=$?"; done
ls .claude/hooks/.token-saver | head -3; ls -d .claude/hooks/.token-guard 2>&1 | head -1   # migrated, or fallback noted
node -e "const m=require('./.claude/hooks/token-guard.js'); console.log(typeof m.main, Object.keys(m).length)"   # function, >1
for t in .claude/hooks/tests/*.test.cjs; do node "$t" >/dev/null 2>&1 || echo "FAIL $t"; done
```
**Commit:** `refactor(token-saver): rename the engine and liveness hooks; shims keep the old names for one release` + `Changelog: none`.

### ☑ 1.2 · M · ~45m — Private repo: tests, scripts, commands, dogfood wiring

**Read list:** the `require` line of each `.claude/hooks/tests/token-guard-*.test.cjs` (20) and
`test/token-guard-*.test.js` (9); `scripts/sync-token-saver-bundle.js` (whole, ~60 lines —
`:34` hook entry, `:43-44` file map, `:49` name); `.claude/scripts/set-spend-gate.js:40-60`;
`.claude/scripts/recover-session.py:45-60,95-105` (`POINTER_REL` `:52`);
`.claude/scripts/test-token-saver.js:95-110`; `.claude/commands/{analyze-session,usage-report,
token-saver-rationale,test-token-saver}.md` (grep windows); `.claude/settings.local.json:8-50`
(entries `:10,:14,:25,:36,:47`); `.gitignore:1-5`; `README.md`, `CLAUDE.md` (grep windows).

- [x] `git mv` all 29 test files to `token-saver-*`; `sed` their `require('../token-guard…')`
      → `token-saver…`; re-verify `rg "require\(.*token-guard" .claude test` = 0.
- [x] `sync-token-saver-bundle.js`: hook entry → `hooks/token-saver.js`; file map →
      `hooks/token-saver.js`. The bundle ships NO shim — a fresh activation has no legacy
      entries. Do not RUN the sync here (it writes into proswitch-api; 3.1 runs it).
- [x] `set-spend-gate.js` writes via the resolved state dir; `recover-session.py` `POINTER_REL`
      tries `.token-saver/recover.json` then `.token-guard/recover.json`; `test-token-saver.js`.
- [x] Commands' `allowed-tools` and bodies → `token-saver.js`; `.gitignore` adds
      `.claude/hooks/.token-saver/` (keep the old line); `settings.local.json` five entries →
      new names; README / CLAUDE.md mentions.

**Verify:** `for t in .claude/hooks/tests/*.test.cjs test/*.test.js; do node "$t" >/dev/null 2>&1 || echo "FAIL $t"; done` prints nothing;
`rg -n 'hooks/token-guard' --glob '!ARTICLES' --glob '!*.md' --glob '!gemini-docs' .` lists only
the two shim files.
**Commit:** `chore(token-saver): tests, scripts and commands follow the engine rename` + `Changelog: none`.

## Phase 2 — Public CCA

Repo `C:\CODE\claude-code-autoconfig`, worktree `token-saver-rename`, branch
`plan/token-saver-rename` off `main`. Every commit: `Changelog: none`.

### ☑ 2.1 · L · ~1.5h — Engine and shims in public CCA, same transform as 1.1 [opus]

⛔ **Preconditions:** `git ls-files .claude/hooks/token-guard.js` non-empty (if the pending
public delete has landed, skip 2.1 and 2.2 and Ledger it), and the main checkout's copy is clean
(`git -C C:/CODE/claude-code-autoconfig status --porcelain .claude/hooks/token-guard.js
.claude/hooks/tests` empty). Dirty from another session → stop and report.

**Read list:** public `.claude/hooks/token-guard.js` windows `:78-90` (config-key doc),
`:1015-1025`, `:1325-1345` (reader + `stateDir`), `:1770-1780`, `:1800-1808`, `:1845-1853`
(home literals), `:5290-5376` (guard, dispatch, exports); `.claude/hooks/token-guard-liveness.js`
whole; `test/complexity-baseline.json` (the `.claude/hooks/token-guard.js` key);
`test/complexity-ratchet.test.js` (how a missing key is treated); 1.1's diff:
`git -C C:/CODE/cca-cost-control show <1.1 hash> -- .claude/hooks/token-saver.js
.claude/hooks/token-saver-liveness.js .claude/hooks/token-guard.js`.

- [x] `git mv` both hooks; transplant 1.1's `main()` extraction, `resolveStateDir`,
      `homeStateDir`, reader alias, header doc and usage text — from the diff, verbatim; do not
      re-derive and do not touch any other line (the copies differ elsewhere by design).
- [x] Write both shims (1.1's text).
- [x] `complexity-baseline.json`: rename the key to `.claude/hooks/token-saver.js` (or add a
      row, if the ratchet treats a missing key as a failure — read the test first).

**Verify:** `node --check` ×4; the 1.1 synthetic-Stop loop through both names, exit 0;
`node test/complexity-ratchet.test.js && node test/hook-tests.test.js` green (the suites still
`require('../token-guard')` — the shim passes exports through, which is the point).
**Commit:** `refactor(token-saver): rename the engine and liveness hooks in CCA; shims keep the old names one release`.

### ☑ 2.2 · M · ~45m — Public CCA tests and manifests

**Read list:** `package.json:20-30` (test chain), `:44-56`, `:78-84` (files negations);
`.gitignore:22-26`; `.gitattributes:9`; the require / spawn-path line of each of the 22
`.claude/hooks/tests/token-guard-*.test.cjs` and 7 `test/token-guard-*.test.js`
(`test/token-guard-liveness.test.js` spawns the hook by path — 9 hits);
`test/dev-gate-consistency.test.js:54-80`.

- [x] `git mv` the 29 test files to `token-saver-*`; fix requires and spawn paths;
      `rg "token-guard" test .claude/hooks/tests` afterwards shows only deliberate
      old-name fixtures (list them in the Ledger).
- [x] `package.json`: the 7 chain entries → new names; `files` negations ADD
      `!.claude/hooks/.token-saver`, `!.claude/hooks/.token-saver/**`,
      `!.claude/hooks/token-saver.js`, `!.claude/hooks/token-saver-liveness.js`, keeping the old
      four; `.gitignore` adds `.claude/hooks/.token-saver/`; `.gitattributes:9`.

**Verify:** `npm test` green (8–10 min); `npm pack --dry-run 2>&1 | grep -i 'token-'` prints no
hook file.
**Commit:** `chore(token-saver): test suites and package manifests follow the rename`.

### ☑ 2.3 · M · ~1h — Installer: dev gate, retraction, config-key migration, plugin verify

**Read list:** `bin/cli.js:512-526` (`DEV_ONLY_FILES`), `:598-612` (the gls migration — copy
its shape), `:660-695` (retraction), `:720-726` (strip); `bin/lib/plugins.js:25-40,305-390`
(`TOKEN_SAVER`, `verifyTokenSaver`, expected bundle paths, hook entry written at activation);
`bin/ccr.js:1-50` (`recover.json` read `:33`); `test/cli-behavior.test.js:225-250,336-420`
(fixtures 2 / 2b / 2c); `test/plugin-activation.test.js` (grep `token-guard`, 18 hits);
`test/dev-gate-consistency.test.js`.

- [x] `DEV_ONLY_FILES`: add `'token-saver.js'`, `'token-saver-liveness.js'`; keep the old two.
      One literal line.
- [x] Retraction: the delete list and the settings fragment cover BOTH command lines (a second
      `TOKEN_SAVER_SETTINGS_FRAGMENT`, unmerged alongside); `keepTokenGuard` reads
      `(cfg.tokenSaver || cfg.tokenGuard)` for `verdictServiceKey` / `devFleet`.
- [x] Config-key migration next to the gls one: when `cfg.tokenGuard` is an object,
      `cfg.tokenSaver` absent and the config not corrupt → `cfg.tokenSaver = cfg.tokenGuard;
      delete cfg.tokenGuard;` write round-tripped; one gray console line. Runs before the
      retraction reads the config.
- [x] `plugins.js`: expected bundle file `hooks/token-guard.js` → `hooks/token-saver.js`; the
      hook entry it writes at activation → `token-saver.js`. `ccr.js` → new-then-old pointer.
- [x] Fixtures: 2 (old-name leftovers) unchanged + a new-name leftover variant; 2b (paid) holds
      `token-saver.js` under a `tokenGuard` key and asserts the key was migrated to
      `tokenSaver`; 2c (devFleet) holds `token-saver.js` under `tokenSaver`.
      `plugin-activation.test.js` expectations → new paths.

**Verify:** `node test/cli-behavior.test.js && node test/plugin-activation.test.js && node test/dev-gate-consistency.test.js && node test/cli-install.test.js && node test/complexity-ratchet.test.js`; `npx eslint bin/cli.js bin/lib/plugins.js bin/ccr.js`.
**Commit:** `fix(installer): dev gate, retraction and plugin verify know both hook names; cca.config.json key migrates to tokenSaver`.

### ☑ 2.4a · M · ~30m — Fleet manifest rows and the sync-script one-liners

**Read list:** `scripts/sync-hook-fleet.js:60-100` (manifest rows `:73`, `:78`, `:83`),
`:160-175`; `test/hook-fleet-sync.test.js` (grep `token-guard` → the manifest fixture windows
only); one grep window each for `scripts/sync-terminal-title.js:14`, `.claude/scripts/fleet.js:9`,
`whats-happening.js:11`, `sync-worktrees.js:19` (path/comment one-liners — ONE scripted
replacement, reviewed in one `git diff`). Files touched: 4 (the four one-liners count as one).

- [x] Manifest: rows → `token-saver.js` (sourceKey `token-saver`), `token-saver-liveness.js`
      (`pairsWith`), plus rows for both shims so the fleet keeps them identical.
- [x] `test/hook-fleet-sync.test.js` manifest fixtures follow the rows.
- [x] The four one-liners: `sed` in one pass, `node --check` each, review the diff.
- [x] Do NOT run `sync-hook-fleet.js --write` — 5.1b owns the actuation.

**Verify:** `node test/hook-fleet-sync.test.js`; `node scripts/sync-hook-fleet.js` (dry run)
lists the token-saver rows — `hook-fleet.local.json` is absent on this box: stub a minimal one in
the scratchpad and point the script at it, or skip the dry run and say so in the Ledger.
**Commit:** `chore(fleet): manifest rows and sync-script paths follow the token-saver rename`.

### ☑ 2.4b · M · ~45m — terminal-title install gate and statusline-cost

**Read list:** `.claude/hooks/terminal-title.js:20-30,900-915,1000-1006,2278-2286` (gate `:911`);
`.claude/hooks/statusline-cost.js:60-70,115-125,195-205,232-240,268-276`;
`test/terminal-title.test.js:316-318` and `.claude/hooks/tests/terminal-title-clear-advice.test.cjs:31-78`
(the two pins on the `:911` gate); `test/live-twin-parity.test.js` (grep — edit only if it names
the file). Files touched: 4–5. One file per trip, read-then-edit.

- [x] `terminal-title.js:911`: gate on `token-saver.js` OR `token-guard.js` existing; the two
      test pins follow.
- [x] `statusline-cost.js`: `:65` home path via the new dir with old fallback; `:120`
      `.tokenSaver || .tokenGuard`; `:200`, `:272` require `token-saver.js`, fall back to
      `token-guard.js`; **`:236`** console message names `token-saver.js` (1.2's Ledger catch —
      the original 2.4 list missed it).
- [x] Do NOT run `sync-terminal-title.js --write` — 4.2c owns the actuation.

**Verify:** `node test/terminal-title.test.js` (2m+, keep the machine awake — the watchdog tests
are not sleep-safe; 2.2's Ledger) `&& node test/live-twin-parity.test.js`.
**Commit:** `chore(hooks): terminal-title gate and statusline-cost follow the token-saver rename`.

### ☑ 2.4c · M · ~45m — recover-session.py pointers, worktree-gate, claim-registry

**Read list:** `.claude/scripts/recover-session.py:25-32,50-55,95-105,125-130,320-326,398-404,662-668`;
`.claude/hooks/worktree-gate.js:10-14,222-228`; `.claude/hooks/claim-registry.js:160-164`;
`test/ccr.test.js:7-39` (pointer shape). Files touched: 4. One file per trip, read-then-edit.

- [x] `recover-session.py`: `POINTER_REL` new-then-old; the other six mentions.
- [x] `worktree-gate.js`, `claim-registry.js`: paths and comments.
- [x] `test/ccr.test.js`: pointer shape follows.

**Verify:** `node test/ccr.test.js && node test/recover-session-cap.test.js`.
**Commit:** `chore(scripts): recover-session pointers and sibling hooks follow the token-saver rename`.

### ☑ 2.5a · M · ~45m — Commands: scripted path sweep + the three shipped @version bumps

**Read list (grep windows only):** `.claude/commands/{recover-context (7 hits), analyze-session
(:4,:23), usage-report (:20), cost-compare, whats-happening, token-saver-rationale (:3,:27),
restore-after-reboot, create-wip-report, fleet, continue}.md` — ONE scripted replacement across
all of them, reviewed in one `git diff`; then `recover-context.md`, `continue.md`,
`validate-cca-install.md` headers for the version bump. Files touched: 4 (the sweep counts as one).

- [ ] Scripted: `hooks/token-guard.js` → `hooks/token-saver.js` and `.token-guard/` →
      `.token-saver/` across `.claude/commands/*.md`; review the diff line by line — prose that
      NAMES the old file deliberately (retraction wording, shim notes) is reverted by hand.
- [ ] `@version` bump + `Changelog: none` for the three shipped commands (`recover-context`,
      `continue`, `validate-cca-install`). (`validate-cca-install.md:73`'s dev_only list already
      carries the new names — 2.3 did it; nothing to add there.)

**Verify:** `rg -n 'token-guard' .claude/commands` shows only the deliberate old-name survivors —
paste the list into the Ledger; `node test/dev-gate-consistency.test.js && node test/contracts.test.js`.
**Commit:** `chore(commands): command paths follow the token-saver rename`.

### ☐ 2.5b · M · ~45m — Rules, CLAUDE.md, dogfood settings, docs regen

**Read list (grep windows only):** `.claude/rules/parallel-session-worktrees.md:80-88,170-176`;
`.claude/rules/plan-authoring.md:100-108`; `CLAUDE.md` (12 hits); `.claude/settings.local.json:160-215`.
Files touched: 4 + the regenerated docs HTML (reviewed by `git diff --stat`).

- [ ] Rules: `parallel-session-worktrees.md` and `plan-authoring.md` (canonical + byte-synced to
      adopting repos — 5.1b's fleet sync carries them). ⚠ CCA **main** carries the 2026-09-11
      substep-sizing edits to `plan-authoring.md` (size table, trip recipe, Ledger actuals); this
      substep edits `:100-108` only, on the plan branch — different lines, so 5.1a's merge should
      be clean; 5.1a checks that both survived.
- [ ] `CLAUDE.md` (12 hits) and the five dogfood entries in `settings.local.json`.
- [ ] `node .claude/scripts/sync-docs.js`. Leave `docs/` plans and audits and
      `scripts/generate-changelog.js` OVERRIDES untouched (history).

**Verify:** `rg -n 'token-guard' .claude/rules CLAUDE.md bin scripts --glob '!scripts/generate-changelog.js'`
shows only the deliberate survivors (retraction, `DEV_ONLY_FILES`, shim manifest rows, alias
fallbacks) — paste the list into the Ledger; `node test/contracts.test.js && node test/cli-install.test.js`
(the two suites that read docs and commands — the full `npm test` runs once, in 5.1a).
**Commit:** `docs(token-saver): rules, CLAUDE.md and dogfood settings follow the rename`.

## Phase 3 — Delivery bundle

### ☐ 3.1 · M · ~45m — proswitch-api bundle regenerated under the new name

Repo `C:\CODE\proswitch-api`, branch `plan/token-saver-rename` off `magic-url-deploy`.

**Read list:** `src/api/cca/token-saver-plugin/plugin.json` (whole);
`src/api/cca/tests/module-bundle.test.js:35-70` (contract `:61`); `src/api/cca/index.js:245-260`
(`BUNDLE_DIR`); private `scripts/sync-token-saver-bundle.js` (whole).

- [ ] `node C:/CODE/cca-cost-control/scripts/sync-token-saver-bundle.js` (1.2's version) —
      emits `hooks/token-saver.js` and the updated embedded `settings.hooks`; `git rm` the old
      `hooks/token-guard.js` in the bundle dir if the sync leaves it.
- [ ] `plugin.json` `files[]` + `settings.hooks` all name `token-saver.js`;
      `module-bundle.test.js:61` → `['commands/token-saver-rationale.md', 'hooks/token-saver.js']`.
- [ ] Leave: route `/guard-verdict`, `handleGuardVerdict`, `guard-decision-core.js`, the
      `claude-code-token-guard` slug, `STRIPE_CCA_PRICE_ID`, `token-guard-license.ejs`,
      `src/api/cca/tests/token-guard-*.test.js` (Deferred — none customer-visible).

**Verify:** `npm test` green; `node -e "const p=require('./src/api/cca/token-saver-plugin/plugin.json'); if (JSON.stringify(p).includes('token-guard')) throw new Error('old name in bundle')"`.
**Commit:** `chore(cca): module bundle ships hooks/token-saver.js`. Merge into `magic-url-deploy` only in 5.1.

## Phase 4 — Live wiring sites

### ☐ 4.1a · M · ~45m — job-agent-extension: hook files, shims, gitignore, quiet-card test

Session rooted in `C:\CODE\job-agent-extension`. ⛔ `EnterWorktree` (`token-saver-rename`) +
`node scripts/bootstrap-worktree.js` before the first write. The hooks that FIRE are the main
checkout's — the rename takes effect there at 4.1b's merge; the shim keeps the interval safe.

**Read list:** `.claude/hooks/token-guard-liveness.js:30-36`; `.gitignore` (grep);
`.claude/hooks/tests/token-guard-quiet-card.test.cjs` (require line). Files touched: 3 (the
four hook files arrive as one verbatim copy batch).

- [ ] `git mv` `token-guard.js` → `token-saver.js` and the liveness hook, then overwrite
      content with the post-2.1 canonical files from
      `C:\CODE\claude-code-autoconfig\.claude\hooks\` on branch `plan/token-saver-rename`, and
      copy both shims — one `cp` batch. (This moves JAE from its 5,202-line engine to CCA's —
      what the fleet sync does anyway; note it in the Ledger.)
- [ ] `.gitignore` adds `.claude/hooks/.token-saver/`; `git mv` the quiet-card test, fix its
      require.
- [ ] Leave the CCA-managed commands (`token-saver-rationale`, `usage-report`, `recover-context`,
      `continue`, `fleet`, `whats-happening`, `validate-cca-install`) — 5.1b's installer run
      refreshes them; the shim keeps `node .claude/hooks/token-guard.js --details` working until
      then. Leave `docs/token-guard-*.md`, `.claude/plans/`, `.claude/board/` (history).

**Verify:** the 1.1 synthetic-Stop loop through both names, exit 0; `ls .claude/hooks/.token-saver | wc -l`
(≈1,395) and `.token-guard` gone or its fallback noted; `node .claude/hooks/token-saver.js --details`
prints the rationale card; `node .claude/hooks/tests/token-saver-quiet-card.test.cjs`.
**Commit** in the worktree; **stay in the worktree** (no merge) — 4.1b finishes the repo.

### ☐ 4.1b · M · ~30m — job-agent-extension: settings and config wiring, merge

Same worktree as 4.1a (re-enter it; `EnterWorktree` finds it by name).

**Read list:** `.claude/settings.local.json:570-630` (entries `:577,:581,:592,:603,:623`) and
`:490-550` (allow literals `:494,:495,:497,:498,:505,:506,:518,:519,:546`) — ONE scripted
replacement, reviewed in one diff; `.claude/cca.config.json`. Files touched: 2.

- [ ] `settings.local.json`: five hook entries and nine allow literals → new paths.
- [ ] `cca.config.json`: `tokenGuard` → `tokenSaver` (contents unchanged, `devFleet: true` stays).

**Verify:** the synthetic-Stop loop through the NEW names (the entries now call `token-saver.js`
directly), exit 0; `pnpm test --run` green.
**Commit** in the worktree; `ExitWorktree keep`, merge to `main` from the main checkout
(autonomous — no approval gate), then `remove`.

### ☐ 4.2a · L · ~1h — wifi-app

**Read list:** `.claude/settings.json:15-20,39-47,62-66,73-77,108-112` (six entries — the
carrier), `.claude/settings.local.json` (12 allow literals — grep; scripted), `.claude/cca.config.json`
(`mode: "token-saver"` stays), the require line of the 7 `.claude/hooks/tests/token-guard-*.test.cjs`
(git mv + one scripted require fix), `.gitignore`. Files touched: 6 (hook-file copy batch and
the test batch count as one each) — L on the file column; trips ≈ 16.

- [ ] Canonical `token-saver.js` + liveness + both shims in from CCA `plan/token-saver-rename`
      (one `cp` batch); `.gitignore` adds `.claude/hooks/.token-saver/`.
- [ ] `git mv` the 7 tests; fix their require lines in one pass.
- [ ] `settings.json` six entries + `settings.local.json` 12 literals → new paths; `tokenGuard`
      → `tokenSaver` in `cca.config.json`.

**Verify:** the synthetic-Stop loop through both names exit 0 and the state dir migrated;
`for t in .claude/hooks/tests/*.test.cjs; do node "$t" >/dev/null 2>&1 || echo "FAIL $t"; done`.
**Commit** on `main` (single-session repo).

### ☐ 4.2b · M · ~20m — coldplay-bossa-nova

**Read list:** `.claude/settings.json:33,58,101,121`; `.claude/cca.config.json` (may be absent).
Files touched: 3 (settings, config, the hook-file copy batch).

- [ ] Canonical `token-saver.js` + shim in (one `cp` batch); four entries flipped; write
      `.claude/cca.config.json` `{ "tokenSaver": { "devFleet": true } }` (create if absent) so a
      future `@latest` there keeps the file.

**Verify:** the synthetic-Stop loop through both names exit 0; the state dir migrated.
**Commit** on `main` (single-session repo).

### ☐ 4.2c · M · ~30m — The global `~/.claude` tier

**Read list:** `~/.claude/hooks/statusline-cost.js` (:65,:120,:200,:236,:272 — receives 2.4b's
copy), `~/.claude/commands/cost-compare.md:4,12,33`, `~/.claude/commands/restore-after-reboot.md:26`,
`~/.claude/settings.json` (verify only — no token-guard entries on 2026-09-10). Files touched: 4.

- [ ] `node C:/CODE/claude-code-autoconfig/scripts/sync-terminal-title.js --write`
      (canonical-first — run it from the plan-branch worktree so 2.4b's gate lands).
- [ ] `cp` `statusline-cost.js` from CCA (manual cp is the rule for that file).
- [ ] Edit the two global commands. `~/.claude/.token-guard` migrates on the first hook run.
- [ ] Empty `WHITELIST` in `test/live-twin-parity.test.js` again (2.4b's two rows cover the gate
      divergence until the `--write` above lands) and re-run it — it must report 0 divergences
      with an empty list.

**Verify:** `ls ~/.claude/.token-saver`; the synthetic-Stop loop through both names exit 0 from any
repo; the terminal title still renders on the next prompt.
**Commit:** none — the global tier has no repo; Ledger it.

## Phase 5 — Release

### ☐ 5.1a · L · ~1h — Merge every repo once, publish, deploy the bundle

Precondition: 1.1–4.2c Ledgered. In this order:

- [ ] Private repo: `git merge plan/token-saver-rename` → `main`, push.
- [ ] Public CCA, from the MAIN checkout (never a worktree): `git merge plan/token-saver-rename`
      → `main`. ⚠ `plan-authoring.md` merges two edits — main's 2026-09-11 sizing changes and
      2.5b's rename at `:100-108`; confirm both survived. `npm test` (33 `&&`-chained entries —
      if it stops early, run the rest entry-by-entry; 2.2's Ledger); `/deploy-to-npmjs`
      (`npm version patch` → postversion changelog → publish). Read the generated changelog
      bullets: no paid / pricing wording.
- [ ] proswitch-api: merge → `magic-url-deploy`, push, safe deploy per FEEDBACK.md "Deploying
      API Changes"; confirm the bundle endpoint serves `hooks/token-saver.js`.

**Verify:** `npm view claude-code-autoconfig version` = the new version; the bundle endpoint
check above.
**Commit:** the merges are the commits.

### ☐ 5.1b · M · ~45m — Fleet refresh and close the plan

- [ ] Fleet refresh: in JAE and wifi-app run `npx claude-code-autoconfig@latest`; confirm
      `token-saver.js` SURVIVES (devFleet) and the managed commands now say `token-saver.js`.
- [ ] `node scripts/sync-hook-fleet.js` dry run from CCA main: token-saver rows in sync — ⛔ no
      `--write` if the dry run reports the private-vs-public engine drift.
- [ ] Ledger the shim-removal condition (Deferred, first bullet) with the published version.

**Verify:** `rg -ln 'hooks/token-guard' C:/CODE/job-agent-extension/.claude C:/CODE/wifi-app/.claude C:/CODE/coldplay-bossa-nova/.claude --glob '!*.md'`
lists only the shim files.
**Commit:** none; the Ledger entry closes the plan.

## Deferred

- **Shim removal** — the two `token-guard*.js` shims in CCA, the private repo and the three
  wiring repos. Condition: one CCA release AFTER 5.1's publish, and
  `rg -l 'hooks/token-guard' C:/CODE/*/.claude/settings*.json ~/.claude/settings*.json` empty.
  Separate S task. The old names stay in `DEV_ONLY_FILES` and the retraction forever.
- **Output tag names** `<token-guard>` / `<token-guard-liveness>` — parsed by
  `recover-session.py` and the rules; cosmetic; verify consumers before touching.
- **Nested `tokenSaver` boolean + legacy `mode: 'token-saver'`** — product semantics; the
  activation work (private PLAN.md Ledger "Phase 7" / MODULE-DELIVERY-PLAN) owns what the flag
  means once `verdictServiceKey` implies it.
- **API internals** — `/guard-verdict`, `handleGuardVerdict`, `guard-decision-core.js`,
  `src/api/cca/tests/token-guard-*.test.js`, `MAPPING.md`, the `claude-code-token-guard` slug
  (live DB + Stripe metadata), `STRIPE_CCA_PRICE_ID` default, `token-guard-license.ejs`. Not
  customer-visible; the slug and price id are live data.
- **Public-vs-private engine drift** (968 diff lines on 2026-09-10) and the pending public
  delete of the engine from CCA — a separate decision; this plan keeps the copies in lockstep
  for the rename only. If the delete lands first, 2.1/2.2 are skipped.
- **Stale global copies** — `~/.claude/scripts/token-guard.js` (~3,700 lines),
  `token-guard-boundaries.js`, `test-boundary-scenarios.js`, `~/.claude/token-guard-fixtures/`:
  unwired; delete after `rg` proves no caller. Orphan `.token-guard/` state dirs in
  `hedge-glasses` and `image-editor`: remove by hand.
- **History** — `docs/` plans and audits, `scripts/generate-changelog.js` OVERRIDES, ARTICLES,
  JAE `docs/token-guard-*.md`, `.claude/plans/token-guard-plan-aware-checkpoints.md`,
  `.claude/migration/*`: never rewritten.

## Ledger

- 2026-09-10 — plan authored from a job-agent-extension session (three Explore-agent inventories
  across public CCA, the private repo, and fleet/global/API). Not started. Base facts: public CCA
  main checkout dirty on `token-guard.js` + two of its tests (another session's work, do not
  touch); private repo clean at `4c8e30d`; API on `magic-url-deploy`; the installer's devFleet
  exemption is committed at CCA `f930a88` but unpublished — 5.1's `@latest` run depends on it.

- 2026-09-10 — **1.1 done** — private `0dfdaf1` on `plan/token-saver-rename`. Verify green: `node --check` ×4, synthetic Stop through both names exit 0, `.token-guard` → `.token-saver` migrated (505 entries), both shims export `main`. Nine `.claude/hooks/tests/token-guard-*.test.cjs` suites fail on `.token-guard` state-dir path pins (budgets, ccr, quiet-card, r11, r19, r4, r8, r9, shim) — 1.2 owns them. Hazard for 1.2: `.claude/hooks/.token-saver/` is UNTRACKED (`.gitignore` still names the old dir) — fix `.gitignore` before any `git add -A`. Session ended on an unexplained interrupt mid-diff-review; finished by the recovery session.

- 2026-09-10 — **1.2 done** — private `358a597` on `plan/token-saver-rename`. 32 test files (23 hook + 9 repo — the plan's 29 undercounted) `git mv`'d and re-pointed; all suites green (0 failures across `.claude/hooks/tests/*.test.cjs` + `test/*.test.js`). `set-spend-gate.js` reads the resolved dir (new, else old) with an inline helper — the engine does NOT export `stateDir`, and 1.2 stayed out of the engine so 2.1's transplant of 1.1 stays exact. `recover-session.py` `POINTERS` fans out new-then-old; `test-token-saver.js` loads `token-saver.js` with `token-guard.js` fallback (CCA/JAE are still on the old name until 2.1/4.x). `.gitignore` fixed first; `.token-saver/` no longer untracked. Verify grep leaves ONE non-shim hit: `statusline-cost.js:236` (a console message naming `.claude/hooks/token-guard.js`) — fleet-managed file, left for 2.4, which lists `:65,:120,:200,:272` and must add `:236`. Fleet-synced commands `recover-context.md`/`continue.md` still say `token-guard` in prose and `.token-guard/` at `recover-context.md:28` — 2.5 + 4.2. `settings.local.json` (gitignored) now calls the new names directly.

- 2026-09-10 — **2.1 prerequisites cleared** (from the private-repo session that closed 1.2, at the user's ask). The other session's dirty CCA main-checkout work landed as its own commits: `d98d297` (bomb-landing `RELAY_CARDS` + `persistCard`, budgets/quiet-card tests — all suites green: hook-tests 401/0, ratchet, bomb-gate) and `ef86f2f` (`.gitignore` `ARTICLE-CONCEPTS/`). 2.1's precondition now holds: `token-guard.js` tracked, main checkout clean on the engine + tests. Worktree `.claude/worktrees/token-saver-rename` created on branch `plan/token-saver-rename` at `ef86f2f`, bootstrapped (`hook-fleet.local.json` absent on this box — sync-hook-fleet dry runs in 2.4 need it). 2.1 itself NOT started — re-enter that worktree from a CCA-rooted session.

- 2026-09-10 — **2.1 done** — public `2a4e3d0` on `plan/token-saver-rename` (worktree `.claude/worktrees/token-saver-rename`; run interactively from the private-repo session at the user's ask — the headless runner would have needed `--dangerous` for hook-file edits). 1.1's diff applied as a patch: 22/23 engine hunks landed (offsets up to ±90 lines from the bomb-landing commit `d98d297`; hunks 16 and 18 with fuzz, verified at `stateDir`/`homeStateDir` and `windowWarnsPath`); the exports hunk was re-done by hand (public list has no `driftVerdict`). Liveness patch applied clean. Shims are 1.1's text verbatim. Verify: `node --check` ×4; synthetic Stop + UserPromptSubmit through all four names exit 0; `.token-guard` → `.token-saver` migration confirmed through both shims on a UserPromptSubmit (a Stop with no transcript exits before touching state — expected); shims pass 90 engine exports + `main`; complexity ratchet green after the key rename PLUS a new `Function 'main'` row — the ratchet treats a missing key as all-new violations, and `main()` is the old top-level dispatch block now visible to the per-function lint (pre-existing debt, not new; the private repo has no ratchet, so 1.1 never met this). Same deviation as 1.1: `hook-tests` shows 10 failures, all `.token-guard` path pins in 10 suites (budgets, ccr, official-usage, quiet-card, r11, r19, r4b, r8, r9, shim) — 2.2 owns them, plus `test/token-guard-liveness.test.js` (path pin) and `test/token-guard-recovery.test.js:27` / `token-guard-session-gate.test.js:22`, which `readFileSync` the ENGINE SOURCE by the old path for source-order checks and now read the 7-line shim — 2.2 must point them at `token-saver.js`. `test/cli-install.test.js` fails 1: "all shipped hooks appear in docs HTML file tree" lists `token-saver*.js` because they are not yet in `DEV_ONLY_FILES` — 2.3 adds them (nothing ships mid-plan; 5.1 merges once). `dev-gate-consistency`, `hook-fleet-sync`, copy/divert/reread/bomb-gate all green. Ledger for 2.x now lives on the plan branch (the doc is tracked); `/continue` for 2.2 must re-enter the worktree, not read main's copy.
- 2026-09-10 — **2.2 done** — public `d8bbed6` on `plan/token-saver-rename` (same worktree, interactive; the session that started it was interrupted at the pack check and finished by the recovery session). 29 files `git mv`'d (22 `.cjs` + 7 `test/*.js`), similarities 94–100%; `tokenGuard:` config keys in fixtures kept (the engine read-aliases them). `rg token-guard test .claude/hooks/tests` shows ZERO hits in the renamed 29; every remaining hit is a fixture another substep owns — 2.3: `cli-behavior.test.js` (fixtures 2/2b/2c, 18 hits), `plugin-activation.test.js` (10); 2.4: `hook-fleet-sync.test.js` (63, manifest fixtures), `terminal-title.test.js:316-318` + `tests/terminal-title-clear-advice.test.cjs:31-78` (the `:911` install gate), `ccr.test.js:7-39` (pointer shape); deliberate survivors nobody renames: `changelog-gen.test.js` (`token-guard.js` as a synthetic DEV_ONLY member — history), `contracts.test.js:107` (skip-set for the old state dir). Verify: `npm pack --dry-run | grep -i token-` prints nothing. `npm test` is `&&`-chained and stops at `cli-install` (entry 2 of 33), so the chain was run entry-by-entry: 28 green including all 7 renamed `test/token-saver-*.js`; the 3 reds are all 2.3's — `cli-install` 1 (docs tree lists `token-saver*.js`), `contracts` 1 (docs ratchet: `sync-docs.js` parses `DEV_ONLY_FILES` from `bin/cli.js`, so the same missing entries make the HTML stale — proved by regenerating: the diff is only the two new hook rows; HTML restored, not committed), `hook-tests` 2 (`token-saver-ccr`: `bin/ccr.js:33` still reads `.token-guard/recover.json`; 2.3 owns the new-then-old pointer). Hazard for the record: `terminal-title.test.js` failed 1 ("awaiting|Notification rolls the deadline") and took 3.5 h on the first run because the machine slept mid-suite — re-run awake, 134/134 in 2m11s; wall-clock watchdog tests are not sleep-safe. Ledger + doc edits live on the plan branch; `/continue` for 2.3 re-enters the worktree.
- 2026-09-10 — **2.3 done** [3 sessions · 79 trips · peak 126k · was M → L+] — public `20fbcf9` on `plan/token-saver-rename` (same worktree, interactive; the session that started it was interrupted mid-fixture-listing and finished by the recovery session). All five boxes as specified, plus one the plan missed: `.claude/commands/validate-cca-install.md:73` mirrors `DEV_ONLY_FILES` and `dev-gate-consistency` diffs the two — the mirror gets the same two new names. `migrateTokenSaverConfigKey` + `tokenSaverBlock` are exported from `plugins.js` and shared by `cli.js` (migration runs before the retraction read; the gray line prints only on a move). `ccr.js` `POINTER_DIRS = ['.token-saver', '.token-guard']`, first readable valid pointer wins. Fixtures: cli-behavior 1/2b/2c updated + 2d (new-name leftover, unpaid → retracted), 87 green; plugin-activation seeds `tokenGuard: { sessionWarnUSD: 5 }` and asserts the activate merge lands under `tokenSaver` with the old key gone, 14 green. Verify: cli-behavior, plugin-activation, dev-gate-consistency, cli-install (2.2's red cleared), complexity-ratchet, contracts (2.2's docs-ratchet red cleared — `sync-docs.js` regen is byte-identical, nothing to commit), `token-saver-ccr` hook suite 9/9 and `test/ccr.test.js` 6/6 (2.2's pointer red cleared); eslint clean on the three bin files. Remaining `token-guard` hits in `bin/` are all the intended shim/migration/comment lines. Next: 2.4 (fleet manifest + sibling hooks) — `hook-fleet.local.json` is absent on this box, so the sync-hook-fleet dry runs there need it created or the check skipped.
- 2026-09-11 — **plan re-cut under the files-touched / trip-estimate rule** (plan-authoring.md on CCA main, 2026-09-11 — not yet on this branch; 5.1a merges it). Evidence: 2.3 tagged M ran 79 tool calls over three sessions (35/24/20, peak 126k) and 2.4 tagged M spent its first session on 21 reads and zero edits before an R14 rent card ended it — both over L on the ≤25-trip cap, invisible to the lines-read budget because a rename sweep is small on lines and wide on files. Re-cut: 2.4 → 2.4a/b/c (manifest + one-liners; terminal-title + statusline-cost; recover-session + worktree-gate + claim-registry), 2.5 → 2.5a/b (scripted command sweep + 3 version bumps; rules + CLAUDE.md + dogfood + docs regen), 4.1 → 4.1a/b (JAE hook files; JAE wiring + merge — the shim makes the split safe), 4.2 → 4.2a/b/c (wifi-app L; coldplay; global tier), 5.1 → 5.1a/b (merges + publish + deploy; fleet refresh + close). 3.1 unchanged (4 files, ~12 trips). Splits follow verify seams so a red suite is one short fix loop; sweeps are written one-file-per-box, read-then-edit; scripted replacements and verbatim copy batches count as one file. Dropped: 2.5's `validate-cca-install.md:73` box (2.3 already did it). 18 substeps parse (engine + plan-progress accept `2.4a` ids); next: 2.4a.
- 2026-09-11 — **2.4a done** [1 session · 19 trips · peak ~45k · M held] — public `0c00c14` on `plan/token-saver-rename` (same worktree, run interactively from the private-repo session at the user's ask). Manifest: `token-saver.js` (sourceKey `token-saver` + a new `legacySourceKey: 'token-guard'` read in `sourceRootFor`, so an existing box's `hook-fleet.local.json` keeps sourcing the engine without a hand edit), `token-saver-liveness.js`, `claim-registry.js` re-paired, plus shim rows for `token-guard.js` / `token-guard-liveness.js` paired with the engine. Test file swept `token-guard` → `token-saver` from line 9 (line 8 keeps the 231-line history); the shims are seeded in the two exact-count cases (check-mode drift, quiet-mode) and asserted in the partners case; one new case pins the legacy-key fallback — 25/25. Four one-liners swept in one `sed` pass (`sync-worktrees.js` was `:28`, not `:19`); `node --check` ×5, eslint clean, complexity ratchet green; nothing touched ships (`npm pack --dry-run` lists none). Dry run against a scratchpad stub keyed by the LEGACY `token-guard` source: engine + liveness `[ ok ]`, both shims `[DRIFT] absent` (the pairing `create` verdict — correct), exit 1 as expected. ⚠ Hazard for 5.1b, documented on the shim rows: a fleet repo still on the old name reads as drifted on `token-guard.js` (full engine ≠ 8-line shim) and a `--write` there would replace a live engine with a shim pointing at a file the repo lacks — 4.x must rename every fleet repo BEFORE 5.1b's `--write`. Also seen: `[!wire]` on the worktree's own `token-saver.js`/`-liveness.js` — this checkout's `settings.json` still calls the old names (2.5b's dogfood-settings box). Test file is CRLF; a Python rewrite LF'd it and it was restored before commit. Next: 2.4b.
- 2026-09-11 — **2.4b done** [2 sessions · ~26 trips · M held] — public `05075b3` on `plan/token-saver-rename`. `terminal-title.js`: the `:911` gate is now `TOKEN_SAVER_NAMES.some(...)` over `['token-saver.js', 'token-guard.js']` (module constant at `:839`), header prose + the house-style comment renamed; both pins follow (`test/terminal-title.test.js` 134/134, `terminal-title-clear-advice.test.cjs` 25/25). `statusline-cost.js`: state dir tries `~/.claude/.token-saver` then `.token-guard` (the engine owns the migration), `raw.tokenSaver || raw.tokenGuard`, `GUARD_NAMES` require new-then-old at both call sites, console message names `token-saver.js`. ⚠ The Verify line as written cannot go green: `live-twin-parity` compares the twin against the global `~/.claude/hooks/terminal-title.js`, which only 4.2c's `--write` updates — the plan's own "do NOT sync" rule guarantees red. Took the test's documented path: two `WHITELIST` rows (`/TOKEN_SAVER_NAMES/`, `/'token-guard.js'/`) with a comment naming 4.2c as the substep that empties it; a matching box added to 4.2c. Parity 1566/1567, 0 divergences. Session 1 was interrupted twice by the user (a mid-substep clear-card question, then an unexplained stop while reading 4.2c); session 2 resumed via `/continue` from the private-repo terminal — the probe still cannot see this plan (it lives in the CCA worktree, not the repo `/continue` runs in), so the verdict was reconciled by hand from `git status` here. Next: 2.4c.
- 2026-09-11 — **2.4c done** [1 session · ~12 trips · M held] — public `7fae954` on `plan/token-saver-rename`. `recover-session.py`: `POINTER_REL` became `POINTER_RELS = ['.token-saver', '.token-guard']` and `POINTERS` expands root-major, new-then-old per root (a worktree's new dir beats the main checkout's old one; nothing else references the constant). The other six mentions renamed, including the docstring's `token-guard-*` plan-alias example → `token-saver-*` / `{token, saver}`. `worktree-gate.js:12,225` and `claim-registry.js:162` are comment-only hits (no paths) — all three renamed, including the 2026-07-31 incident line, since the reader needs to identify the file by today's name. `test/ccr.test.js` seeds the pointer under `.token-saver/` (`bin/ccr.js` has read new-then-old since 2.3). Verify green: `ccr.test.js` 6/6, `recover-session-cap.test.js` 6/6, eslint clean on the three JS files. Live check: `--pid 99999` from the worktree lists pids 24–28, resolved through the OLD-name fallback — the CCA main checkout still runs the pre-rename engine and its pointer sits in `.token-guard/`, exactly the case the fallback exists for. `recover-session.py` is fleet-synced (canonical-first); no `--write`, 5.1b carries it. Next: 2.5a.
- 2026-09-11 — **2.5a done** [1 session · ~12 trips · M held] — public `e4dadac` on `plan/token-saver-rename`. One `sed` pass over `.claude/commands/*.md` (`hooks/token-guard.js` → `hooks/token-saver.js`, `.token-guard/` → `.token-saver/`): 10 lines in 5 files (analyze-session ×4, cost-compare ×1, recover-context ×2, token-saver-rationale ×2, usage-report ×1), nothing reverted — no retraction/shim wording was caught. Beyond the paths, the shipped commands also drop the engine's old name from prose, since a customer opens them: `recover-context.md` ×7 ("token-guard's idle warning/restart advisory", "a token-guard pointer") and `continue.md:111` ×1 → `token-saver`. Version bumps: recover-context 9→10, continue 18→19, validate-cca-install 12→13 (2.3 changed its `:73` dev_only row without bumping; this is that bump). Verify — survivors of `rg -n 'token-guard' .claude/commands`, all dev-gated or deliberate: `cost-compare.md:12,33` ("token-guard meter" prose, dev-only), `create-wip-report.md:397` (worktree-name example, history), `fleet.md:18` + `restore-after-reboot.md:26` + `whats-happening.md:7,16` (dev-gated file/title-substring examples), `usage-report.md:12` ("Renamed from /token-guard-report" history), `validate-cca-install.md:73` (dev_only list entry for the shim — deliberate). `dev-gate-consistency` 6/6. `contracts` was red on the docs ratchet (three command headers scanned by `sync-docs.js` changed, plus 2.4b's `terminal-title.js` header comment which nobody regenerated) — regenerated `autoconfig.docs.html` (12 lines, all from this plan's edits) and committed it with the substep, so 2.5b's docs-regen box only carries its own changes; `contracts` 4/4 after. Commit carries `Changelog: none`. Only a pre-push hook exists in this repo, so nothing ran at commit. Next: 2.5b.
