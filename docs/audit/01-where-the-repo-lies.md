# Audit 01 — Where the Repo Lies

Audit dimension: places where what a reader would believe from reading is FALSE.
Repo: claude-code-autoconfig v1.0.215, audited 2026-07-20 at commit `bdfc331` (working tree clean).
Every "dead file" claim records the grep that proves zero live references — re-run it before deleting.

Live entry points traced: `package.json` bin (`bin/cli.js`, `bin/ccr.js`) and scripts
(`test/*.test.js`, `scripts/generate-changelog.js`), `.claude/settings.json` hook commands,
`.claude/commands/*.md`, `.claude/hooks/*`, plus the README-advertised `install.sh` / `install.ps1`.

---

## Category A — Dead / unwired code

### A1. `archive/.claude/agents/create-retro-item.md` — dead, byte-identical twin of a LIVE shipped file
- **Severity: High · Effort: S**
- File: `C:\CODE\claude-code-autoconfig\archive\.claude\agents\create-retro-item.md`
- Tracked in git, referenced by nothing. It is **byte-identical** to the live, user-shipped
  `C:\CODE\claude-code-autoconfig\.claude\agents\create-retro-item.md` (copied into every install by
  `copyDir(agentsSrc, ...)`, `bin/cli.js:866-868`). A reader who lands here via search edits the dead
  copy and ships nothing; worse, once the live copy changes, the "archive" silently becomes a stale
  near-duplicate (which is exactly what already happened to its sibling, A2).
- Evidence: `diff archive/.claude/agents/create-retro-item.md .claude/agents/create-retro-item.md` → exit 0 (identical).
- Dead-grep: `grep -rn "archive/" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=ARTICLES | grep -v "^\./archive/"` → **0 matches**.

### A2. `archive/.claude/commands/enable-retro.md` — dead AND actively wrong (stale v1)
- **Severity: High · Effort: S**
- File: `C:\CODE\claude-code-autoconfig\archive\.claude\commands\enable-retro.md`
- Tracked, referenced by nothing (same dead-grep as A1). It is `@version 1`; the live
  `.claude/commands/enable-retro.md` is `@version 2`. The v1 copy instructs *creating*
  `.claude/agents/create-retro-item.md` from a bullet-list description — the live v2 explicitly
  forbids that ("do NOT re-author it from memory; the shipped file is canonical",
  `.claude/commands/enable-retro.md:42`). A model that finds the archive copy first will do the
  exact thing v2 was rewritten to prevent.
- Evidence: `diff archive/.claude/commands/enable-retro.md .claude/commands/enable-retro.md` → hunks at lines 2, 40-45 (version + Step 2 rewrite).

### A3. `internal/.claude/agents/docs-refresh.md` — dead duplicate of a shipped user-facing agent
- **Severity: Med · Effort: S**
- File: `C:\CODE\claude-code-autoconfig\internal\.claude\agents\docs-refresh.md`
- Tracked, byte-identical to the live shipped `.claude/agents/docs-refresh.md`. The directory name
  `internal/` says "internal-only tooling"; the content is a user-shipped agent (README.md:68 documents
  it as installed). Same drift trap as A1. Note MEMORY feedback "Agents branding — only ship user-facing
  agents": docs-refresh graduated to user-facing, and the `internal/` copy was left behind.
- Evidence: `diff internal/.claude/agents/docs-refresh.md .claude/agents/docs-refresh.md` → exit 0 (identical).
- Dead-grep: `grep -rn "internal/" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=ARTICLES | grep -v "^\./internal/"` → **0 matches**.

