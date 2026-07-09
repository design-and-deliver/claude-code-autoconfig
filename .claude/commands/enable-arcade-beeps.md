---
description: Turn ON Pole Position tab status beeps (awaiting = low tone, complete = high tone)
allowed-tools: Bash
---

Run exactly this command, then reply with a single confirmation line and nothing else:

```
mkdir -p "${CLAUDE_PROJECT_DIR:-.}/.claude/sounds" && touch "${CLAUDE_PROJECT_DIR:-.}/.claude/sounds/arcade-beeps.enabled" && echo "arcade beeps ENABLED for this project (every turn-end beeps: awaiting=low, complete=high). Disable with /disable-arcade-beeps."
```
