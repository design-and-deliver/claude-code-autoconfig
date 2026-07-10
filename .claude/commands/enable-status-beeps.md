---
description: Turn ON Pole Position tab status beeps (awaiting = low tone, complete = high tone)
allowed-tools: Bash
---
<!-- @version 1 -->

Run exactly this command, then reply with a single confirmation line and nothing else:

```
mkdir -p "${CLAUDE_PROJECT_DIR:-.}/.claude/sounds" && touch "${CLAUDE_PROJECT_DIR:-.}/.claude/sounds/status-beeps.enabled" && echo "status beeps ENABLED for this project (every turn-end beeps: awaiting=low, complete=high). Disable with /disable-status-beeps."
```
