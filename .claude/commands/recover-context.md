<!-- @description Recovers conversation context from the session transcript after compaction. -->
<!-- @version 6 -->
<!-- @param minutes | integer | optional | How far back to recover, in minutes. Leading dash optional. Min: 1. Bare invocation auto-recovers the last session instead. -->
<!-- @param pid | integer | optional | Recovery-pointer id from token-guard's idle warning (e.g. pid=3). Resolves the exact session + cutoff from .claude/hooks/.token-guard/recover.json. -->
<!-- @param --show | flag | optional | Opens the extracted transcript in your default editor. -->
<!-- @response success | ~{tokens} tokens recovered ({N} messages across {sessions} session(s)). -->
<!-- @response no-transcript | No transcript files found. -->
<!-- @response no-messages | No messages found in the requested time range. -->
<!-- @response no-pointer | No recovery pointer found (or that pid is not in it). -->
<!-- @response no-previous | No previous session found in this project. -->
<!-- @sideeffect Reads .jsonl transcripts from ~/.claude/projects/, writes temp file -->
<!-- @example /recover-context | Auto: last ~15 min of this project's previous session -->
<!-- @example /recover-context -60 | Last 60 minutes of conversation -->
<!-- @example /recover-context pid=3 | Recover exactly what token-guard's idle warning pointed at -->
<!-- @example /recover-context -60 --show | Last 60 min + open transcript file -->
Recover recent conversation context from the raw session transcript on disk.

Usage:
- `/recover-context` — auto: recover the last session in this project (after a /clear or in a fresh terminal), no arguments needed
- `/recover-context -60` — last 60 minutes of conversation (any recent session)
- `/recover-context pid=3` — recover via a token-guard pointer: the exact stale session and cutoff its idle warning computed
- `/recover-context -60 --show` — same as minutes mode, but also opens the transcript in your editor

Three modes:
- **Auto mode** (no arguments): finds this project's previous session by itself — the current session's transcript is the newest `.jsonl` in the project's transcript directory (it is being written right now), so the previous session is the second-newest. The cutoff comes from a matching token-guard pointer when one exists (frozen at fire time, interaction-aware), otherwise from the same ~15-minutes-of-real-interaction walk-back over the transcript's own timestamps.
- **Minutes mode**: the number means "go back N minutes from now." The leading dash is optional.
- **Pointer mode** (`pid=N`): token-guard's idle-return warning writes a numbered recovery pointer to `.claude/hooks/.token-guard/recover.json` in the project it fired in. The pid encapsulates the stale session's id and the recovery cutoff (frozen at fire time), so this mode recovers the right window no matter how long ago the warning fired — even if other sessions happened in between (which would fool auto mode).

## Step 1: Parse the arguments

The arguments are: $ARGUMENTS

- If empty (no arguments beyond flags) → **auto mode**. Go to Step 2c.
- If they match `pid=N` (also accept `pid N` or `--pid N`) → **pointer mode**, `$PID` = N. Go to Step 2a.
- Otherwise, strip the leading `-` from the number and treat it as minutes to look back → **minutes mode**. Go to Step 2b.
- Check if `--show` flag is present (any mode).

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

## Step 2c: Auto mode — resolve the previous session

From the project root (the directory you were launched in), run:

```bash
python3 -c "
import glob, json, os, re, sys
from datetime import datetime, timedelta

proj = re.sub(r'[^A-Za-z0-9]', '-', os.getcwd())
tdir = os.path.expanduser('~/.claude/projects/' + proj)
files = sorted(glob.glob(os.path.join(tdir, '*.jsonl')), key=os.path.getmtime, reverse=True)
if len(files) < 2:
    print('NO_PREVIOUS_SESSION'); sys.exit(0)

# files[0] is THIS session (its transcript is being written right now);
# files[1] is the previous session.
prev = files[1]
sid = os.path.splitext(os.path.basename(prev))[0]

# Prefer a matching token-guard pointer: its cutoff was frozen at fire time and
# weighted by real interaction, so it beats a recomputed one.
cutoff = None; via = 'walk-back'
try:
    rec = json.load(open('.claude/hooks/.token-guard/recover.json', encoding='utf-8'))
    for e in [rec] + rec.get('history', []):
        if e.get('sid') == sid and e.get('cutoffIso'):
            cutoff = e['cutoffIso']; via = 'pointer pid=%s' % e.get('pid'); break
except Exception:
    pass

if cutoff is None:
    # Same walk-back token-guard uses: cover ~15min of real interaction, counting
    # any gap as at most 5min so idle stretches don't eat the budget.
    ts = []
    with open(prev, encoding='utf-8', errors='replace') as f:
        for line in f:
            try:
                obj = json.loads(line)
            except Exception:
                continue
            t = obj.get('timestamp')
            if t:
                ts.append(datetime.fromisoformat(t.replace('Z', '+00:00')))
    if not ts:
        print('NO_PREVIOUS_SESSION'); sys.exit(0)
    i = len(ts) - 1; acc = timedelta()
    while i > 0 and acc < timedelta(minutes=15):
        acc += min(ts[i] - ts[i-1], timedelta(minutes=5)); i -= 1
    cutoff = ts[i].isoformat()

print('SID=' + sid)
print('FILE=' + prev)
print('CUTOFF_ISO=' + cutoff)
print('VIA=' + via)
"
```

- `NO_PREVIOUS_SESSION` → tell the user no previous session exists for this project and stop (offer minutes mode if they meant a different project's work).
- Otherwise store `$SID`, `$CUTOFF_ISO`, set `$FILES_TO_PARSE` to the `FILE=` path, note `VIA` for the confirmation, and skip to Step 4.

Caveat: if ANOTHER Claude session is live in this project right now, it may be the second-newest file and auto mode would pick it up instead — in that case rerun with `pid=N` or minutes mode.

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

- Auto mode: **~{tokens} tokens recovered and persisted into context ({N} messages from your last session, {first 8 chars of SID}, via {VIA}).**
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
