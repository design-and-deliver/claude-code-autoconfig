# Audit 03 — Hazards and God Files

Repo: `claude-code-autoconfig` v1.0.215 (published, real users — stored/serialized shapes are additive-only).
Scope: oversized multi-job files, load-bearing conventions, hidden coupling. Every item carries a
one-line **Never** phrasing for the remediation plan's standing-warnings section. All paths absolute
under `C:\CODE\claude-code-autoconfig\`.

LOC census (bin/, scripts/, .claude/hooks/, .claude/scripts/):

| File | LOC |
|---|---|
| `.claude/hooks/token-guard.js` | 2659 |
| `.claude/hooks/terminal-title.js` | 1433 |
| `bin/cli.js` | 1140 |
| `.claude/scripts/sync-docs.js` | 672 |
| `scripts/generate-changelog.js` | 131 |
| `bin/update-summary.js` | 122 |
| everything else | ≤ 96 each |

---

## God files

### G1. `bin/cli.js` — 1140 LOC, ~12 jobs, and the program IS the statement order — **High / L**

Distinct jobs: (1) version-pin gate (`bin/cli.js:12-28`, `508-523`); (2) Windows `nul`-artifact
cleanup + reserved-name guard (`31-55`); (3) `--pull-updates` subcommand (`86-177`); (4) settings
merge/unmerge helpers (`179-310`); (5) plugin add/remove/list subsystem (`312-483`); (6)
inside-Claude detection + block (`485-506`); (7) Claude Code presence check/auto-install
(`546-575`); (8) user-content backup/migration (`579-708`); (9) the copy pipeline for
commands/docs/agents/feedback/hooks/scripts/sounds with three per-directory policies (`738-902`);
(10) settings.json merge-on-upgrade (`909-934`); (11) update pre-marking + FEEDBACK.md→Discoveries
migration (`955-1031`); (12) what's-new persistence, ANSI box UI, readline launch (`1033-1140`).

**Natural seams** (safe to extract): the plugin subsystem (`312-483`) and the settings merge
helpers (`179-310`) are already pure named functions with a clean boundary (the plugin path
`process.exit(0)`s at `483`); `pullUpdates` (`106-172`) likewise exits at `177`. These could move to
`bin/lib/*.js` mechanically.

**Why a naive decomposition breaks at runtime** — the rest is order-dependent top-level script:

- `bin/update-summary.js:7-8` states the constraint outright: *"cli.js runs its whole flow on
  require, so its inline logic can't be imported."* There is no `main()`. Tests therefore assert on
  cli.js **source text by regex**, not by requiring it: `test/box-alignment.test.js:20`
  (`/console\.log\(['"`]([^'"`]*[╔╗╚╝║═]...)/g`) and `test/cli-install.test.js:414,435,457`
  (`/const DEV_ONLY_FILES = \[([^\]]+)\]/`), plus dozens of `cliCode.includes(...)` assertions
  (`test/cli-install.test.js:41,144,149,154,374,379,392,397`). Moving code into another file makes
  these source-greps miss **silently** (the box test then finds 0 boxes and passes vacuously —
  `test/box-alignment.test.js:84-100` has no minimum-box assertion).
- Ordering invariants inside the install flow: `previousVersion` is read at `711-714` **before**
  the copy overwrites the marker; `isUpgrade` detection (`718-736`) must run **before** copying
  (its own comment says so, `717`); `existingCommandContents` is snapshotted (`796-801`) **before**
  `copyDir(commandsSrc, …)` (`814`) and the `DEPRECATED_COMMAND_ALIASES` pruning (`824-829`)
  depends on that pre-copy snapshot to distinguish "had the old alias" from "never had it";
  the what's-new JSON write (`1042-1055`) is deliberately placed **before** the `--bootstrap`
  early-exit (`1060-1063`) so in-Claude upgrades still produce it; the pin gate must run before
  any file copy (`508-510` comment).
- Reordering any of these compiles and runs clean — it just quietly mis-detects upgrades, loses
  version transitions, resurrects deprecated aliases on fresh installs, or drops the what's-new
  finale.

**Never**: never reorder or extract cli.js top-level statements without re-verifying the
read-before-copy / snapshot-before-copy / write-before-bootstrap-exit ordering, and never move
box-drawing or `DEV_ONLY_FILES` out of `bin/cli.js` — tests regex its source, not its exports.

### G2. `.claude/hooks/token-guard.js` — 2659 LOC, one file = pricing engine + 5 hook handlers + 3 CLIs — **Med / L** (dev-gated: not shipped)

Distinct jobs: model pricing (`154-257`), transcript meter + agent-file cache (`259-392`), R6
scope-drift over the terminal-title ledger (`424-631`), payload/fan/workflow verdicts (`633-795`),
skill budgets generator (`797-919`), config+state persistence (`921-1063`), recover-pointer +
migrate-candidate writers (`960-1052`), official-usage fetch + 5-hour window guards (`1153-1400+`),
forensic `--analyze` digest (`2278-2459`), `--report`/`--analyze`/`--budgets` CLI dispatch and the
five hook-event handlers (`2607-2650`).

Extraction hazards: `module.exports` at `2652-2659` names **30+ symbols** consumed by nine test
suites under `.claude/hooks/tests/*.test.cjs` (which run ONLY via `npm run test:hooks` /
`test/hook-tests.test.js`) — any rename breaks fixtures that "it didn't error" won't catch, because
the hook path swallows everything (`2638-2647`: `catch (_) { /* fail-safe: emit nothing */ }`).
Also single-file matters less here than for terminal-title, but the file is registered by literal
command string in dev `settings.local.json` — splitting it changes the invocation contract.
Blast radius is dev-only today (`DEV_ONLY_FILES` gates it, see T1) — but that also means a future
"ship token-guard" decision inherits this file as-is.

**Never**: never rename a `token-guard.js` export or assume a green run proves the hook works —
it exits 0 on every failure; only the `.test.cjs` suites see regressions.

### G3. `.claude/hooks/terminal-title.js` — 1433 LOC, deliberately monolithic — DO NOT SPLIT — **High / M (to document), L (to change)**

Jobs: glyph state machine over SessionStart/UserPromptSubmit/Stop/Notification/PostToolUse,
runtime two-tier root selection (`106-119`), per-session ledger writer (`342-368`), debug log
(`379-394`), ending classification (`endsOnQuestion`/`solicitsReply`), `--idle-rescue` watchdog
(`200-230`, `1096-1214`), an embedded **C# program as a string array** lazily compiled by csc
(`PAINTER_CS`, `~874-905`), lineage tracking, /clear advisor.

This one is a god file **by contract**: `test/live-twin-parity.test.js:3-17` requires the repo copy
and `~/.claude/hooks/terminal-title.js` to be the SAME single file (comment-stripped, zero
divergence, empty whitelist at line ~53), and `scripts/sync-terminal-title.js:23-35` byte-copies
exactly `['terminal-title.js', 'terminal-title.directive.md']` to a hardcoded fleet. Splitting it
into modules breaks the single-file fleet-sync model (the sync script and parity test know nothing
about a second file). The hook also reads `terminal-title.directive.md` from its own directory
(`sync-terminal-title.js:22`) — the pair moves together.

**Never**: never split terminal-title.js into multiple files and never edit any copy except
`C:\CODE\claude-code-autoconfig\.claude\hooks\terminal-title.js` (then
`node scripts/sync-terminal-title.js --write`); parity **skips on CI** — CI green ≠ fleet in sync.

### G4. `.claude/scripts/sync-docs.js` — 672 LOC of `indexOf` string surgery on generated HTML — **Med / M**

Rebuilds `.claude/docs/autoconfig.docs.html` by locating exact literals inside the HTML:
`'<span class="folder">.claude</span>'` (`:557-561`), `'const treeInfo = {'` (`:582-585`),
a fileContents marker (`:631`), and closing-`'};'` scans (`:619`, `:660`). Any reformat of the
HTML (prettier, editor autoformat, even re-indenting) makes a marker miss and the next sync either
errors or splices at the wrong offset. CRLF is handled (`:549-553` normalizes then restores EOL).

**Never**: never reformat or hand-edit `autoconfig.docs.html` — regenerate via
`node .claude/scripts/sync-docs.js`; if you change its structure, update the marker strings in
sync-docs.js in the same commit.

---

## Trap inventory (load-bearing conventions)

### T1. `DEV_ONLY_FILES` is the install gate — and its literal FORMATTING is a test interface — **High / S**
`bin/cli.js:751`. This array (not package.json `files` negations) decides what reaches user
projects: `copyDir`/`copyDirIfMissing` skip entries in it (`:759`, `:777`), and the new/updated
command report filters by it (`:834`). Anything absent ships to every user. Additionally
`test/cli-install.test.js:414,435,457` parse cli.js source with
`/const DEV_ONLY_FILES = \[([^\]]+)\]/` and then `/'([^']+)'/g` — the cli.js comment (`:749-750`)
demands the literal stay on one line; switching to double quotes, template literals, or a
different variable name silently yields `devOnly = []` in the docs-coverage tests.
Note the tarball/gate split: only `deploy-to-npmjs.md` is ALSO excluded from the tarball
(package.json `files`: `!.claude/commands/deploy-to-npmjs.md`); the other five dev-only files ARE
in the published tarball and are gated **only** at install time by this array.
**Never**: never add a dev-only command/hook without adding it to `DEV_ONLY_FILES` (one-line,
single-quoted), and never treat package.json `files` negations as the install gate.

