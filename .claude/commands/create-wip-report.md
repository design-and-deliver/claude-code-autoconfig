<!-- @description Snapshot every open Claude session on this repo into one WIP note each — description, work complete, work remaining, merge issues. -->
<!-- @version 2 -->
<!-- @param all | flag | optional | Include idle sessions, not just active ones. -->
<!-- @param mine | flag | optional | Write only this session's note (refresh before a /clear). -->
<!-- @response report | One line per note written, then the single sharpest cross-session finding. -->
<!-- @sideeffect Writes WIP/<YYYY-DD-MON>/<goal-slug>.html + index.html in the BASE checkout. Deliberately untracked. -->
<!-- @example /create-wip-report | Snapshot every active session -->
<!-- @example /create-wip-report mine | Refresh just this session's note -->
<!-- @example /create-wip-report all | Include idle sessions too -->

# /create-wip-report

Half a dozen sessions run against this repo at once and every one of them holds state that exists
nowhere but its own context window. `/fleet` says who is live and what sits unlanded in a worktree;
`/plan-progress` says how far a plan doc got. Neither says **what each session is actually trying to
accomplish, how far it got, and what would break if it died right now.** That is what a WIP note is.

Write them at a natural pause — before a batch of `/clear`s, before stepping away, before a merge
train. They are a snapshot, not a log: cheap to regenerate, never edited in place.

**READ-ONLY toward the repo.** It never merges, commits, reaps a worktree, runs the hook-fleet
actuator, or touches another session's files. It reports.

## Step 1 — the roster

```bash
node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/fleet.js"
```

Take the `SESSIONS` block and the `UNLANDED` block. Ignore the `⚠ IN-FLIGHT` collision warnings —
they are computed over all history and name dozens of dead sessions across every repo on this box;
they are noise here. The `⚠ SAME-TREE COLLISION` block is *not* noise: two live sessions sharing one
working tree is a merge issue every note in that tree must mention.

- Default: the sessions `fleet` lists as `● LIVE` and `○ RECENT`.
- `all` in `$ARGUMENTS`: add `--all` and include idle ones too.
- `mine` in `$ARGUMENTS`: skip the roster entirely — one note, this session, from your own context.

Each roster row gives you the session id, its working tree (`base` or a `worktree-<name>` branch),
and its terminal title. The title is the session's own statement of its goal — it is the strongest
single signal you have, and it seeds the note's `# ` heading.

## Step 2 — one subagent per session

Do **not** read five transcripts inline. Each is tens of thousands of tokens and none of it belongs
in this session's context. Spawn one `general-purpose` agent per session, all in one message so they
run concurrently, and have each agent write its own file and return **one line**.

Give each agent: the session id, its transcript path
(`~/.claude/projects/<project-slug>/<sid>.jsonl` — check every project-slug directory, a worktree
session lives under its own slug), its working tree, its title, Step 3's slot mapping and its
⛔ template rule (**each agent Reads `~/.claude/skills/create-web-page/template.html` itself** —
5KB, and the alternative is five agents each drifting the format from memory), and the
work-remaining format in Step 4.

Tell each agent to establish, from evidence and not from the transcript's own claims:

- **the goal** — from the title and the session's opening prompts, phrased as an imperative.
- **what landed** — `git log` in that session's tree, with hashes. A transcript saying "done" and
  a missing commit disagree; git wins. Note whether the commits are pushed: this repo lands on
  local `main` and pushes in batches, so "committed" and "on origin" are different states.
- **what is uncommitted** — `git status --short` in that session's tree.
- **the plan, if any** — a `docs/*.md` or `.claude/plans/*.md` the session opened that has a
  `## Ledger`. Read the Ledger tail and the substep list, never the whole doc. `.claude/plans/` is
  gitignored here, so a plan edit there will not show in `git status` — the Ledger is the record.
- **writes outside this repo** — a session that also commits to the private `cca-cost-control` repo,
  or that publishes hooks into `~/.claude` and the fleet repos via `scripts/sync-hook-fleet.js`,
  has hazards git-in-this-repo cannot see. Name the other repo and its branch.

Your own session writes its own note directly — you already have that context; a subagent would
only re-derive it worse.

## Step 3 — the note

