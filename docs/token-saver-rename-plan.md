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
plan branch from its base at every substep boundary; merge each repo ONCE, in 5.1. After each
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
  to defaults. Fleet repos therefore rename their engine (4.x) BEFORE any `@latest` run (5.1).
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
  `scripts/sync-terminal-title.js --write` / `scripts/sync-hook-fleet.js --write` in 4.2 / 5.1 —
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

### ☐ 1.1 · L · ~1.5h — Rename the engine and liveness hooks, add shims, migrate the state dir, alias the config key [opus]

**Read list** (Grep-then-window; the private copy's line numbers differ from the public ones
quoted elsewhere — grep, never trust a number): `.claude/hooks/token-guard.js` — `function
stateDir`, every `'.token-guard'` literal (home-tier: observed-skills, window-warns,
meter-canary, spend-ledger), `cfg.tokenGuard` (the reader, ~:1330 public), the header doc of
the config key (~:82 public), the `require.main === module` block and the ~20 lines above it,
`module.exports` (tail); `.claude/hooks/token-guard-liveness.js` whole (158 lines; `stateDir()`
at `:33`); this doc: traps + this substep.

- [ ] `git mv .claude/hooks/token-guard.js .claude/hooks/token-saver.js` and
      `git mv .claude/hooks/token-guard-liveness.js .claude/hooks/token-saver-liveness.js`.
- [ ] In `token-saver.js`: move the body of the `if (require.main === module) { … }` block into
      `function main() { … }`, leave `if (require.main === module) main();`, add `main` to
      `module.exports`. Confirm nothing else at module level starts work.
- [ ] Add `resolveStateDir(oldDir, newDir)`: if `newDir` exists → return it; else if `oldDir`
      exists → `try { fs.renameSync(oldDir, newDir); return newDir } catch { return oldDir }`;
      else return `newDir`. `stateDir(projectDir)` → `resolveStateDir(<…/.token-guard>,
      <…/.token-saver>)`. Add `homeStateDir()` the same way for `~/.claude/.token-guard` →
      `~/.claude/.token-saver`, and route the four home-tier literals through it.
- [ ] Config reader: `const block = cfg && (cfg.tokenSaver || cfg.tokenGuard); return (block &&
      typeof block === 'object') ? block : {};` — and document `tokenSaver` (read-alias
      `tokenGuard`) in the header comment. Update the file's own usage text
      (`node .claude/hooks/token-guard.js --report` etc.) to the new name.
- [ ] Liveness: same `main()` export, same `resolveStateDir` (copied — the liveness hook
      deliberately never requires the engine, `:9`); canary wording "token-guard" →
      "TokenSaver".
- [ ] Write the two shims, verbatim shape:
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

### ☐ 1.2 · M · ~45m — Private repo: tests, scripts, commands, dogfood wiring

**Read list:** the `require` line of each `.claude/hooks/tests/token-guard-*.test.cjs` (20) and
`test/token-guard-*.test.js` (9); `scripts/sync-token-saver-bundle.js` (whole, ~60 lines —
`:34` hook entry, `:43-44` file map, `:49` name); `.claude/scripts/set-spend-gate.js:40-60`;
`.claude/scripts/recover-session.py:45-60,95-105` (`POINTER_REL` `:52`);
`.claude/scripts/test-token-saver.js:95-110`; `.claude/commands/{analyze-session,usage-report,
token-saver-rationale,test-token-saver}.md` (grep windows); `.claude/settings.local.json:8-50`
(entries `:10,:14,:25,:36,:47`); `.gitignore:1-5`; `README.md`, `CLAUDE.md` (grep windows).

- [ ] `git mv` all 29 test files to `token-saver-*`; `sed` their `require('../token-guard…')`
      → `token-saver…`; re-verify `rg "require\(.*token-guard" .claude test` = 0.
- [ ] `sync-token-saver-bundle.js`: hook entry → `hooks/token-saver.js`; file map →
      `hooks/token-saver.js`. The bundle ships NO shim — a fresh activation has no legacy
      entries. Do not RUN the sync here (it writes into proswitch-api; 3.1 runs it).
