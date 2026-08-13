#!/usr/bin/env python3
"""One-shot recovery probe for /continue and /recover-context auto mode.

WHY THIS EXISTS
---------------
Recovery used to be five to eight SEPARATE command steps -- resolve the previous
session, read its title history, grep for Ledger-bearing plan docs, tiebreak
against the transcript tail, re-resolve the session with the full heuristics,
run the sibling gate, extract. Every one of them is a pure filesystem read whose
output does not change what the next one does; they were separate round trips
only because the command doc wrote them as separate prose steps.

Recovery cost is `round_trips x resident_context`, so that structure -- not the
imported payload -- was the whole bill. Measured 2026-08-07 across 245 real
/continue sessions: the extracted payload is ~700 tokens at p50 (7 messages),
while the recovery PHASE cost ~1.13M tokens over ~15 round trips. Collapsing the
probes into one process is worth ~900k tokens per /continue.

WHAT IT DOES NOT DO
-------------------
It reports facts and never decides. The clean-handoff / mid-flight call, the
plan-vs-git reconciliation, and whether to stand down for a sibling all stay
with the model, because those carry nuance the command docs spell out (a Ledger
entry with no hash still counts as ledgered; a gitignored plan skips Ledger-only
commits). This script just makes all the evidence arrive in one round trip.

Usage (from the project root):
    python3 .claude/scripts/recover-session.py             # auto mode
    python3 .claude/scripts/recover-session.py --pid 3     # token-guard pointer
    python3 .claude/scripts/recover-session.py --minutes 60
    python3 .claude/scripts/recover-session.py --no-plan-probe

Prints ONE json object to stdout. Writes the extracted context to
<tmp>/recovered-context.json -- always this run's content, so the stale-leftover
hazard the command docs warn about cannot occur. `readTempFile` says whether the
caller should actually open it.
"""

import argparse
import glob
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

PROJECTS = os.path.expanduser('~/.claude/projects')
TITLES_REL = os.path.join('.claude', 'hooks', '.titles')
POINTER_REL = os.path.join('.claude', 'hooks', '.token-guard', 'recover.json')
PLAN_DIRS = ['docs', '.claude/plans']
LIVENESS_SECS = 180        # same bar as the dupe-session guard
HANDOFF_DRIFT = 180        # note is STALE if the transcript ran on past it
MAX_EXTRACT_TOKENS = 3000  # payload ceiling -- see cap_to_budget()
MIN_EXTRACT_MSGS = 4       # ...never trimmed below this, however long the messages
STOP_WORDS = {'plan', 'plans', 'doc', 'docs', 'the', 'and', 'for', 'with'}
SUBSTEP_RE = re.compile(r'^#{2,4}\s+([☑☐])\s*(.*)$')      # ☑ / ☐
TRAP_RE = re.compile(r'^#{1,4}.*⛔')                            # ⛔ heading


