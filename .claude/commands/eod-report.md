<!-- @description End-of-day wrap-up: what got done and what's next, as two collapsible sections on an HTML page. -->
<!-- @version 9 -->
<!-- @param days | number | optional | How many days back to scan. Default 1 (today). -->
<!-- @response success | The report path, the "Start here" item, and the sharpest finding of the day. -->
<!-- @sideeffect Writes reports/eod/<YYYY-DD-MON>.html in the BASE checkout. That folder IS tracked; the command never commits it. -->
<!-- @sideeffect Opens the report in the default browser. -->
<!-- @example /eod-report | Wrap up the day: what got done, what's next -->
<!-- @example /eod-report 3 | Same, but covering the last three days -->

# /eod-report

Close out the working day. The whole report is **two collapsed sections — `Done today` and `Next steps`**
— and nothing else. Someone reading it cold should know what moved and what to pick up first,
without reading a paragraph to get there.

The output is an HTML page in the `create-web-page` house style, same as `/create-wip-report`'s
notes. **The console gets three lines, not the report** — see Step 4.

**It writes one file and commits nothing.** No merges, no pushes, no `CLAUDE.md` edits, no
`sync-hook-fleet.js`. Where it has a finding, it surfaces it and leaves the decision to the user.

## Step 1 — gather (batch these into as few calls as possible)

Scan back `$ARGUMENTS` days (default **1**, i.e. today), in **this repo only** — the checkout the
command was run from, plus its worktrees. Do not go hunting through sibling checkouts.

```bash
git log --oneline --since="<N> days ago" --author="$(git config user.name)"
git status --short
git log --oneline @{u}.. 2>/dev/null    # committed but unpushed
```

**The project is the report's boundary.** A wrap-up covering four repos is four wrap-ups stapled
together: nothing in it can be ranked, because a commit here and a commit in an unrelated service
are not competing for the same second slot. The two-item cap only means something inside one
project.

**A related repo enters through an item, never through the scan.** When today's work here depended
on a change elsewhere — `cca-cost-control`, `proswitch-api` — that fact belongs in the sentence
describing the work: *"the usage check it calls now lives in `cca-cost-control@bc4e303`"*. Read
that repo's `git log` when an item already points at it; never sweep it for its own day's commits,
and never let it appear in the `.stamp`.

Also pull in, when they exist and are cheap to read:

- **Plan Ledgers** — any `docs/*.md` or `.claude/plans/*.md` with a `## Ledger`: the newest entry
  names the substep that closed and what the next session needs. A plan whose last substep landed
  today belongs in `Done today`; its next unchecked substep belongs in `Next steps`. Read the Ledger tail
  and the substep list, never the whole doc.
- **Open loops from this conversation** — decisions deferred, questions asked and unanswered,
  things deliberately tabled. These are the highest-value `Next steps` items and they exist **only**
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

**Output self-check:** the file starts at `<!DOCTYPE html>` and contains the full `<style>` block
and the `toggle-all` `<script>`. A file starting at `<p class="stamp">` is a naked fragment — redo
it from the template.

### Slot mapping

| Template slot | End-of-day content |
|---|---|
| `<title>` | `End of day — <Month D, YYYY>` |
| `.stamp` | the project name, bare — `claude-code-autoconfig`. **Not the generation time.** |
| `.title` | two lines — `End of day report`, then the date in a `<span class="when">` |
| `.dek` | **omitted entirely** — no element, not an empty one |
| `<details>` ×2 | `Done today` · `Next steps` — **exactly these two, in this order** |

### ⛔ Nothing lives outside the two sections

No lead-in paragraph. No summary. No "pick up here" box. No third section. Between the toolbar and
the closing `</div>` there are **two `<details>` elements and nothing else** — that is the whole
format, and it is the point: a wrap-up whose sections are collapsed is read in four seconds, and a
paragraph above them is a paragraph that gets read every time instead.

Nothing hidden lives there either. Every element on the page renders — there are no display:none
blocks waiting behind a link, because there are no links (see below).

The `.stamp` is the one exception, and it holds **the project name and nothing else** —
`claude-code-autoconfig`, in the template's small muted line above the title. It is an **anchor,
not a summary**: it says which project the two sections are about, which the sections themselves
never say, and then stops. Anything that asks to be read rather than glanced at belongs in an item.

**The `.dek` is omitted** — there is no third line above the toolbar. The project name is the only
thing that belongs there, `.stamp` already carries it, and two lines saying one thing is the
padding this format exists to refuse.

⛔ **No counts, anywhere above the toolbar.** `4 repos · 15 commits · 2 unpushed · 8 open` looks
like a summary and is not one: fifteen commits is not a better day than four, so the numbers give
the reader nothing to conclude, and a repo list is a boundary the report already has. The day's
shape is in the two items — that is what the two-item cap is for.

