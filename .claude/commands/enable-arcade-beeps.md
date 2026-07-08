---
description: Turn ON Pole Position tab status beeps (awaiting = low tone, complete = high tone)
allowed-tools: Bash
---

Run exactly this command, then reply with a single confirmation line and nothing else:

```
mkdir -p ~/.claude/sounds && touch ~/.claude/sounds/arcade-beeps.enabled && echo "arcade beeps ENABLED (every turn-end beeps: awaiting=low, complete=high). Disable with /disable-arcade-beeps."
```