### A4. `todo.md` — dead planning doc describing a problem that was since half-fixed
- **Severity: Med · Effort: S**
- File: `C:\CODE\claude-code-autoconfig\todo.md` (tracked, last touched Apr 2026)
- Claims the deny list is only "described in prose" and proposes shipping a canonical `settings.json`
  via `--bootstrap`. That proposal **was implemented** (`bin/cli.js:909-934` copies/merges the packaged
  `.claude/settings.json`), so the doc reads as an open task when the main fix landed. Meanwhile its core
  complaint — `Edit(./.env)` denies "not in the spec" breaking .env template creation — is now WORSE than
  described: `Edit(./.env)` was written INTO the spec (`.claude/commands/autoconfig.md:172-173`) instead of
  removed (see B11). A reader can't tell which half of this document is history and which is guidance.
- Dead-grep: `grep -rni "todo\.md" . --exclude-dir=node_modules --exclude-dir=.git` → **0 matches**.

### A5. `bin/cli.js:804-811 + 845-852` — "@screenshotDir preservation" that can never preserve anything
- **Severity: Med · Effort: S**
- The comment says "Preserve user's saved @screenshotDir in gls.md across upgrades". Reality: shipped
  `gls.md` (v5) stores the screenshot dir in `.claude/cca.config.json` (`gls.screenshotDir`,
  `.claude/commands/gls.md:23`) and contains **no** `@screenshotDir` marker at all, so the restore regex
  `/<!-- @screenshotDir\s*-->/` (`bin/cli.js:849`) can never match the freshly copied file. Net effect for a
  legacy user who still has the old marker: the CLI reads it, overwrites gls.md, fails to re-insert it, and the
  saved dir is **silently dropped** — the opposite of what the comment promises. For everyone else it's dead code
  on the hot install path.
- Evidence: `grep -n "@screenshotDir" .claude/commands/gls.md` → **0 matches**; the only occurrences in the repo are the four in `bin/cli.js` itself (`grep -rn "@screenshotDir" bin .claude`).

### A6. `bin/ccr.js` — a published global bin no user can ever use
- **Severity: Med · Effort: S**
- `package.json:35` installs `ccr` on every user's PATH. It only works off
  `.claude/hooks/.token-guard/recover.json`, which is written exclusively by
  `.claude/hooks/token-guard.js` — a hook that is DEV_ONLY-gated out of every user install
  (`bin/cli.js:751`) and wired only via this repo's untracked `settings.local.json`. Its own header says
  "LEGACY since 2026-07-18: the guard's warnings no longer advertise ccr" (`bin/ccr.js:13-16`). So every
  real user gets a bin whose only possible output is its error message. It is also absent from README and
  CLAUDE.md ("Entry: bin/cli.js" is the only entry documented, `CLAUDE.md` Tech Stack section).
- Evidence: `grep -rn "token-guard" .claude/settings.json` → 0 (not wired for users); `grep -rn "'token-guard.js'" bin/cli.js` → line 751 (gated); `grep -rn "ccr" README.md` → 0.

### A7. `pilots/deny-reads-pilot/` — local experiment, unreferenced (gitignored)
- **Severity: Low · Effort: S**
- Working-tree only (`.gitignore:37 pilots/`), so it lies only to people reading the checkout, not the
  repo. Contains `deny-reads-pilot.js` + config + README; no live entry point references it.
- Dead-grep: `grep -rn "pilots/" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=ARTICLES --exclude-dir=pilots` → only `.gitignore:37` and two stale permission strings in untracked `.claude/settings.local.json:100-101`.

### A8. `ARTICLES/` — 39 rendered HTML pages, local-only
- **Severity: Low · Effort: S**
- Gitignored (`.gitignore:34`), produced by the user's global create-web-page workflow. Nothing references
  it. Harmless but a large "what is this?" surface in the working tree.
- Dead-grep: `grep -rn "ARTICLES" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=ARTICLES` → only the `.gitignore` comment.

---

## Category B — Docs that contradict code

### B1. README says `rules/` (with the two publish-safety rules) is installed — it never is
- **Severity: High · Effort: M**
- `README.md:82-84` ("What Gets Installed" tree) lists `rules/deploy-approval.md` and `rules/readme-sync.md`
  as installed into `your-project/`; `README.md:186-191` says "Autoconfig ships with publish-safety rules."