⛔ **The generation time does not appear on the page.** `.stamp` is the template's datetime slot
everywhere else, so writing the project name there is a deliberate override, not an oversight —
the date is already on the title's second line, and a wrap-up read the evening it was written has
no use for the minute. Re-running the same day overwrites the file, so nothing depends on telling
two runs apart.

### The title is two lines — name, then date

```html
<h1 class="title">End of day report<span class="when">Friday, August 21</span></h1>
```

The name of the thing is fixed and the date is what changes, so they are not peers: `.when` renders
at `.58em` in `--muted` under a full-size first line. A multi-day scan puts the range on the second
line — `Monday–Friday, August 17–21` — and the first line never changes.

`<title>` is unaffected; it stays the flat `End of day — <Month D, YYYY>` for the browser tab.

### The two sections

Each is a `<details>` (closed — never add `open`) with its content in `<div class="s-body">`.

```html
<summary>Done today</summary>
<summary>Next steps</summary>
```

**The summary is the label alone, in sentence case.** `Done today` and `Next steps` — never
`Done Today`, `DONE`, or a title-cased variant. No counts either, no `(9)`, no `— top 2 of 9`: a
header that carries a number invites reading the number instead of the item.

Everything that is finished goes in `Done today`. Everything that is not — blocked, undecided, or merely
unstarted — goes in `Next steps`. There is no third bucket; the distinction between "blocked" and
"just unstarted" is carried by the ⛔ mark and the owner tag, not by a section.

### ⛔ Two headline items per section — the rest goes in a labeled drawer

Each section shows **at most two** items at its top level. This is a hard cap and it is the whole
mechanism: two slots force a ranking, and a ranking is the thing a wrap-up is actually for. Nothing
is discarded — everything past the second item moves into a drawer below.

A headline item is **one line, 25 words, and complete on its own** — the outcome clause bolded via
`.lede`, the remainder of the sentence carrying whatever else earns room:

```html
<p class="item">⛔ <span class="lede">Point the automatic deploy at the current server</span>
— the address it uses stopped being ours in June. <span class="owner">Ours · ~20 min</span></p>
```

### ⛔ There is no `Details` link — the item is the whole item

An item never links to a fuller version of itself. No modal, no hidden block, no "read more".
**What does not fit in the line does not go on the page: the reader asks.**

That trade is the point, not a limitation accepted reluctantly. A wrap-up is read in front of the
person who wrote it, or in a channel where they are one message away — so the expensive thing is
never the reader's missing context, it is the writer pre-answering questions nobody asked. Every
detail block is a guess at the follow-up, written at full length, and most guess wrong. A line the
reader can question costs one message and returns the answer they actually wanted.

It also deletes the format's one failure mode. A link is a promise, and a block that paraphrases
its own headline breaks it — one of those and the reader stops opening the ones that would have
paid. With no link there is nothing to promise and nothing to break.

**So the line has to survive alone.** Everything below is about making it do that.

#### ⛔ The check: could the reader have believed the opposite?

Twenty-five words is the entire budget, so a clause carrying no information is not merely padding —
it displaces the clause that would have carried some. Not "name the fact it adds": that is a
judgment call, and it passes anything you can phrase confidently. **Negate the clause. If the
negation is absurd given the `.lede`, the clause carries no information** — cut it and let the lede
stand alone.

Worked example — lede *"Completed the cost-control plan"*, with five candidate trailing clauses:

| Clause | Negated | Verdict |
|---|---|---|
| "one copy of the logic now, in the private service" | "two copies now" | believable — **keep** |
| "used to live in two places" | "used to live in one place" | absurd — `now` already said it |
| "that could quietly disagree" | "two copies that always agreed" | absurd — that is what two copies means |
| "the public tool reads from it" | "the public tool ignores it" | absurd — the tool works |
| "the plan's last item, so finished not paused" | "the plan is paused" | contradicted by the lede |

One survives, so the item is *"Completed the cost-control plan — one copy of the logic now, in the
private service."* and stops there. Compare a clause that is genuinely a fact: *"it times out rather
than errors"* negates to *"releases failed loudly"* — perfectly believable, and wrong. That is what
earns its words.

**Three idioms generate the empty clauses.** They are recognizable while typing, which the judgment
call is not:

1. **Spelling out an entailment** — "one copy *now*" → "used to live in two places". The tense
   already carried it.
2. **Naming the obvious consequence** — two copies "could quietly disagree". That is the definition,
   not a finding.
