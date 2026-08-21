<!-- @description End-of-day wrap-up: what landed today and what's still open, rendered as an HTML report. -->
<!-- @version 2 -->
<!-- @param days | number | optional | How many days back to scan. Default 1 (today). -->
<!-- @response success | The report path, the one "pick up here" line, and the sharpest finding of the day. -->
<!-- @sideeffect Writes WIP/EOD/<YYYY-DD-MON>.html in the BASE checkout. That folder IS tracked; the command never commits it. -->
<!-- @sideeffect Opens the report in the default browser. -->
<!-- @example /eod-report | Wrap up the day: what shipped, what's left -->
<!-- @example /eod-report 3 | Same, but covering the last three days -->

# /eod-report

Close out the working day. **Short bullets only** — this is a handoff to tomorrow-you, not a
report to a manager. Someone reading it cold should know what moved and what to pick up first.

The output is an HTML page in the `create-web-page` house style, same as `/create-wip-report`'s
notes: collapsed sections, so the day is skimmable at headline level and expands only where the
reader cares. **The console gets three lines, not the report** — see Step 4.

**It writes one file and commits nothing.** No merges, no pushes, no `CLAUDE.md` edits, no
`sync-hook-fleet.js`. Where it has a finding, it surfaces it and leaves the decision to the user.

## Step 1 — gather (batch these into as few calls as possible)

Scan back `$ARGUMENTS` days (default **1**, i.e. today). In **every** repo touched this session,
not just the CWD — a session that committed to three repos and reports one is worse than useless.
Find them by scanning sibling checkouts for same-day commits, then, per repo:

```bash
git log --oneline --since="<N> days ago" --author="$(git config user.name)"
git status --short
git log --oneline @{u}.. 2>/dev/null    # committed but unpushed
```

Also pull in, when they exist and are cheap to read:

- **Plan Ledgers** — any `docs/*.md` or `.claude/plans/*.md` with a `## Ledger`: the newest entry
  names the substep that closed and what the next session needs. A plan whose last substep landed
  today belongs in Landed; its next unchecked substep belongs in Remaining. Read the Ledger tail
  and the substep list, never the whole doc.
- **Open loops from this conversation** — decisions deferred, questions asked and unanswered,
  things deliberately tabled. These are the highest-value Remaining items and they exist **only**
  in the session; no command can re-derive them tomorrow. They are the reason this file is worth
  tracking at all.
- **CI state** for anything pushed (`gh run list`) — a green push and a red one are different days.
  Check the *conclusion*, not just that a run exists.

## Step 2 — the page

One file at `WIP/EOD/<YYYY-DD-MON>.html` — e.g. `WIP/EOD/2026-20-AUG.html` — always in the **base
checkout**, never inside `.claude/worktrees/`. On a multi-day scan the filename is the **end** date.

**Re-running the same day overwrites it.** That is the opposite of `WIP/DONE/`'s immutability, and
deliberately so: the day is not over until it is, and a wrap-up run at 4pm and again at 9pm should
be one file, not two disagreeing ones.

### ⛔ Instantiate the template from the FILE, never from memory

```
C:\Users\andre\.claude\skills\create-web-page\template.html    (95 lines, ~5KB)
```

Read it before writing. Reproducing it from memory — or cloning yesterday's report — is how the
format drifts: the `<style>` block and the `toggle-all` script get dropped and the page renders as
unstyled serif text with a dead button. Missing template (another box, a fresh checkout) → say so
and fall back to the `## Fallback` shape at the bottom; do not improvise a stylesheet.

**Output self-check:** the file starts at `<!DOCTYPE html>` and contains both the full `<style>`
block and the `toggle-all` `<script>`. A file starting at `<p class="stamp">` is a naked fragment —
redo it from the template.

### Slot mapping

| Template slot | End-of-day content |
|---|---|
| `<title>` | `End of day — <Month D, YYYY>` |
| `.stamp` | the generation time, local (`date "+%B %-d, %Y %-I:%M%p"`) |
| `.title` | `End of day — <Weekday, Month D>`; a multi-day scan uses the range |
| `.dek` | `<N> repos · <K> commits · <U> unpushed · <R> open` — `<code>` around repo names |
| `.lead-in` | **the day's bottom line, ONE paragraph, 45 words hard cap** |
| `<p class="pickup">` | **the pick-up line — after the lead-in, ABOVE the toolbar** |
| `<details>` ×2 | `Landed` · `Remaining` |

The lead-in and the pick-up line are the only prose above the fold, and on a day nobody re-opens
the page they are the only prose read at all. Everything else is inside a `<details>`.

### ⛔ The lead-in is the day's bottom line, not a list of what you did

Same genre and the same 45-word cap as a WIP note's lead-in, and the same senior-manager test —
`/create-wip-report`'s two ⛔ sections on it are canonical, so follow them rather than re-deriving
the rules here. The one difference: a WIP note reports where **one** effort stands; this reports
what the **day** amounted to. State what moved, then the single thing that did not.

