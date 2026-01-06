<!-- @description Incrementally updates CLAUDE.md and the guide when .claude/ files change. Runs automatically via PostToolUse hook — no manual trigger needed. -->

# Autoconfig Refresh

Incrementally update CLAUDE.md and the guide to reflect current `.claude/` contents.

This command is triggered automatically when you edit files in `.claude/`. You can also run it manually.

## Step 1: Scan Changed Files

Check which `.claude/` files exist and extract their top comments:

1. For each `.md` file in `.claude/commands/`, `.claude/agents/`, `.claude/rules/`, `.claude/feedback/`:
   - Read the file
   - Extract the HTML comment from the top (if present): `<!-- description here -->`
   - This becomes the hover description in the guide

2. Note any new files or removed files compared to the guide's current treeInfo.

## Step 2: Update the Guide

Open `.claude/guide/autoconfig.guide.html` and update the `treeInfo` object:

1. For each file with a top comment, update its `desc` field with the comment content
2. Add entries for any new files discovered
3. Remove entries for files that no longer exist
4. Also update the treeview HTML structure if files were added/removed

**Only update entries that actually changed.** Don't rewrite unchanged entries.

## Step 3: Update CLAUDE.md (if needed)

If the project structure changed significantly (new frameworks, dependencies, or commands detected), regenerate CLAUDE.md:

1. Re-analyze package.json, config files, etc.
2. Update tech stack, commands sections
3. **Always preserve** the Team Feedback pointer at the end:

```markdown
## Team Feedback
See `.claude/feedback/` for corrections and guidance from the team.
```

If only `.claude/` config files changed (not the project itself), skip CLAUDE.md regeneration.

## Step 4: Update Guide File Preview

If CLAUDE.md was regenerated, update the guide's `fileContents['claude-md']` to match.

## Guidelines

- **Be incremental**: Only update what changed
- **Be fast**: This runs in background, but should complete quickly
- **Preserve structure**: Don't reorganize the treeInfo or HTML unless necessary
- **Extract @description**: Use `<!-- @description ... -->` as the source of truth for hover text

## @description Convention

Files should have an `@description` comment at the top for automatic guide integration:

```markdown
<!-- @description Brief description shown in guide hover -->

# Title
...
```

The `@description` text becomes the hover description in the guide's treeview.