3. **Negating an alternative nobody raised** — "finished rather than paused". `Finished` is not
   ambiguous; denying an unheld reading manufactures a clause out of nothing.

Each one produces words the lede did not literally contain, which is exactly why it feels like
elaboration while writing. **Novelty of wording is not novelty of information.**

### ⛔ Write the line for the scrum master, not the committer

The person reading runs the standup; they did not write the code. They are reading to answer one
question — *can I tell the team this is done, and does anyone have to do anything?* So the item
names **what changed**, in the product's terms, and — only when there is one — **what it needs**.

**Name what it needs only when the answer is not "nothing".** "Nobody is blocked", "nothing needed
from anyone", "no action required" — an item that ends without an ask has already said that, and a
phrase appearing on every item stops being read on any of them.

It wears a second disguise that is easy to miss: **"that's a separate decision", "not scheduled
yet", "we'll look at it later"** announce that nothing follows from the item — the same non-ask with
a calendar bolted on. A real ask names a person and what they must decide; anything short of that
is the item ending, so let it end.

### ⛔ No hash trails in an item

An item gets **one identifier, or none** — and "none" is the common case. The person reading it
runs the standup; they will never type a commit hash, so a trailing
`bc4e303, fb15638, 7c407e0, ab6cb17` is four tokens of noise sitting where the sentence should have
ended. It is a changelog wearing a receipt's clothes.

- **One `repo@hash` is allowed** when the item is a single commit someone would plausibly go read.
  Multi-commit work gets nothing — the commit-level trail belongs in the overflow drawer, which is
  where an engineer scanning the day's commits is already looking.
- **A pointer is not a hash.** `.claude/retro/deploy-workflow-stale-ip.md` is a destination someone
  may actually open, so it earns its place; keep those.
- The `repo@hash` form still applies wherever hashes *do* appear (drawers) whenever the commit is
  not this repo's — a bare hash is read as local, so an unprefixed one from a related repo is worse
  than no hash.

- **No unexplained internals.** An env var, a function, a table, a flag — gloss it in plain words on
  first mention, or cut it. `CCA_LICENSE_KEYS` becomes "the license key on the server".
- **Cut the shorthand that only parses inside the codebase.** "Counters in, display object out",
  "inert", "existing callers", "the mapping" — if a sentence needs the reader to know the
  architecture, it is a code comment that wandered into a report.
- **A number gets a meaning, not just a unit.** "94 tests" is a fact; "94 tests came with it, so the
  paid path is still covered" is why anyone cares.
- **Name the actor — never "someone".** "it does nothing until someone sets the license key" reads as
  *anyone could*, which quietly demotes an open item to background. Write **we**: "until we set the
  license key on the server". Same laundering as the passive voice, and the scrum master is asking
  precisely the question it hides — *is this ours?* Keep "someone" only for a genuine stranger — a
  customer, a reader of the repo — never for a person on the team.
- **Never animate the software.** Code does not "wake up", "go to sleep", "come alive", "know about",
  "learn", "want", or "sit dormant". Write the mechanism in flat words instead: it **runs** when the
  key is set; it **does nothing** until then. The figure of speech feels like plain English because it
  avoids jargon, but it costs the reader a translation step — and a scrum master repeating "it wakes
  up" to the team has to explain what that means anyway.
- **The test:** could the reader repeat this to the team tomorrow morning without opening the code?
  If not, rewrite it.

```
✗ Counters in, display object out; inert until CCA_LICENSE_KEYS is present, so merging it
  changed nothing for existing callers — proswitch-api@bc4e303, fb15638, 7c407e0, ab6cb17.

✓ Merged the paid tier's usage check, switched off — it does nothing until we set
  the license key on the server.                                                  (20 words)
```

**It holds hardest in the `.lede`**, which is read first and is the part that gets quoted onward:
"The paid verdict endpoint is live in `main`" becomes "Merged the paid usage check, switched off" —
plain words, and active, per the voice rules below. Same for the `.more-body` drawers; every prose
surface on this page has the same reader.

It **departs from** `C:\CODE\ux\copy\warnings-name-the-trigger.md`, which parks mechanism behind a
details affordance rather than in the headline. This page has no such affordance to park it in, so
mechanism either fits the line in plain words or waits for the reader to ask.

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

**The drawer is the page's only expandable thing, and it holds items — never evidence.** What
opens is *a list continuing*, which is why it continues in place rather than on some other surface.
It also sits below both headline items, so expanding it pushes nothing that matters. Overflow items
follow the same rule as the headlines: one line, complete on its own, nothing behind them.

### `Next steps` item one is tagged `Start here`

The first item in `Next steps` is the single thing tomorrow opens with, and it says so:

