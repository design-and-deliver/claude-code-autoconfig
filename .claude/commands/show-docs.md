<!-- @description Opens the interactive docs in your browser. -->

# Show Docs

Open the interactive documentation for Claude Code Autoconfig.

## Step 1: Check for Changes

Compare modification times of files in `.claude/` against `.claude/docs/autoconfig.docs.html`.

If any files or folders in `.claude/` have a newer modification time than the docs HTML:
1. Output: "Syncing docs with latest changes..."
2. Proceed to Step 2

If the docs are already current, skip to Step 3.

## Step 2: Delta Sync

For each file in `.claude/` that is newer than the docs HTML:

1. Map the file to its `fileContents` key in the docs HTML:
   - `CLAUDE.md` → `claude-md`
   - `settings.json` → `settings`
   - `commands/autoconfig.md` → `autoconfig`
   - `commands/show-docs.md` → `docs-cmd`
   - `commands/sync-claude-md.md` → `sync-claude-md`
   - `commands/commit-and-push.md` → `commit-and-push`
   - `commands/enable-retro.md` → `enable-retro`
   - `commands/test.md` → `test`
   - `feedback/FEEDBACK.md` → `feedback-template`
   - `agents/create-retro-item.md` → `create-retro-item` (only if `.claude/retro/` exists)

2. Read the current content of the changed file

3. Update only that entry's `content` value in the `fileContents` object in the docs HTML

4. After all deltas are applied, the docs HTML's modification time will naturally update

## Step 3: Open Docs

Open the docs in the default browser. Use the command matching the current OS:

- **macOS:** `open .claude/docs/autoconfig.docs.html`
- **Linux:** `xdg-open .claude/docs/autoconfig.docs.html`
- **Windows:** `powershell -NoProfile -Command "Start-Process '.claude/docs/autoconfig.docs.html'"`

**Important:** If the command exits with a non-zero exit code or produces an error, tell the user the file failed to open and suggest they open it manually. Do NOT report success unless the command completed without error.