- Reality: `bin/cli.js` copies commands, docs (html only), agents, feedback, hooks, scripts, sounds and
  settings.json — **there is no copy step for `.claude/rules/`**. `/autoconfig` Step 2
  (`.claude/commands/autoconfig.md:87-95`) creates an **empty** rules dir with a `.gitkeep`.
  Additionally, those two rules are CCA-maintainer rules (npm-publish approval for *this* package, README
  sync for *this* repo) that would be nonsense inside a user project even if they were copied.
- Evidence: `grep -in "rules" bin/cli.js` → only line 50 (`AUTOCONFIG_FILES` backup-skip list) and a
  comment at line 212 about permission rules. `grep -rn "deploy-approval\|readme-sync" test/` → 0.

### B2. README says `.mcp.json` is installed — the npx installer never copies it
- **Severity: Med · Effort: S**
- `README.md:91` lists `.mcp.json  # MCP server configs (empty placeholder)` in the installed tree.
  `bin/cli.js` has no copy step for it (same grep as B1: `.mcp.json` appears only inside
  `AUTOCONFIG_FILES`, line 50). Only the legacy curl installers (B6) download it.

### B3. README says `updates/` is installed — the CLI actively deletes it
- **Severity: Med · Effort: S**
- `README.md:81` lists `updates/  # Pending config updates` in the installed tree. `bin/cli.js:904-907`
  says "updates directory is no longer copied to user projects", and `bin/cli.js:986-989` **removes**
  `.claude/updates/` from the user project on every install. It exists transiently only during
  `--pull-updates`.

### B4. README omits `/continue` entirely — a shipped, current command
- **Severity: Med · Effort: S**
- `.claude/commands/continue.md` (`@version 2`, feature commit `0286939`) is tracked, in the tarball, and
  NOT in `DEV_ONLY_FILES` (`bin/cli.js:751`) → installed into every user project. It appears nowhere in
  `README.md`: not in the file tree (43-93) and not in the Slash Commands table (120-138). This violates
  the repo's own `.claude/rules/readme-sync.md` checklist item 2.
- Evidence: `grep -n "continue" README.md` → 0 command references.

### B5. README Quick Install: "Works … from inside an existing Claude Code session" — the CLI hard-blocks that
- **Severity: Med · Effort: S**
- `README.md:17`. Reality: `bin/cli.js:492-506` detects an in-session run (`CLAUDECODE=1` + piped stdio)
  and exits **before copying anything**, printing "The tool needs to be run from a regular terminal".
  Only the internal `--bootstrap` flag (used by `/autoconfig` itself) is allowed through. A user following
  the README inside a session installs nothing and gets a redirect message.

### B6. `install.sh` / `install.ps1` — README-advertised installers running a stale, harmful legacy flow
- **Severity: High · Effort: M**
- `README.md:24-32` presents the curl/irm scripts as equivalent installs. What they actually do:
  - Download only **5** of the 18 shipped commands (`install.sh:38-44`: autoconfig, commit-and-push,
    show-docs, sync-claude-md, test) — no hooks, no agents, no sounds, no feedback, so half the README's
    advertised features (terminal titles, status beeps, format hook, /recover-context, /gls …) silently
    don't exist on this path.
  - **Unconditionally overwrite** an existing `.claude/settings.json` (`install.sh:34`, `install.ps1:29`) —
    no merge, no backup, unlike the npx path's careful `mergeSettingsInto`.
  - Install **this repo's own maintainer `CLAUDE.md`** into the user's project (`install.sh:25-31` fetches
    `$REPO_BASE/CLAUDE.md`) — i.e. the file containing CCA's npm-publish token flow, box-drawing rules and
    invariants. Every claim in that file is false inside a user project.
- Evidence: compare with the real install surface in `bin/cli.js:738-934` and the commands list
  (`ls .claude/commands` → 23 files).

