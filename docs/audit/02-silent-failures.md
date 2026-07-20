# Audit 02 — Where Wrong Edits Fail Silently

Audit dimension: gaps where a wrong edit by a less-capable model runs clean and only
breaks later in a user's hands. Goal state: a wrong edit fails loudly before it ships.

Repo: claude-code-autoconfig v1.0.215 (published npm CLI, real users). Audited 2026-07-20.

Severity: High / Med / Low. Effort to close: S (hours) / M (a day) / L (multi-day).

**Baseline facts established during the audit** (so later findings don't re-litigate them):

- CI exists and is real: `.github/workflows/test.yml` runs `npm test` on
  ubuntu/windows/macos × node 18/20/22 on push + PR to main.
- All 10 `test/*.test.js` files ARE wired into the `npm test` chain (package.json:25).
  Nothing in `test/` is orphaned. Hook suites are auto-discovered by
  `test/hook-tests.test.js:16-24` (readdir, loud failure if the dir is empty).
- Zero type annotations: no jsconfig.json, no tsconfig.json, no `// @ts-check`, and a
  project-wide grep for `@type|@param|@returns` over `bin/`, `scripts/`,
  `.claude/hooks/`, `.claude/scripts/` returns **0 matches** across ~11,700 LOC.
- Zero lint/format config: no .eslintrc*, eslint.config.*, biome.json, .prettierrc*,
  or .editorconfig anywhere. No husky; `.git/hooks/` is empty.
- Swallowed-error catches (`catch (_)` / `catch {`): token-guard.js **64**,
  terminal-title.js **59**, bin/cli.js **8** — 131 in the three biggest files alone.

---

## Category 1 — Type-checking gaps

### 1.1 No static checking on any JSON/message boundary (High, effort M)

There is no jsconfig, no `@ts-check`, no JSDoc typedefs anywhere (see baseline). The
places this bites hardest are the data boundaries where a silently-wrong field name or
shape survives every test and only misbehaves in a user project:

- `bin/cli.js:213-269` `mergeSettingsInto` / `bin/cli.js:273-310` `unmergeSettingsFrom`
  — walk `hooks[event][].hooks[].command`, `env`, `permissions.allow/deny` with zero
  shape validation. A typo like `matcher.hook` instead of `matcher.hooks` produces
  `undefined`-driven no-ops, not errors, and ships a merge that silently drops entries.
- `bin/cli.js:342-359` `loadManifest` — validates only `name` (string) and `files`
  (array). `settings` is passed straight into the merge unvalidated; a malformed plugin
  fragment writes garbage into the user's settings.json without complaint.
- `bin/cli.js:21-27` `readCcaConfig` and `.claude/hooks/token-guard.js:921-926`
  `loadConfig` — both `catch (_)` malformed `cca.config.json` (see 1.2).
- Hook stdin payloads (`data.tool_input.file_path`, `data.hook_event_name`,
  `data.transcript_path`) are optional-chained everywhere
  (`.claude/hooks/format.js:27`, `arcade-beeps.js:107-120`) — a renamed field reads
  `undefined` and the hook quietly does nothing forever.
- Ledger JSONL contract: `terminal-title.js` writes `{sid}.history.jsonl` lines
  (`ts`/`title`/`tokens`); `token-guard.js` `ledgerScopes()` and three shipped command
  prompts (`continue.md`, `eval-new-session.md`, `migrate-new-session.md`,
  `recover-context.md`) parse them. Producer and one consumer have tests
  (`test/terminal-title.test.js:224-292`, `.claude/hooks/tests/token-guard-r6.test.cjs:136-173`),
  but nothing pins the *field names as a contract* — a rename that updates both JS
  files still silently breaks the .md prompt consumers (see also 4.6).

Fix shape: add `jsconfig.json` with `checkJs: true` + a small `types.d.ts` (or JSDoc
`@typedef`s) for: settings.json shape, plugin manifest, cca.config.json, hook stdin
payload, history-ledger line. Even without CI type-check, editors and a
`npx tsc --noEmit` test step would catch field-name drift.

### 1.2 Malformed-JSON fallbacks that destroy or silently disable user data (High, effort S)

Three `catch → default` paths turn a corrupt-but-recoverable file into silent data loss
or silent feature-off:

- **`bin/cli.js:381-390` (plugin add): corrupt user settings.json → user settings
  wiped.** `catch { userSettings = {}; }` then the plugin fragment is merged into the
  empty object and **written back over the user's settings.json**. One stray trailing
  comma from a hand edit + one `plugin add` = the user's entire hooks/env/permissions
  config replaced by the plugin's fragment. No warning, exit 0.
  (Contrast `pluginRemove` at cli.js:424-430, which correctly leaves an unparsable
  settings.json intact.)
- **`bin/cli.js:21-28`: corrupt cca.config.json → silent unpin.** `readCcaConfig`
  returns `null` on parse failure, so `pinVersion` reads as absent and the very
  protection feature (freeze silent refreshes, cli.js:511-523) evaporates — the pinned
  project gets dragged to latest with no message.
- **`bin/cli.js:331-335`: corrupt plugins ledger → orphaned installs.**
  `readPluginsLedger` returns `{}`; `plugin remove` then reports "not installed" while
  the plugin's files and settings contributions remain forever.

Fix shape: distinguish ENOENT (fine, default) from parse error (refuse to proceed /
back the file up and say so). Three small guards, all loud.

### 1.3 Blanket catch around the settings upgrade merge (Med, effort S)

`bin/cli.js:916-933`: the entire upgrade-path settings merge
(`migrateLegacyHookCommands` + `mergeSettingsInto` + write) is wrapped in
`catch (err) { /* If merge fails, don't break the install */ }`. A thrown regression in
either helper means **every future upgrade silently stops delivering new hooks,
permissions, and env keys** — installs look successful, settings just stay stale. The
helpers have unit tests via source-extraction (`test/cli-install.test.js:579-635`), but
the composed read-merge-write path that this catch guards has none. At minimum log one
yellow line inside the catch; ideally add a behavioral fixture test (see 3.4).

### 1.4 engines claims node >=16, CI tests 18/20/22 (Low, effort S)

`package.json:56-58` vs `.github/workflows/test.yml:15`. Anything in the codebase that
requires node 17/18 semantics ships green and breaks only for node-16 users at runtime.
Either raise `engines` to >=18 (matches CI reality) or add 16 to the matrix.

---

## Category 2 — Lint absence

### 2.1 No linter, no formatter, nowhere (Med, effort S)

No ESLint/Biome/Prettier/editorconfig config exists (baseline). There is no `lint`
script in package.json — yet the shipped settings template allowlists
`Bash(npm run lint)` / `npm run lint:fix` / `npm run typecheck`
(`.claude/settings.json:130-132`) for commands that don't exist in this repo. In an
untyped codebase where hooks are *designed* to swallow exceptions and `exit 0`
(token-guard.js, terminal-title.js — 123 silent catches between them), an
undefined-variable typo inside any rarely-hit branch is undetectable: no compile step,
no lint, no crash, no log. `eslint` with just `no-undef`, `no-unused-vars`, and
`no-empty` (allowing commented catches) would convert a whole class of wrong edits into
pre-ship failures. Effort S: flat-config ESLint + one CI line.

### 2.2 format.js hook is a silent no-op almost everywhere (Low, effort S)

`.claude/hooks/format.js:39-47` runs `execSync('npm run format --silent || true',
{ stdio: 'ignore' })`. In any project without a `format` script (including this repo
itself), the hook does nothing — by design "best-effort", but there is no debug path,
no log line, and no test (see 4.2), so a wrong edit to its extension regex (line 30) or
skip-list (line 35) is indistinguishable from normal operation.

---

## Category 3 — Tests not wired in / missing CI enforcement

### 3.1 Publishing is not gated on tests (High, effort S)

Nothing mechanical runs `npm test` before code reaches npm:

- No `prepublishOnly`, no `prepack`, no `preversion` script (package.json:24-32).
- The `pub` script is `npm whoami && npm publish` (package.json:27) — auth check only.
- The only "run tests first" gates are prose: `/deploy-to-npmjs` steps 2-3
  (`.claude/commands/deploy-to-npmjs.md:22-23`) and CLAUDE.md's Testing Requirements —
  conventions an agent under time pressure or a human in a hurry can skip.

Given the CLI executes at full trust inside thousands of `npx` runs, this is the single
cheapest high-value fix in this audit:
`"prepublishOnly": "npm test"` (one line) makes an untested publish impossible, and
`"preversion": "npm test"` catches it a step earlier.

### 3.2 No pre-commit / pre-push enforcement (Med, effort S)

`.git/hooks/` is empty; no husky/lefthook. CLAUDE.md marks "run `npm test` before
committing bin/scripts/hooks changes" as CRITICAL, but it is convention only. CI
catches breakage *after* push — except for everything CI structurally cannot see (3.3,
5.1, 5.2). A `pre-push` hook running `npm test` is effort S.

### 3.3 Parity and live-hook tests silently pass everywhere but one machine (Med, effort S)

- `test/live-twin-parity.test.js:32-36`: exits 0 with "skipping" whenever
  `~/.claude/hooks/terminal-title.js` is absent — i.e., on all 9 CI matrix legs and any
  machine but Andrew's. CI green ≠ parity ok (known invariant, restated here because
  the skip prints `ALL TESTS PASSED (0 tests, skipped)` — a string that reads like
  success in a log scan).