```html
<!-- ✗ an inventory. Names the activity, ranks nothing, ends nowhere. -->
<p class="lead-in">Worked across four repos today. Merged the guard-verdict endpoint, closed out a
plan, slimmed the verdict set, added a command, and looked into the deploy pipeline.</p>

<!-- ✓ 44 words — what moved, what it is blocked behind, what it costs -->
<p class="lead-in">The paid verdict endpoint is merged and inert until its key is set, and the
cost-control plan is finished. Neither can reach production: the deploy pipeline has been pointed
at a dead server since June. Repointing it is a ten-minute fix nobody has made.</p>
```

The pick-up line is its own element, bolded, never inside a section:

```html
<p class="pickup"><strong>Pick up here:</strong> add <code>npm ci</code> to the
<code>test</code> job — CI has been red for a month and every local green was local-only.</p>
```

Style it inline on that element (the shared stylesheet has no `.pickup` rule):
`style="font-size:19px;margin:0 0 24px;padding:12px 16px;background:var(--code);border-radius:8px;"`.

**One action, named precisely enough to start cold.** Not a theme, not two things joined by "and" —
if two things genuinely tie for first, the report has not been thought through yet.

### The two sections

Each is a `<details>` (closed — never add `open`) with its content in `<div class="s-body">`.
Both summaries carry a count, because the counts are the day at a glance:

```html
<summary>Landed (7)</summary>
<summary>Remaining (6 · ~2h est.)</summary>
```

`Remaining`'s estimate is an estimate and must be marked as one — `~` and `est.`, both. Size it off
the list you just wrote; a plan-driven day sums the unchecked substeps' `~time` tags and says
`(~7h plan)` instead. **Never round up to look substantial.** Nothing left → `Remaining (none)`,
and the section holds one line saying so — this is the one section that stays when empty, because
"nothing is open" is the single most useful thing a wrap-up can report.

**Landed** — one `<li>` per outcome, `<code>` every hash and path:

```html
<li>Guard-verdict endpoint merged to main — inert until <code>CCA_LICENSE_KEYS</code> is set —
<code>proswitch-api@bc4e303</code></li>
```

**Remaining** — ⛔ items **first**, each opening `⛔ <strong>…</strong>`, then the rest,
most-blocking first. The concrete next command goes in its own `<pre><code>` block.

### ⛔ The rules that make it a wrap-up instead of noise

- **One line per bullet, 35 words**, blockers 50. Over that, split it or move the reasoning into
  the lead-in. Short declarative sentences, stacked — not one sentence with three clauses hanging
  off it.
- **Name the outcome, not the activity.** "Fleet actuator can no longer overwrite adopting repos'
  guards" beats "worked on `sync-hook-fleet.js`".
- **Every hash is `repo@hash`** when more than one repo is in play — a bare hash is unverifiable
  from another checkout.
- **Blocked items say what unblocks them**, and who has to do it. "Blocked on X" with no owner is
  how an item sits for two months.
- **Surface the unwelcome findings.** A broken pipeline, a deploy that did not take, a suite
  skipped rather than passed — those are the bullets that matter tomorrow, and they lead
  `Remaining`. A wrap-up that only lists wins is a wrap-up that gets read once.
- **Do not pad Landed.** If the day's real output was one commit and a diagnosis, say that.
  Reading time is the whole point.
- **Another session's work is reported, never touched.** Read `git log` and `git status` there;
  write nothing, and say a live sibling owns it.

## Step 3 — open it

Open the file in the default browser — `start "" "<f>"` on Windows, `open "<f>"` on macOS,
`xdg-open "<f>"` on Linux.

This is where it parts company with `/create-wip-report`, which deliberately opens nothing: that
command writes an archive of six notes the user visits when they choose to. This writes **one page,
just asked for, at the moment it is meant to be read.**

## Step 4 — report, in three lines

The page is the report. The console gets:

1. the file path,
2. the pick-up line, verbatim,
3. **one** finding — the sharpest thing the day revealed. One. Not a digest of the page you just
   wrote; the user is about to look at it.

Then, only when the file is new or changed: name the commit as the user's next step. `WIP/EOD/` is
**tracked** — unlike the rest of `WIP/`, which is regenerated and gitignored — because the open
loops in it exist nowhere else. **Do not commit it yourself**; a command that writes tracked files
and commits them is a command that lands work nobody reviewed.

## Fallback — no template

Only when `~/.claude/skills/create-web-page/template.html` does not exist. Write the same content
as `WIP/EOD/<YYYY-DD-MON>.md` — `#` for the title, a bullet list for the `.dek` fields, `##` per
section, the pick-up line bolded near the top — and skip the browser open. Say in the report that
the page is markdown and why.

## What it will never do

- **Commit or push anything**, including its own output. See Step 4.
- **Act on a finding.** It reports a red pipeline; fixing it is the next session's work.
- **Pad the day.** One commit and a diagnosis is a legitimate day, reported as such.
- **Write outside `WIP/EOD/`**, or inside a worktree.
- **Read a whole plan doc or a whole transcript.** Ledger tail, substep list, transcript tail.
- **Trust a transcript over git.** A session that says it committed and has no hash did not.