### B7. `/validate-cca-install` ships a stale dev-only list → reports 4 false "MISSING CMD" issues to every user
- **Severity: High · Effort: S**
- `.claude/commands/validate-cca-install.md:71`: `dev_only = ['deploy-to-npmjs.md']`.
  The real gate is `bin/cli.js:751`:
  `DEV_ONLY_FILES = ['deploy-to-npmjs.md', 'usage-report.md', 'analyze-session.md', 'eval-new-session.md', 'migrate-new-session.md', 'token-guard.js']`.
  The four extra command files ARE in the published tarball (package.json `files` excludes only
  `deploy-to-npmjs.md`, lines 37-55) but are never installed — so the validator's tarball-vs-project diff
  flags `analyze-session.md`, `eval-new-session.md`, `migrate-new-session.md`, `usage-report.md` as
  "MISSING CMD" issues and tells the user to reinstall (which cannot fix it). None of the four contains
  "deprecated" in its first 400 chars, so the alias escape hatch (lines 79-87) doesn't rescue them.
- Evidence: `head -8` of each of the four files (no "deprecated"); `grep -n "dev_only" .claude/commands/validate-cca-install.md` → line 71.

### B8. `/validate-cca-install` Step 7 "hooks reference integrity" checks nothing, twice over
- **Severity: Med · Effort: S**
- `.claude/commands/validate-cca-install.md:155-173`: iterates settings hooks and reads
  `cmd = matcher.get('command', '')`. In the actual settings schema the command lives at
  `matcher['hooks'][i]['command']` (see `.claude/settings.json:7-115`), so `cmd` is always `''` and the
  BROKEN HOOK check can never fire. Even if fixed, the token heuristic `token.endswith('.js')` misses every
  shipped hook command because the anchored form ends in `…terminal-title.js"` (trailing quote). A command
  documented as validating hook integrity validates nothing — silently.

### B9. `autoconfig.md` internal step numbers point at the wrong steps
- **Severity: Med · Effort: S**
- `.claude/commands/autoconfig.md:106` — "Skip to adding the hook (Step 5b)" and line 134 — "continue to
  Step 6" are instructions inside "## Step 3"; the section actually named `Step 5b` lives at line 136
  *inside Step 3*, and the sections after it are `Step 4` (159), `Step 5` (221), `Step 6` (243). "Continue
  to Step 6" after declining a formatter should mean "continue to Step 4". A literal executor skips
  Settings and MEMORY.md configuration entirely. Leftover from an old numbering.

### B10. `autoconfig.md` instructs writing the legacy hook-command form the installer exists to eradicate
- **Severity: Med/High · Effort: S**
- `.claude/commands/autoconfig.md:147`: the format-hook JSON says
  `"command": "node .claude/hooks/format.js"` — the cwd-relative form that `migrateLegacyHookCommands`
  (`bin/cli.js:183-206`) documents as breaking with MODULE_NOT_FOUND when a session `cd`s away, and that
  this repo's CLAUDE.md invariant explicitly bans ("hook commands stay `${CLAUDE_PROJECT_DIR:-.}`-anchored").
  Every fresh `/autoconfig` run plants the bug; the next upgrade's migration then has to un-plant it.

### B11. `autoconfig.md` Step 4 deny/allow spec contradicts the shipped canonical `settings.json`
- **Severity: Med · Effort: M**
- Two diverging sources of truth for the same file:
  - Spec says deny `Edit(./.env)` / `Edit(./.env.*)` (`.claude/commands/autoconfig.md:172-173`) — the very
    rule `todo.md` documents as breaking safe `.env` template creation; shipped `settings.json` deliberately
    does NOT deny it (`.claude/settings.json:164-174`).
  - Spec says deny `Write(./nul)` / `Edit(./nul)` (lines 178-180) — absent from shipped settings (the CLI
    handles `nul` via `cleanupNulFile()`, `bin/cli.js:31-42`).
  - Shipped settings deny `credentials.*`, `*.pem`, `*.key`, `rm -rf`, `curl`, `wget` — none of which the
    spec mentions. Which list a user ends up with depends on which model ran which step.