def iso(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00'))


def read_json(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def toks(s):
    return {w for w in re.split(r'[^a-z0-9]+', (s or '').lower())
            if len(w) > 2 and w not in STOP_WORDS}


def git(*args):
    try:
        r = subprocess.run(['git'] + list(args), capture_output=True, text=True, timeout=15)
        return r.stdout.strip() if r.returncode == 0 else ''
    except Exception:
        return ''


def search_roots():
    """CWD, then the MAIN checkout when CWD is a git worktree, then home.

    `.titles/` and `.token-guard/` are gitignored, so a worktree has neither --
    only the main checkout does. Resolving CWD alone (what the inline probes did)
    silently loses lineage, title history and the token-guard pointer for every
    session run from a worktree, which is most of them in a parallel-session repo:
    auto mode then drops to the newest-other-transcript rung and the plan alias
    match sees an empty title. Measured 2026-08-07 in job-agent-extension.
    """
    roots, seen = [], set()
    for r in ['.', main_checkout(), os.path.expanduser('~')]:
        if not r:
            continue
        key = os.path.normcase(os.path.abspath(r))
        if key not in seen:
            seen.add(key)
            roots.append(r)
    return roots


def main_checkout():
    common = git('rev-parse', '--path-format=absolute', '--git-common-dir').replace('\\', '/')
    if common.endswith('/.git'):
        return common[:-len('/.git')]
    return None


ROOTS = search_roots()
TITLES_DIRS = [os.path.join(r, TITLES_REL) for r in ROOTS]
# Home holds no per-project token-guard state, so the pointer stops at the repo tiers.
POINTERS = [os.path.join(r, POINTER_REL) for r in ROOTS[:2]]


# --------------------------------------------------------------------------
# Resolve the previous session  (recover-context Step 2c, verbatim semantics)
# --------------------------------------------------------------------------

def transcript_for(sid):
    hits = glob.glob(os.path.join(PROJECTS, '*', sid + '.jsonl'))
    return hits[0] if hits else None


def glyph_mtime(sid, floor=0.0):
    m = floor
    for d in TITLES_DIRS:
        g = os.path.join(d, sid + '.glyph')
        if os.path.exists(g):
            m = max(m, os.path.getmtime(g))
    return m


def is_closed(sid, activity):
    """session-close.js stamps {sid}.closed on every orderly SessionEnd, so a
    marker at-or-after the last activity is proof of death -- release the session
    immediately instead of waiting out the liveness window (a just-finished
    headless run, or a tab closed seconds ago, is otherwise invisible to recovery
    for LIVENESS_SECS). A marker OLDER than the activity means the session was
    resumed after closing -- still live. The 2s grace absorbs same-moment write
    ordering at SessionEnd; no marker (a kill, or a user install without the
    dev-only hook) falls back to quiescence."""
    for d in TITLES_DIRS:
        c = os.path.join(d, sid + '.closed')
        if os.path.exists(c) and os.path.getmtime(c) >= activity - 2:
            return True
    return False


def resolve_previous(sid_now):
    prev = how = None
    if sid_now:
        for d in TITLES_DIRS:
            f = os.path.join(d, sid_now + '.lineage.json')
            if os.path.exists(f):
                prev = (read_json(f) or {}).get('prevSid')
                if prev:
                    how = 'terminal lineage'
                break

    path = transcript_for(prev) if prev else None
    if path:
        return prev, path, how

    proj = re.sub(r'[^A-Za-z0-9]', '-', os.getcwd())
    files = sorted(glob.glob(os.path.join(PROJECTS, proj, '*.jsonl')),
                   key=os.path.getmtime, reverse=True)
    files = [p for p in files if os.path.splitext(os.path.basename(p))[0] != sid_now]

    # Live-twin filter: another terminal's CURRENT occupant that showed activity
    # inside the liveness window is a running session, never this tab's dead
    # predecessor. Quiet occupants stay eligible so a closed tab is recoverable.
    occupied = set()
    for d in TITLES_DIRS:
        for tf in glob.glob(os.path.join(d, 'terminals', '*.json')):
            s = (read_json(tf) or {}).get('sid')
            if s and s != sid_now:
                occupied.add(s)

    def is_live(p):
        s = os.path.splitext(os.path.basename(p))[0]
        if s not in occupied:
            return False
        act = glyph_mtime(s, os.path.getmtime(p))
        return not is_closed(s, act) and time.time() - act < LIVENESS_SECS

    files = [p for p in files if not is_live(p)]
    if not files:
        return None, None, None
    path = files[1] if (not sid_now and len(files) > 1) else files[0]
    return os.path.splitext(os.path.basename(path))[0], path, 'newest-other transcript'


# --------------------------------------------------------------------------
# Cutoff ladder + checkpoint handoff
# --------------------------------------------------------------------------

def last_title_entry(sid):
    for d in TITLES_DIRS:
        h = os.path.join(d, sid + '.history.jsonl')
        if not os.path.exists(h):
            continue
        lines = [l for l in open(h, encoding='utf-8', errors='replace') if l.strip()]
        for line in reversed(lines):
            try:
                return json.loads(line)
            except Exception:
                continue
        return None
    return None


def find_handoff(sid, last_ts):
    """mtime is the freshness authority -- the note's own first line is model-written."""
    for d in TITLES_DIRS:
        p = os.path.join(d, sid + '.handoff.md')
        if os.path.exists(p):
            fresh = os.path.getmtime(p) >= last_ts.timestamp() - HANDOFF_DRIFT
            return p.replace('\\', '/'), fresh
    return None, False


def read_pointer():
    for p in POINTERS:
        rec = read_json(p)
        if rec:
            return rec
    return None


def compute_cutoff(sid, stamps, title_entry):
    # a. token-guard pointer for this sid: frozen at idle-fire time.
    rec = read_pointer()
    if rec:
        for e in [rec] + (rec.get('history') or []):
            if e.get('sid') == sid and e.get('cutoffIso'):
                return iso(e['cutoffIso']), 'pointer pid=%s' % e.get('pid')

    # b/c. Walk back over >=15min of REAL interaction (idle gaps capped at 5min).
    i, acc = len(stamps) - 1, timedelta()
    while i > 0 and acc < timedelta(minutes=15):
        acc += min(stamps[i] - stamps[i - 1], timedelta(minutes=5))
        i -= 1
    walkback = stamps[i]

    # ...widened to the start of the final use-case thread when the title knows it.
    thread = None
    if title_entry and title_entry.get('ts'):
        try:
            thread = iso(title_entry['ts'])
        except Exception:
            thread = None

    cut = min(thread, walkback) if thread else walkback
    via = 'title-thread' if (thread and thread < walkback) else 'walk-back'

    floor = stamps[-1] - timedelta(minutes=60)      # marathon guard
    if cut < floor:
        cut, via = floor, via + ', capped at 60min'
    return cut, via


# --------------------------------------------------------------------------
# Plan probe + gate evidence
# --------------------------------------------------------------------------

def ledger_plans():
    out = []
    for d in PLAN_DIRS:          # BOTH -- .claude/plans is often gitignored
        for p in sorted(glob.glob(os.path.join(d, '*.md'))):
            try:
                with open(p, encoding='utf-8', errors='replace') as f:
                    if re.search(r'^## Ledger', f.read(), re.M):
                        out.append(p.replace('\\', '/'))
            except Exception:
                pass
    return out


def plan_candidates(title, plans, tail_text, mentions):
    """Evidence per plan doc -- title-alias overlap, plus whether it was OPENED."""
    scope = toks((title or '').split('—')[0])
    out = []
    for p in plans:
        base = os.path.basename(p)
        shared = sorted(toks(base) & scope)
        m = mentions.get(base, {})
        if not (shared or m.get('opened')):
            continue
        out.append({'doc': p, 'sharedTokens': shared,
                    'opened': bool(m.get('opened')), 'inTail': base in tail_text})
    return out


def pick_plan(cands):
    """A shared WORD alone is not evidence, so demand corroboration.

    '/Continue command — Cut recovery over-import' shares "continue" with
    clear-and-continue-refinements-plan.md while executing no plan whatsoever,
    and the alias-only rule matched it (measured 2026-08-07). That false positive
    is expensive in one direction only: declaring a plan SHRINKS the recovery
    window to ten minutes, so the real context is thrown away and the model may
    open an unrelated substep. A false negative just costs an ordinary transcript
    recovery. So bias hard toward "not plan-driven" and let the model escalate
    from planCandidates, which is always reported.

    A session executing a substep necessarily OPENS its plan doc -- it reads the
    trap section and appends a Ledger entry -- so a file_path hit anywhere in the
    transcript is the signal that actually separates the two cases, and it beats
    token overlap outright: two token-guard-* plans tie on {token, guard} while
    only one of them was ever read.
    """
    opened = [c for c in cands if c['opened']]
    if len(opened) == 1:
        return opened[0]['doc'], 'opened in transcript'
    if opened:
        return None, None                      # genuinely ambiguous -- do not guess
    aliased = [c for c in cands if len(c['sharedTokens']) >= 2]
    if len(aliased) == 1:
        return aliased[0]['doc'], 'title alias (%s)' % '+'.join(aliased[0]['sharedTokens'])
    return None, None


def plan_slices(plan_doc):
    """Line ranges so the caller reads the plan in SLICES, never whole."""
    try:
        lines = open(plan_doc, encoding='utf-8', errors='replace').read().splitlines()
    except Exception:
        return {}
    total = len(lines)
    heads = [i for i, l in enumerate(lines) if l.startswith('#')]

    def next_head(i):
        return next((h for h in heads if h > i), total)

    trap = None
    for i, l in enumerate(lines):
        if TRAP_RE.match(l):
            trap = [i + 1, next_head(i)]
            break

    substeps, first_unchecked = [], None
    for i, l in enumerate(lines):
        m = SUBSTEP_RE.match(l)
        if not m:
            continue
        done = m.group(1) == '☑'
        substeps.append({'line': i + 1, 'done': done, 'title': m.group(2).strip()[:90]})
        if not done and first_unchecked is None:
            first_unchecked = [i + 1, next_head(i)]

    ledger = None
    for i, l in enumerate(lines):
        if re.match(r'^## Ledger', l):
            ledger = [max(i + 1, total - 79), total]      # tail only
            break

    return {'totalLines': total, 'trapSection': trap, 'nextSubstep': first_unchecked,
            'ledgerTail': ledger, 'substeps': substeps,
            'substepsDone': sum(1 for s in substeps if s['done']),
            'substepsTotal': len(substeps)}


def live_siblings(plan_doc, sid_now):
    """Another terminal already resumed this plan? The Ledger cannot see it."""
    want = toks(os.path.basename(plan_doc))
    hits = {}
    for d in TITLES_DIRS:
        for g in glob.glob(os.path.join(d, '*.glyph')):
            sid = os.path.basename(g)[:-6]
            if sid == sid_now or sid in hits:
                continue
            gm = os.path.getmtime(g)
            if time.time() - gm > LIVENESS_SECS or is_closed(sid, gm):
                continue
            title = ((last_title_entry(sid) or {}).get('title') or '').strip()
            if toks(title.split('—')[0]) & want:
                try:
                    glyph = open(g, encoding='utf-8', errors='replace').read().strip()
                except Exception:
                    glyph = '?'
                hits[sid] = {'sid': sid[:8], 'glyph': glyph, 'title': title}
    return list(hits.values())


# --------------------------------------------------------------------------
# Extract
# --------------------------------------------------------------------------

def clip_middle(text, budget):
    """Keep a long message's head and tail, elide the middle. Head-heavy: a dump's
    opening says what it is, its last lines say where it ended."""
    lim = budget * 4
    if len(text) <= lim:
        return text
    return '%s\n\n... [%d tokens elided] ...\n\n%s' % (
        text[:lim * 2 // 3], (len(text) - lim) // 4, text[-(lim // 3):])


def cap_to_budget(results, budget=MAX_EXTRACT_TOKENS, floor=MIN_EXTRACT_MSGS):
    """Bound the payload: clip oversized messages, then drop OLDEST ones until it
    fits `budget`. Returns (kept, {'droppedOlder': n, 'clipped': m}).

    Every other guard here measures TIME -- the 15min walk-back, the 60min marathon
    floor, the title-thread widening -- and time is the wrong dimension. A dense,
    fast session never trips the 60min floor, so a title that never shifted (the
    compass is SUPPOSED to change rarely) reaches back over the entire session.
    Measured 2026-08-07 across 363 job-agent-extension sessions: the payload is
    660 tok at p50 and 2,580 at p90, but one 43-minute session extracted 156,512 --
    a 5,000x overrun no time-based cap can see. At 3k the cap leaves 95% of real
    recoveries byte-identical.

    ⛔ Message-count trimming ALONE does not bound this, and the floor is why: that
    same session's 156k sat in FOUR messages, so `floor` (rightly) kept all of them
    and dropping did nothing. One pasted dump always defeats a count. So when the
    floor binds, the survivors get clipped to an equal share of what is left.

    Clipping runs LAST, and only then, on purpose: a payload already inside the
    budget is returned byte-identical. Clipping every long message up front instead
    (a fixed per-message ceiling) altered 32% of real sessions to fix the 5% that
    were actually over -- measured, then rejected.

    Oldest-first because recovery reads BACKWARD: the tail is the in-flight work,
    the head is context the resumed session can re-derive from git if it matters.
    """
    est = [len(r['text']) // 4 for r in results]
    total, i = sum(est), 0
    while total > budget and len(results) - i > floor:
        total -= est[i]
        i += 1

    kept, clipped = results[i:], 0
    if total > budget and kept:
        share = max(1, budget // len(kept))
        for r in kept:
            short = clip_middle(r['text'], share)
            if short != r['text']:
                r['text'], clipped = short, clipped + 1
    return kept, {'droppedOlder': i, 'clipped': clipped}


def extract(paths, cutoff):
    results = []
    for path in paths:
        with open(path, encoding='utf-8', errors='replace') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                t = obj.get('type')
                if t not in ('user', 'assistant'):
                    continue
                ts = obj.get('timestamp')
                if not ts:
                    continue
                try:
                    if iso(ts) < cutoff:
                        continue
                except Exception:
                    continue

                content = (obj.get('message', {}) or {}).get('content', '')
                text = ''
                if t == 'user':
                    if isinstance(content, str):
                        text = content
                    elif isinstance(content, list):
                        if any(isinstance(c, dict) and c.get('type') == 'tool_result'
                               for c in content):
                            continue
                        text = ' '.join(c.get('text', '') for c in content
                                        if isinstance(c, dict) and c.get('type') == 'text')
                elif isinstance(content, list):
                    text = '\n'.join(c.get('text', '') for c in content
                                     if isinstance(c, dict) and c.get('type') == 'text')

                if not text.strip():
                    continue
                results.append({'parentUuid': obj.get('parentUuid', ''), 'type': t,
                                'timestamp': ts, 'text': text.strip()})

    results.sort(key=lambda r: r['timestamp'])
    results, capped = cap_to_budget(results)
    tmp = os.path.join(tempfile.gettempdir(), 'recovered-context.json')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    return results, tmp, capped


def stamps_and_tail(path, needles=()):
    """One pass: timestamps, the last 100 raw lines, and which needles were OPENED.

    "Opened" means the name showed up in a tool_use path argument -- a Read, Edit
    or Write of that file -- as opposed to merely being printed by some `ls` or
    grep, which is how a session that never touched a plan doc still mentions one.
    """
    stamps, tail, mentions = [], [], {}
    # Anchor each needle to a path boundary: one plan basename is often a SUFFIX of
    # another (settings-db-migration-plan.md ends with db-migration-plan.md), and a
    # bare substring test would credit both docs with the same open.
    pats = {n: re.compile(r'"(?:file_path|notebook_path|path)"\s*:\s*"(?:[^"]*[\\/])?'
                          + re.escape(n) + r'"') for n in needles}
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            tail.append(line)
            if len(tail) > 100:
                tail.pop(0)
            for n in needles:
                if n in line:
                    m = mentions.setdefault(n, {'anywhere': 0, 'opened': False})
                    m['anywhere'] += 1
                    if not m['opened'] and pats[n].search(line):
                        m['opened'] = True
            try:
                t = json.loads(line).get('timestamp')
            except Exception:
                continue
            if t:
                try:
                    stamps.append(iso(t))
                except Exception:
                    pass
    return stamps, '\n'.join(tail), mentions


# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pid', type=int)
    ap.add_argument('--minutes', type=int)
    ap.add_argument('--no-plan-probe', action='store_true')
    args = ap.parse_args()

    sid_now = os.environ.get('CLAUDE_CODE_SESSION_ID', '')

    # ---------- minutes mode ----------
    if args.minutes:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=args.minutes)
        files = sorted(glob.glob(os.path.join(PROJECTS, '*', '*.jsonl')),
                       key=os.path.getmtime, reverse=True)[:20]
        needed = []
        for p in files:                       # lazy probe: stop once covered
            st, _, _ = stamps_and_tail(p)
            if not st:
                continue
            needed.append(p)
            if st[0] <= cutoff:
                break
        if not needed:
            print(json.dumps({'error': 'NO_TRANSCRIPTS'}))
            return
        res, tmp, capped = extract(needed, cutoff)
        out = {'mode': 'minutes', 'minutes': args.minutes,
               'cutoffIso': cutoff.isoformat(), 'sessions': len(needed),
               'messages': len(res),
               'tokens': sum(len(r['text']) for r in res) // 4,
               'tempFile': tmp, 'readTempFile': True}
        out.update(capped)
        print(json.dumps(out, indent=2))
        return

    # ---------- pointer mode ----------
    if args.pid:
        rec = read_pointer()
        if not rec:
            print(json.dumps({'error': 'NO_POINTER_FILE'}))
            return
        entries = [rec] + (rec.get('history') or [])
        hit = next((e for e in entries if e.get('pid') == args.pid), None)
        if hit is None:
            print(json.dumps({'error': 'PID_NOT_FOUND',
                              'available': [e.get('pid') for e in entries if e.get('pid')]}))
            return
        sid = hit['sid']
        cutoff_iso = hit.get('cutoffIso')
        if not cutoff_iso:
            written = datetime.fromtimestamp(hit.get('writtenAt', 0) / 1000, tz=timezone.utc)
            cutoff_iso = (written - timedelta(minutes=hit.get('minutes', 15))).isoformat()
        path = transcript_for(sid)
        if not path:
            print(json.dumps({'error': 'TRANSCRIPT_GONE', 'sid': sid}))
            return
        stamps, tail, mentions = stamps_and_tail(path)
        plans = []
        out = {'mode': 'pointer', 'pid': args.pid}
        cutoff, via, how = iso(cutoff_iso), 'pointer pid=%s' % args.pid, 'pointer'
        title_entry = last_title_entry(sid)
    else:
        # ---------- auto mode ----------
        out = {'mode': 'auto'}
        sid, path, how = resolve_previous(sid_now)
        if not sid or not path:
            print(json.dumps({'error': 'NO_PREVIOUS_SESSION'}))
            return
        # Plan basenames are needles for the single transcript pass below, so the
        # "was it OPENED" evidence costs no extra read.
        plans = [] if args.no_plan_probe else ledger_plans()
        stamps, tail, mentions = stamps_and_tail(path, [os.path.basename(p) for p in plans])
        if not stamps:
            print(json.dumps({'error': 'NO_PREVIOUS_SESSION', 'sid': sid}))
            return
        title_entry = last_title_entry(sid)
        cutoff, via = compute_cutoff(sid, stamps, title_entry)

    title = (title_entry or {}).get('title', '') or ''
    out.update({'sid': sid, 'sidShort': sid[:8], 'file': path.replace('\\', '/'),
                'how': how, 'lastTitle': title})

    # ---------- checkpoint handoff (a CONTENT source, above the ladder) ----------
    handoff, handoff_fresh = find_handoff(sid, stamps[-1])
    if handoff:
        out['handoff'] = handoff
        out['handoffState'] = 'FRESH' if handoff_fresh else 'STALE'
        if handoff_fresh:
            via = 'handoff'

    # ---------- plan probe ----------
    plan_doc = None
    if out['mode'] == 'auto' and plans:
        cands = plan_candidates(title, plans, tail, mentions)
        plan_doc, why = pick_plan(cands)
        out['planDriven'] = bool(plan_doc)
        out['planCandidates'] = cands          # always: the model can overrule a miss
        if not plan_doc:
            out['planDocsFound'] = len(plans)
        else:
            out['planDoc'] = plan_doc
            out['planMatchedVia'] = why
            out['plan'] = plan_slices(plan_doc)
            out['git'] = {'log': git('log', '--oneline', '-15').splitlines(),
                          'statusShort': git('status', '--short').splitlines()}
            sibs = live_siblings(plan_doc, sid_now)
            out['liveSiblings'] = sibs
            out['siblingGate'] = 'STOP' if sibs else 'CLEAR'
            # NO window shrink on a plan match, deliberately. The command docs treat
            # the Ledger as the handoff and the transcript as mere colour, which is
            # true -- but the extracted payload is ~700 tokens at p50, so shrinking it
            # saves noise while a MIS-matched plan would delete the only record of what
            # the session was actually doing. Asymmetric bet, declined: the model gets
            # the plan slices AND the normal walk-back, and decides for itself.

    out['cutoffIso'] = cutoff.isoformat()
    out['via'] = via

    res, tmp, capped = extract([path], cutoff)
    if capped['droppedOlder'] or capped['clipped']:
        # The window the time-based cutoff picked was too wide; say so, because the
        # extract is now a TAIL and the model must not read it as the whole thread.
        out['via'] += ', size-capped at %d tok' % MAX_EXTRACT_TOKENS
    out.update({'messages': len(res),
                'tokens': sum(len(r['text']) for r in res) // 4,
                'tempFile': tmp,
                # A fresh note already says what the walk-back would infer.
                'readTempFile': not (handoff and handoff_fresh)})
    out.update(capped)
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:                     # never hard-fail the command
        print(json.dumps({'error': 'PROBE_FAILED', 'detail': str(exc)}))
        sys.exit(0)
