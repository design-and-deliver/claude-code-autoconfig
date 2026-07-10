---
description: (deprecated — use /enable-status-beeps) Turn ON Pole Position tab status beeps
allowed-tools: Bash
---
<!-- @version 2 -->
<!-- Deprecated alias: /enable-arcade-beeps was renamed to /enable-status-beeps.
     Kept so existing users' muscle memory still works; remove in a future major version. -->

Run exactly this command, then reply with a single confirmation line and nothing else:

```
mkdir -p "${CLAUDE_PROJECT_DIR:-.}/.claude/sounds" && touch "${CLAUDE_PROJECT_DIR:-.}/.claude/sounds/status-beeps.enabled" && echo "status beeps ENABLED for this project (every turn-end beeps: awaiting=low, complete=high). Heads up: /enable-arcade-beeps is deprecated — next time use /enable-status-beeps. Disable with /disable-status-beeps."
```
