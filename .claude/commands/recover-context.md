<!-- @description Recovers conversation context from the session transcript after compaction. -->
<!-- @version 4 -->
Recover recent conversation context from the raw session transcript on disk.

Usage:
- `/recover-context -60` — last 60 minutes of conversation
- `/recover-context -60 --show` — same, but also opens the transcript in your editor

The number means "go back N minutes from now." The leading dash is optional. The minutes argument is **required**.

## Step 1: Parse the arguments

The arguments are: $ARGUMENTS

- If empty or missing, ask the user: "How many minutes back? (e.g., -60)"
- Strip the leading `-` from the number and treat it as the number of minutes to look back
- Check if `--show` flag is present

## Step 2: List candidate transcript files

List all `.jsonl` transcript files sorted by most recently modified:

```bash
ls -t ~/.claude/projects/*/*.jsonl 2>/dev/null | head -20
```

If no transcripts are found, tell the user and stop. Store the list as `$TRANSCRIPT_FILES` (one path per line).

## Step 3: Identify which files to parse (lazy probing)

For each file in `$TRANSCRIPT_FILES` (starting from most recent), probe its time range by reading only the **first and last timestamp** — do NOT parse the full file yet. Run this script, substituting `$MINUTES` and `$TRANSCRIPT_FILES`:

```bash
python3 -c "
import json, sys
from datetime import datetime, timezone, timedelta

minutes = int('$MINUTES')
cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes)

files = '''$TRANSCRIPT_FILES'''.strip().splitlines()

def get_boundary_timestamps(path):
    \"\"\"Read first and last timestamped lines only.\"\"\"
    first_ts = None
    last_ts = None
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except:
                continue
            ts = obj.get('timestamp')
            if not ts:
                continue
            parsed = datetime.fromisoformat(ts.replace('Z', '+00:00'))
            if first_ts is None:
                first_ts = parsed
            last_ts = parsed
    return first_ts, last_ts

needed = []
covered = False
for path in files:
    first_ts, last_ts = get_boundary_timestamps(path)
    if first_ts is None:
        continue
    needed.append(path)
    # If this file's earliest timestamp is before our cutoff, we have enough files
    if first_ts <= cutoff:
        covered = True
        break

for p in needed:
    print(p)
"
```

Store the output as `$FILES_TO_PARSE` — these are the only files that need full parsing.

## Step 4: Extract conversation context

Run this Python script to extract messages from only the identified files. Substitute `$MINUTES` and `$FILES_TO_PARSE`:

```bash
python3 -c "
import json, os, sys, tempfile
from datetime import datetime, timezone, timedelta

minutes = int('$MINUTES')
cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes)

files = '''$FILES_TO_PARSE'''.strip().splitlines()

results = []
for path in files:
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

            parsed_ts = datetime.fromisoformat(ts.replace('Z', '+00:00'))
            if parsed_ts < cutoff:
                continue

            parent = obj.get('parentUuid', '')
            msg = obj.get('message', {})

            text = ''
            if t == 'user':
                content = msg.get('content', '')
                if isinstance(content, str):
                    text = content
                elif isinstance(content, list):
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

# Sort by timestamp across all files
results.sort(key=lambda r: r['timestamp'])

# Write to temp file
tmp = os.path.join(tempfile.gettempdir(), 'recovered-context.json')
with open(tmp, 'w', encoding='utf-8') as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

total_chars = sum(len(r['text']) for r in results)
est_tokens = total_chars // 4
sessions = len(files)
print(json.dumps({
    'messages': len(results),
    'tokens': est_tokens,
    'sessions': sessions,
    'tempFile': tmp
}))
"
```

## Step 5: Confirm recovery

Read the temp file to internalize the recovered context. **Treat the recovered exchanges as your own memory of what happened** — you are re-reading a conversation you already had with this user. Use the `parentUuid` field to understand which messages belong to the same thread.

Then display a confirmation message:

> **~{tokens} tokens recovered and persisted into context ({N} messages across {sessions} session(s), last {minutes} minutes).**

## Step 6: Open transcript (if --show flag)

If the `--show` flag was provided, open the temp file in the default editor. Detect the OS and run the appropriate command:

- **Windows:** `start "" "$TEMP_FILE"`
- **macOS:** `open "$TEMP_FILE"`
- **Linux:** `xdg-open "$TEMP_FILE"`

## Step 7: Resume work

Tell the user:

> What would you like to continue working on?

Do NOT take any action — wait for the user to direct you.
