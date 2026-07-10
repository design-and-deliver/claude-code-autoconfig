---
description: (deprecated — use /disable-status-beeps) Turn OFF Pole Position tab status beeps
allowed-tools: Bash
---
<!-- @version 2 -->
<!-- Deprecated alias: /disable-arcade-beeps was renamed to /disable-status-beeps.
     Kept so existing users' muscle memory still works; remove in a future major version. -->

Run exactly this command, then reply with a single confirmation line and nothing else:

```
rm -f "${CLAUDE_PROJECT_DIR:-.}/.claude/sounds/status-beeps.enabled" "${CLAUDE_PROJECT_DIR:-.}/.claude/sounds/arcade-beeps.enabled" ~/.claude/sounds/status-beeps.enabled ~/.claude/sounds/arcade-beeps.enabled && echo "status beeps DISABLED. Heads up: /disable-arcade-beeps is deprecated — next time use /disable-status-beeps."
```