- `test/golden-endings.test.js:75-80`: the LIVE-hook corpus run has the same
  silent-skip shape (the twin run still executes, so classification itself is covered).

The dev box is the only place these assert, and the dev box has no pre-push hook (3.2).
A drift introduced on another machine (or via GitHub web edit) is invisible until the
next local `npm test` on this machine. Cheap hardening: make the skip line
unmistakable (`SKIPPED (no live hook) — parity NOT verified`) and/or add a CI job that
copies the twin to `~/.claude/hooks/` first so the normalization logic itself stays
exercised.

### 3.4 The install path is tested by source-string assertions, not behavior (High, effort M)

`test/cli-install.test.js` and `test/update-system.test.js` overwhelmingly assert that
`bin/cli.js` *source contains literals*, not that running it produces the right tree:

- `assertCliCopies("copyDir(commandsSrc, ...)")` (cli-install.test.js:39-44, 105-129)
  passes as long as the string exists — even if the call is moved into dead code.
- `update-system.test.js:153-175` verifies `--pull-updates` support by
  `content.includes('--pull-updates')` and `includes('function pullUpdates()')`. The
  actual behaviors — `parseAppliedUpdates` regex (cli.js:87-100), highest-applied
  filtering (cli.js:148-153), the `@applied`-block-preserving merge (cli.js:123-137) —
  are never executed by any test.