### B12. `bin/cli.js:748` cites `docs/cca-port-next-steps.md` — file does not exist
- **Severity: Low · Effort: S**
- Evidence: `Glob docs/**` → only `docs/audit/*` (created by this audit round); no such file anywhere
  (`grep -rn "cca-port-next-steps" .` → only the citing comment).

### B13. `token-guard.js:5` cites `Spec: docs/token-guard-v2-cca-spec.md` — file does not exist in this repo
- **Severity: Low · Effort: S**
- The spec lives (lived) in the wifi-app repo the hook was prototyped in; the path is dead here.
- Evidence: `grep -rn "token-guard-v2-cca-spec" .` → only `.claude/hooks/token-guard.js:5`.

### B14. `terminal-title.js:45` — "CLAUDE_CODE_DISABLE_TERMINAL_TITLE … (set by plugin.json)"
- **Severity: Low · Effort: S**
- No plugin.json sets it in this distribution; it is set by `.claude/settings.json:4` (env block) and
  merged into user settings by `mergeSettingsInto`. Stale wording from the retired paid-plugin
  distribution era (MEMORY: "cca-plugins retired").

### B15. `.claude/agents/README.md` — "ships this folder empty so you can populate it"
- **Severity: Med · Effort: S**
- `.claude/agents/README.md:7`. False: the folder ships with `create-retro-item.md` and `docs-refresh.md`
  (copied into every install by `bin/cli.js:866-868`), and README.md:65-68 documents exactly that. A model
  told the folder is user-owned-and-empty may delete or re-author the shipped agents.

### B16. `enable-retro.md` — "What This Does" contradicts its own Step 2
- **Severity: Low · Effort: S**
- `.claude/commands/enable-retro.md:13-15` item 2: "Creates `.claude/agents/create-retro-item.md` agent";
  Step 2 (line 40-42, rewritten in v2) says the agent *ships with autoconfig* and must only be verified,
  never re-authored. The intro was not updated with the v2 rewrite.

### B17. README Updates section — "only new files are added"
- **Severity: Low · Effort: S**
- `README.md:150`. On upgrade, all commands are overwritten (`copyDir`, `bin/cli.js:813-814`), the four
  MANAGED_HOOKS are always refreshed (`bin/cli.js:880-891`), and `scripts/` + `sounds/` always overwrite
  (`bin/cli.js:893-902`). "Customizations preserved" is broadly true (feedback, own hooks, settings merge),
  but "only new files are added" is false and could lead a user to expect local edits to shipped commands
  to survive.

---

## Category C — Misleading names

### C1. `internal/` — labeled internal, contains a shipped user-facing file
- **Severity: Med · Effort: S** — see A3. The name promises "not shipped"; the identical live twin ships
  to every install.

### C2. `archive/` — labeled archived, contains a byte-current copy of a live file
- **Severity: Med · Effort: S** — see A1/A2. Half its contents are identical to live (not "archived" at
  all), the other half are stale-and-dangerous v1 instructions.

### C3. `ccr` — a user-installed bin for a feature users don't receive
- **Severity: Med · Effort: S** — see A6. The name/help text imply working recovery; the pointer file it
  needs can never exist in a user project.

### Explicitly NOT flagged (by-design, verified)
- `/enable-arcade-beeps` + `/disable-arcade-beeps` vs `/enable-status-beeps` + `/disable-status-beeps`:
  the arcade pair are **deliberate deprecated aliases** — labeled deprecated in frontmatter, they write the
  NEW flag (`status-beeps.enabled`), and `DEPRECATED_COMMAND_ALIASES` (`bin/cli.js:824-829`) removes them
  from fresh installs; `test/cli-install.test.js:184-214` guards the behavior. Consistent everywhere.
  **Update 2026-09-03:** the alias pair was retired — the .md files are deleted and `RETIRED_COMMANDS`
  (`bin/cli.js`) removes leftovers from upgraded installs.