### T2. token-guard `--analyze` digest wording is a machine interface — **Med / S** (dev-only today)
Producer: `renderAnalysis`, `.claude/hooks/token-guard.js:2405` (warning comment at `2404`);
literals: `"live context at end"` (`:2415`), section headers `RENT` (`:2418`), `BOMBS` (`:2424`),
`FLEETS` (`:2440`), `TTL` (`:2450`). Consumer: `.claude/commands/analyze-session.md:32`
(category names) and `:47` (keys on the literal phrase `live context at end` with a ≥150k
threshold). **Never**: never reword the `--analyze` digest headers or the "live context at end"
line without updating `analyze-session.md` in the same commit.

### T3. The `.titles/{sid}.history.jsonl` ledger shape has FOUR+ consumers — **High / S**
Writer: `.claude/hooks/terminal-title.js:363-366` — entry is `{ ts, title, tokens? }` (`tokens`
optional; readers must tolerate both shapes, `:360-362`). Consumers: (1)
`ledgerScopes()` in `.claude/hooks/token-guard.js:440-457` reads `e.title`, `e.ts`, `e.tokens`
and splits scope on the literal `' — '` (space, em-dash, space) at `:445`; (2)
`.claude/commands/eval-new-session.md:61`; (3) `.claude/commands/migrate-new-session.md:21,34`
(an inline node script in the .md parses the jsonl); (4) `.claude/commands/continue.md:35`
(reads the final line's `title`). The `"{scope} — {use-case}"` title format itself is part of the
contract (`migrate-new-session.md:22`). File location doubles as API:
`token-guard.js:429-434` hardcodes `.claude/hooks/.titles/{sid}.history.jsonl`.
**Never**: never rename `ts`/`title`/`tokens`, move the `.titles` dir, or change the `" — "`
title separator — additions to the entry object are fine; renames silently break token-guard R6,
/eval-new-session, /migrate-new-session, and /continue.

### T4. `.claude/settings.json` details are load-bearing — **High / S**
(1) `CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1"` (`:4`) — remove it and Claude Code's own title
writer races the hook. (2) TWO Notification entries (`:63-86`) that look like duplicates:
`permission_prompt` (`:65`) runs terminal-title plainly; `idle_prompt` (`:78`) passes
`--idle-rescue` (`:82`), which selects a distinct code path (`terminal-title.js:214`, gate at
`:130`) — "deduping" them kills interrupt rescue. (3) Every hook command is
`${CLAUDE_PROJECT_DIR:-.}`-anchored; `migrateLegacyHookCommands` (`bin/cli.js:194-206`) exists
precisely to rewrite the old relative form, and `mergeSettingsInto` dedups **by exact command
string** (`bin/cli.js:223`) — so changing a shipped hook command string doesn't replace the old
entry on upgrade, it ADDS a second one and the hook runs twice per event.
**Never**: never dedupe the two Notification entries, never drop `--idle-rescue` or the
DISABLE_TERMINAL_TITLE env, and never reword a shipped hook `command` string without adding a
migration like `migrateLegacyHookCommands` (merge dedup is exact-string).

### T5. `.claude/updates/` numbering is append-only, and the `@applied` block format is regex-exact — **High / S**
Rules: `.claude/updates/README.md` — next free ID is `005`; `002` is a retired tombstone; a reused
number is silently skipped by installs whose `@applied` block already lists it. Parsers:
`bin/cli.js:90` (`/<!-- @applied\r?\n([\s\S]*?)-->/`), `:96` (`^(\d{3})`), `:150` (`^(\d{3})-`).
Sharper still: the fresh-install pre-mark at `bin/cli.js:976` matches ONLY the exactly-empty block
`<!-- @applied\n-->` — `.claude/commands/autoconfig-update.md:8-9` ships that exact two-line block;
reformatting it (adding a space, a blank line, CRLF-only edits) makes pre-marking silently no-op
and fresh installs re-run every historical update.
**Never**: never reuse an update number (even a deleted one) and never reformat the
`<!-- @applied -->` block in autoconfig-update.md.

### T6. `<!-- @version N -->` in command files: unbumped edits are silently unannounced — **Med / S**
Parser: `bin/cli.js:789-792` (`/<!-- @version (\d+) -->/`). The upgrade report at `:947` does
`if (oldVersion > 0 && newVersion > 0 && oldVersion === newVersion) continue;` — an edited command
whose version wasn't bumped is **dropped from the "↑ updated" list entirely** (the file still
copies; users just never hear about it). **Never**: never modify a `.claude/commands/*.md` without
bumping its `@version` comment.

