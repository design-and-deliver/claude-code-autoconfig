---
description: Stop auto-guard prompts for one category so auto mode can cover it — /enable-auto-mode <category>
allowed-tools: Bash
argument-hint: <category>
---
<!-- @version 1 -->

The category the user passed: $ARGUMENTS

- If a category was passed, run exactly this command with it substituted for `<category>`:

```
node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/auto-guard-set.js" <category> off
```

- If no category was passed, run the script with NO arguments instead — it prints every category's current setting.

Reply with the script's output verbatim as your whole response — no commentary. If it errors, show the error verbatim.