- `.claude/hooks/arcade-beeps.js` keeping its old filename: documented in its header (lines 8-11) — every
  installed settings.json points at that name.
- `.claude/hooks/terminal-title.js` duplicated at `~/.claude` and in fleet repos: BY DESIGN — this repo's
  copy is canonical, `scripts/sync-terminal-title.js` is the actuator, `test/live-twin-parity.test.js` the
  guard.

---

## Category D — Commented-out blocks / duplicate implementations

### D1. FEEDBACK.md→Discoveries migration implemented in FOUR live places
- **Severity: Med · Effort: M**
- The same migration (find first `---`, move custom content to a `## Discoveries` section, reset
  FEEDBACK.md to a clean template) exists at:
  1. `bin/cli.js:991-1031` (upgrade path, incl. the template literal at line 1022)
  2. `.claude/hooks/migrate-feedback.js` (SessionStart hook, template at lines 60-71)
  3. `.claude/commands/autoconfig.md:30-50` (Step 0b, template inline)
  4. `.claude/updates/004-feedback-to-discoveries-migration.md` (update instructions)
  All four are wired/live (settings.json:7-16 runs the hook every session). They are guarded only by the
  same idempotence check (`includes('## Discoveries')`); any change to the template or the separator
  convention must be made in four places, and nothing says so at any of the four sites.
- Evidence: `grep -rln "Discoveries" bin/cli.js .claude/hooks/migrate-feedback.js .claude/commands/autoconfig.md .claude/updates/004-feedback-to-discoveries-migration.md` → all four.

### D2. `endsOnQuestionInline` in arcade-beeps.js duplicates terminal-title's ending regex
- **Severity: Low · Effort: S**
- `.claude/hooks/arcade-beeps.js:87-102` carries its own copy of the question-ending regex, annotated
  "(Mirrors terminal-title.js's regex.)" — documented as a fallback for when the lazy require fails, so
  it is an *explained* duplicate, but the two regexes are not test-linked: a change to terminal-title's
  ending classification will silently desynchronize the fallback tone. Worth a parity assertion, not a
  deletion.

### D3. No significant commented-out code blocks found
- Grep for `if (false`, `DISABLED`, `HACK`, `XXX` across `bin/`, `scripts/`, `test/`, `.claude/hooks/`,
  `.claude/scripts/` surfaced only documented LEGACY markers (ccr header, arcade-beeps legacy flag,
  cli.js legacy-hook migration) — all accurate descriptions of live compatibility code, not lies.

---

## Summary counts

| Category | Findings |
|---|---|
| A — Dead / unwired code | 8 |
| B — Docs contradict code | 17 |
| C — Misleading names | 3 (+3 verified-by-design, documented above) |
| D — Duplicates / commented-out | 2 (+1 all-clear note) |
| **Total flagged** | **30** |

## Top 5 by severity

1. **B6** — README-advertised `install.sh`/`install.ps1` run a stale legacy flow: 5 of 18 commands, no
   hooks/agents, clobbers `settings.json`, and installs CCA's own maintainer CLAUDE.md into user projects.
2. **B7** — `/validate-cca-install`'s `dev_only` list is stale vs `DEV_ONLY_FILES`: every user gets 4
   false "MISSING CMD" issues with a reinstall recommendation that can't fix them.
3. **B1** — README claims `rules/` + publish-safety rules are installed; `bin/cli.js` never copies rules,
   and the two rules named are CCA-maintainer rules meaningless in user projects.
4. **A1/A2** — `archive/` holds a byte-identical twin of a live shipped agent and a stale v1 command that
   instructs the exact re-authoring the live v2 forbids; `internal/` (A3) repeats the pattern.
5. **A5** — `bin/cli.js`'s "@screenshotDir preservation" block can never match the shipped gls.md; for
   legacy users it silently drops the value its comment promises to preserve.