### T7. `CHANGELOG.md` and `autoconfig.docs.html` are generated — hand-edits are clobbered — **Med / S**
`CHANGELOG.md` is rebuilt from git history on every `npm version` (package.json `postversion` →
`scripts/generate-changelog.js`, self-declaring header at `:76-78`); reword bullets via
`Changelog:` trailers or the `OVERRIDES` map (`generate-changelog.js:16-33`). The docs HTML is
rebuilt by sync-docs.js (see G4). **Never**: never hand-edit CHANGELOG.md or
autoconfig.docs.html — change the generator's inputs instead.

### T8. terminal-title canonical copy + fleet sync — **High / S**
Canonical: `.claude/hooks/terminal-title.js` (+ its `.directive.md`, paired at
`scripts/sync-terminal-title.js:22-23`). `--write` clobbers `~/.claude/hooks` and three hardcoded
repos (`:27-32`). Drift on the dev box fails `test/live-twin-parity.test.js`; the test **skips
when the live copy is absent** (CI), so CI green proves nothing about parity.
**Never**: never edit any non-canonical terminal-title copy — the next `--write` erases it.

### T9. `test/golden-endings.json` is append-only incident memory — **Med / S**
`_readme` block in the file: APPEND-ONLY; never delete or relabel an entry without explicit
sign-off — each records a real incident, and the same corpus is run against BOTH the twin and the
live hook (`test/golden-endings.test.js:30-31`). **Never**: never relabel/delete a golden-endings
entry; add new entries only.