One file per session at `WIP/<YYYY-DD-MON>/<goal-slug>.html` — e.g. `WIP/2026-19-AUG/`. Always in
the **base checkout** (`C:\CODE\claude-code-autoconfig`), never inside `.claude/worktrees/`, so
every session's note lands in one folder. The slug is the goal in kebab-case, verb first,
parentheticals dropped, ~5 words: "Gate the WIP report command out of user installs" →
`gate-the-wip-report-command.html`.

Notes render as HTML in the `create-web-page` house style — collapsed sections, so a folder of
six notes is skimmable at headline level and expands only where the reader cares. They are **not**
ARTICLES pages: same stylesheet, different archive, never opened automatically.

### ⛔ Instantiate the template from the FILE, never from memory

```
C:\Users\andre\.claude\skills\create-web-page\template.html    (95 lines, ~5KB)
```

**Every agent Reads that file before writing its note.** Reproducing it from memory — or cloning
a previous WIP note — is how the format drifts: the `<style>` block and the `toggle-all` script
get dropped and the page renders as unstyled serif text with a dead button. If the template is
missing (another box, a fresh checkout), say so and fall back to the markdown shape in the
`## Fallback` section at the bottom — do not improvise a stylesheet.

**Output self-check, per note:** the file starts at `<!DOCTYPE html>`, and contains both the full
`<style>` block and the `toggle-all` `<script>`. A file starting at `<p class="stamp">` is a naked
fragment — redo it from the template.

### Slot mapping

| Template slot | WIP note content |
|---|---|
| `<title>` | the goal, plain text |
| `.stamp` | `Snapshot — 2026-08-19 4:12PM` (local, `date "+%B %-d, %Y %-I:%M%p"`) |
| `.title` | **the goal as an imperative** — the session's use case, not its last task |
| `.dek` | the metadata line: session id · working tree · plan · also-writes (see below) |
| `.lead-in` | **ONE paragraph, 45 words hard cap** — see below |
| `<details>` ×4 | `Background` · `Work complete` · `Work remaining` · `Merge issues` |

### ⛔ The lead-in is a status reply, in one short paragraph

**Write it as you would answer a senior manager who stops you and asks "what's the status on X?"**
Not a description of the work — a report of where it stands. That is a different genre, and getting
it wrong is the single most common failure of these notes. Four things, in this order:

1. **The state, in the first clause** — shipped / ready but not shipped / blocked / in progress.
   Where the thing *is*. Never open on a diagnosis of why it isn't somewhere else.
2. **The impact, if any** — is something broken for a user right now? This is the sentence the
   reader actually needs, and it is the one most often missing entirely.
3. **What is holding it** — one clause, plain language, no machinery.
4. **The ask or the next action, with its size** — so the reader is not left composing questions.

Everything else is `Background`. This is the only prose the reader sees before the fold, so it is
worth more than everything below it, and it stops working the moment it becomes a narrative.

**Worked example.** This version is short, accurate, and still fails:

```html
<p class="lead-in">The next release is stuck with nobody owning it. Two sessions each got it ready,
each saw the other working on it, and each backed off to avoid a collision. Fourteen finished
changes are sitting unreleased.</p>
```

Seven objections, all of them fair:

- **It reads like a riddle.** The middle sentence is a narrative twist; the reader has to decode
  "each saw the other and each backed off" to extract "so nobody did it."
- **Implementation details.** "Sessions" is internal machinery. "Fourteen changes" is a commit
  count — an engineering unit, not a business one.
- **It raises alarm and answers nothing.** "Stuck with nobody owning it" provokes *is this urgent?
  what's broken? who should own it? what do you need from me?* — and answers none of them.
- **The most important fact is absent.** That release carries a fix for an installer crash users
  are hitting today. It is the only sentence the reader truly needs, and it is not there.
- **It opens on a diagnosis, not a state.** "Stuck" is why it has not shipped. Where it *is* — ready
  — comes first.
- **No size, so the reader over-escalates.** "Stuck" sounds like a project problem. It is a
  fifteen-minute publish.
- **No ask.** If a human decision unblocks it, name the decision.

```html
<!-- ✓ state, impact, cause, ask — 43 words -->
<p class="lead-in">The next release is ready but has not shipped. It contains a fix for an installer
crash that users are hitting today. It stalled because two parallel efforts each assumed the other
was publishing it. It needs one owner and about fifteen minutes.</p>
```

```html
<p class="lead-in">The release is ready to publish and waiting on a go-ahead. Its main fix stops
the installer from crashing during setup. Nothing was built here — this session only re-checked
that the release was safe. Publishing takes about fifteen minutes.</p>
```

