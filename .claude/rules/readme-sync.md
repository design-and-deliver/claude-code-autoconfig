---
paths:
  - "package.json"
  - "README.md"
  - "bin/cli.js"
  - ".claude/commands/*.md"
  - ".claude/docs/*.html"
  - ".claude/scripts/sync-docs.js"
---

Before any publish to npm — whether via `/publish`, `npm publish`, `npm version`, or any other method — you MUST complete both steps below. Never skip either.

## 1. Sync README.md

Compare README.md against the current project state. Check:

1. File tree matches actual `.claude/` directory contents
2. Slash commands table matches actual `.claude/commands/` files (names, descriptions, versions)
3. Feature sections reflect current capabilities
4. No references to nonexistent commands, files, or removed features

Update and commit if anything is out of date.

## 2. Regenerate interactive HTML docs

Run `node .claude/scripts/sync-docs.js` to rebuild `.claude/docs/autoconfig.docs.html` from the current `.claude/` directory. Commit the regenerated file if it changed.