### T10. `module.exports` names are cross-file contracts (hooks are require()'d, not just executed) — **High / S**
`terminal-title.js:1433` exports
`{ inspectLastResponse, endsOnQuestion, normalize, GLYPH, shouldDefer, solicitsReply, readContextTokens, clearAdvice, ancestryChain, recordLineage }`;
its own comment (`:1424-1426`) warns that `terminal-title.test.js`, `golden-endings.test.js`, and
**`arcade-beeps.js` (lazy-requires `inspectLastResponse`)** depend on these names — renaming one
silently degrades the beeps hook (it fail-silences). Same for `token-guard.js:2652-2659` (30+
exports, nine `.test.cjs` suites). **Never**: never rename a hook export without grepping
`.claude/hooks/` and `test/` + `.claude/hooks/tests/` for consumers — hooks swallow require
failures.

### T11. `AUTOCONFIG_FILES` must list every shipped top-level `.claude/` entry — **Med / S**
`bin/cli.js:50`. `hasUserContent()` (`:57-69`) and the backup path (`:644-666`) treat anything NOT
in this list as user content: a newly shipped file/dir that isn't added here triggers spurious
`.claude/migration/<timestamp>/` backups of CCA's own files on every upgrade, forever.
**Never**: never ship a new top-level `.claude/` file or directory without adding it to
`AUTOCONFIG_FILES` in the same commit.