- Also never executed: the backup/migration path (cli.js:644-708), pre-marking bundled
  updates as applied (cli.js:959-982), gls `@screenshotDir` preservation
  (cli.js:805-852), the FEEDBACK.md → Discoveries migration (cli.js:992-1031), the
  settings merge write path (1.3), and the whats-new file write (cli.js:1042-1055).

The two genuinely behavioral exceptions prove it's feasible: the inside-Claude block
test spawns the real CLI (cli-install.test.js:544-556), and `plugin-system.test.js`
drives `bin/cli.js` end-to-end against temp dirs (its header explicitly brags
"not on source text"). `terminal-title.test.js` is likewise behavioral.

A wrong edit to any of the listed cli.js regions that keeps the magic strings intact
ships green and fails only during a real user's `npx` upgrade — the exact scenario this
audit targets. Fix: one `test/cli-behavior.test.js` that runs
`node bin/cli.js --bootstrap` (and `--pull-updates`) in fixture projects (fresh,
upgrade-with-user-content, upgrade-with-@applied) and asserts on the produced tree.
The `--bootstrap` early-exit (cli.js:1060-1063) makes this runnable headlessly; only
the `claude --version` check (cli.js:547-554) needs a PATH shim.

### 3.5 Command `@version` bump is unenforced — and forgetting it hides updates from users (Med, effort S)

