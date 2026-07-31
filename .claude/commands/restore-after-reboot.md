<!-- @description Your machine restarted and took every terminal with it — this says which Claude sessions died in it and reopens them. -->
<!-- @version 1 -->
<!-- @param all | flag | optional | Include sessions killed some other way (a force-quit terminal), not just the reboot's. -->
<!-- @param days N | integer | optional | How far back to look. Default 7. -->
<!-- @param --launch | flag | optional | Actually reopen them — one Windows Terminal tab per session. -->
<!-- @response roster | Lists the sessions the reboot killed, what uncommitted work is sitting in their trees, and the resume commands. -->
<!-- @response nothing | Nothing to restore — every session ended cleanly or is still open. -->
<!-- @example /restore-after-reboot | What died in the restart, and how to get it back -->
<!-- @example /restore-after-reboot --launch | Reopen them all as tabs -->
<!-- @example /restore-after-reboot all days 14 | Everything killed in the last two weeks -->

# /restore-after-reboot

A restart closes every terminal at once. The conversations survive — transcripts are append-only —
but nothing tells you WHICH of the hundreds on disk were open when the power went. This does.

It is named for the event, not the object, because that is how you reach for it: you don't know
what got wiped, you know the machine restarted. Answering "what else did that take?" is part of
the job, so it also reports uncommitted work sitting in the trees those sessions were editing.

**READ-ONLY unless you pass `--launch`.** Running it never resumes anything on its own.

DEV-ONLY: gated out of user installs (`DEV_ONLY_FILES` in `bin/cli.js`), dogfooded from the CCA
repo like `fleet` and `token-guard`. It depends on `session-close.js`, which is gated the same way.

## Step 1 — run it

Installed at BOTH tiers, so prefer the project copy and fall back to the global one. A reboot is a
machine event, not a repo event — this has to be reachable from whatever directory you happen to
be standing in when you notice your tabs are gone.

```bash
S="${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/restore-after-reboot.js"
[ -f "$S" ] || S="$HOME/.claude/scripts/restore-after-reboot.js"
node "$S"
```

Map `$ARGUMENTS`: `all` → `--all`, `days N` → `--days N`, `--launch` → `--launch`.

⛔ **Never add `--launch` yourself.** Spawning eight terminals is not a step to take on the user's
behalf because the roster looked convincing. If they want it, they pass it.

## Step 2 — report it

Print the output **verbatim in a fenced block**. It is already a board; re-narrating it row by row
makes it longer and harder to scan.

Then at most two lines of interpretation, and only when there is something to say:

- **A session was ◐ awaiting you** — say which. It died mid-question, so it is the one with an
  unanswered thread, and usually the one to reopen first.
- **STILL ON DISK** — name the tree with the most uncommitted files. A restored session has no
  memory of that work and will happily edit over it.
- **⚠ gone** — the directory was renamed or deleted after those sessions ran. They cannot be
  resumed in place; say so rather than suggesting a `cd` that will fail.

If the roster is clean, add nothing.

## Step 3 — do not act on it

Do not resume a session, do not launch tabs, do not commit the uncommitted work it surfaced. The
board tells the **user**; they choose what comes back.

## How it decides

`session-close.js` writes `{sid}.closed` on every orderly exit (quit, `/clear`, logout). A kill
cannot write one — the process is gone before any hook runs. So:

| Verdict | Test |
|---|---|
| ended cleanly | `{sid}.closed` exists |
| **killed by the reboot** | no marker, and the transcript's last write predates boot |
| still open | its recorded pid is alive, or it wrote in the last 3 min |
| killed some other way | no marker, wrote since boot, pid gone |
| unclassifiable | it ended before `session-close.js` was installed |

Two traps this had to learn the hard way, both of which reported live sessions as dead:

- **A quiet tab is not a dead tab.** `fleet.js` treats 3 minutes of silence as idle, which is fine
  for "is anyone working?" — but a tab you walked away from 25 minutes ago is open and looks
  identical by mtime. Hence the pid check (`{sid}.pid`, trusted only when written after boot,
  since PIDs are recycled).
- **A session's state dir is not derivable from its cwd.** `terminal-title.js` writes to the
  directory the terminal was LAUNCHED from; the transcript records where the session ended up.
  They differ often enough that the state dirs are indexed by sid, not computed.

## What it reads

| Signal | Source |
|---|---|
| clean-exit marker + reason | `.claude/hooks/.titles/{sid}.closed` |
| process liveness | `.claude/hooks/.titles/{sid}.pid` |
| title, awaiting-you flag | `{sid}.txt`, `{sid}.ask` |
| superseded predecessor | `{sid}.lineage.json` |
| last activity | mtime of `~/.claude/projects/*/{sid}.jsonl` and `{sid}.glyph` |
| working directory, branch | the `cwd` / `gitBranch` fields in the transcript's tail |
| boot time | `os.uptime()` — advisory only, never the classifier |

Nothing new is instrumented; the hooks already wrote all of it.
