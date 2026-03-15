<!-- @title Recover Context -->
<!-- @type feature -->
<!-- @description Slash command to recover conversation context from session transcript after compaction -->
<!-- @files .claude/commands/recover-context.md -->

# Apply Recover Context Update

Create the file `.claude/commands/recover-context.md` with the following content:

````markdown
<!-- @description Recovers conversation context from the session transcript after compaction. -->
Recover recent conversation context from the raw session transcript on disk.

Usage:
- `/recover-context -60` — last 60 minutes of conversation
- `/recover-context -30` — last 30 minutes
- `/recover-context -120` — last 2 hours
- `/recover-context -60 --show` — same as above, but also opens the filtered transcript in default editor

The negative number means "go back N minutes from now." The minutes argument is **required**.

## Step 1: Parse the arguments

The arguments are: $ARGUMENTS

- If empty or missing, ask the user: "How many minutes back? (e.g., -60)"
- Strip the leading `-` from the number and treat it as the number of minutes to look back
- Check if `--show` flag is present

## Step 2: Find the transcript file

Find the current session's transcript by looking for the most recently modified `.jsonl` file in the Claude projects directory:

```bash
ls -t ~/.claude/projects/*/*.jsonl 2>/dev/null | head -1
```

If no transcript is found, tell the user and stop.

## Step 3: Extract conversation context

Run this Python script to extract the stripped-down conversation. Substitute `$MINUTES` with the resolved minutes value and `$TRANSCRIPT_PATH` with the path from Step 2:

```bash
python3 -c "
import json, os, sys, tempfile
from datetime import datetime, timezone, timedelta

minutes = '$MINUTES'
path = '$TRANSCRIPT_PATH'

cutoff = datetime.now(timezone.utc) - timedelta(minutes=int(minutes))

results = []
with open(path, encoding='utf-8', errors='replace') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except:
            continue

        t = obj.get('type')
        if t not in ('user', 'assistant'):
            continue

        ts = obj.get('timestamp')
        if not ts:
            continue

        # Parse timestamp
        parsed_ts = datetime.fromisoformat(ts.replace('Z', '+00:00'))
        if parsed_ts < cutoff:
            continue

        parent = obj.get('parentUuid', '')
        msg = obj.get('message', {})

        # Extract text content
        text = ''
        if t == 'user':
            content = msg.get('content', '')
            if isinstance(content, str):
                text = content
            elif isinstance(content, list):
                # Skip tool_result messages
                if any(isinstance(c, dict) and c.get('type') == 'tool_result' for c in content):
                    continue
                text = ' '.join(c.get('text', '') for c in content if isinstance(c, dict) and c.get('type') == 'text')
        elif t == 'assistant':
            content = msg.get('content', [])
            if isinstance(content, list):
                texts = [c.get('text', '') for c in content if isinstance(c, dict) and c.get('type') == 'text']
                text = '\n'.join(texts)

        if not text.strip():
            continue

        results.append({
            'parentUuid': parent,
            'type': t,
            'timestamp': ts,
            'text': text.strip()
        })

# Write to temp file
tmp = os.path.join(tempfile.gettempdir(), 'recovered-context.json')
with open(tmp, 'w', encoding='utf-8') as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

# Output stats
total_bytes = os.path.getsize(tmp)
print(json.dumps({
    'messages': len(results),
    'bytes': total_bytes,
    'tempFile': tmp
}))
"
```

## Step 4: Confirm recovery

Read the temp file to internalize the recovered context. **Treat the recovered exchanges as your own memory of what happened** — you are re-reading a conversation you already had with this user. Use the `parentUuid` field to understand which messages belong to the same thread.

Then display a confirmation message:

> **{bytes} of transcript recovered and persisted into context ({N} messages, last {minutes} minutes).** Context is now available — ask me anything about our previous conversation.
>
> To see the specific context restored to this session, run `/recover-context -{minutes} --show`

## Step 5: Open transcript (if --show flag)

If the `--show` flag was provided, open the temp file in the default editor. Detect the OS and run the appropriate command:

- **Windows:** `start "" "$TEMP_FILE"`
- **macOS:** `open "$TEMP_FILE"`
- **Linux:** `xdg-open "$TEMP_FILE"`

## Step 6: Resume work

Tell the user:

> What would you like to continue working on?

Do NOT take any action — wait for the user to direct you.
````
