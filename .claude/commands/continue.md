<!-- @description Continues where your previous session in this terminal left off — recovers its context and resumes the work. Plan-aware: if that session was executing a substep of a plan doc, resumes from the plan's Ledger instead of the transcript. -->
<!-- @version 7 -->
<!-- @param --show | flag | optional | Opens the recovered transcript in your default editor (no-op on a clean plan handoff or a fresh checkpoint handoff note — nothing is extracted). -->
<!-- @response success | Picking up where we left off — {what we were doing}. Then the work resumes. -->
<!-- @response plan | Picking up where we left off — {plan alias}: substep {N.k} done ({hash}); starting {next}. Then the next substep runs. -->
<!-- @response no-previous | I can't find a previous session for this terminal. -->
<!-- @sideeffect Reads .jsonl transcripts from ~/.claude/projects/, writes temp file — both skipped on a clean plan handoff or a fresh checkpoint handoff note -->
<!-- @example /continue | Recover the previous session here and resume its work -->
Continue where the previous session in this terminal left off.

This is the no-ceremony wrapper around `/recover-context`'s auto mode: recover the last
session's context (when the transcript is actually needed), then RESUME the work — unlike
`/recover-context`, which recovers and waits for direction. No arguments; it figures
everything out itself.

It is also **plan-aware**: when the previous session was executing a substep of a phased
plan doc (the plan-authoring pattern — a `docs/*.md` or `.claude/plans/*.md` with a
`## Ledger` section), the plan doc + Ledger is the handoff, not the transcript. On a
**clean handoff** (last substep committed + ledgered, tree clean) transcript recovery is
skipped ENTIRELY — the plan doc + git is the whole handoff — so `/clear` → `/continue`
between plan substeps costs a sliver, not a recovery. That is why the steps below probe
for a plan BEFORE recovering anything.

## Step 1: Find the previous session (cheap — no recovery yet)

Do NOT read recover-context.md yet — a clean plan handoff never needs it. Resolve just the
previous session's id and transcript, from the project root:

```bash
python3 -c "
import glob, json, os, re, sys
sid_now = os.environ.get('CLAUDE_CODE_SESSION_ID', '')
prev = None
for d in ['.claude/hooks/.titles', os.path.expanduser('~/.claude/hooks/.titles')]:
    f = os.path.join(d, sid_now + '.lineage.json')
    if sid_now and os.path.exists(f):
        try:
            prev = json.load(open(f, encoding='utf-8')).get('prevSid')
        except Exception:
            prev = None
        break
file = None
if prev:
    hits = glob.glob(os.path.expanduser('~/.claude/projects/*/' + prev + '.jsonl'))
    file = hits[0] if hits else None
if not file:
    proj = re.sub(r'[^A-Za-z0-9]', '-', os.getcwd())
    tdir = os.path.expanduser('~/.claude/projects/' + proj)
    files = sorted(glob.glob(os.path.join(tdir, '*.jsonl')), key=os.path.getmtime, reverse=True)
    files = [p for p in files if os.path.splitext(os.path.basename(p))[0] != sid_now]
    if not files:
        print('NO_PREVIOUS_SESSION'); sys.exit(0)
    file = files[0]
    prev = os.path.splitext(os.path.basename(file))[0]
print('SID=' + prev)
print('FILE=' + file)
"
```

This is the SID-only sliver of recover-context's Step 2c: terminal lineage first (the
terminal-title hook stamps `{sid}.lineage.json` on every SessionStart), newest-other-
transcript fallback. No cutoff ladder, no live-twin filter — if the flow falls back to
full recovery below, recover-context re-resolves with the stronger heuristics.

- `NO_PREVIOUS_SESSION` → say "I can't find a previous session for this terminal." and
  suggest `/recover-context -60` for time-window recovery instead — then stop.
- Otherwise store `$SID` and `$FILE` (its transcript).

## Step 2: Plan probe — was that session executing a plan substep?

Two cheap probes BEFORE recovering anything:

1. **Last title**: read the final line of `.claude/hooks/.titles/{$SID}.history.jsonl`
   (fall back to `~/.claude/hooks/.titles/`). Plan-driven sessions title as
   `{plan alias} — {area} — {goal}`.
2. **Plan docs**: list the plan docs — `grep -l '^## Ledger' docs/*.md .claude/plans/*.md
   2>/dev/null` (no hits in either place → not plan-driven). `.claude/plans/` is typically
   gitignored — a plan doc there still counts, and its edits will NOT show in `git status`.

