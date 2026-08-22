<!-- @description End-of-day wrap-up: what got done and what's next, as two collapsible sections on an HTML page. -->
<!-- @version 8 -->
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

**Output self-check:** the file starts at `<!DOCTYPE html>` and contains the full `<style>` block,
the `toggle-all` `<script>`, the `.mask` shell, and one `.detail` block per `Details` link. A file
starting at `<p class="stamp">` is a naked fragment — redo it from the template. A `Details` link
whose `href` matches no id is a dead link: the modal silently declines to open.

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

Two things are not exceptions to this, because neither renders: the `.detail` blocks (hidden,
adjacent to their items, inside the sections) and the modal shell (a sibling *after* `.article`
closes). Nothing visible joins the two sections.

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

A headline item is one line, **25 words**, with the outcome clause bolded via `.lede`. When it has
evidence to show, it ends with a `Details` link:

```html
<p class="item">⛔ <span class="lede">Point the automatic deploy at the current server</span>
— the address it uses stopped being ours in June. <span class="owner">Ours · ~20 min</span>
<a class="det" href="#n2">Details</a></p>
<div class="detail" id="n2">
  <p>It times out rather than errors, so releases have looked fine while nothing reached the
  live site for two months — <code>.claude/retro/deploy-workflow-stale-ip.md</code>.</p>
</div>
```

**A `Details` link is earned, not standard issue.** The block behind it is where the hashes, the
commands, the reasoning, and the `<pre><code>` fix blocks live. The headline says what; the detail
says how you know — so it earns its place only by carrying something the headline does not.

⛔ **If the detail would restate the headline, delete the link and the block.** Some items really are
one sentence long: a thing was merged, it is switched off, that is the whole story. A rule that
attaches a block to every item is what manufactures the paraphrase — the reader clicks `Details`,
gets the line they just read in longer words, and learns that this report's links do not pay. One
of those teaches them to stop opening the ones that would have.

#### ⛔ The check: could the reader have believed the opposite?

Not "name the fact it adds" — that is a judgment call, and it passes anything you can phrase
confidently. **Negate each sentence of the block. If the negation is absurd given the headline, the
sentence carries no information.** Every sentence failing that means no block and no link.

Worked example — headline *"Completed the cost-control plan — one copy of the logic now, in the
private service."*

| Sentence | Negated | Verdict |
|---|---|---|
| "used to live in two places" | "used to live in one place" | absurd — `now` already said it |
| "that could quietly disagree" | "two copies that always agreed" | absurd — that is what two copies means |
| "one copy now, in the private service" | — | verbatim the headline |
| "the public tool reads from it" | "the public tool ignores it" | absurd — the tool works |
| "the plan's last item, so finished not paused" | "the plan is paused" | contradicted by the headline |

Five for five, so that item ships with **no link at all**. Compare the deploy block above: *"it times
out rather than errors"* negates to *"releases failed loudly"* — perfectly believable, and wrong.
That is what a fact looks like.

**Three idioms generate the empty sentences.** They are recognizable while typing, which the
judgment call is not:

1. **Spelling out an entailment** — "one copy *now*" → "used to live in two places". The tense
   already carried it.
2. **Naming the obvious consequence** — two copies "could quietly disagree". That is the definition,
   not a finding.
3. **Negating an alternative nobody raised** — "finished rather than paused". `Finished` is not
   ambiguous; denying an unheld reading manufactures a sentence out of nothing.

Each one produces a clause the previous sentence did not literally contain, which is exactly why it
feels like elaboration while writing. **Novelty of wording is not novelty of information.**

⛔ **The modal's heading repeating the `.lede` is by design — never count it as evidence.** The
script sets `sheetH.textContent` from the item's own `.lede` on purpose, so the reader knows which
item they opened. Apply the test to the block's **body only**; a body that survives it is earning
its place even though the heading above it is a verbatim repeat.

### ⛔ Detail opens in a modal — it never expands in place

`.detail` divs are `display:none` and are **never** read where they sit. The `Details` link opens
the shared modal (the shell and script below), which lifts that block onto a `rgba(255,255,255,.95)`
white mask with the item's own `.lede` as the modal's heading.

The reason is the two-item cap. An inline drawer pushes item two down the page the moment item one
is opened, so reading the evidence for the first item costs you the ranking the section exists to
show. A modal leaves the two items exactly where they are — you drop into the detail and come back
to an unmoved page.

Rules that follow from it:

- **The link text is the bare word `Details`** — not "detail", "more", "why", or a count. It is a
  destination, so it reads like one.
