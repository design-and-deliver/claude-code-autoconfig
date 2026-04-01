<!-- @description Scan Claude artifacts and extract structured rules into .claude/rules/ -->
<!-- @version 3 -->
<!-- @param select | string | optional | Write only specific rules by number: "1,3,5". Default: all. -->
<!-- @param keep-sources | boolean | optional | Write rules but skip source cleanup (Step 8) -->
<!-- @response success | Rules extracted, written, and sources cleaned up. -->
<!-- @response no-rules | No extractable rules found in scanned sources. -->
<!-- @sideeffect Creates .claude/rules/ files and removes extracted content from source files -->
<!-- @example /extract-rules | Scan, propose, prompt for approval, write, and clean up -->
<!-- @example /extract-rules --keep-sources | Write rules without modifying source files -->
<!-- @example /extract-rules --select 1,3 | Write only rules #1 and #3 -->

# Extract Rules

Scan all Claude configuration artifacts and propose structured rules for `.claude/rules/`.

## Step 0: Git safety check

Before doing anything else, check for uncommitted changes:

```bash
git status --porcelain
```

If there are uncommitted changes, show this warning and wait for confirmation:

> **Warning:** This command will modify files (extract rules from sources and optionally clean up originals). You have uncommitted changes.
>
> Commit your work before proceeding, or type "continue" to proceed anyway.

If the working tree is clean, proceed silently.

## Step 1: Discover sources

Scan these locations for `.md` files containing potential rules. **Skip any that don't exist** — not all projects have all of these:

1. `CLAUDE.md` (project root)
2. `CLAUDE.local.md` (project root, if present)
3. All `.md` files in `.claude/` recursively (feedback, commands, etc.) — **excluding** `.claude/rules/` and `.claude/commands/extract-rules.md`
4. Any nested `CLAUDE.md` files in subdirectories (e.g., `src/CLAUDE.md`)
5. Auto memory files — memory often contains misplaced imperatives that should be promoted to rules. To find the memory directory, list `~/.claude/projects/` and fuzzy-match against the current project path. The directory name encodes the path with dashes replacing separators, but encoding varies by platform and may not be consistent for paths with spaces, special characters, or deep nesting. **Discovery strategy**: list all directories under `~/.claude/projects/`, then find the one whose name best matches the current working directory (check if the directory name contains key path segments like the project folder name). Read `MEMORY.md` in that directory, then each `.md` file it links to. If no match is found or the memory directory can't be read, skip this source silently.

Also read all existing `.claude/rules/` files to avoid proposing duplicates.

## Step 2: Extract candidate rules

A rule is a **deterministic behavioral instruction** that Claude should follow when working on specific files or file patterns. Good rules are:

- **Actionable**: "Do X" or "Never do Y" — not background context
- **Scoped**: Applies to specific files, directories, or file patterns
- **Not already enforced**: Skip anything already handled by hooks, settings, or linting
- **Not ephemeral**: Skip project status, session notes, debugging histories

**Skip these** (they belong in other artifacts):
- Domain knowledge / business logic explanations → stay in their source doc
- Slash command definitions → stay in `commands/`
- Session-specific debugging notes → stay in memory
- Deployment / operational procedures → stay in their source doc
- **Unscoped behavioral imperatives** (e.g., "always use conventional commits", "ask before deleting files") → stay in CLAUDE.md. The value of `.claude/rules/` is path-scoped loading — a rule without a meaningful file scope loads identically to CLAUDE.md, so extracting it is just moving it sideways. Only extract if you can identify a real file pattern.

## Step 3: Deduplicate

- If a candidate rule already exists in `.claude/rules/` (same intent, even if worded differently), skip it
- If the same guidance appears in multiple sources, note all sources but propose one rule
- Group related rules into single files when they share the same `paths` scope. If two imperatives apply to the same files, they belong in one rule file. If they target different files, keep them separate — even if topically related.
- **Rules spanning multiple scopes**: If a rule applies to multiple file patterns (e.g., "never use `any` in tests or production code"), use multiple entries in the `paths` array — this is valid and preferred over splitting into separate rule files:
  ```yaml
  paths:
    - "**/*.test.*"
    - "src/**/*"
  ```

## Step 4: Detect conflicts

Check for contradictory guidance across sources. Two rules conflict when they give opposite instructions for the same scope (e.g., "always mock the DB in tests" vs "never mock the DB in tests").

For each conflict found:
- Flag it with `⚠️ CONFLICT` in the output
- Show both sources and the contradictory statements
- Do **not** propose either rule — ask the user which one wins

Conflicts block extraction for the affected rules only. Non-conflicting rules proceed normally.

## Step 5: Rate confidence

For each proposed rule, assign a confidence level:

- **HIGH** — Explicit imperative instruction ("never do X", "always do Y", "must use Z", "prefer X over Y"). The source text literally contains an imperative. Extract these.
- **SKIP** — Everything else: inferred conventions, contextual guidance, implementation details derivable from the code. Do not propose these.

## Step 6: Output proposals

For each HIGH-confidence rule, output:

```
### Rule: <short name>
**Source**: <file(s) it was extracted from>
**Paths**: <e.g., `src/background.ts`, `src/**/*.ts`, `*.ts`>
**File name**: <proposed .claude/rules/ filename, e.g., `linkedin-selectors.md`>

--- file content ---
---
paths:
  - "src/background.ts"
  - "src/**/*.ts"
---

<rule content here>
--- end file content ---
```

The file content block must include proper YAML frontmatter with `paths` as an array. This is the exact format Claude Code expects.

**Validate paths**: Before proposing a rule, use Glob to verify that at least one `paths` pattern matches existing files in the project. If no files match, flag it with `⚠️ no matching files` and exclude it from the proposal. Dead rules erode trust.