**Plan-driven** = a Ledger-bearing plan doc exists AND the last title's first segment reads
as an alias of that doc (the alias's words appear in the doc's filename or title). If the
title is missing, ambiguous, or matches NO plan doc, do not conclude "not plan-driven" yet —
tiebreak by grepping `$FILE`'s final ~100 lines for each plan doc's filename (an Edit/Write
touching a plan doc there is decisive: that session WAS plan-driven; sessions don't always
title by the plan-alias convention). Only when both probes and the tiebreak come up empty is
the session NOT plan-driven — then skip to Step 4 (full recovery).

## Step 3: Plan gate — clean handoff or mid-flight?

Read the plan doc **in slices, never whole** — a mature plan runs 800+ lines and more than half
of that is Ledger, which a full read makes resident for every remaining request in the session.
Take exactly three slices:

- the **⛔ standing trap warnings** (the plan's header names their line range),
- the **substep checklist** — `grep -n '^#\{2,4\} [☑☐]' <plan>` for the map, then read only the
  next unchecked substep's body,
- the **Ledger tail** — `tail -80 <plan>`, not the whole section.

If the plan's header carries its own read-in-slices instruction (the plan-authoring convention),
follow that instead — it names exact ranges. Then reconcile three sources:

- the Ledger's latest entry (which substep, which commit hash),
- `git log --oneline -15` (does that hash exist? a Ledger entry with NO hash counts as
  ledgered — gitignored plans skip Ledger-only commits by design),
- `git status --short` (uncommitted work?).

**Clean handoff** (latest substep committed + ledgered, working tree clean — or every
substep already checked): the transcript is dead weight the Ledger already covers. Do NOT
read recover-context.md and do NOT extract anything (`--show` has nothing to show — say so
in one line if it was passed). Go straight to Step 6.

**Mid-flight** (uncommitted changes, a Ledger/git mismatch, or work done but its Verify /
commit / Ledger entry missing): the in-flight sliver lives only in the transcript — recover
it. Continue with Step 4.

## Step 3b: Concurrency gate — is a SIBLING session already on this plan?

⛔ **Run this before executing any substep.** A plan doc is a shared work queue with no
lock: nothing stops two terminals from resuming the same plan. The Ledger cannot protect
you here — it is written *after* a substep, so a sibling mid-substep is invisible in it by
construction, and a sibling that ran two substeps without ledgering the first makes the
Ledger actively wrong. The dupe-session guard does not cover this either: it keys on
*identical* titles, and two sessions routinely invent different aliases for the same plan
("Company Fields" vs "Company info plan"). So probe for a live sibling directly —
substituting the plan doc path resolved in Step 2:

```bash
python3 -c "
import glob, json, os, re, time
plan = '$PLAN_DOC'
sid_now = os.environ.get('CLAUDE_CODE_SESSION_ID', '')
STOP = {'plan','plans','doc','docs','the','and','for','with'}
def toks(s):
    return {w for w in re.split(r'[^a-z0-9]+', s.lower()) if len(w) > 2 and w not in STOP}
want = toks(os.path.basename(plan))
hits = {}
for d in ['.claude/hooks/.titles', os.path.expanduser('~/.claude/hooks/.titles')]:
    for g in glob.glob(os.path.join(d, '*.glyph')):
        sid = os.path.basename(g)[:-6]
        if sid == sid_now or sid in hits: continue
        if time.time() - os.path.getmtime(g) > 180: continue   # same liveness bar as the dupe guard
        title = ''
        h = os.path.join(d, sid + '.history.jsonl')
        if os.path.exists(h):
            lines = [l for l in open(h, encoding='utf-8', errors='replace') if l.strip()]
            if lines:
                try: title = json.loads(lines[-1]).get('title', '') or ''
                except Exception: pass
        if toks(title.split('—')[0]) & want:
            hits[sid] = (title.strip(), open(g, encoding='utf-8', errors='replace').read().strip())
for sid, (title, glyph) in hits.items():
    print('LIVE_SIBLING sid=%s glyph=%s title=%s' % (sid[:8], glyph, title))
print('NO_LIVE_SIBLING' if not hits else 'SIBLING_COUNT=%d' % len(hits))
"
```

The match is deliberately loose (any distinctive word shared between the sibling's title
scope and the plan's filename) — a false positive costs one sentence of reporting, a false
negative costs duplicated work and a merge conflict.

- `NO_LIVE_SIBLING` → proceed to Step 4/6 as resolved.
- One or more `LIVE_SIBLING` lines → **STOP. Do not execute a substep, do not edit the plan
  doc, do not touch the working tree.** Report: the sibling's sid, its title, and what git
  actually shows (`git log --oneline -5` and `git status --short`, in every repo the plan's
  phases commit to — a done substep's commit may live in another repo entirely). Then ask
  the user how to proceed rather than choosing for them; standing down is the default.

## Step 4: Full recovery (not plan-driven, or mid-flight)

Read `.claude/commands/recover-context.md` (fall back to `~/.claude/commands/recover-context.md`
if the project doesn't ship it) and run its **Step 2c** (auto mode) exactly as written — it
re-resolves the previous session with the full heuristics (live-twin filter, cutoff ladder);
trust its result over Step 1's if they differ. Store `$SID`, `$FILES_TO_PARSE` (the `FILE=`
path), and `$CUTOFF_ISO`.

If it reports no previous session: say "I can't find a previous session for this terminal." and
suggest `/recover-context -60` for time-window recovery instead — then stop.

**Checkpoint handoff (v8+ of recover-context):** its Step 2c now probes for
`.claude/hooks/.titles/{$SID}.handoff.md` first — the note token-guard's restart advisory asks a
session to write before a /clear (ISO timestamp, then `## Done` / `## In flight` / `## Next` /
`## Pointers`). This is the non-plan analogue of the Ledger, and it ranks the same way: on
`HANDOFF=… FRESH` (`VIA=handoff`) the note IS the recovery — read it, skip the extract, and
cross-check `git status --short` before acting, exactly as Step 3 reconciles a Ledger against git.
On `STALE` the note is the frame and the walk-back supplies the tail. Honor whichever the script
reports; do not extract on top of a fresh note.

When Step 2 found the session plan-driven, shrink the recovery window — the Ledger is the
handoff and the transcript is only color: raise `$CUTOFF_ISO` to (the transcript's last
timestamp − 10 minutes) if that is later than the resolved cutoff.

Then — unless a FRESH handoff was reported (the note replaced the extract; nothing new was
written) — run recover-context's **Step 4** (extract) with `$CUTOFF_ISO` and `$FILES_TO_PARSE`.
Honor `--show` via its Step 6. Do NOT use its Step 5 confirmation or Step 7 wait — /continue
replaces both below.

Read the extracted temp file and treat the recovered exchanges as your own memory of the
conversation you were just having with this user — not a document to summarize. On a fresh
handoff there is no temp file from THIS run — internalize the handoff note itself instead, and
never open a `recovered-context.json` left behind by an earlier recovery (the extract writes to
a fixed name and nothing cleans it up, so a leftover is always some other recovery's content).

## Step 5: Resume (ordinary session)

If Step 2 found the session plan-driven, use Step 6 instead.

Silently reconstruct from that memory: the active task and its state, the next action that was
in flight, and what was already completed. Before acting, cross-check reality — `git status
--short`, plus a quick look at any file the tail claims was mid-edit — the recovered tail may
predate work that already landed.

Then open your reply with exactly this line (bold, em-dash clause naming the work):

> **Picking up where we left off** — {one short clause: what we were doing}.

And continue, by ending state:

- **Work was mid-flight** (a task underway, a named next step): carry on with it now, under the
  same rules as any turn — proceed with reversible work; confirm first before anything
  destructive or outward-facing.
- **The session ended waiting on the user** (an open question, a pending decision): re-ask that
  question, refreshed with anything you can now verify yourself.
- **The work was finished**: say so in one line, then ask what's next.

Never re-do work the tail (or git) already shows as done.

## Step 6: Resume (plan-driven session)

The plan doc is already read, the Ledger/git reconciliation done (Step 3), and the
concurrency gate cleared (Step 3b — if it did not clear, you already stopped there). Open
your reply with the same line, plan-flavored:

> **Picking up where we left off** — {plan alias}: substep {N.k} done ({hash}); starting {N.next}.

Then act by Step 3's state:

- **Clean handoff**: execute the next unchecked substep start-to-finish per the plan doc —
  including its Verify step, its commit, and appending its Ledger entry. Close by prompting
  the user to `/clear` then `/continue`.
- **Mid-flight**: FINISH that substep — complete the work, run its Verify, commit, append the
  Ledger — then stop and prompt `/clear` + `/continue`. Do not also start the next substep.
- **Plan complete** (every substep checked): say so in one line, then ask what's next.

Traps: never re-do a substep the Ledger + git already show done; never run two substeps in
one session (one-substep-per-fresh-session is the plan's token-hygiene lever — and skipping
the intermediate Ledger entry is what makes the next session's handoff lie); where the doc
and the code disagree, trust git and fix the doc; a plan doc is a shared queue with no lock,
so Step 3b's gate is not optional.
