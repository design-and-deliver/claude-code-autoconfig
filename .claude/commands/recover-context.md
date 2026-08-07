<!-- @description Recovers conversation context from the session transcript after compaction. -->
<!-- @version 8 -->
<!-- @param minutes | integer | optional | How far back to recover, in minutes. Leading dash optional. Min: 1. Bare invocation auto-recovers the last session instead. -->
<!-- @param pid | integer | optional | Recovery-pointer id from token-guard's idle warning (e.g. pid=3). Resolves the exact session + cutoff from .claude/hooks/.token-guard/recover.json. -->
<!-- @param --show | flag | optional | Opens the extracted transcript in your default editor. -->
<!-- @response success | ~{tokens} tokens recovered ({N} messages across {sessions} session(s)). -->
<!-- @response no-transcript | No transcript files found. -->
<!-- @response no-messages | No messages found in the requested time range. -->
<!-- @response no-pointer | No recovery pointer found (or that pid is not in it). -->
<!-- @response no-previous | No previous session found in this project. -->
<!-- @response handoff | Recovered your last session's checkpoint handoff — no transcript replay needed. -->
<!-- @sideeffect Reads .jsonl transcripts from ~/.claude/projects/, writes temp file — both skipped when the previous session left a fresh handoff note -->
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
- **Auto mode** (no arguments): recovers the session that ran in THIS terminal before the current one. The terminal-title hook maintains a terminal-lineage registry: on every SessionStart (including /clear) it records which session this terminal held, and stamps the outgoing session as the incoming one's predecessor in `.claude/hooks/.titles/{sid}.lineage.json`. Auto mode reads its own lineage file (keyed by `$CLAUDE_CODE_SESSION_ID`), falling back to the newest-other-transcript heuristic when no lineage exists. The cutoff ladder: a matching token-guard pointer (frozen at fire time) → the start of the previous session's final use-case thread per its title history (`{sid}.history.jsonl`), floored at ~15 min of real interaction and capped at 60 wall-clock minutes → the plain ~15-min walk-back.
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
import glob, json, os, re, sys, time
from datetime import datetime, timedelta

