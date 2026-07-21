<!-- @description Completes a session migration — recovers the old session's conversation tail and its handoff, from one keyword. Works with a previously prepped handoff manifest OR self-packages from a bare scope keyword (e.g. one a scope-drift nudge printed). -->
<!-- @version 4 -->
<!-- @param keyword | string | required | Migration name from a prepped handoff manifest, OR the scope slug a /migrate-new-session {slug} drift-nudge printed. -->
<!-- @response success | Migrated {keyword}: ~{tokens} tokens recovered + handoff internalized. -->
<!-- @response self-packaged | No manifest for {keyword} — self-packaged from the title-ledger boundary of session {sid8}. -->
<!-- @sideeffect Reads .claude/handoff/*.manifest.json OR .claude/hooks/.titles/*.history.jsonl (terminal-title ledger); runs the recover-context extraction -->
<!-- @example /migrate-new-session guard-ux | A previously prepped handoff manifest -->
<!-- @example /migrate-new-session cca-distribution | No manifest — self-package from the scope keyword a drift nudge printed -->

Run this **in the new session**. It completes the cutover — no manual `/recover-context` args, no
manual handoff read. Two modes, auto-detected in Step 1.

## Step 1: Resolve the keyword — manifest first, else self-package

The keyword is: $ARGUMENTS (trim whitespace/flags). Look for `.claude/handoff/<keyword>.manifest.json`.

- **It exists → MANIFEST MODE.** Read its fields (`sid8`, `boundaryIso`, `handoffFile`) and use them
  for Steps 2–4 exactly as written.
- **It doesn't → SELF-PACKAGE MODE.** The keyword is a scope slug (e.g. the one a scope-drift nudge
  printed). There is no pre-written prep — derive it from the old session's terminal-title ledger
  (`.titles/{sid}.history.jsonl`, one line per title change). Run this to find the source session +
  boundary (collapses each ledger into scope tenures — scope = segment 1 of the title — and matches
  the keyword against them, slugified the same way the guard emits it; a just-born session whose
  first ledger line is under 10 minutes old is skipped, so the session you're running this in never
  matches its own baseline title):

  ```bash
  node -e "
  const fs=require('fs'),path=require('path');
  const kw=process.argv[1];
  const slug=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+\$/g,'').slice(0,40).replace(/-+\$/g,'')||'session';
  const dir=path.join(process.cwd(),'.claude','hooks','.titles');
  let out=[];
  try{for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.history.jsonl'))){
    const tenures=[];
    for(const line of fs.readFileSync(path.join(dir,f),'utf8').split(/\r?\n/)){
      if(!line.trim())continue;
      let e;try{e=JSON.parse(line)}catch(_){continue}
      const scope=String(e.title||'').split(' — ')[0].trim();
      if(!scope)continue;
      const last=tenures[tenures.length-1];
      if(!last||last.scope!==scope)tenures.push({scope,enteredIso:e.ts});
    }
    if(!tenures.length||Date.now()-Date.parse(tenures[0].enteredIso)<10*60000)continue;
    const hit=[...tenures].reverse().find(t=>slug(t.scope)===kw);
    if(hit)out.push({sid8:f.slice(0,8),boundaryIso:hit.enteredIso,scope:hit.scope,mtime:fs.statSync(path.join(dir,f)).mtimeMs});
  }}catch(_){}
  out.sort((a,b)=>b.mtime-a.mtime);
  console.log(JSON.stringify(out,null,2));
  " "<keyword>"
  ```

  - **One match** → that's `sid8` and `boundaryIso` (the matched tenure's first title write). Continue.
  - **Several matches** → list them (`sid8` + `scope` + recency) and ask which to migrate; stop.
  - **No match / no `.titles` dir** (terminal-title module off or ledger absent) → fall back: take the newest
    `*.jsonl` in `~/.claude/projects/<cwd-slug>/` that isn't this session as `sid8`, leave `boundaryIso`
    unset, and use recover-context's own 15-min window. Note the degraded mode in Step 4.

## Step 2: Recover the conversation tail

Compute `minutes` = (now − `boundaryIso`) in minutes, rounded **up** to the nearest 5 — recomputed here
so a delay never stales the window. (If `boundaryIso` is unset, use the recover-context fallback window.)
Read `.claude/commands/recover-context.md` and execute its Steps 2–5 with `$MINUTES = minutes` and
`$SESSION_PREFIX = sid8` (no `--show`).

## Step 3: Get the handoff — read it, or synthesize it

- **MANIFEST MODE:** read `handoffFile` and treat it as your own working state: decisions, files
  touched, temp-state gotchas, next actions.
- **SELF-PACKAGE MODE:** there is no pre-written handoff — build one NOW from the recovered tail.
  Reconstruct, from the recovered exchanges: the active task & current state; decisions made but not yet
  in repo docs; files touched (cross-check `git status --short` for uncommitted ones — deterministic);
  any temp-state gotchas the transcript reveals; and the next actions. Treat that as your working state.
  If the thread clearly leans on work older than the recovered window (a dependency the drift boundary
  couldn't see), say so and offer to `/recover-context` further back.

## Step 4: Confirm and hand back

> **Migrated `{keyword}`** — ~{tokens} tokens recovered from session `{sid8}`
> ({manifest handoff internalized | self-packaged from the title-ledger boundary}). Next up: {top next-action}.

Then wait for the user to direct you — do not start work unprompted.