### T12. The `AUTO-GENERATED BY /autoconfig` marker string is frozen forever — **High / S**
Upgrade detection greps CLAUDE.md for this exact phrase: `bin/cli.js:539, 592, 723`; asserted at
`test/cli-install.test.js:379`; written into users' CLAUDE.md by the /autoconfig command. Existing
installs carry the CURRENT phrase in their CLAUDE.md — changing it in either the command or cli.js
makes every existing install look like a fresh one (wrong launch command, wrong merge behavior).
**Never**: never change the `AUTO-GENERATED BY /autoconfig` marker text — old installs' CLAUDE.md
files can't be updated retroactively.

### T13. Inside-Claude detection is a two-signal trick — **Med / S**
`bin/cli.js:492`: `process.env.CLAUDECODE === '1' && !process.stdout.isTTY`. The comment
(`:487-491`) explains why CLAUDECODE alone is wrong (env inherits into VS Code terminals spawned
from a Claude session). "Simplifying" to one signal re-introduces the false block; also the whole
check + MEMORY.md's install-flow note require it to run **before** any file copying.
**Never**: never reduce the insideClaude check to `CLAUDECODE` alone and never move it after the
copy pipeline.

### T14. The 46-char box + source-regex box tests — **Med / S**
`bin/cli.js:1067-1085`: every box line must be exactly 46 visible chars (ANSI codes excluded,
color codes placed outside content spacing — CLAUDE.md "Box Drawing Guidelines").
`test/box-alignment.test.js:20` finds boxes by regexing cli.js **source** for
`console.log('…╔║╚…')` string literals — extracting the box into a helper function, template
string with interpolation, or a loop makes the extractor find zero boxes and the suite passes
vacuously (no minimum-box assertion exists). **Never**: never refactor the READY boxes out of
direct single-quoted `console.log` literals in cli.js; run `npm run test:box` after any box edit
and confirm it still reports "Found 2 box(es)".

### T15. The `{sid}.glyph` file format `name|event` is parsed positionally — **Med / S**
Writer: `terminal-title.js:346-347` (`` `${name}|${logCtx.event}` ``). Readers: the idle-rescue
path checks `painted[1] !== 'Notification'` (`:224`, `:1146`) and the watchdog deliberately writes
the literal `'awaiting|Notification'` to be **byte-identical** to a real notification paint
(`:1204-1212`) so one rule covers both. Changing the separator, the name set
(`working|awaiting|idle`), or the event spelling silently breaks stuck-tab rescue.
**Never**: never change the `name|event` glyph-file format or the glyph name strings.

### T16. Serialized user-project state is additive-only (shipped shapes inventory) — **High / S**
These JSON shapes live in REAL users' projects; old files must parse forever:
`.claude/.autoconfig-plugins.json` entries `{version, files, settings, installedAt}`
(`bin/cli.js:394-401`, consumed by `pluginRemove` `:405-437`);
`.claude/.autoconfig-whats-new.json` `{from, to, segments:[{kind,text}]}` (`bin/cli.js:1046-1054`,
consumed by /autoconfig-update per `test/cli-install.test.js:281`) — the segment `kind` enum
(`latest|heading|group|item|more`) is also the render switch at `bin/cli.js:1095-1099` and
`bin/update-summary.js:10-16`; `.claude/cca.config.json` is a MULTI-consumer config
(`pinVersion` `bin/cli.js:28`, `tokenGuard` `token-guard.js:921-926`, `gls.screenshotDir`
`.claude/commands/gls.md:23`) — any writer must round-trip unknown keys (the pin-removal write at
`bin/cli.js:516-520` does); `.claude/hooks/.token-guard/recover.json` keeps `{sid, recoverCmd,
writtenAt}` flat at top level explicitly "so the legacy ccr bin still round-trips"
(`token-guard.js:~955-959`; reader `bin/ccr.js:26-31` validates `recoverCmd.startsWith('/')`);
`.claude/hooks/.titles/*.history.jsonl` (T3); token-guard per-session state (`loadState`,
`token-guard.js:930-943` — new fields get defaults in `blank`, existing names never repurposed).
**Never**: never rename/repurpose a field in any `.claude/*.json`, `.titles/*`, or
`.token-guard/*` file — add new optional fields with defaults instead.