def iso(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00'))

titles_dirs = ['.claude/hooks/.titles', os.path.expanduser('~/.claude/hooks/.titles')]

# 1. Terminal lineage — the explicit record of which session THIS terminal held before
#    the current one (written by the terminal-title hook on every SessionStart/clear).
sid_now = os.environ.get('CLAUDE_CODE_SESSION_ID', '')
prev = None; how = None
if sid_now:
    for d in titles_dirs:
        f = os.path.join(d, sid_now + '.lineage.json')
        if os.path.exists(f):
            try:
                prev = json.load(open(f, encoding='utf-8')).get('prevSid')
            except Exception:
                prev = None
            if prev:
                how = 'terminal lineage'
            break

# 2. Fallback heuristic — this project's newest transcript that isn't the current
#    session's (the current one is being written right now, so it sorts first).
file = None
if prev:
    hits = glob.glob(os.path.expanduser('~/.claude/projects/*/' + prev + '.jsonl'))
    file = hits[0] if hits else None
if not file:
    proj = re.sub(r'[^A-Za-z0-9]', '-', os.getcwd())
    tdir = os.path.expanduser('~/.claude/projects/' + proj)
    files = sorted(glob.glob(os.path.join(tdir, '*.jsonl')), key=os.path.getmtime, reverse=True)
    files = [p for p in files if os.path.splitext(os.path.basename(p))[0] != sid_now]
    # Live-twin filter (added 2026-07-21 after auto mode resumed a RUNNING tab's work):
    # a sid that is some OTHER terminal's current occupant (terminals/ registry) and
    # showed activity within 3 min (transcript/glyph mtime — the dupe guard's liveness
    # bar) is a live session, never this tab's dead predecessor — our own SessionStart
    # dethroned the predecessor from this terminal's record. Quiet occupants stay
    # eligible so a closed tab's session is still recoverable from a fresh terminal.
    occupied = set()
    for d in titles_dirs:
        for tf in glob.glob(os.path.join(d, 'terminals', '*.json')):
            try:
                s = json.load(open(tf, encoding='utf-8')).get('sid')
                if s and s != sid_now:
                    occupied.add(s)
            except Exception:
                pass
    def is_live(p):
        s = os.path.splitext(os.path.basename(p))[0]
        if s not in occupied:
            return False
        m = os.path.getmtime(p)
        for d in titles_dirs:
            g = os.path.join(d, s + '.glyph')
            if os.path.exists(g):
                m = max(m, os.path.getmtime(g))
        return time.time() - m < 180
    files = [p for p in files if not is_live(p)]
    if not files:
        print('NO_PREVIOUS_SESSION'); sys.exit(0)
    file = files[1] if (not sid_now and len(files) > 1) else files[0]
    prev = os.path.splitext(os.path.basename(file))[0]
    how = 'newest-other transcript'

ts = []
with open(file, encoding='utf-8', errors='replace') as f:
    for line in f:
        try:
            obj = json.loads(line)
        except Exception:
            continue
        t = obj.get('timestamp')
        if t:
            ts.append(iso(t))
if not ts:
    print('NO_PREVIOUS_SESSION'); sys.exit(0)

# --- checkpoint handoff: a CONTENT source, above the cutoff ladder rather than in it ---
# token-guard's restart advisory asks a session past the fat line to write what it ruled out to
# .titles/<sid>.handoff.md before /clear (ISO timestamp, then ## Done / ## In flight / ## Next /
# ## Pointers). Where that note exists the walk-back below is guessing at something the previous
# session already stated. mtime is the freshness authority, NOT the note's own first line: the
# line is model-written copy and can be wrong or timezone-naive; the mtime cannot.
handoff = None
for d in titles_dirs:
    p = os.path.join(d, prev + '.handoff.md')
    if os.path.exists(p):
        handoff = p; break
# Stale = the transcript kept moving >3min past the write, so the note is missing that tail.
# (Some drift is normal and expected: the note is written mid-turn, and the turn that writes it
# still lands messages after it.)
handoff_fresh = bool(handoff) and os.path.getmtime(handoff) >= ts[-1].timestamp() - 180

# --- cutoff ladder ---
# Still computed even on a fresh handoff — it costs nothing (the transcript is already parsed)
# and it is what the stale/unreadable-note fallback needs.
cutoff = None; via = None

# a. A token-guard pointer for this sid: frozen at idle-fire time, interaction-aware.
try:
    rec = json.load(open('.claude/hooks/.token-guard/recover.json', encoding='utf-8'))
    for e in [rec] + rec.get('history', []):
        if e.get('sid') == prev and e.get('cutoffIso'):
            cutoff = iso(e['cutoffIso']); via = 'pointer pid=%s' % e.get('pid'); break
except Exception:
    pass

if cutoff is None:
    # b/c. Walk-back: >=15min of real interaction (gaps counted at most 5min)...
    i = len(ts) - 1; acc = timedelta()
    while i > 0 and acc < timedelta(minutes=15):
        acc += min(ts[i] - ts[i-1], timedelta(minutes=5)); i -= 1
    wb = ts[i]
    # ...widened to the start of the session's FINAL use-case thread when the title
    # history knows it (the last title write marks where that thread began).
    tb = None
    for d in titles_dirs:
        h = os.path.join(d, prev + '.history.jsonl')
        if os.path.exists(h):
            lines = [l for l in open(h, encoding='utf-8', errors='replace') if l.strip()]
            if lines:
                try:
                    tb = iso(json.loads(lines[-1])['ts'])
                except Exception:
                    tb = None
            break
    cutoff = min(tb, wb) if tb else wb
    via = 'title-thread' if (tb and tb < wb) else 'walk-back'
    # Cap the tail at 60 wall-clock minutes so a single-title marathon can't flood context.
    floor = ts[-1] - timedelta(minutes=60)
    if cutoff < floor:
        cutoff = floor; via += ', capped at 60min'

print('SID=' + prev)
print('FILE=' + file)
print('CUTOFF_ISO=' + cutoff.isoformat())
if handoff:
    print('HANDOFF=' + handoff + (' FRESH' if handoff_fresh else ' STALE'))
print('VIA=' + ('handoff' if handoff_fresh else via) + ' (' + how + ')')
"
```

- `NO_PREVIOUS_SESSION` → tell the user no previous session exists for this project and stop (offer minutes mode if they meant a different project's work).
- `HANDOFF=… FRESH` (printed with `VIA=handoff`) → the previous session left a **checkpoint handoff note**: read that file and treat it as the PRIMARY recovery content. It replaces the transcript deep-read — **skip Step 4 entirely** (nothing is extracted, so there is no temp file and `--show` has nothing to open; say so in one line if it was passed). Cross-check it against reality before acting on it — `git status --short` and `git log --oneline -10` — because the note states intent at write time and work may have landed since. Store `$SID` and go to Step 5, reporting `VIA=handoff`.
- `HANDOFF=… STALE` → the transcript kept moving for more than 3 minutes after the note was written, so the note is missing its own tail. Read it anyway, then ALSO run Step 4 with `$CUTOFF_ISO`: the note is the frame (what was done / next), the walk-back is the tail. `VIA` stays whatever the ladder resolved.
- Otherwise store `$SID`, `$CUTOFF_ISO`, set `$FILES_TO_PARSE` to the `FILE=` path, note `VIA` for the confirmation, and skip to Step 4.

Caveat: the lineage registry makes auto mode terminal-accurate, and the fallback skips sessions that look LIVE (another terminal's current occupant with transcript/glyph activity in the last 3 min). Residual: a twin that has been quiet longer than 3 min can still be picked — if the result looks like the wrong session, rerun with `pid=N` or minutes mode.

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

Skip this step entirely when Step 2c reported `HANDOFF=… FRESH` — the handoff note already says what the walk-back would be inferring, and extracting on top of it just pays for the transcript twice. A `STALE` handoff still runs it.

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
- Auto mode, fresh handoff (Step 4 was skipped — read the note itself instead of a temp file): **Recovered your last session's checkpoint handoff ({first 8 chars of SID}, via handoff) — no transcript replay needed.**
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
