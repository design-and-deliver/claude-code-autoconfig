<!-- @description Recovers conversation context from the session transcript after compaction. -->
<!-- @version 5 -->
<!-- @param minutes | integer | optional | How far back to recover, in minutes. Leading dash optional. Min: 1. Required unless pid= is given. -->
<!-- @param pid | integer | optional | Recovery-pointer id from token-guard's idle warning (e.g. pid=3). Resolves the exact session + cutoff from .claude/hooks/.token-guard/recover.json. -->
<!-- @param --show | flag | optional | Opens the extracted transcript in your default editor. -->
<!-- @response success | ~{tokens} tokens recovered ({N} messages across {sessions} session(s)). -->
<!-- @response no-transcript | No transcript files found. -->
<!-- @response no-messages | No messages found in the requested time range. -->
<!-- @response no-pointer | No recovery pointer found (or that pid is not in it). -->
<!-- @sideeffect Reads .jsonl transcripts from ~/.claude/projects/, writes temp file -->
<!-- @example /recover-context -60 | Last 60 minutes of conversation -->
<!-- @example /recover-context pid=3 | Recover exactly what token-guard's idle warning pointed at -->
<!-- @example /recover-context -60 --show | Last 60 min + open transcript file -->
Recover recent conversation context from the raw session transcript on disk.

Usage:
- `/recover-context -60` — last 60 minutes of conversation (any recent session)
- `/recover-context pid=3` — recover via a token-guard pointer: the exact stale session and cutoff its idle warning computed
- `/recover-context -60 --show` — same as minutes mode, but also opens the transcript in your editor

Two modes:
- **Minutes mode**: the number means "go back N minutes from now." The leading dash is optional.
- **Pointer mode** (`pid=N`): token-guard's idle-return warning writes a numbered recovery pointer to `.claude/hooks/.token-guard/recover.json` in the project it fired in. The pid encapsulates the stale session's id and the recovery cutoff (frozen at fire time), so this mode recovers the right window no matter how long ago the warning fired.

## Step 1: Parse the arguments

The arguments are: $ARGUMENTS

- If they match `pid=N` (also accept `pid N` or `--pid N`) → **pointer mode**, `$PID` = N. Go to Step 2a.
- Otherwise, strip the leading `-` from the number and treat it as minutes to look back → **minutes mode**. Go to Step 2b.
- If empty or missing, ask the user: "How many minutes back? (e.g., -60) — or pid=N if token-guard gave you a pointer."
- Check if `--show` flag is present (either mode).

## Step 2a: Pointer mode — resolve the pid

From the project root (the directory you were launched in), run:

```bash
python3 -c "
import json, sys
from datetime import datetime, timezone, timedelta

want = int('$PID')
try:
    rec = json.load(open('.claude/hooks/.token-guard/recover.json', encoding='utf-8'))
except Exception:
    print('NO_POINTER_FILE'); sys.exit(0)

entries = [rec] + rec.get('history', [])
hit = next((e for e in entries if e.get('pid') == want), None)
if hit is None:
    print('NOT_FOUND available=' + ','.join(str(e.get('pid')) for e in entries if e.get('pid')))
    sys.exit(0)

cutoff = hit.get('cutoffIso')
if not cutoff:
    written = datetime.fromtimestamp(hit.get('writtenAt', 0) / 1000, tz=timezone.utc)
    cutoff = (written - timedelta(minutes=hit.get('minutes', 15))).isoformat()
print('SID=' + hit['sid'])
print('CUTOFF_ISO=' + cutoff)
"
```

- `NO_POINTER_FILE` → tell the user no recovery pointer exists in this project (token-guard writes it when its idle warning fires) and stop.
- `NOT_FOUND available=…` → tell the user that pid isn't in the pointer file and list the available pids, then stop.
- Otherwise store `$SID` and `$CUTOFF_ISO`, then find that session's transcript:

```bash
ls ~/.claude/projects/*/$SID.jsonl 2>/dev/null
```

If it's gone, tell the user the transcript no longer exists and stop. Otherwise store the single path as `$FILES_TO_PARSE` and skip to Step 4.

## Step 2b: Minutes mode — list candidate transcript files

Compute the cutoff:

```bash
python3 -c "
from datetime import datetime, timezone, timedelta
print((datetime.now(timezone.utc) - timedelta(minutes=int('$MINUTES'))).isoformat())
"
```

Store it as `$CUTOFF_ISO`. Then list all `.jsonl` transcript files sorted by most recently modified:

```bash
ls -t ~/.claude/projects/*/*.jsonl 2>/dev/null | head -20
```

If no transcripts are found, tell the user and stop. Store the list as `$TRANSCRIPT_FILES` (one path per line).

## Step 3: Minutes mode — identify which files to parse (lazy probing)

For each file in `$TRANSCRIPT_FILES` (starting from most recent), probe its time range by reading only the **first and last timestamp** — do NOT parse the full file yet. Run this script, substituting `$CUTOFF_ISO` and `$TRANSCRIPT_FILES`:

```bash
python3 -c "
import json, sys
from datetime import datetime

cutoff = datetime.fromisoformat('$CUTOFF_ISO')

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

## Step 4: Extract conversation context (both modes)

Run this Python script to extract messages from only the identified files. Substitute `$CUTOFF_ISO` and `$FILES_TO_PARSE`:

```bash
python3 -c "
import json, os, sys, tempfile
from datetime import datetime

cutoff = datetime.fromisoformat('$CUTOFF_ISO')

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

- Minutes mode: **~{tokens} tokens recovered and persisted into context ({N} messages across {sessions} session(s), last {minutes} minutes).**
- Pointer mode: **~{tokens} tokens recovered and persisted into context ({N} messages from session {first 8 chars of SID}, pointer pid={PID}).**

## Step 6: Open transcript (if --show flag)

If the `--show` flag was provided, open the temp file in the default editor. Detect the OS and run the appropriate command:

- **Windows:** `start "" "$TEMP_FILE"`
- **macOS:** `open "$TEMP_FILE"`
- **Linux:** `xdg-open "$TEMP_FILE"`

## Step 7: Resume work

Tell the user:

> What would you like to continue working on?

Do NOT take any action — wait for the user to direct you.
