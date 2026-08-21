<!-- @description End-of-day wrap-up: what got done and what's next, as two collapsible sections on an HTML page. -->
<!-- @version 4 -->
<!-- @param days | number | optional | How many days back to scan. Default 1 (today). -->
<!-- @response success | The report path, the "Start here" item, and the sharpest finding of the day. -->
<!-- @sideeffect Writes reports/eod/<YYYY-DD-MON>.html in the BASE checkout. That folder IS tracked; the command never commits it. -->
<!-- @sideeffect Opens the report in the default browser. -->
<!-- @example /eod-report | Wrap up the day: what got done, what's next -->
<!-- @example /eod-report 3 | Same, but covering the last three days -->

# /eod-report

Close out the working day. The whole report is **two collapsed sections — `Done` and `Next Steps`**
— and nothing else. Someone reading it cold should know what moved and what to pick up first,
without reading a paragraph to get there.

The output is an HTML page in the `create-web-page` house style, same as `/create-wip-report`'s
notes. **The console gets three lines, not the report** — see Step 4.

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
  today belongs in `Done`; its next unchecked substep belongs in `Next Steps`. Read the Ledger tail
  and the substep list, never the whole doc.
- **Open loops from this conversation** — decisions deferred, questions asked and unanswered,
  things deliberately tabled. These are the highest-value `Next Steps` items and they exist **only**
  in the session; no command can re-derive them tomorrow. They are the reason this file is worth
  tracking at all.
- **CI state** for anything pushed (`gh run list`) — a green push and a red one are different days.
  Check the *conclusion*, not just that a run exists.

## Step 2 — the page

One file at `reports/eod/<YYYY-DD-MON>.html` — e.g. `reports/eod/2026-20-AUG.html` — always in the
**base checkout**, never inside `.claude/worktrees/`. On a multi-day scan the filename is the **end**
date.

**Re-running the same day overwrites it.** That is the opposite of `reports/wip/done/`'s
immutability, and deliberately so: the day is not over until it is, and a wrap-up run at 4pm and
again at 9pm should be one file, not two disagreeing ones.

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
| `<details>` ×2 | `Done` · `Next Steps` — **exactly these two, in this order** |

### ⛔ Nothing lives outside the two sections

No lead-in paragraph. No summary. No "pick up here" box. No third section. Between the toolbar and
the closing `</div>` there are **two `<details>` elements and nothing else** — that is the whole
format, and it is the point: a wrap-up whose sections are collapsed is read in four seconds, and a
paragraph above them is a paragraph that gets read every time instead.

The `.dek` is the one exception, and it earns it by being counts rather than prose. It is also the
**only** place the day's totals appear, since the summaries carry no numbers (below) — so get them
right: `4 repos · 15 commits · 2 unpushed · 8 open`.

### The two sections

Each is a `<details>` (closed — never add `open`) with its content in `<div class="s-body">`.

```html
<summary>Done</summary>
<summary>Next Steps</summary>
```

**The summary is the bare word.** No counts, no `(9)`, no `— top 2 of 9`. A header that carries a
number invites reading the number instead of the item, and the `.dek` already has the totals.

Everything that is finished goes in `Done`. Everything that is not — blocked, undecided, or merely
unstarted — goes in `Next Steps`. There is no third bucket; the distinction between "blocked" and
"just unstarted" is carried by the ⛔ mark and the owner tag, not by a section.

### ⛔ Two headline items per section — the rest goes in a labeled drawer

Each section shows **at most two** items at its top level. This is a hard cap and it is the whole
mechanism: two slots force a ranking, and a ranking is the thing a wrap-up is actually for. Nothing
is discarded — everything past the second item moves into a drawer below.

A headline item is one line, **25 words**, with the outcome clause bolded via `.lede`:

```html
<p class="item"><span class="lede">The paid verdict endpoint is live in <code>main</code></span>
— dormant until one env var is set.</p>
<details class="more">
  <summary>detail</summary>
  <div class="more-body">
    <p>Counters in, display object out; inert until <code>CCA_LICENSE_KEYS</code> is present —
    <code>proswitch-api@bc4e303</code>.</p>
  </div>
</details>
```

**Every headline item carries its own `details.more`.** That is where the hashes, the commands, the
reasoning, and the `<pre><code>` fix blocks live. The headline says what; the drawer says how you
know. A headline with no drawer is a headline that skipped its evidence.

The overflow sits in a `<div class="rest">` after the two items, one `details.more` per *kind*:

```html
<div class="rest">
  <details class="more">
    <summary>2 more blocked — one fix, one decision</summary>
    ...
  </details>
  <details class="more">
    <summary>4 more open loops — nothing blocking</summary>
    ...
  </details>
</div>
```

**A drawer label states its kind, never a bare count.** `7 smaller commits` and `2 more blocked —
one fix, one decision` tell the reader whether to open them; `5 more` does not. Splitting the
overflow by kind is also how the old third section's meaning survives the collapse to two.

### `Next Steps` item one is tagged `Start here`

The first item in `Next Steps` is the single thing tomorrow opens with, and it says so:

```html
<p class="item"><span class="chip">Start here</span><span class="lede">SSH the API box and read
which branch its checkout is on</span> — that answer decides whether anything below matters.
<span class="owner">Ours · 5 min</span></p>
```

**One item, never two.** If two genuinely tie for first, the day has not been thought through yet.