### T17. Legacy compat markers that look dead but aren't — **Low / S**
`gls.md` `<!-- @screenshotDir … -->` first-line preserve/restore (`bin/cli.js:805-811`, `846-852`)
serves installs that predate the `cca.config.json` migration — the restore regex expects the old
placeholder; deleting this "unused" block strands old users' saved dirs.
`arcade-beeps.js:8-11`: the legacy `arcade-beeps.enabled` flag is still honored and **the file
keeps its `arcade-beeps.js` name forever** because every installed settings.json points at that
literal path. (`DEPRECATED_COMMAND_ALIASES` shipped the alias .md files for upgraders until
2026-09-03, when the pair was retired — `RETIRED_COMMANDS` in `bin/cli.js` now deletes them.)
**Never**: never rename `arcade-beeps.js` or delete legacy-flag/screenshotDir compat paths —
installed settings.json files and old installs reference them by literal string.

---

## Hidden coupling (must-change-together pairs with no enforcement)

### C1. Commit-message convention → generate-changelog → CHANGELOG.md → update-summary → user's screen — **High / S**
Four-stage chain: commit bodies carry `Changelog: <line>` trailers (CLAUDE.md rule), parsed by
`scripts/generate-changelog.js:46` which deliberately re-attaches the `type(scope):` prefix
(`:50-51`) **so that** `bin/update-summary.js:61-65` can classify feat-vs-fix; update-summary in
turn requires the exact `## v` header and `- ` bullet shapes generate-changelog emits
(`generate-changelog.js:101-102` ↔ `update-summary.js:45-49`). Dev-gated work MUST carry
`Changelog: none` or its bullet is shown verbatim to users who can't receive the feature — the
`OVERRIDES` map (`generate-changelog.js:16-33`) is the graveyard of seven past leaks.
**Never**: never emit a changelog bullet without its conventional prefix, and never let a
dev-gated commit ship without `Changelog: none`.

### C2. `install.sh` / `install.ps1` are a drifted parallel installer that produces broken installs — **High / M**
`README.md:26,31` still advertise `curl … install.sh | bash` and `irm … install.ps1 | iex`. Both
scripts (`install.ps1:27-38`, `install.sh`) download `settings.json` plus only FIVE commands and
the docs HTML from GitHub `main` — but today's `settings.json` registers seven hook commands under
`.claude/hooks/*.js` (`settings.json:6-115`) which these scripts never download. A user who
installs this way gets `MODULE_NOT_FOUND` hook errors on **every** SessionStart/Stop/tool event.
No test covers either script; nothing ties their file lists to the real install pipeline in
cli.js. **Never**: never change the shipped `.claude/` contents (especially settings.json hooks)
without either updating install.sh/install.ps1 or retiring them from the README.