- [ ] `set-spend-gate.js` writes via the resolved state dir; `recover-session.py` `POINTER_REL`
      tries `.token-saver/recover.json` then `.token-guard/recover.json`; `test-token-saver.js`.
- [ ] Commands' `allowed-tools` and bodies → `token-saver.js`; `.gitignore` adds
      `.claude/hooks/.token-saver/` (keep the old line); `settings.local.json` five entries →
      new names; README / CLAUDE.md mentions.

**Verify:** `for t in .claude/hooks/tests/*.test.cjs test/*.test.js; do node "$t" >/dev/null 2>&1 || echo "FAIL $t"; done` prints nothing;
`rg -n 'hooks/token-guard' --glob '!ARTICLES' --glob '!*.md' --glob '!gemini-docs' .` lists only
the two shim files.
**Commit:** `chore(token-saver): tests, scripts and commands follow the engine rename` + `Changelog: none`.

## Phase 2 — Public CCA

Repo `C:\CODE\claude-code-autoconfig`, worktree `token-saver-rename`, branch
`plan/token-saver-rename` off `main`. Every commit: `Changelog: none`.

### ☐ 2.1 · L · ~1.5h — Engine and shims in public CCA, same transform as 1.1 [opus]

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

- [ ] `git mv` both hooks; transplant 1.1's `main()` extraction, `resolveStateDir`,
      `homeStateDir`, reader alias, header doc and usage text — from the diff, verbatim; do not
      re-derive and do not touch any other line (the copies differ elsewhere by design).