That is 40 words and it is the length to beat. **Never write a second `<p class="lead-in">`** —
two paragraphs is the tell that the frame turned into a narrative. Everything that does not fit
goes into the `Background` section, which is what that section is for. Count the words before you
write the file; over 45, cut rather than rationalize.

### ⛔ And it has to be readable — the senior-manager test

Read your lead-in once, at speed. **Would a senior manager — someone who knows the product exists
but has never opened this repo — understand what the session is doing, without pausing or reading
it twice?** If not, it fails, however accurate it is. Short and unreadable is not the goal; short
and instantly clear is. Five ways it fails, all of them things a technically-correct writer does
by reflex:

- **Stacked compound adjectives.** "the installer's worktree-and-symlink-skipping backup fix" is
  three concepts welded into one noun phrase, and the reader has to unpack it before the sentence
  can finish. Say what broke, or say what the fix does — not both, hyphenated.
- **Mechanism as the subject.** "investigative `git`/`Read` calls plus its own terminal-title
  bookkeeping file" names tools and files. Nobody outside the repo knows what those are, and the
  goal is not in there anywhere.
- **Opening on the negative.** "It made no code edits itself" leads with what did *not* happen and
  buries the actual goal in sentence two. Goal first, caveats after.
- **A pronoun with no antecedent.** Starting on "It" makes the reader guess: the session, the
  command, the repo? Name the subject.
- **Abstract framing verbs.** "The underlying use case is…", "Design enforcement so…" — scaffolding
  around the sentence instead of the sentence. Say the thing directly.

Internal names are the main offender. `plan-authoring.md`, `worktree-gate.js`, "the hook fleet",
"Step 0" mean nothing to the test reader; they belong in `Background` and in the sections, where
the reader has already opted in. The lead-in gets plain English:

| ✗ fails the test | ✓ passes |
|---|---|
| Promote the hybrid phrasing of `/continue`'s Step 0 recovery announcement to the prescribed wording, then push it to every repo adopting the hook fleet. | When a session picks up where a previous one left off, it announces that in one line. Two versions of that line were in circulation; this settles which is correct and rolls it out everywhere. |
| Design enforcement so plan-driven work can't land directly on CCA's local `main`: a branch-quarantine rule in canonical `plan-authoring.md`, a fix to the worktree auto-merge step, and an extension to `worktree-gate.js`. | Work done under a multi-session plan has been landing straight on the branch we publish from, with nothing to stop it. Make that impossible — a written rule, plus an automated check that blocks it. |

The `.dek` is one line, ` · `-separated, `<code>` around identifiers:

```html
<p class="dek">Session <code>454463ff</code> · worktree <code>wip-report-command</code>
(branch <code>worktree-wip-report-command</code>) · plan <code>docs/agy-worktree-adoption-plan.md</code>,
4 of 11 substeps · also writes <code>~/.claude</code> + the hook fleet</p>
```

Drop the plan clause when the session is not plan-driven; drop the also-writes clause when it stays
inside this repo. Never leave an empty clause or a trailing ` · `.

### The four sections

Each is a `<details>` (closed — never add `open`) with its content inside `<div class="s-body">`.

- **Background** — everything the lead-in could not hold: how the session started, what it tried,
  what it discovered along the way, the constraint that shaped it. Prose, two or three short
  paragraphs. This section exists so the lead-in can stay short — if it is empty, the lead-in is
  probably doing too much. Comes first, before `Work complete`.
- **Work complete** — opens with Step 4's mirror count header as a `<p>`, then a `<ul>`. Bold the
  substep number or the change, `<code>` every hash and path.
- **Work remaining** — Step 4's format. The load-bearing section. Blockers are `<p>` elements
  above the list, each opening `⛔ <strong>…</strong>`, with the concrete next command in a
  `<pre><code>` block when it is longer than a few words.
- **Merge issues** — a `<ul>`:
  - Where the commits live, whether they are landed on `main`, and whether `main` is pushed.
  - Whose the dirty files in the shared base checkout are — never assume they are this session's.
  - Ordering hazards: the things worktrees do **not** isolate — `~/.claude` and the hook fleet, the
    live twin (`test/live-twin-parity.test.js`), `.claude/updates/` numbers, publishing.
  - "None in git" is a fine answer, but say *why* — "works in the base checkout, no worktree".

Never keep an empty section: delete the whole `<details>` rather than shipping a hollow one.

