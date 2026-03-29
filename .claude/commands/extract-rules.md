<!-- @description Scan Claude artifacts and propose structured rules for .claude/rules/ -->
<!-- @version 1 -->
<!-- @param mode | string | optional | "preview" (default) shows proposals, "apply" writes and cleans sources -->
<!-- @response success | Rules extracted and optionally applied with source cleanup. -->
<!-- @response no-rules | No extractable rules found in scanned sources. -->
<!-- @sideeffect May create .claude/rules/ files and remove extracted content from source files -->
<!-- @example /extract-rules | Preview proposed rules without writing -->
<!-- @example /extract-rules --apply | Write rules and clean up sources -->

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
5. `.claude/settings.json` (hooks section — behavioral rules implied by hooks)

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

## Step 3: Deduplicate

- If a candidate rule already exists in `.claude/rules/` (same intent, even if worded differently), skip it
- If the same guidance appears in multiple sources, note all sources but propose one rule
- Group related rules into single files when they share the same `paths` scope. If two imperatives apply to the same files, they belong in one rule file. If they target different files, keep them separate — even if topically related.

## Step 4: Rate confidence

For each proposed rule, assign a confidence level:

- **HIGH** — Explicit imperative instruction ("never do X", "always do Y", "must use Z", "prefer X over Y"). The source text literally contains an imperative. Extract these.
- **SKIP** — Everything else: inferred conventions, contextual guidance, implementation details derivable from the code. Do not propose these.

## Step 5: Output proposals

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

At the end, show a summary table:

| # | Rule file | Paths | Source(s) | Status |
|---|-----------|-------|-----------|--------|

Status column: `NEW` if no prior rule exists, `UPDATE` if it would merge with/extend an existing rule, `SKIP` if already covered.

After the table, show a stats line:

> Scanned **N** sources · Extracted **X** rules · Skipped **Y** candidates

## Step 6: Apply or wait

- **Default (preview mode)**: Do NOT create any files. Wait for user approval.
- **If `--apply` argument is passed**: Write all proposed rules directly, then proceed to Step 7.

After user approves in preview mode, write the rule files and proceed to Step 7.

## Step 7: Source cleanup

After writing rules, remove the extracted content from the original source files:

1. For each written rule, locate the original text in the source file(s)
2. Remove the extracted lines from the source — do not leave comments or placeholders
3. If removing content leaves an empty section (e.g., a `## Discoveries` section with no remaining entries), remove the section heading too
4. Preserve all non-extracted content in the source file

Show what was cleaned:

```
Cleaned sources:
  CLAUDE.md — removed 3 lines (2 rules extracted)
  .claude/feedback/FEEDBACK.md — removed 1 line (1 rule extracted)
```