**Output format**: Always show the summary table first, followed by a stats line. If there are 5 or fewer proposals, show the full file-content blocks after the table. If there are more than 5, ask the user if they want to see the full content for all rules or specific ones (e.g., "show 1,3" or "show all").

Summary table format:

| # | Rule file | Paths | Source(s) | Status |
|---|-----------|-------|-----------|--------|

Status column: `NEW` if no prior rule exists, `UPDATE` if it would merge with/extend an existing rule, `SKIP` if already covered.

After the table, show a stats line:

> Scanned **N** sources · Extracted **X** rules · Skipped **Y** candidates

### Examples

**Example 1: Clear imperative → single rule**

Source (`.claude/feedback/FEEDBACK.md`):
```markdown
## Dev Build vs Prod Build — CRITICAL
**ALWAYS use `npm run build`** (dev build) for local development and testing.
**NEVER use `build:prod`** unless the user explicitly asks to package for distribution.
Dev build includes a stable ID in the config. Prod build = random ID = broken auth.
```

Extracted rule (`.claude/rules/build-rules.md`):
```markdown
---
paths:
  - "build.config.ts"
  - "package.json"
---

ALWAYS use `npm run build` (dev build) for local development and testing. NEVER use `build:prod` unless the user explicitly asks to package for distribution.

Dev build includes a stable ID in the config. Prod build = random ID = broken auth.
```

Note: the imperative ("ALWAYS", "NEVER") transfers directly. The explanation is condensed but kept — it justifies the rule. Paths target the files a developer would touch when building.

**Example 2: Mixed content → split into two rules**

Source (`.claude/feedback/FEEDBACK.md`):
```markdown
## Related Projects
The business logic lives in the adjacent `../backend-api` project. This project is mostly UI — it sends raw data to the API which does the actual processing.
Treat these as a single unit. When the user mentions a feature, check backend-api automatically. Don't ask — just go find it.

## Fix Scoping
Scope fixes narrowly. Each data source has unique structure.
1. Check the `match()` function before modifying handlers
2. Don't apply fixes broadly across sources without asking
3. Test on the specific input that had the problem
```

Extracted as TWO rules because they have different path scopes:

`.claude/rules/related-projects.md`:
```markdown
---
paths:
  - "src/scrapers/*.ts"
  - "src/services/*.ts"
---

The business logic lives in `../backend-api`. When the user mentions a feature, check backend-api automatically. Don't ask — just go find it.
```

`.claude/rules/fix-scoping.md`:
```markdown
---
paths:
  - "src/scrapers/*.ts"
  - "src/adapters/*.ts"
---

Scope fixes narrowly. Each data source has unique structure.
1. Check the `match()` function before modifying handlers
2. Don't apply fixes broadly across sources without asking
3. Test on the specific input that had the problem
```

Note: same source section, but the "related projects" rule applies broadly to services while "fix scoping" targets handler files specifically. Different paths → separate rules.

## Step 7: Write rules

Write all proposed rules directly. No prompt needed — the user committed their work in Step 0 and can revert if needed.

- **If `--select N,N,...` is passed**: Write only the specified rules by number from the summary table. Skip all others.
- **If `--keep-sources` is passed**: Skip Step 8 (source cleanup) entirely. Rules are written but original source files are left untouched. Useful for validating extracted rules before committing to the full migration.

## Step 8: Source cleanup

**Skip this step if `--keep-sources` was passed.**

After writing rules, remove the extracted content from the original source files:

1. For each written rule, locate the original text in the source file(s)
2. Remove the extracted lines from the source — do not leave comments or placeholders
3. If removing content leaves an empty section (e.g., a `## Discoveries` section with no remaining entries), remove the section heading too
4. Preserve all non-extracted content in the source file
5. **Memory files**: Do NOT edit memory files (`~/.claude/projects/.../memory/`). These are outside the project directory and managed by Claude's auto-memory system. Extracted imperatives from memory will naturally be pruned by autodream once the rule takes over.

Show what was cleaned:

```
Cleaned sources:
  CLAUDE.md — removed 3 lines (2 rules extracted)
  .claude/feedback/FEEDBACK.md — removed 1 line (1 rule extracted)
```

## Step 9: Changelog summary

After applying rules (and optional cleanup), show a final changelog summarizing all changes. This is the last output the user sees, so it must be self-contained and scannable.

Format each rule as a block with a blank line between blocks:

```
NEW   .claude/rules/build-rules.md
      [manifest.config.ts, package.json]
      1. "ALWAYS use dev build, NEVER use prod for local testing"
      2. "Bump BASE_VERSION before CWS builds"
      from FEEDBACK.md

NEW   .claude/rules/content-logging.md
      [src/content.tsx, src/components/**/*.tsx]
      "Never import fileLogger in content scripts"
      from MEMORY.md → feedback_check_logs_yourself.md

UPD   .claude/rules/debugging.md
      [src/**/*.ts, src/**/*.tsx]
      added "check logs yourself, never ask user"
      from MEMORY.md → feedback_check_logs_yourself.md

---   4 rules unchanged
```

Each block has four lines:
1. Status prefix + full rule file path (`.claude/rules/filename.md`)
2. `[paths]` — the file patterns that trigger this rule, in square brackets
3. Rule description(s) — numbered list if multiple imperatives, no number if single
4. `from` — source file. For memory files discovered via MEMORY.md index, use arrow notation: `from MEMORY.md → specific_file.md`

Other rules:
- Status prefixes: `NEW` (created), `UPD` (merged new content into existing rule), `---` (unchanged count)
- On re-runs with no changes, show: `No new rules found. N existing rules unchanged.`