- [ ] Write both shims (1.1's text).
- [ ] `complexity-baseline.json`: rename the key to `.claude/hooks/token-saver.js` (or add a
      row, if the ratchet treats a missing key as a failure — read the test first).

**Verify:** `node --check` ×4; the 1.1 synthetic-Stop loop through both names, exit 0;
`node test/complexity-ratchet.test.js && node test/hook-tests.test.js` green (the suites still
`require('../token-guard')` — the shim passes exports through, which is the point).
**Commit:** `refactor(token-saver): rename the engine and liveness hooks in CCA; shims keep the old names one release`.

### ☐ 2.2 · M · ~45m — Public CCA tests and manifests

**Read list:** `package.json:20-30` (test chain), `:44-56`, `:78-84` (files negations);
`.gitignore:22-26`; `.gitattributes:9`; the require / spawn-path line of each of the 22
`.claude/hooks/tests/token-guard-*.test.cjs` and 7 `test/token-guard-*.test.js`
(`test/token-guard-liveness.test.js` spawns the hook by path — 9 hits);
`test/dev-gate-consistency.test.js:54-80`.

- [ ] `git mv` the 29 test files to `token-saver-*`; fix requires and spawn paths;
      `rg "token-guard" test .claude/hooks/tests` afterwards shows only deliberate
      old-name fixtures (list them in the Ledger).
- [ ] `package.json`: the 7 chain entries → new names; `files` negations ADD
      `!.claude/hooks/.token-saver`, `!.claude/hooks/.token-saver/**`,
      `!.claude/hooks/token-saver.js`, `!.claude/hooks/token-saver-liveness.js`, keeping the old
      four; `.gitignore` adds `.claude/hooks/.token-saver/`; `.gitattributes:9`.

**Verify:** `npm test` green (8–10 min); `npm pack --dry-run 2>&1 | grep -i 'token-'` prints no
hook file.
**Commit:** `chore(token-saver): test suites and package manifests follow the rename`.

### ☐ 2.3 · M · ~1h — Installer: dev gate, retraction, config-key migration, plugin verify

**Read list:** `bin/cli.js:512-526` (`DEV_ONLY_FILES`), `:598-612` (the gls migration — copy
its shape), `:660-695` (retraction), `:720-726` (strip); `bin/lib/plugins.js:25-40,305-390`
(`TOKEN_SAVER`, `verifyTokenSaver`, expected bundle paths, hook entry written at activation);
`bin/ccr.js:1-50` (`recover.json` read `:33`); `test/cli-behavior.test.js:225-250,336-420`
(fixtures 2 / 2b / 2c); `test/plugin-activation.test.js` (grep `token-guard`, 18 hits);
`test/dev-gate-consistency.test.js`.

- [ ] `DEV_ONLY_FILES`: add `'token-saver.js'`, `'token-saver-liveness.js'`; keep the old two.
      One literal line.
- [ ] Retraction: the delete list and the settings fragment cover BOTH command lines (a second
      `TOKEN_SAVER_SETTINGS_FRAGMENT`, unmerged alongside); `keepTokenGuard` reads
      `(cfg.tokenSaver || cfg.tokenGuard)` for `verdictServiceKey` / `devFleet`.
- [ ] Config-key migration next to the gls one: when `cfg.tokenGuard` is an object,
      `cfg.tokenSaver` absent and the config not corrupt → `cfg.tokenSaver = cfg.tokenGuard;
      delete cfg.tokenGuard;` write round-tripped; one gray console line. Runs before the
      retraction reads the config.
- [ ] `plugins.js`: expected bundle file `hooks/token-guard.js` → `hooks/token-saver.js`; the
      hook entry it writes at activation → `token-saver.js`. `ccr.js` → new-then-old pointer.
- [ ] Fixtures: 2 (old-name leftovers) unchanged + a new-name leftover variant; 2b (paid) holds
      `token-saver.js` under a `tokenGuard` key and asserts the key was migrated to
      `tokenSaver`; 2c (devFleet) holds `token-saver.js` under `tokenSaver`.
      `plugin-activation.test.js` expectations → new paths.

**Verify:** `node test/cli-behavior.test.js && node test/plugin-activation.test.js && node test/dev-gate-consistency.test.js && node test/cli-install.test.js && node test/complexity-ratchet.test.js`; `npx eslint bin/cli.js bin/lib/plugins.js bin/ccr.js`.
**Commit:** `fix(installer): dev gate, retraction and plugin verify know both hook names; cca.config.json key migrates to tokenSaver`.

### ☐ 2.4 · M · ~1h — Fleet manifest and sibling hooks

**Read list:** `scripts/sync-hook-fleet.js:60-100` (manifest rows `:73`, `:78`, `:83`),
`:160-175`; `test/hook-fleet-sync.test.js` (grep `token-guard` → the manifest fixture windows
only); `.claude/hooks/terminal-title.js:20-30,900-915,1000-1006,2278-2286` (gate `:911`);
`.claude/hooks/statusline-cost.js:60-70,115-125,195-205,268-276`;
`.claude/hooks/worktree-gate.js:10-14,222-228`; `.claude/hooks/claim-registry.js:160-164`;
`.claude/scripts/recover-session.py:25-32,50-55,95-105,125-130,320-326,398-404,662-668`;
`.claude/scripts/fleet.js:9`, `whats-happening.js:11`, `sync-worktrees.js:19`;
`scripts/sync-terminal-title.js:14`; `test/live-twin-parity.test.js` (grep).

- [ ] Manifest: rows → `token-saver.js` (sourceKey `token-saver`), `token-saver-liveness.js`
      (`pairsWith`), plus rows for both shims so the fleet keeps them identical.
- [ ] `terminal-title.js:911`: gate on `token-saver.js` OR `token-guard.js` existing.
- [ ] `statusline-cost.js`: `:65` home path via the new dir with old fallback; `:120`
      `.tokenSaver || .tokenGuard`; `:200`, `:272` require `token-saver.js`, fall back to
      `token-guard.js`.
- [ ] `recover-session.py`: `POINTER_REL` new-then-old; the other six mentions.
      `worktree-gate.js`, `claim-registry.js`, `fleet.js`, `whats-happening.js`,
      `sync-worktrees.js`, `sync-terminal-title.js`: paths and comments.
- [ ] Do NOT run `sync-terminal-title.js --write` or `sync-hook-fleet.js --write` here — 4.2
      and 5.1 own the live actuations.

**Verify:** `node test/hook-fleet-sync.test.js && node test/terminal-title.test.js && node test/live-twin-parity.test.js && node test/ccr.test.js && node test/recover-session-cap.test.js`; `node scripts/sync-hook-fleet.js` (dry run) lists the token-saver rows.
**Commit:** `chore(fleet): manifest and sibling hooks follow the token-saver rename`.

### ☐ 2.5 · M · ~1h — Commands, rules, docs, dogfood settings

**Read list (grep windows only):** `.claude/commands/{recover-context (7 hits), analyze-session
(:4,:23), usage-report (:20), cost-compare, whats-happening, token-saver-rationale (:3,:27),
validate-cca-install (:73), restore-after-reboot, create-wip-report, fleet, continue}.md`;
`.claude/rules/parallel-session-worktrees.md:80-88,170-176`; `.claude/rules/plan-authoring.md:100-108`;
`CLAUDE.md` (12 hits); `.claude/settings.local.json:160-215`.

- [ ] Replace `hooks/token-guard.js` command paths and `.token-guard/` paths in the commands;
      `validate-cca-install.md:73` dev_only list adds the new names. `@version` bump +
      `Changelog: none` for the three shipped commands (`recover-context`, `continue`,
      `validate-cca-install`).
- [ ] Rules (`plan-authoring.md` is canonical + byte-synced to adopting repos — 5.1's fleet
      sync carries it), `CLAUDE.md`, the five dogfood entries in `settings.local.json`.
- [ ] `node .claude/scripts/sync-docs.js`. Leave `docs/` plans and audits and
      `scripts/generate-changelog.js` OVERRIDES untouched (history).

**Verify:** `rg -n 'token-guard' .claude/commands .claude/rules CLAUDE.md bin scripts --glob '!scripts/generate-changelog.js'` shows only the deliberate old-name survivors (retraction, `DEV_ONLY_FILES`, shim manifest rows, alias fallbacks) — paste the list into the Ledger; `npm test` green.
**Commit:** `chore(commands): hook paths follow the token-saver rename`.

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

### ☐ 4.1 · M · ~1h — job-agent-extension

Session rooted in `C:\CODE\job-agent-extension`. ⛔ `EnterWorktree` (`token-saver-rename`) +
`node scripts/bootstrap-worktree.js` before the first write. The hooks that FIRE are the main
checkout's — the rename takes effect there at merge; the shim keeps the interval safe.

**Read list:** `.claude/settings.local.json:570-630` (entries `:577,:581,:592,:603,:623`) and
`:490-550` (allow literals `:494,:495,:497,:498,:505,:506,:518,:519,:546`);
`.claude/cca.config.json`; `.claude/hooks/token-guard-liveness.js:30-36`; `.gitignore` (grep);
`.claude/hooks/tests/token-guard-quiet-card.test.cjs` (require line).

- [ ] `git mv` `token-guard.js` → `token-saver.js` and the liveness hook, then overwrite
      content with the post-2.1 canonical files from
      `C:\CODE\claude-code-autoconfig\.claude\hooks\` on branch `plan/token-saver-rename`, and
      copy both shims. (This moves JAE from its 5,202-line engine to CCA's — what the fleet sync
      does anyway; note it in the Ledger.)
- [ ] `settings.local.json`: five hook entries and nine allow literals → new paths.
- [ ] `cca.config.json`: `tokenGuard` → `tokenSaver` (contents unchanged, `devFleet: true` stays).
- [ ] `.gitignore` adds `.claude/hooks/.token-saver/`; `git mv` the quiet-card test, fix its
      require.
- [ ] Leave the CCA-managed commands (`token-saver-rationale`, `usage-report`, `recover-context`,
      `continue`, `fleet`, `whats-happening`, `validate-cca-install`) — 5.1's installer run
      refreshes them; the shim keeps `node .claude/hooks/token-guard.js --details` working until
      then. Leave `docs/token-guard-*.md`, `.claude/plans/`, `.claude/board/` (history).

**Verify:** the 1.1 synthetic-Stop loop through both names, exit 0; `ls .claude/hooks/.token-saver | wc -l` (≈1,395) and `.token-guard` gone or its fallback noted; `node .claude/hooks/token-saver.js --details` prints the rationale card; `pnpm test --run` green.
**Commit** in the worktree; `ExitWorktree keep`, merge to `main` from the main checkout (autonomous — no approval gate), then `remove`.

### ☐ 4.2 · M · ~1h — wifi-app, coldplay-bossa-nova, and the global tier

**Read list:** wifi-app `.claude/settings.json:15-20,39-47,62-66,73-77,108-112` (six entries),
`.claude/settings.local.json` (12 allow literals — grep), `.claude/cca.config.json` (`mode:
"token-saver"` stays), the require line of the 7 `.claude/hooks/tests/token-guard-*.test.cjs`,
`.gitignore`; coldplay `.claude/settings.json:33,58,101,121`, `.claude/cca.config.json` (may be
absent); global `~/.claude/hooks/statusline-cost.js` (:65,:120,:200,:272),
`~/.claude/commands/cost-compare.md:4,12,33`, `~/.claude/commands/restore-after-reboot.md:26`,
`~/.claude/settings.json` (verify only — no token-guard entries on 2026-09-10).

- [ ] wifi-app: as 4.1 — `settings.json` is the carrier; `git mv` the 7 tests; `tokenGuard` →
      `tokenSaver`; `.gitignore`.
- [ ] coldplay-bossa-nova: canonical `token-saver.js` + shim in, four entries flipped, and write
      `.claude/cca.config.json` `{ "tokenSaver": { "devFleet": true } }` (create if absent) so a
      future `@latest` there keeps the file.
- [ ] Global: `node C:/CODE/claude-code-autoconfig/scripts/sync-terminal-title.js --write`
      (canonical-first); `cp` `statusline-cost.js` from CCA (manual cp is the rule for that
      file); edit the two global commands; `~/.claude/.token-guard` migrates on the first hook
      run.

**Verify:** per repo the synthetic-Stop loop through both names exit 0 and the state dir migrated; wifi-app `for t in .claude/hooks/tests/*.test.cjs; do node "$t" >/dev/null 2>&1 || echo "FAIL $t"; done`; `ls ~/.claude/.token-saver`.
**Commit** in wifi-app and coldplay on their `main` (single-session repos); the global tier has no repo.

## Phase 5 — Release

### ☐ 5.1 · M · ~1h — Merge every repo once, publish, refresh the fleet, deploy the bundle

Precondition: 1.1–4.2 Ledgered. In this order:

- [ ] Private repo: `git merge plan/token-saver-rename` → `main`, push.
- [ ] Public CCA, from the MAIN checkout (never a worktree): `git merge plan/token-saver-rename`
      → `main`; `npm test`; `/deploy-to-npmjs` (`npm version patch` → postversion changelog →
      publish). Read the generated changelog bullets: no paid / pricing wording.
- [ ] proswitch-api: merge → `magic-url-deploy`, push, safe deploy per FEEDBACK.md "Deploying
      API Changes"; confirm the bundle endpoint serves `hooks/token-saver.js`.
- [ ] Fleet refresh: in JAE and wifi-app run `npx claude-code-autoconfig@latest`; confirm
      `token-saver.js` SURVIVES (devFleet) and the managed commands now say `token-saver.js`.
      `node scripts/sync-hook-fleet.js` dry run from CCA: token-saver rows in sync — ⛔ no
      `--write` if the dry run reports the private-vs-public engine drift.
- [ ] Ledger the shim-removal condition (Deferred, first bullet) with the published version.

**Verify:** `npm view claude-code-autoconfig version` = the new version;
`rg -ln 'hooks/token-guard' C:/CODE/job-agent-extension/.claude C:/CODE/wifi-app/.claude C:/CODE/coldplay-bossa-nova/.claude --glob '!*.md'` lists only the shim files.
**Commit:** the merges are the commits; the Ledger entry closes the plan.

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