- **It sits at the END of the sentence**, after the owner tag on a `Next steps` item. Last thing on
  the line, every time, so the eye finds it in the same place down the column.
- **`href` is the `.detail` block's own `#id`**, never `#`. Ids are `d1`, `d2`, `n1`, `n2` — section
  letter plus position — so a link and its block are checkable by eye.
- **The `.detail` block goes immediately after its `<p class="item">`**, never at the bottom of the
  file. It is hidden either way; keeping it adjacent is what makes the pair editable.
- **Each `.detail` holds `<p>` and `<ul>`/`<pre>` only — no heading.** The modal writes the heading
  itself from the item's `.lede`; a heading inside the block prints it twice.

### ⛔ Write the detail for the scrum master, not the committer

The person who opens `Details` runs the standup; they did not write the code. They are reading to
answer one question — *can I tell the team this is done, and does anyone have to do anything?* So
every `.detail` block answers up to three things, in this order — **and only the ones that have a
real answer.** This is a ranking, not a template: a block answering one of them and stopping is
correct, and is more common than a block answering all three. Treating it as three slots to fill is
what produced the empty block above, so run the negation test on each sentence before it ships:

1. **What changed**, in the product's terms.
2. **What it means** — who can now do what, or what deliberately stays the same.
3. **What it needs** — *only when it needs something.*

**Answer three only if the answer is not "nothing".** "Nobody is blocked", "nothing needed from
anyone", "no action required" — an item that ends without an ask has already said that, and a line
that appears under every item stops being read under any of them. Say it when there is a real
decision waiting, and stay silent otherwise.

It wears a second disguise that is easy to miss: **"that's a separate decision", "not scheduled
yet", "we'll look at it later"** announce that nothing follows from the item — the same non-ask with
a calendar bolted on. A real answer three names a person and what they must decide; anything short
of that is the item ending, so let it end.

**Do not restate answer two in fresh words either.** "It does nothing until we set the license
key" already tells the reader nothing changed for users; a sentence adding "so nothing changed for
users today" is the previous sentence wearing a bow.

**Two short paragraphs, 50 words, hard cap.** If the answers genuinely will not fit, the headline is
carrying two items and wants splitting. A modal that scrolls has stopped being an answer and become
a document, which is the thing the reader opened it to avoid.

### ⛔ No hash trails in a detail

A `Details` block gets **one identifier, or none** — and "none" is the common case. The person
reading it runs the standup; they will never type a commit hash, so a trailing
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

**It holds for the headline `.lede` too, and there it is structural**: the modal takes its heading
straight from the item's `.lede`, so a jargon headline puts jargon on top of the plain-English block
underneath it. "The paid verdict endpoint is live in `main`" becomes "Merged the paid usage check,
switched off" — plain words, and active, per the voice rules below. Same for the `.more-body`
drawers; every prose surface on this page has the same reader.

It also **sharpens** `C:\CODE\ux\copy\warnings-name-the-trigger.md`, which parks mechanism behind a
details affordance rather than in the headline. Mechanism stays parked there; this says it arrives
*after* the meaning, as provenance, never instead of it.

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

**The overflow stays a drawer — do not convert it to a modal.** The two are answering different
questions. A `Details` link opens *evidence for one item*, so it wants a surface that leaves the
page still; a `.rest` drawer opens *more items*, which is a list continuing, and a list continues
in place. It also sits below both headline items, so expanding it pushes nothing that matters.
Overflow items are already brief enough not to need a `Details` link of their own.

### `Next steps` item one is tagged `Start here`

The first item in `Next steps` is the single thing tomorrow opens with, and it says so:

