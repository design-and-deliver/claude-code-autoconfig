<!-- @description End-of-day wrap-up: what landed today and what's still open, as short bullets. -->
<!-- @version 1 -->
<!-- @param days | number | optional | How many days back to scan. Default 1 (today). -->
<!-- @response success | Two bullet lists — Landed and Remaining — plus a one-line "pick up here" pointer. -->
<!-- @example /eod-report | Wrap up the day: what shipped, what's left -->
<!-- @example /eod-report 3 | Same, but covering the last three days -->

# /eod-report

Close out the working day. **Short bullets only** — this is a handoff to tomorrow-you, not a
report to a manager. Someone reading it cold should know what moved and what to pick up first.

## Step 1 — gather (batch these into as few calls as possible)

Scan back `$ARGUMENTS` days (default **1**, i.e. today). In **every** repo touched this session,
not just the CWD — a session that committed to three repos and reports one is worse than useless:

```bash
git log --oneline --since="<N> days ago" --author="$(git config user.name)"
git status --short
git log --oneline @{u}.. 2>/dev/null    # committed but unpushed
```

Also pull in, when they exist and are cheap to read:

- **Plan Ledgers** — any `docs/*.md` or `.claude/plans/*.md` with a `## Ledger`: the newest entry
  names the substep that closed and what the next session needs. A plan whose last substep landed
  today belongs in Landed; its next unchecked substep belongs in Remaining.
- **Open loops from this conversation** — decisions deferred, questions asked and unanswered,
  things deliberately tabled. These are the highest-value Remaining items and they exist **only**
  in the session; no command can re-derive them tomorrow.
- **CI state** for anything pushed — a green push and a red one are different days.

## Step 2 — write it

Exactly two lists, then one pointer line.

```
## Landed
- <what changed, and where it lives> — `repo@hash`
- ...

## Remaining
- <what's open, and what specifically unblocks it>
- ...

**Pick up here:** <the single next action, named precisely enough to start cold>
```

Rules that make the difference between a useful wrap-up and noise:

- **One line per bullet.** If it needs two, it's two bullets or it's over-explained.
- **Name the outcome, not the activity.** "Fleet actuator can no longer overwrite adopting repos'
  guards" beats "worked on sync-hook-fleet.js".
- **Every hash is `repo@hash`** when more than one repo is in play — a bare hash is unverifiable
  from another checkout.
- **Blocked items say what unblocks them**, and who has to do it. "Blocked on X" with no owner is
  how an item sits for two months.
- **Surface the unwelcome findings.** A broken pipeline, a deploy that didn't take, a test skipped
  rather than passed — those are the bullets that matter tomorrow. A wrap-up that only lists wins
  is a wrap-up that gets read once.
- **Don't pad Landed.** If the day's real output was one commit and a diagnosis, say that. Reading
  time is the whole point.

## Step 3 — offer, don't do

End by offering to persist it — a Ledger entry, a note file, a commit message — and let the user
choose. **Do not write anything to disk in this command by default.** A wrap-up that silently
creates files is a wrap-up that gets run once and then avoided.
