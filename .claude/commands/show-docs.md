<!-- @description Opens the interactive docs in your browser. -->
<!-- @version 2 -->
<!-- @response success | Docs synced and opened in default browser. -->
<!-- @response no-docs | Docs file not found — run /autoconfig first. -->
<!-- @sideeffect Runs sync-docs.js to refresh content, opens browser -->
<!-- @example /show-docs | Open interactive documentation -->

# Show Docs

Open the interactive documentation for Claude Code Autoconfig.

## Step 1: Sync Docs

Run the sync script to ensure the docs reflect the current state of `.claude/`:

```bash
node .claude/scripts/sync-docs.js
```

This scans all files in `.claude/` (commands, hooks, agents, feedback, updates, settings) and updates the docs HTML file tree, info cards, and content previews automatically. It's fast and idempotent.

If the script fails (e.g., file not found), skip to Step 2 — the docs will still open with whatever content they have.

## Step 2: Open Docs

Open the docs in the default browser. Use the command matching the current OS:

- **macOS:** `open .claude/docs/autoconfig.docs.html`
- **Linux:** `xdg-open .claude/docs/autoconfig.docs.html`
- **Windows:** `powershell -NoProfile -Command "Start-Process '.claude/docs/autoconfig.docs.html'"`

**Important:** If the command exits with a non-zero exit code or produces an error, tell the user the file failed to open and suggest they open it manually. Do NOT report success unless the command completed without error.