```html
<p class="item"><span class="chip">Start here</span><span class="lede">SSH the API box and read
which branch its checkout is on</span> — that answer decides whether anything below matters.
<span class="owner">Ours · 5 min</span> <a class="det" href="#n1">Details</a></p>
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
  /* ── two-section shape: two headline items per section, detail behind a Details link ── */
  .title .when{display:block;margin-top:5px;font-size:.58em;font-weight:600;
    letter-spacing:-.01em;color:var(--muted);}
  .item{margin:0 0 18px;font-size:19px;line-height:1.5;color:var(--ink);}
  .item .lede{font-weight:700;}
  .item .owner{color:var(--muted);font-size:16px;font-style:italic;}
  .chip{display:inline-block;font-size:12px;font-weight:700;text-transform:uppercase;
    letter-spacing:.06em;color:#fff;background:var(--link);border-radius:4px;
    padding:2px 7px;margin-right:8px;vertical-align:2px;}
  .det{color:var(--link);text-decoration:none;font-size:17px;white-space:nowrap;
    border-bottom:1px solid rgba(10,102,194,.35);cursor:pointer;}
  .det:hover{border-bottom-color:var(--link);}
  .detail{display:none;}
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
  /* ── detail modal: .95 white mask, one shell reused by every Details link ── */
  .mask{position:fixed;inset:0;z-index:100;background:rgba(255,255,255,.95);
    display:flex;align-items:center;justify-content:center;padding:40px 20px;}
  .mask[hidden]{display:none;}
  .sheet{position:relative;background:#fff;border:1px solid var(--rule);border-radius:12px;
    box-shadow:0 12px 44px rgba(0,0,0,.14);width:100%;max-width:640px;max-height:80vh;
    overflow:auto;padding:30px 34px 28px;}
  .sheet h3{margin:0 0 16px;padding-right:28px;font-size:22px;line-height:1.3;
    font-weight:700;color:var(--ink);letter-spacing:-.01em;}
  .sheet-body{font-size:18px;line-height:1.6;color:var(--body);}
  .sheet-body p{margin:0 0 .8em;} .sheet-body p:last-child{margin-bottom:0;}
  .sheet-body ul{padding-left:20px;margin:0 0 .8em;}
  .sheet-x{position:absolute;top:12px;right:14px;background:none;border:none;cursor:pointer;
    font:400 26px/1 -apple-system,system-ui,sans-serif;color:var(--muted);padding:2px 6px;}
  .sheet-x:hover{color:var(--ink);}
```

Two rules in there are load-bearing, not taste:

- **`details.more{border:none}`** — the template's `details:last-of-type` adds a bottom rule, and a
  nested drawer is last-of-type inside its own parent, so without the override every drawer draws a
  stray line across the section.
- **`.mask[hidden]{display:none}`** — `display:flex` beats the `hidden` attribute, so without this
  the modal is open on page load, covering the report with a white sheet.

### The modal shell and its script

Paste the shell **after** the closing `</div>` of `.article`, as a sibling — inside the article it
inherits the 700px column and stops centering on the viewport:

```html
<div class="mask" id="mask" hidden>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h">
    <button class="sheet-x" aria-label="Close">&times;</button>
    <h3 id="sheet-h"></h3>
    <div class="sheet-body"></div>
  </div>
</div>
```

And append this to the template's existing `<script>`, below the `toggle-all` handler — one
delegated listener serves every link, so items cost nothing to add:

```js
  var mask=document.getElementById('mask'),
      sheetH=mask.querySelector('h3'),
      sheetB=mask.querySelector('.sheet-body'),
      opener=null;
  function openDetail(link){
    var src=document.querySelector(link.getAttribute('href'));
    if(!src)return;
    var item=link.closest('.item'), lede=item&&item.querySelector('.lede');
    sheetH.textContent=lede?lede.textContent:'Details';
    sheetB.innerHTML=src.innerHTML;
    opener=link; mask.hidden=false;
    mask.querySelector('.sheet-x').focus();
  }
  function closeDetail(){
    mask.hidden=true; sheetB.innerHTML='';
    if(opener){opener.focus();opener=null;}
  }
  document.addEventListener('click',function(e){
    var link=e.target.closest('.det');
    if(link){e.preventDefault();openDetail(link);return;}
    if(e.target===mask||e.target.closest('.sheet-x'))closeDetail();
  });
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&!mask.hidden)closeDetail();
  });
```

Three closes — the `×`, a click on the mask, and `Escape` — and focus returns to the link that
opened it. `e.target===mask` is deliberate: a click that lands on the sheet bubbles to the same
listener, and testing the target identity is what keeps it from closing under your own cursor.

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
`## Done today` and `## Next steps`, the same two-items-plus-overflow shape with the overflow as a nested list — and
skip the browser open. There is no modal in markdown: each item's detail becomes an indented
paragraph under it, and no `Details` link is written. Say in the report that the page is markdown
and why.

## What it will never do

- **Commit or push anything**, including its own output. See Step 4.
- **Act on a finding.** It reports a red pipeline; fixing it is the next session's work.
- **Pad the day.** One commit and a diagnosis is a legitimate day, reported as such.
- **Add a third section**, a lead-in, or a summary paragraph. Two collapsed sections, nothing else.
- **Write outside `reports/eod/`**, or inside a worktree.
- **Read a whole plan doc or a whole transcript.** Ledger tail, substep list, transcript tail.
- **Trust a transcript over git.** A session that says it committed and has no hash did not.
