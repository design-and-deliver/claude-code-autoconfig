<!-- @description Opens the interactive guide in your browser. -->

# Show Guide

Open the interactive guide for Claude Code Autoconfig.

## Step 1: Check for Changes

Compare modification times of files in `.claude/` against `.claude/guide/autoconfig.guide.html`.

If any files or folders in `.claude/` have a newer modification time than the guide HTML:
1. Output: "Syncing guide with latest changes..."
2. Proceed to Step 2

If the guide is already current, skip to Step 3.

## Step 2: Delta Sync

For each file in `.claude/` that is newer than the guide HTML:

1. Map the file to its `fileContents` key in the guide HTML:
   - `CLAUDE.md` → `claude-md`
   - `settings.json` → `settings`
   - `commands/autoconfig.md` → `autoconfig`
   - `commands/show-guide.md` → `guide-cmd`
   - `commands/sync-claude-md.md` → `sync-claude-md`
   - `commands/commit-and-push.md` → `commit-and-push`
   - `commands/test.md` → `test`
   - `agents/refresh-guide.md` → `refresh-guide`
   - `agents/create-retro-item.md` → `create-retro-item`
   - `feedback/FEEDBACK.md` → `feedback-template`

2. Read the current content of the changed file

3. Update only that entry's `content` value in the `fileContents` object in the guide HTML

4. After all deltas are applied, the guide HTML's modification time will naturally update

## Step 3: Open Guide

Open the guide in the default browser using the appropriate command for the OS:

```bash
# macOS
open .claude/guide/autoconfig.guide.html

# Linux
xdg-open .claude/guide/autoconfig.guide.html

# Windows
start .claude/guide/autoconfig.guide.html
```