CLAUDE.md mandates bumping `<!-- @version N -->` on every command edit. Nothing checks
it, and the failure is genuinely silent: `bin/cli.js:947`
`if (oldVersion > 0 && newVersion > 0 && oldVersion === newVersion) continue;` —
a command whose content changed but whose version wasn't bumped is **omitted from the
upgrade report entirely**. The file still updates on disk, but the user is never told,
and `/autoconfig-update`'s "what changed" narrative loses the entry. Effort S: a test
that every `.claude/commands/*.md` has a parseable `@version`, plus (better) a check in
cli.js that prints "(updated)" instead of skipping when content differs at equal
versions.

---

## Category 4 — Runtime-only failure paths

### 4.1 LIVE BUG: sync-docs.js's DEV_ONLY_FILES mirror has drifted — shipped docs document features users don't have (High, effort S)

- `bin/cli.js:751` (the authoritative gate): 6 entries — deploy-to-npmjs.md,
  usage-report.md, analyze-session.md, eval-new-session.md, migrate-new-session.md,
  token-guard.js.
- `.claude/scripts/sync-docs.js:37` (self-described "mirror of bin/cli.js
  DEV_ONLY_FILES"): **1 entry** — deploy-to-npmjs.md.

Result, verified in the shipped artifact `.claude/docs/autoconfig.docs.html` (which
cli.js:854-863 copies verbatim into every user project): file-tree rows at lines 869
(analyze-session.md), 924 (eval-new-session.md), 939 (migrate-new-session.md),
969 (usage-report.md), 1049 (token-guard.js) — five dev-gated files presented to users
as part of their install, with info cards and previews (44 total references). Users
clicking them see documentation for commands that do not exist in their project.

Why no test caught it: `test/cli-install.test.js:412-473` parses cli.js's list by regex
and asserts every *shipped* command appears in the docs — it never asserts the inverse
(no dev-only file appears). The mirror comment at sync-docs.js:36 is the only guard.

Fix: sync-docs.js should parse the list out of bin/cli.js (the same regex the tests
already use) instead of keeping a copy; plus one inverse test: for each DEV_ONLY entry,
assert `docsHtml` does NOT contain `<span class="file">{name}</span>`. Then regenerate
the docs.

### 4.2 Four shipped hooks have zero test coverage, and all fail silent by design (High, effort M)

Coverage map of `.claude/hooks/*.js` (runners: `test/hook-tests.test.js` +
`test/terminal-title.test.js` + golden-endings + parity):

| Hook | Tested? | Silent-failure surface |
|---|---|---|
| terminal-title.js (1433 LOC) | Yes — behavioral (test/terminal-title.test.js, 1314 LOC), lineage, golden corpus, parity | — |
| token-guard.js (2659 LOC) | Yes — 9 unit suites in .claude/hooks/tests/ (dev-gated file) | digest wording unpinned (4.6) |
| mark-commit-active.js | Yes — mark-commit-active.test.cjs | — |
| **migrate-feedback.js** (73 LOC) | **No** | **Destructive**: appends to CLAUDE.md and **resets FEEDBACK.md to a template** (lines 55-72) on every SessionStart where its conditions match; whole run wrapped in `catch { /* Silent exit */ }` (lines 22-27). A wrong edit to the `---` separator scan or the `## Discoveries` guard could wipe team feedback with no error anywhere. |
| **arcade-beeps.js** (149 LOC) | Source-regex asserts only (cli-install.test.js:177-233) | Every path swallows; only mitigations are the bounded diag log (lines 53-58) and DEBUG env. The awaiting/complete classification fallback chain (lines 126-137) is untested behaviorally. |
| **format.js** (50 LOC) | **No** | See 2.2 — triple-silenced (`catch` + `stdio: ignore` + `\|\| true`). |
| **feedback-rule-check.js** (42 LOC) | **No** | Lowest risk (prints guidance, no writes) — but a broken `endsWith('FEEDBACK.md')` gate (line 21) silently kills the feature. |

Priority: a behavioral test for migrate-feedback.js (it writes user files) and a
smoke test that arcade-beeps.js + format.js + feedback-rule-check.js each exit 0 AND
produce their expected observable (log line / stdout) for a canned payload — that
converts "swallowed forever" into "assertable".

### 4.3 The FEEDBACK.md migration exists twice, hand-synced (Med, effort S)

The same migration — find first `---`, extract custom content, append `## Discoveries`
to CLAUDE.md, reset FEEDBACK.md to an identical hardcoded template string — is
implemented independently in `bin/cli.js:992-1031` (upgrade path) and
`.claude/hooks/migrate-feedback.js:30-73` (SessionStart hook). The multi-line template
literal is duplicated character-for-character. Neither copy is tested (3.4, 4.2), and
nothing detects divergence — an edit to one template leaves installs producing
different FEEDBACK.md files depending on which path ran first. Extract to a shared
module (cli.js already requires `./update-summary.js`, so the pattern exists) or at
least add a parity test comparing the two template strings from source.

### 4.4 Load-bearing shell logic embedded as a JSON string in settings.json (Med, effort S)

`.claude/settings.json:44` — the uncommitted-work Stop warning is a ~400-char inline
bash one-liner (`find .git/.cc-commit-active -mmin -5`, `git status --porcelain | grep
-c .`, awk sum, threshold compare, printf JSON) inside a JSON string. It cannot be
linted, has no test (its cousin mark-commit-active.js does), suppresses all errors with
`2>/dev/null`, and a quoting mistake during any settings edit degrades it to
never-fires with zero symptoms. It also assumes bash/grep/awk exist on the user's
Windows PATH. Moving it into `.claude/hooks/check-uncommitted.js` puts it under the
same testability umbrella as every other hook.

### 4.5 131 designed-silent catches with no uniform diagnostic channel (Med, effort M)

Hooks must not crash sessions — swallowing is correct. But `catch (_) {}` makes a
*regression* swallow and a *designed* swallow identical. arcade-beeps.js shows the
better pattern (bounded log at `~/.claude/hooks/.titles/arcade-beeps.log` + DEBUG env);
terminal-title and token-guard have partial internal logging; cli.js's 8 swallows
(including 1.2's data-loss paths) log nothing. A shared `swallow(tag, err)` helper that
appends one line to a bounded diag file would make "the hook quietly stopped
warning/painting" a greppable event instead of an inference. CLAUDE.md already warns
"'it didn't error' proves nothing" — this gives that warning teeth.

### 4.6 token-guard `--analyze` digest wording is a machine interface with no test pinning it (Med, effort S)

CLAUDE.md declares the literal "live context at end" and the RENT/BOMBS/FLEETS/TTL
headers a machine interface keyed on by `/analyze-session`
(`.claude/commands/analyze-session.md`). Grep across `.claude/hooks/tests/` shows
**no test asserts the digest's literal output strings** (r6 covers `ledgerScopes`
units; r12 covers window logic). A wording tweak in token-guard.js's digest emitter
ships green and breaks the command's parsing instructions silently. Dev-gated today,
so user impact is nil — but this is exactly the kind of contract that will be forgotten
when token-guard un-gates. Effort S: one snapshot-style test asserting the digest
contains the four headers and the "live context at end" phrase.

### 4.7 `ccr` bin ships to every user while its producer is dev-gated (Low-Med, effort S)

`package.json:33-36` installs the `ccr` binary for all users, but the only writer of
its pointer file (`recover.json`) is token-guard.js — which `DEV_ONLY_FILES` excludes
from user installs. Every real user's `ccr` can only ever print "no recovery pointer"
(`bin/ccr.js:40-45`). Additionally `readPointer` (ccr.js:26-32) swallows malformed JSON
into the same "no pointer here" message — a corrupt pointer is misdiagnosed as absence.
No test asserts bin entries correspond to shipped features. Either gate the bin or
document the intentional leak; add a distinct message for unparsable-pointer.

### 4.8 Publish-time-only code paths never rehearsed (Med, effort S)

- `scripts/generate-changelog.js` — `bulletFor`/`isHousekeeping` are unit-tested
  (`test/changelog-gen.test.js`), but `main()` (tag enumeration, `%x1f/%x1e` log
  parsing, the postversion commit/re-tag dance at lines 113-127) executes only during a
  real `npm version`. The half-versioned-repo hazard is handled for the empty-diff case
  (lines 118-123, good), but a failure in `git tag -f` or the changelog commit still
  aborts mid-release with a bumped-but-unrecorded state, discovered only live.
- `.claude/scripts/sync-docs.js` — runs only when a maintainer remembers (5.1). Its
  marker-based surgery *is* loud on marker misses (exit 1 at lines 560-574, 583-596,
  631-664 — good design), with one exception: see 4.9.

A dry-run test that clones the repo's git history into a temp dir and runs
`generate-changelog.js` (no --postversion) would exercise the parsing at test time.

### 4.9 sync-docs.js exits 0 when the docs file is missing (Low, effort S)

`.claude/scripts/sync-docs.js:21-24`: absent `autoconfig.docs.html` → silent
`process.exit(0)`. If the docs file is ever renamed/moved, every future "regenerate the
docs" step (readme-sync rule, /deploy-to-npmjs step 1) reports success while syncing
nothing. Should be a loud error in the maintainer repo (the "nothing to sync" case is
legitimate only in user projects, which never run this script — distinguish by checking
for `bin/cli.js`).

### 4.10 Update-file numbering invariants live only in prose (Med, effort S)

`.claude/updates/README.md` states the append-only rules: never reuse a number, `002`
is a retired tombstone, next is `005`. The failure mode is textbook-silent: a reused
number is *skipped without any message* on every install whose `@applied` block already
lists it (cli.js:148-153 filters on `> highestApplied`). `test/update-system.test.js`
checks file format but not numbering. Effort S: extend it to assert (a) IDs unique,
(b) no `002-*` file exists, (c) IDs are a subset of expected known-good history — a
regex over the updates dir.

---

## Category 5 — Absent verify loops (manual steps nothing enforces)

### 5.1 "Sync docs + README before publish" is a rule, not a check (High→Med, effort S)

`.claude/rules/readme-sync.md` mandates README comparison and `sync-docs.js` before
*any* publish; `/deploy-to-npmjs` step 1 repeats it. Nothing mechanical verifies either:
no test regenerates the docs and diffs against the committed file, no CI step, and
`npm publish` runs with zero pre-hooks (3.1). **Finding 4.1 is this loop failing in
production** — the committed docs HTML drifted from the shipped-file set and ten+
releases went out anyway. Effort S: a test that runs sync-docs.js against a temp copy
and asserts byte-equality with the committed HTML ("docs are regenerated" ratchet);
same pattern as the missing README-table check.

### 5.2 sync-terminal-title.js check mode is wired to nothing (Med, effort S)

`scripts/sync-terminal-title.js:10` advertises "CHECK: report drift, exit 1 if any
(pre-commit / CI friendly)" — but no pre-commit hook exists (3.2) and CI can't see the
fleet (the target dirs are personal checkouts, script header lines 27-32). The actuator
(`--write`) is invoked purely from memory per CLAUDE.md's landmine list. The only
automated guard is live-twin-parity, which itself skips off the dev box (3.3). Given
the fleet is personal, the realistic fix is a dev-box pre-push hook running
`node scripts/sync-terminal-title.js` (check mode) + `npm test`.

### 5.3 Three hand-coordinated gating lists, one of them tested (Med, effort S)

The dev-only gate is spread across: `bin/cli.js:751` DEV_ONLY_FILES (tested by regex
parse), `package.json:37-55` `files` negations (deploy-to-npmjs.md negated there too,
but usage-report/analyze-session/etc. deliberately NOT — asymmetry explained only in
CLAUDE.md), and `.claude/scripts/sync-docs.js:37` (drifted — 4.1). The comment at
cli.js:748-750 ("THIS list ... is what gates installs") guards the first; nothing
guards agreement among the three. One test importing all three lists and asserting the
intended relationships (sync-docs ⊇ cli list for doc purposes; every `files`-negated
command ∈ DEV_ONLY) closes the class, not just the instance.

### 5.4 Changelog trailer discipline is enforced only at review time (Low, effort S)

CLAUDE.md: commits about dev-gated work need `Changelog: none`, and user-facing bullets
surface verbatim on upgrade screens. The OVERRIDES map (`scripts/generate-changelog.js:16-33`)
exists precisely because this was violated six times (six `null` rows for leaked
token-guard bullets). Nothing warns at commit time. A `commit-msg`/pre-push heuristic
(subject mentions token-guard/analyze-session and body lacks `Changelog:` → warn) would
catch the recurring instance cheaply; without it, expect the OVERRIDES list to keep
growing one user-visible leak at a time.

### 5.5 "Next update number: 005" is a manually-bumped counter (Low, effort S)

`.claude/updates/README.md:11` asks maintainers to bump a line of prose when taking a
number. Covered mechanically by the 4.10 test if added; otherwise the counter and
reality drift silently.

---

## Summary table

| # | Finding | Sev | Effort |
|---|---|---|---|
| 3.1 | No test gate on publish (`prepublishOnly` absent) | High | S |
| 1.2 | Corrupt settings.json + `plugin add` silently wipes user settings (cli.js:385) | High | S |
| 4.1 | sync-docs DEV_ONLY mirror drift — shipped docs document 5 dev-only files (live bug) | High | S |
| 3.4 | Install/upgrade paths tested by source-string asserts, not behavior | High | M |
| 4.2 | migrate-feedback.js (destructive) + 3 other hooks: zero tests, designed-silent | High | M |
| 1.1 | No types/JSDoc at any JSON boundary (settings/plugin/cca.config/ledger/stdin) | High | M |
| 5.1 | Docs/README publish-sync rule unenforced (4.1 is this loop failing) | Med | S |
| 1.3 | Blanket catch silently disables settings upgrades forever | Med | S |
| 2.1 | No linter anywhere; `npm run lint` allowlisted but nonexistent | Med | S |
| 3.2 | No pre-commit/pre-push hooks | Med | S |
| 3.3 | Parity/live tests silently skip everywhere but the dev box | Med | S |
| 3.5 | Unbumped @version hides real command updates from upgrade report (cli.js:947) | Med | S |
| 4.3 | FEEDBACK.md migration duplicated in cli.js + hook, hand-synced | Med | S |
| 4.4 | Inline bash Stop-hook logic inside settings.json — untestable, all errors hidden | Med | S |
| 4.5 | 131 silent catches, no uniform diagnostic channel | Med | M |
| 4.6 | --analyze digest literals (machine interface) unpinned by tests | Med | S |
| 4.8 | Publish-time scripts (changelog main(), postversion dance) never rehearsed | Med | S |
| 4.10 | Update-number append-only invariant untested (reuse = silent skip) | Med | S |
| 5.2 | sync-terminal-title check mode wired to nothing | Med | S |
| 5.3 | Three hand-coordinated dev-gate lists, one tested | Med | S |
| 4.7 | `ccr` bin ships to users whose producer is dev-gated | Low-Med | S |
| 1.4 | engines >=16 but CI floor is 18 | Low | S |
| 2.2 | format.js triple-silenced no-op | Low | S |
| 4.9 | sync-docs exits 0 when docs file missing | Low | S |
| 5.4 | Changelog-trailer discipline unenforced (OVERRIDES keeps growing) | Low | S |
| 5.5 | "Next update number" manual counter | Low | S |

**Counts**: Category 1 — 4 findings · Category 2 — 2 · Category 3 — 5 · Category 4 —
10 · Category 5 — 5. Total 26 (6 High, 14 Med, 6 Low). 21 of 26 are effort S.

**Highest-leverage single edit**: `"prepublishOnly": "npm test"` in package.json —
after which every other test added by this list is automatically publish-gating.
