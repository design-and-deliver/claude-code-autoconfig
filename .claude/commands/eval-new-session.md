<!-- @description Evaluates the merit of spinning the current conversation out into a fresh session, and if worth it, preps the spinout: recovery window + handoff notes + a one-command /migrate-new-session manifest. -->
<!-- @version 5 -->
<!-- @param --cut | flag | optional | Skip the merit verdict and go straight to handoff prep. -->
<!-- @response cut | Verdict CUT — handoff file written; exact recover commands printed. -->
<!-- @response stay | Verdict STAY — reason plus what would flip it. -->
<!-- @sideeffect Reads this session's .jsonl transcript; runs git status; writes .claude/handoff/<sid8>-<stamp>.md -->
<!-- @example /eval-new-session | Evaluate, and prep only if worth it -->
<!-- @example /eval-new-session --cut | Prep the spinout without the debate -->

Evaluate whether cutting over to a fresh session is worth it (killing the per-turn rent on
resolved context), and if so, prep everything the new session needs to spin out effectively.

Companion to token-guard and `/recover-context`: the guard says *you should move*, this skill
decides **if** and preps the move. Everything runs in ONE turn — no subagents, no re-reading
the conversation from disk (it is already in your context).

## Step 1: Measure (deterministic, cheap)

Find this session's transcript — the most recently modified `.jsonl` for this project
(`~/.claude/projects/<slug>/`, slug = cwd with separators mapped to `-`; with concurrent
sessions the newest is still this one, since this very prompt just appended to it). Then run,
substituting the path:

```bash
node -e "
const fs=require('fs');
const p=process.argv[1];
const ts=[];let last=null;
for(const line of fs.readFileSync(p,'utf8').split('\n')){
  if(!line.trim())continue;let o;try{o=JSON.parse(line)}catch(_){continue}
  if(o&&o.type==='assistant'&&o.message&&o.message.usage){last=o.message.usage;
    const t=Date.parse(o.timestamp||'');if(t)ts.push(t);}
}
const live=last?(last.input_tokens||0)+(last.cache_read_input_tokens||0)+(last.cache_creation_input_tokens||0):0;
let i=ts.length-1;
for(let acc=0;i>0&&acc<15*60000;i--)acc+=Math.min(ts[i]-ts[i-1],5*60000);
const rec=Math.max(5,Math.ceil((Date.now()-(ts[i]||Date.now()))/300000)*5);
console.log(JSON.stringify({liveContextTokens:live,recoverMinFallback:rec,sid8:require('path').basename(p).slice(0,8)}));
" "<transcript-path>"
```

Also run `git status --short` (for the uncommitted-files list).

## Step 2: Judge the merit (skip when `--cut` was passed)

From the conversation already in your context, judge:

1. **Where does the active thread start?** Everything before it is rent.
2. **What share of live context is resolved back-and-forth** (settled decisions now captured in
   files, demos, dead ends)?
3. **Is anything mid-flight that genuinely needs the deep context** (an unresolved discussion
   that keeps referencing old turns)?

Verdict **STAY** when live context is under ~100k, or the active thread spans most of the
session, or mid-flight work would be crippled by the cut. Otherwise **CUT**.

If STAY: print one line — verdict, reason, and what would flip it — and stop.

## Step 3: Pick the recovery window

Deterministic source first (@v5): read `.claude/hooks/.titles/<full-session-id>.history.jsonl`
— terminal-title appends one line per tab-title change; scope = segment 1 of each `title`
(before the first ` — `). The `ts` of the last line whose scope segment DIFFERS from the line
before it is the moment the session's current scope began; when it plausibly matches your
judged thread start, that timestamp IS the boundary. Otherwise prefer your judged thread
boundary, expressed as wall-clock minutes back from now, rounded up to the nearest 5. Fall back
to `recoverMinFallback` (the ~15-min-of-interaction walk) when the boundary is fuzzy. Call it
`N` (or carry the timestamp straight into `boundaryIso`).

## Step 4: Write the supplemental handoff file

Write `.claude/handoff/<sid8>-<yyyymmdd-hhmm>.md` (create the directory; ensure
`.claude/handoff/` is gitignored — append to `.gitignore` if missing). Capture ONLY what the
recovered transcript tail will NOT carry — `/recover-context` migrates message text, not tool
state:

```markdown
# Handoff from session <sid8> — <date>

## Active task & current state
## Decisions made this session, not yet reflected in repo docs
## Files touched (note uncommitted ones, from git status)
## Temp state & gotchas (rigged configs, armed one-shots, reverted-or-not)
## Next actions
```

Terse bullets. Facts, not narrative.

## Step 4.5: Write the migration manifest

Pick a `shortname`: a memorable 1-2 word slug for the active task (e.g. `guard-ux`). Write
`.claude/handoff/<shortname>.manifest.json`:

```json
{
  "shortname": "...",
  "sid8": "...",
  "sessionId": "<full session id>",
  "boundaryIso": "<thread-boundary timestamp, i.e. now minus N minutes, ISO-8601>",
  "handoffFile": ".claude/handoff/<handoff filename>",
  "createdIso": "<now, ISO-8601>"
}
```

`boundaryIso` is absolute so `/migrate-new-session` can recompute the window at migrate time —
a delay between eval and migrate never stales it.

## Step 5: Print the cutover card

UX-y, conversational, no jargon, no dollar figures (subscription users read $ as real charges):

> ℹ️ **Migrate to a new session? Yeah, here's why you should:**
> This thread holds ~{live}k of context, but only the last ~{keep}k is still relevant — the
> rest is settled work you're re-paying for on every turn. Migrating cuts your token cost
> ~{X}× per turn.
>
> In a **new session**, type: `/migrate-new-session {shortname}`

Do NOT start the new session or /clear yourself — the user runs the cutover.