### ⛔ Two of the summaries carry a time, and the labels are not decoration

The point of the folder is seeing, at a glance, what is invested and what is left. So:

```html
<summary>Work complete (51m active)</summary>
<summary>Work remaining (~45m est.)</summary>
```

`Background` and `Merge issues` get no time — they describe, they do not cost.

**`Work complete` is MEASURED, never guessed.** Take it from the session's own transcript
timestamps, and report **active** time, not wall-clock: sum the gaps between consecutive messages
and treat any gap over 15 minutes as idle. The two diverge wildly — measured 2026-08-19, session
`663e641a` ran **9h elapsed but 3m active** (a recovery turn left open overnight), and `4e5a2a5d`
ran 11.5h elapsed / 1.5h active. Wall-clock would have reported nine hours of investment in three
minutes of work. A session with a lineage (`/continue` chains) sums all of its transcripts.

```python
# active minutes, per transcript: gaps <= 15 min count, longer ones are idle
sum(g for g in gaps_in_minutes if 0 < g <= 15)
```

Format short: `3m`, `45m`, `1.5h`, `9h`. Always append the word **`active`** — without it a
3-minute figure on a nine-hour session reads as a bug rather than as the honest number.

**`Work remaining` is an ESTIMATE, and must be marked as one** — `~` and `est.`, both. There is
nothing to measure; the work has not happened. Size it off the remaining list you just wrote:
mechanical steps (run a publish, reap a worktree) in minutes, a real code change against the repo's
own effort tags. A plan-driven session has actual `~time` tags in its plan doc — sum the unchecked
substeps and say `(~7h plan)` instead of `est.`, since that number has a source. **Never round an
estimate up to look substantial**; a 15-minute release is a 15-minute release, and inflating it
hides that the thing is one decision away from done.

Where a section is genuinely empty of cost — nothing remains — write `(none)`, not `(~0m est.)`.

### ⛔ Bullets are capped at 35 words, blockers at 50

Sections are **scanned, not read** — that is the entire reason they are lists. A bullet that runs
to paragraph length destroys the property the list exists for, and the reader who skips it loses
the fact it was carrying.

```html
<!-- ✓ 30 words. Three facts, three short sentences, no subordinate clauses. -->
<li>Both of this session's commits (<code>794c52b</code>, <code>6931fae</code>) are already on
local <code>main</code>, confirmed by <code>git log</code>. <code>main</code> is 14 commits ahead
of <code>origin/main</code>, unpushed. <code>git status --short</code> is clean.</li>
```

That is the shape to copy: **short declarative sentences, stacked.** Not one sentence with three
subordinate clauses hanging off it. Density is fine — brevity is about sentence length, not about
how many facts you are allowed.

Over 35 words, do one of two things:

1. **Split into two bullets.** Usually the long one is carrying a finding *and* its implication.
   Those are two bullets.
2. **Move the reasoning to `Background`, keep the conclusion.** If the split produces two bullets
   that only make sense read together, it was never a bullet — it was prose wearing a dash.