```html
<p class="item"><span class="chip">Start here</span><span class="lede">SSH the API box and read
which branch its checkout is on</span> — that answer decides whether anything below matters.
<span class="owner">Ours · 5 min</span></p>
```

**One item, never two.** If two genuinely tie for first, the day has not been thought through yet.

### Marks and owner tags

- **`⛔` prefixes a blocked item**, in either the headline or a drawer. It means work is stopped,
  not merely unstarted.
- **Every `Next steps` item ends with an owner tag** — `<span class="owner">Ours · 2 lines</span>`,
  `Ours · ~10 min`, `Yours · a decision`. With blocked and unblocked items in one list, the tag is
  the only thing telling the reader which ones they can just go do. An item with no owner is how a
  loop sits open for two months.
- Estimates are marked as estimates (`~`), sized off the item in front of you. **Never round up to
  look substantial.**

### ⛔ The rules that make it a wrap-up instead of noise

- **Every item leads with a verb — both sections.** `Done today` in the past tense, `Next steps` in
  the imperative: *"Completed the cost-control plan"* · *"Repoint the deploy pipeline at the live
  box"*. One tense apart, so both sections scan as actions instead of a list of facts beside a list
  of orders. A `Next steps` item's *condition* — "the deploy pipeline points at a dead box" — goes
  in its detail block; the headline names the action, because that is what makes it a step.
- **⛔ `Done today` is active voice, never a state description.** *"The cost-control plan is
  finished"* reports a condition the plan arrived at by itself; *"Completed the cost-control plan"*
  says a person did it. The passive drops the actor, which is the thing a wrap-up exists to record.
- **Name the outcome, not the activity** — so the verb has to be a finished one. "Merged", "Fixed",
  "Moved", "Deleted", "Completed" name a result; "Worked on", "Looked at", "Started", "Continued"
  name effort. Verb-first does not by itself make an item: *"Worked on `sync-hook-fleet.js`"*
  satisfies both rules above and still reports nothing.
- **A bare hash means this repo; anything else is `repo@hash`.** The report has one project, so the
  prefix is what marks the exception — a hash from `cca-cost-control` without it is unverifiable
  from this checkout, and reads as if the work happened here.
- **Surface the unwelcome findings.** A broken pipeline, a deploy that did not take, a suite
  skipped rather than passed — those outrank wins for the two `Next steps` slots. A wrap-up that
  only lists wins is a wrap-up that gets read once.
- **Do not pad `Done today`.** If the day's real output was one commit and a diagnosis, the second slot
  goes empty rather than inventing a peer for the first.
- **Nothing open → `Next steps` holds one line saying so.** The section stays; "nothing is open" is
  the single most useful thing a wrap-up can report, and deleting the section hides it.
- **Another session's work is reported, never touched.** Read `git log` and `git status` there;
  write nothing, and say a live sibling owns it.

### The style block to append

The shared template has no rules for these classes. Paste this **verbatim** immediately before
`</style>` in the instantiated file — do not restyle it per report, or two days' wrap-ups stop
looking like the same document:

```css
  /* ── two-section shape: two headline items per section, overflow in a labeled drawer ── */
  .title .when{display:block;margin-top:5px;font-size:.58em;font-weight:600;
    letter-spacing:-.01em;color:var(--muted);}
  .item{margin:0 0 18px;font-size:19px;line-height:1.5;color:var(--ink);}
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

One rule in there is load-bearing, not taste: **`details.more{border:none}`** — the template's
`details:last-of-type` adds a bottom rule, and a nested drawer is last-of-type inside its own
parent, so without the override every drawer draws a stray line across the section.

**The script is the template's, unchanged.** `toggle-all` is the only behavior on the page; there
is no second listener to append, because there is nothing to open but the sections and the drawers.

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
as `reports/eod/<YYYY-DD-MON>.md` — the project name as the first line, `#` for the title,
`## Done today` and `## Next steps`, the same two-items-plus-overflow shape with the overflow as a
nested list — and skip the browser open. The shape ports cleanly because there is nothing
interactive to port: an item is one line either way. Say in the report that the page is markdown
and why.

## What it will never do

- **Commit or push anything**, including its own output. See Step 4.
- **Act on a finding.** It reports a red pipeline; fixing it is the next session's work.
- **Pad the day.** One commit and a diagnosis is a legitimate day, reported as such.
- **Add a third section**, a lead-in, or a summary paragraph. Two collapsed sections, nothing else.
- **Write outside `reports/eod/`**, or inside a worktree.
- **Read a whole plan doc or a whole transcript.** Ledger tail, substep list, transcript tail.
- **Trust a transcript over git.** A session that says it committed and has no hash did not.
