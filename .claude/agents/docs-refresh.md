<!-- @description Background worker that syncs the docs when .claude/ files change. -->

# Docs Refresh Agent

Sync the interactive docs with the current state of `.claude/`.

## How

Run:

```bash
node .claude/scripts/sync-docs.js
```

This scans `.claude/` for all files, extracts `@description` metadata, and updates the docs HTML (file tree, info cards, and content previews).

## When to Use

- After adding, modifying, or deleting files in `.claude/`
- Before opening docs with `/show-docs` (already built in)
- As a background task when `.claude/` files change
