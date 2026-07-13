<!-- @description Completes a session migration prepped by /eval-new-session — recovers the old session's conversation tail and internalizes its handoff notes, all from one short name. -->
<!-- @version 1 -->
<!-- @param shortname | string | required | Migration name printed by /eval-new-session (e.g. guard-ux). -->
<!-- @response success | Migrated {shortname}: ~{tokens} tokens recovered + handoff internalized. -->
<!-- @response not-found | No manifest named {shortname} — available names listed. -->
<!-- @sideeffect Reads .claude/handoff/<shortname>.manifest.json + handoff MD; runs the recover-context extraction -->
<!-- @example /migrate-new-session guard-ux | Pull everything prepped under "guard-ux" into this session -->

Run this **in the new session**. It completes the cutover that `/eval-new-session` prepped in
the old one — no manual `/recover-context` args, no manual handoff read.

## Step 1: Resolve the manifest

The shortname is: $ARGUMENTS (trim whitespace/flags). Read
`.claude/handoff/<shortname>.manifest.json`. If it doesn't exist, list the basenames of
`.claude/handoff/*.manifest.json` so the user can pick, and stop.

Fields: `sid8`, `boundaryIso`, `handoffFile`, `createdIso`.

## Step 2: Recover the conversation tail

Compute `minutes` = (now − `boundaryIso`) in minutes, rounded **up** to the nearest 5 —
recomputed here so a delay between eval and migrate can never stale the window.

Read `.claude/commands/recover-context.md` and execute its Steps 2–5 with
`$MINUTES = minutes` and `$SESSION_PREFIX = sid8` (no `--show`).

## Step 3: Internalize the handoff

Read `handoffFile` and treat it as your own working state: decisions, files touched,
temp-state gotchas, next actions.

## Step 4: Confirm and hand back

> **Migrated `{shortname}`** — ~{tokens} tokens of conversation recovered from session
> `{sid8}` + handoff notes internalized. Next up (from the handoff): {top next-action}.

Then wait for the user to direct you — do not start work unprompted.