### C3. `mark-commit-active.js` ↔ the inline bash Stop hook in settings.json — **Med / S**
Writer: `.claude/hooks/mark-commit-active.js:46-49` stamps `.git/.cc-commit-active`. Reader: the
inline `find .git/.cc-commit-active -mmin -5` in `.claude/settings.json:44` (the uncommitted-work
reminder's suppression). Different files, different languages, joined only by a literal path and
an implicit ~5-minute freshness convention (documented only in the hook's comment). **Never**:
never rename `.cc-commit-active` or change its freshness model on one side only.

### C4. sync-docs.js output format ↔ cli-install.test.js docs assertions — **Med / S**
The docs-coverage tests assert the docs HTML contains `<span class="file">{cmd}</span>` and
`trigger: '/{name}'` for every shipped command/hook (`test/cli-install.test.js:426,450,469`);
sync-docs.js is what emits those exact shapes. Changing the docs template's file-row or
info-card markup breaks the tests — or worse, changing BOTH the template and the generator keeps
tests green while the marker surgery of G4 shifts. **Never**: never change the docs HTML
file-row/trigger markup without updating both sync-docs.js and the three docs-coverage tests.

### C5. Command `.md` prose is asserted as API by tests — **Med / S**
`test/cli-install.test.js` greps command files for exact phrases: the `cca-<name>:begin` managed-
block protocol (`:385`), status-beeps flag paths in enable/disable commands (`:202-213, 230`),
`"autoModePrompted": true` and `~/.claude/settings.json` + `"defaultMode": "auto"` in
/autoconfig + /autoconfig-update (`:248-267`), the whats-new deletion instruction (`:281`), the
Status Beeps Opt-in section (`:289-307`). Editing command wording — which reads as harmless prose
for the model — can fail (good) or, if a test's phrase survives while semantics change, silently
stop guarding (bad). **Never**: never reword the quoted protocol phrases in command files
(cca-block markers, flag paths, config keys) without checking cli-install.test.js's greps.

### C6. `MANAGED_HOOKS` is the inverse of DEV_ONLY_FILES and just as easy to forget — **Med / S**
`bin/cli.js:880`: hooks copy with `copyDirIfMissing` on upgrade (user-authorable), EXCEPT the four
listed cca-managed files which are force-refreshed. A new cca-owned hook not added to
`MANAGED_HOOKS` installs once and then **never receives bug fixes** in any existing project
(stale forever, no error). **Never**: never add a cca-owned hook without also listing it in
`MANAGED_HOOKS` (and, if user projects' settings must invoke it, wiring settings.json + T4's
exact-string dedup caveat).

### C7. `npm test` is a hand-maintained `&&` chain — new top-level tests silently don't run — **Med / S**
`package.json` `scripts.test` chains ten explicit `node test/X.test.js` calls; a new
`test/*.test.js` not appended there never runs anywhere (unlike the hook suites, which
`test/hook-tests.test.js:16-24` auto-discovers). The CLAUDE.md "npm test runs the FULL suite"
promise holds only if this list is maintained. **Never**: never add a `test/*.test.js` without
appending it to the `scripts.test` chain.

### C8. README.md ↔ actual `.claude/` contents — enforced only by prose rule — **Low / S**
`.claude/rules/readme-sync.md` mandates a manual README file-tree/commands-table sync + docs
regen before every publish; the docs side has tests (C4) but the README side has none.
**Never**: never publish without running the readme-sync rule's two steps.

### C9. `bin/ccr.js` ↔ token-guard recover pointer — **Low / S**
`bin/ccr.js:26-31` reads `.claude/hooks/.token-guard/recover.json` written by
`token-guard.js:960+`; ccr is LEGACY (its header, `:14-17`) but still a published bin
(`package.json` `bin.ccr`) — the pointer's flat top-level shape is frozen for it (see T16).
**Never**: never restructure recover.json's top level while `ccr` remains a published bin.

---

## Top-5 standing warnings (condensed for the plan header)

1. **Never rename fields in any serialized user-project file** (`.autoconfig-*.json`,
   `cca.config.json`, `.titles/*.history.jsonl`, `.token-guard/*`) — published package, real
   users, additive-only (T3, T16).
2. **Never trust package.json `files` to gate installs** — `DEV_ONLY_FILES` in `bin/cli.js:751`
   is the gate, and its one-line single-quoted literal is itself a test interface (T1).
3. **Never edit generated or non-canonical copies** — CHANGELOG.md, autoconfig.docs.html, any
   terminal-title.js outside the repo canonical (T7, T8, G4).
4. **Never reorder bin/cli.js top-level flow or extract its box/DEV_ONLY literals** — tests
   regex the source, and the install flow's correctness is statement order (G1, T14).
5. **Never reword machine-read strings that look like prose** — the `--analyze` digest headers,
   the `AUTO-GENERATED BY /autoconfig` marker, the `@applied` block, `name|event` glyph files,
   hook `command` strings in settings.json (T2, T4, T5, T12, T15, C5).