### Marks and owner tags

- **`⛔` prefixes a blocked item**, in either the headline or a drawer. It means work is stopped,
  not merely unstarted.
- **Every `Next Steps` item ends with an owner tag** — `<span class="owner">Ours · 2 lines</span>`,
  `Ours · ~10 min`, `Yours · a decision`. With blocked and unblocked items in one list, the tag is
  the only thing telling the reader which ones they can just go do. An item with no owner is how a
  loop sits open for two months.
- Estimates are marked as estimates (`~`), sized off the item in front of you. **Never round up to
  look substantial.**

### ⛔ The rules that make it a wrap-up instead of noise

- **Name the outcome, not the activity.** "Fleet actuator can no longer overwrite adopting repos'
  guards" beats "worked on `sync-hook-fleet.js`".
- **`Next Steps` items are imperatives.** "Repoint the deploy pipeline at the live box" — not "the
  deploy pipeline points at a dead box". The condition belongs in the drawer; the headline names
  the action, because that is what makes it a *step*.
- **Every hash is `repo@hash`** when more than one repo is in play — a bare hash is unverifiable
  from another checkout.
- **Surface the unwelcome findings.** A broken pipeline, a deploy that did not take, a suite
  skipped rather than passed — those outrank wins for the two `Next Steps` slots. A wrap-up that
  only lists wins is a wrap-up that gets read once.
- **Do not pad `Done`.** If the day's real output was one commit and a diagnosis, the second slot
  goes empty rather than inventing a peer for the first.
- **Nothing open → `Next Steps` holds one line saying so.** The section stays; "nothing is open" is
  the single most useful thing a wrap-up can report, and deleting the section hides it.
- **Another session's work is reported, never touched.** Read `git log` and `git status` there;
  write nothing, and say a live sibling owns it.

### The style block to append

The shared template has no rules for these classes. Paste this **verbatim** immediately before
`</style>` in the instantiated file — do not restyle it per report, or two days' wrap-ups stop
looking like the same document:

```css
  /* ── two-section shape: two headline items per section, detail nested under each ── */
  .item{margin:0 0 4px;font-size:19px;line-height:1.5;color:var(--ink);}
  .item .lede{font-weight:700;}
  .item .owner{color:var(--muted);font-size:16px;font-style:italic;}
  .chip{display:inline-block;font-size:12px;font-weight:700;text-transform:uppercase;
    letter-spacing:.06em;color:#fff;background:var(--link);border-radius:4px;
    padding:2px 7px;margin-right:8px;vertical-align:2px;}
  details.more{border:none;margin:0 0 18px;}
  details.more:last-of-type{border-bottom:none;}
  details.more > summary{font-size:15px;font-weight:600;color:var(--muted);
    padding:2px 0;gap:8px;}
  details.more > summary::before{width:6px;height:6px;border-width:1.5px;}
  details.more > summary:hover{color:var(--link);}
  .more-body{font-size:17px;line-height:1.55;color:var(--body);padding:6px 0 4px 18px;}
  .more-body p{margin:0 0 .7em;} .more-body p:last-child{margin-bottom:0;}
  .more-body ul{padding-left:20px;margin:0;}
  .rest{margin:14px 0 0;padding-top:12px;border-top:1px dashed var(--rule);}
```

`details.more{border:none}` is load-bearing: the template's `details:last-of-type` adds a bottom
rule, and a nested drawer is last-of-type inside its own parent, so without the override every
drawer draws a stray line across the section.

## Step 3 — open it

Open the file in the default browser — `start "" "<f>"` on Windows, `open "<f>"` on macOS,
`xdg-open "<f>"` on Linux.

This is where it parts company with `/create-wip-report`, which deliberately opens nothing: that
command writes an archive of six notes the user visits when they choose to. This writes **one page,
just asked for, at the moment it is meant to be read.**

## Step 4 — report, in three lines

The page is the report. The console gets:

1. the file path,
2. the `Start here` item, verbatim,
3. **one** finding — the sharpest thing the day revealed. One. Not a digest of the page you just
   wrote; the user is about to look at it.

Then, only when the file is new or changed: name the commit as the user's next step. `reports/eod/`
is **tracked** — unlike `reports/wip/<date>/`, which is regenerated and gitignored — because the
open loops in it exist nowhere else. **Do not commit it yourself**; a command that writes tracked
files and commits them is a command that lands work nobody reviewed.

## Fallback — no template

Only when `~/.claude/skills/create-web-page/template.html` does not exist. Write the same content
as `reports/eod/<YYYY-DD-MON>.md` — `#` for the title, a bullet list for the `.dek` fields, `## Done`
and `## Next Steps`, the same two-items-plus-overflow shape with the overflow as a nested list — and
skip the browser open. Say in the report that the page is markdown and why.

## What it will never do

- **Commit or push anything**, including its own output. See Step 4.
- **Act on a finding.** It reports a red pipeline; fixing it is the next session's work.
- **Pad the day.** One commit and a diagnosis is a legitimate day, reported as such.
- **Add a third section**, a lead-in, or a summary paragraph. Two collapsed sections, nothing else.
- **Write outside `reports/eod/`**, or inside a worktree.
- **Read a whole plan doc or a whole transcript.** Ledger tail, substep list, transcript tail.
- **Trust a transcript over git.** A session that says it committed and has no hash did not.