3. **Nest a sub-list** where the extra items are genuinely subordinate to the bullet ("…fixed two
   defects:" → a `<ul>` of the two). The parent's own sentence still counts against 35 on its own;
   the children each get their own 35.

The `⛔` blocker paragraphs above a list get **50 words**, because they must carry the reason as
well as the instruction. Same discipline otherwise; the concrete command goes in its own
`<pre><code>` block rather than swelling the sentence.

`Background` prose is uncapped — it is the one section written to be read straight through, and
it is where everything the cap displaces belongs. **Count before you write.** Roughly half the
bullets in the first real run of this command broke this rule, the worst at 131 words.

## Step 4 — the count headers and the remaining list

**Plan-driven session.** A lead line, then one bullet per remaining substep — verbatim number,
size tag, and `~time` from the plan doc, with the title compressed to a short lowercase clause:

```html
<p>Seven substeps left, 4 of 11 done (~7h nominal):</p>
<ul>
  <li>3.1 · L · ~2h — teach the launcher to adopt an existing worktree</li>
  <li>3.2 · M · ~1h — reap orphans without recursing through a junction</li>
  <li>3.3 · M · ~1h — surface the fleet roster in the gate's refusal</li>
</ul>
```

- Count in words up to ten, digits above. `K of T done` comes straight from the checkbox tally.
- The parenthetical sums the `~time` tags. Say **nominal** — the tags are authoring-time hints,
  not measurements, and a substep that hits a ⛔ trap doubles.
- No bold, no numbering, no prose inside a bullet. The list is scannable or it is worthless.

**Work complete opens with the mirror header** — same grammar, same parenthetical, as its first
line, so the two sections read as one progress bar instead of two unrelated lists:

```html
<p>Four substeps done of 11 (~4h nominal):</p>
```

It is `done of T`, not `K done, K of T` — the count already *is* the done count, and repeating it
reads as a typo. The parenthetical sums the `~time` tags of the **done** substeps, so the two
headers add up to the plan's whole nominal budget. A session with no plan gets no header on
either section: there is no denominator to count against.

**Blockers are not substeps.** Anything that must happen before the next substep can ship — a
worktree to reap, a fleet sync to run from base, another session to finish, a release to push —
goes on its own `⛔` line *above* the lead line, with the concrete next command. Numbering a
blocker into the substep list hides it.

```html
<p>⛔ <strong>Land this worktree before running the fleet actuator</strong> —
<code>sync-hook-fleet.js --write</code> run from a worktree publishes that worktree's
possibly-older hooks over newer work in <code>~/.claude</code> and every fleet repo. Merge to
<code>main</code> in the base checkout first, then:</p>
<pre><code>node scripts/sync-hook-fleet.js --write</code></pre>

<p>Seven substeps left, 4 of 11 done (~7h nominal):</p>
```

**Session with no plan.** Plain bullets, most-blocking first, each naming the concrete next action
and where it must run — not a topic. "Reap the orphan `.claude/worktrees/token-guard-r16`, from a
*fresh* session in the base checkout: `node .claude/scripts/sync-worktrees.js --write
--keep-branches`" is an item. "Clean up worktrees" is not.

## Step 5 — the index

Once every note is written, write `WIP/<YYYY-DD-MON>/index.html` from the same template, so the
folder opens as one page instead of a directory listing. It is the only file that reads the others.

- `.title` — `WIP — <date>`; `.stamp` — the snapshot time; `.dek` — `<N> sessions · <T> invested ·
  ~<R> remaining · base <branch>, <K> commits ahead of origin`, where `T` and `R` are the sums of
  the per-note active and estimated times. That one line is the whole folder's bottom line.
- `.lead-in` — the **cross-session finding** from Step 6, under the same 45-word cap as a note's.
  It is the one thing the folder knows that no single note does, so it goes above the fold. State
  the finding and the evidence; everything else waits.
- A first `<details>` naming the finding, holding what the lead-in could not: why it happened, the
  verified numbers, and what resolving it would take. Then one `<details>` per note, `<summary>` =
  the note's goal followed by its two times — `Ship the release (3m active · ~15m est.)` — body =
  a one-sentence status plus `<a href="<slug>.html">open</a>`. Order most-blocked first, not
  alphabetically.
- Skip the index on `mine` — a single refreshed note does not restate the fleet.

## Step 6 — report

List the files written, one line each, with the session id. Then **one** cross-session finding —
the sharpest thing the notes revealed that no single session could see (two sessions sharing a
working tree, two queued on the same file, an unpushed release nobody owns, two worktrees both
claiming the next `.claude/updates/` number). One. Not a digest of the notes you just wrote; the
user can open them.

Give the index's path last, as the one thing worth opening. Do **not** open a browser — unlike
`/create-web-page`, this writes an archive the user visits when they choose to.

Close by saying the folder is untracked and why: WIP notes go stale within hours and would churn
on every merge. They are never committed and never merged — the next `/create-wip-report` replaces
them.

## Fallback — no template

Only when `~/.claude/skills/create-web-page/template.html` does not exist. Write the same content
as `<goal-slug>.md`, `#` for the goal, a bullet list for the `.dek` fields, `##` for each of the
three sections, and skip the index. Say in the report that notes are markdown and why.

## What it will never do

- **Act on a finding.** It surfaces a collision; standing a session down is the user's call.
- **Touch another session's tree.** Read `git log` and `git status` there; write nothing.
- **Read a whole plan doc or a whole transcript.** Ledger tail, substep list, transcript tail.
- **Trust a transcript over git.** A session that says it committed and has no hash did not.
- **Run anything that writes outside this repo** — no `sync-hook-fleet.js --write`, no `npm
  version`, no publish. Those are base-checkout, one-session-at-a-time operations.
