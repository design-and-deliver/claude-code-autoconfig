---
description: Turn OFF Pole Position tab status beeps
allowed-tools: Bash
---

Run exactly this command, then reply with a single confirmation line and nothing else:

```
rm -f "${CLAUDE_PROJECT_DIR:-.}/.claude/sounds/arcade-beeps.enabled" ~/.claude/sounds/arcade-beeps.enabled && echo "arcade beeps DISABLED."
```
