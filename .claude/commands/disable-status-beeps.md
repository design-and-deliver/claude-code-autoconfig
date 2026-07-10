---
description: Turn OFF Pole Position tab status beeps
allowed-tools: Bash
---
<!-- @version 1 -->

Run exactly this command, then reply with a single confirmation line and nothing else:

```
rm -f "${CLAUDE_PROJECT_DIR:-.}/.claude/sounds/status-beeps.enabled" "${CLAUDE_PROJECT_DIR:-.}/.claude/sounds/arcade-beeps.enabled" ~/.claude/sounds/status-beeps.enabled ~/.claude/sounds/arcade-beeps.enabled && echo "status beeps DISABLED."
```
