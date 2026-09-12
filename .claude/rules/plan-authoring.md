# Plan authoring — session-sized steps + handoff ledger

Applies whenever authoring a multi-phase plan/spec doc that will be executed across more than
one session (e.g. by /up-to-snuff). The plan is a self-contained doc a fresh session can execute
with zero prior conversation context.

**This file is CANONICAL and repo-agnostic — keep it that way.** Adopting repos hold a
byte-identical copy at `.claude/rules/plan-authoring.md`, kept in sync by
`scripts/sync-hook-fleet.js` (CCA is the source; a repo without the file is not adopting it and
is never given one). So: edit THIS copy, then run the actuator — a hand-edit in an adopting repo
is reverted by the next `--write`. Repo-specific facts (which files are the god files, what the
test command is) belong in that repo's plan docs and CLAUDE.md, **not here**; hand-porting is
exactly what let the two copies drift apart between 2026-06 and 2026-07-25 with neither a
superset.

## When a plan is required

**Any task beyond small is executed plan-based** (standing agreement, 2026-08-05). If the work
plausibly exceeds one normal session-sized task (~100k tokens — a multi-file feature, a
migration, anything that will span sessions), author the plan doc FIRST, get a go-ahead, then
execute one substep per fresh session. The Ledger is the reason: plan-aware /continue resumes
from it losslessly, where transcript recovery is thin and lossy (interrupted writes, dropped
tails). Token-guard's R13a steer quotes the same bar on every prompt.

## Where plans live

`docs/*.md` (tracked — Ledger history rides in git) or `.claude/plans/*.md` (local working
plans, gitignored in some repos). Tooling that discovers plans (/continue's plan probe,
/plan-progress) must scan BOTH directories. A gitignored plan's Ledger-only "commit" steps
are no-ops — there the Ledger entry itself is the durable record, so skip those commits.

## ⛔ Branch discipline — one branch per plan, merged once

A plan is an all-or-nothing transaction, so it needs somewhere to be incomplete safely. That
place is a branch, never the default branch.

- **One branch per plan**, named after the plan's alias (`plan/<alias>`), created by the first
  substep's session and re-entered by every later one. **Record that branch name in the plan
  doc's header**, so a fresh session finds it without guessing. The unit of isolation is the
  plan, not the substep — a branch per substep is the same big-bang merge in more pieces.
- **Never execute a substep on the default branch.** A plan that lands substep by substep
  straight into `main` has no isolation and nothing to revert as a unit, and any release cut
  from `main` mid-plan ships half a feature to users.
- **Refresh from the default branch at every substep boundary** (`git merge main` on the plan
  branch, before starting the next substep). This is the whole safety mechanism. Textual
  conflicts are rare; what a stale branch actually defers is the *semantic* break, and
  refreshing per substep surfaces it the same day instead of at one big merge at the end.
- ⛔ **Merge to the default branch ONCE, when the whole plan is done — never a phase, never a
  substep.** Merging phase 1 of 3 puts half a feature in `main`: an extracted module nothing
  calls yet, a migration for a table nothing reads, a flag no UI sets. If the plan then dies,
  that junk is indistinguishable from live code and stays forever.
- **If a phase is worth merging on its own, it was never a phase — it was a separate plan.**
  That is the escape valve, and it belongs at *authoring* time: split it into its own plan doc
  with its own branch. The only mid-plan exception is a genuine hotfix that happens to live on
  the branch — cherry-pick that one commit onto the default branch, never merge the phase.

That last rule is what makes the per-substep refresh **mandatory rather than advisory**: one
merge at the end is only cheap because the branch absorbed the default branch continuously on
the way there. Skip the refresh and you have rebuilt the big-bang merge this section avoids.

Two consequences worth stating in the plan's header, because they are why executors comply:
abandoning a plan is exactly one `git branch -D`, at any point in its life; and
`git log main..plan/<alias>` is the plan's whole reviewable delta.

**The base branch is the release branch, not necessarily the default.** Where a repo deploys
from a branch other than its default, the plan branch is cut from and merged back to THAT
branch, and the header names it — a merge to the default would ship nothing.
**Multi-repo plans:** the doc lives in the repo taking most of the commits; every other repo
gets a branch of the same name; each merges once, at the plan's end; and the header says
which substeps commit where, because /continue's sibling and git probes see only the doc's
own repo.

## Structure

1. **Header**: goal, links to source audits/evidence, and "how to execute" (one substep per
   fresh session; Verify; commit; Ledger entry; then `/clear` + `/continue` — /continue (v2+)
   is plan-aware: it detects the plan-substep session via the title history, reads the Ledger,
   verifies the last commit hash against git, and (v9+) reports the next unchecked substep on
   a cheap recovery model, executing it on the session's main model after your go-ahead.
   Fallback where /continue is absent: start a fresh session pointed at the plan doc).
   The header also carries the **read-this-doc-in-slices instruction**: name the ⛔ trap
   section's line range and tell the session to read that range + its own substep + the Ledger
   tail, never the whole plan (see Read budget). It also names the plan's **branch**
   (`plan/<alias>`) — see Branch discipline; a header that omits it makes every executing
   session guess, and the cheapest wrong guess is `main`. And it names the **target
   environment** whenever the deliverable runs anywhere but the authoring machine — a
   reviewer's laptop, a provisioned VM, a deploy target: the runtime prerequisites the output
   assumes (SDK / Node / DB versions) and whether the target was **verified or is an
   assumption**. The ⛔ trap section covers hazards on the machine the plan is written on; this
   line covers the machine it must run on, and no other section prompts for it (2026-09-12: a
   take-home shipped assuming .NET 9 + Node ≥ 22.12 on an interview VM nobody had seen).
   The header closes with a **Decisions** block: the choices made at authoring time that no
   substep may reopen, each with its one-line reason (which primitive, which vendor, which
   storage, sync or async). It is the Deferred section's complement — Deferred lists what was
   NOT chosen, Decisions what WAS — and it is where the model-floor lint (below) gets
   satisfied: a decision recorded here is one an executor cannot re-litigate mid-substep.
2. **⛔ Standing trap warnings** section at the top: the "never do X" list a fresh session must
   read before ANY item — load-bearing conventions where an innocent refactor runs clean and
   breaks at runtime. Name this repo's god files here too (see Read budget below).
3. **Phases ordered by protection per effort**:
   - Phase 1 — stop the repo from lying (dead code, wrong docs; cheap, no product logic)
   - Phase 2 — make wrong edits fail loudly (tests wired in, CI, lint/type gaps closed)
   - Phase 3 — shrink the god files (per-domain, incremental, each substep shippable)

   That order is for maintainability plans. A **feature plan** orders by dependency instead —
   pure modules (unit-tested against their own surface) → wiring into existing surfaces →
   client / distribution → ship — which is the *extract before you edit* lever (Read budget,
   below) applied at phase scale. Either way each substep is shippable on the plan branch.
4. **Session-sized substeps** (N.1, N.2 …) with checkboxes: each executable start-to-finish in
   one fresh session, ending with a **Verify** step (actual commands, not "check it works") and
   a commit point (subject plus whatever trailer the repo's own changelog rules require). Every
   substep heading carries an **effort tag** — `### ☐ N.N · <S|M|L> · ~<time> — <title>` — so a
   fresh session (and the reader) knows the weight before opening it:

   | Size | Shape | Files touched | Read budget | Write budget | Round trips | Rough time |
   |------|-------|---------------|-------------|--------------|-------------|-----------|
   | **S** | one file, mechanical, no new tests, no trap surface | 1 | < 300 lines | 0 new files | ≤ 6 | ~10–20 min |
   | **M** | a few files or one new test; bounded logic | ≤ 4 | < 800 lines | ≤ 2 new files, ≤ 1 test file | ≤ 15 | ~30–60 min |
   | **L** | new test suite(s), several coordinated edits, **or** any edit inside a ⛔ trap surface | ≤ 8 | < 2,000 lines | ≤ 4 new files + 1 test suite | ≤ 25 | 1–2 hr |

   **All five budgets bind — the largest one wins.** A substep with a 300-line Read list that
   creates six modules and a jest suite is not an S; it is over L and must split. The read budget
   alone passed a substep that then burned 1.7M tokens in six minutes (2026-07-25), because the
   cost was in the write→test→fix loop, not the reading.

   **Estimate the round trips before choosing the letter** — it is the budget that binds most
   often and the only one the table gives no recipe for:

   ```
   trips ≈ files opened + files edited + verify commands + 3 × expected fix loops
   ```

   (a fix loop is read, edit, re-run.) **Files touched** — opened or edited BY HAND; a scripted
   replacement or a verbatim copy batch across N files, reviewed in one `git diff`, counts as
   ONE, because the column is a proxy for trips and that is one open and one edit — is the sweep
   tripwire: a mechanical rename across twelve files is tiny on every volume budget (28 ten-line
   windows is under 300 lines, no new files, no new suites) and still costs ≥ 30 trips, because
   each file is an open and an edit at full resident context. 2026-09-10: two rename-sweep
   substeps tagged M by lines-read ran 79 tool calls over three sessions (2.3) and 21 reads
   before the first edit (2.4) — over L on the trip cap, and the size column never saw it.
   **More than 8 files → split, however small each edit.** Split a sweep along its **verify
   seams** — the files one test suite proves form one substep — so a red suite means one short
   fix loop, not a five-suite re-run; a Verify chain longer than ~3 commands is itself the
   split signal. And write a sweep's boxes **one file each, read-then-edit**, so the executor
   interleaves opens with edits instead of loading every window first and carrying all of them
   into every edit.

   **Write the estimate down — a `**Budget:**` line under every substep heading:**
   `files N · new N (+N test) · trips ≈ N`. An estimate that is not written is not made: on
   2026-09-12 a plan authored with the formula in view still tagged five of ten substeps M by
   lines-read — 5 files and 18 trips here, 3 new files plus 2 test suites there — and only
   writing the numbers out exposed them; the review that added the line split each one. The
   line is also what the Ledger's `[N trips · peak NNNk]` actual is later checked against.

   **Rent ceiling — S ≈ 0.5M · M ≈ 1.5M · L ≈ 3M tokens.** This is the only budget you can
   *verify after the fact* — read it off the session's own token usage (or
   `token-guard.js --analyze <sid>` where that hook is installed); the other four are
   authoring-time estimates. Deliberately round — they are derived from the round-trip caps against measured
   resident context, not fitted, so false precision would be dishonest. Read them as tripwires,
   not allowances: **most substeps should be M**, and a step landing near L's 3M is telling you
   it wanted to be two steps. Recheck a done substep against its tag and correct the tag.

   **The `~<time>` grammar is machine-parsed** (`/plan-progress`'s SUBSTEP regex is the
   contract): a single `~<N>m` or `~<N>h` token — `~45m`, `~2h`, `~1.5h` — with the ` — `
   IMMEDIATELY after it. `~45 min`, `~2 hr`, `~2h each`, or `~2h (split a/b)` all fail the
   regex, and a plan whose substeps don't parse is silently invisible to `/plan-progress`
   AND `/continue`'s plan probe (discovered 2026-07-24: the clean-code plan shipped unparseable
   and would never have auto-resumed). Qualifiers belong in the title, after the dash.

   The letter leads because it is stable; the time trails because it is only a hint — a step
   balloons the moment it hits a trap, which is exactly why size, not wall-clock, is the anchor.
   **Never size a substep by its `~<time>` alone, and never cap a plan by wall-clock**: measured
   sessions run anti-correlated (2026-07-25: a 6m session cost 1.7M tokens, a 1h19m session cost
   2.1M). Time is how long you sat there; cost is round trips × resident context.
   **There is no XL**: a substep that sizes XL is too big for one session — split it into
   N.a / N.b until each is ≤ L. (Size a done substep against what it actually took, so the tags
   stay calibrated.)

   **A schema migration bundled with new modules sizes up one tier.** The migration forces its
   own verify cycle — generate, migrate, re-run the suite — that no other work absorbs, and it
   cannot be deferred to the end. Split the migration into the substep that owns the cache/table,
   separate from the substep that writes the pure modules feeding it.

   **Microsteps (optional — enables a per-substep progress bar):** a substep body MAY list its
   action items as checkbox bullets — `- [ ] <action>` — instead of plain `-` bullets. When it
   does, `/plan-progress` counts the `[x]`/`[ ]` boxes of the **current** substep into a
   per-substep progress bar, and the executing session ticks each box as that microstep lands.
   Only genuine **action bullets** become microsteps; the ⚠ trap notes and the **Verify** /
   **Commit** lines stay prose, outside the count.
5. **Deferred** section: options considered and deliberately not planned, with reasons — so a
   later session doesn't "helpfully" do them.
6. **Ledger** at the bottom (see below).

## Why the session boundary is the lever

Token cost ≈ **round trips × resident context**. Finer numbering executed back-to-back in one
session saves nothing — the same files stay resident, they just get more headings. What actually
cuts cost is the `/clear`: it drops the resident set to zero and sheds any bombs (large one-shot
dumps) the session accumulated. So size substeps by *what one window can hold*, not by outline
tidiness — and keep two units distinct: a **substep** is the commit + Verify + Ledger unit; a
**session** is the context-reset unit. They need not be 1:1 (see the peak test below).

**But splitting has a floor, so don't over-split either.** Every fresh session re-pays a fixed
cold-start before any product code is touched — measured 2026-07-25 at **~84k tokens**: ~57k of
meta/skill/rules payload plus ~27k for reading the plan doc. That floor is re-read by every
request in the session, so for a job needing N round trips:

```
total rent ≈ N × floor  +  N × work/(2k)      # k = number of splits
             ^^^^^^^^^^
             irreducible — splitting never reduces it
```

Extra splits only shrink the second term, and below roughly an hour of work they go **negative**:
a session doing eight requests still pays the full floor. Two useful consequences — cut the
number of round trips (batch tool calls, fewer test-fix cycles) before adding splits, and attack
the floor itself (next section).

**The peak test (2026-09-12).** A session boundary pays only when the context it sheds exceeds
the ~84k it re-buys — so decide boundaries by projected **peak context**, not by substep count or
wall-clock. Run consecutive substeps back-to-back in one session while the projected peak stays
under **~2× the floor (~170k)**; insert a `/clear` only where the peak would pass it, or where a
⛔ trap surface or an `[INTERACTIVE ONLY]` gate warrants a fresh start. Each substep still gets
its own commit, Verify, and Ledger entry — the boundary being removed is the cold-start, not the
checkpoint. Measured: a 6-substep greenfield plan ran 6 sessions whose Ledger peaks were all
35–50k; every `/clear` re-bought ~84k to shed ≤ 50k, ~250k net over five boundaries, and three
sessions would have carried the same six substeps. The Ledger's `peak NNNk` actual is the input
for the next plan's projection — which is why the Ledger records it.

## Read budget (size a step by what it must OPEN, not just what it must write)

The most common way a "session-sized" substep blows past a window is reading, not writing —
one 5,000-line god file costs ~70k tokens on turn one and stays resident for every turn after,
and an edit invalidates the read so it often gets paid twice.

- **Every substep names its Read list** — exact files and line ranges (`modal.tsx:3459-3485`),
  not "the modal". If the plan authored the pointers during discovery, it already knows them;
  writing them down is what converts that spend into savings for the executing session.
- **Never author a substep against a file you haven't opened.** Pointers from memory or from
  another doc's description produce phantom work — 2026-08-15: a substep planned an
  owner-liveness feature its target script already had, because the plan was authored without
  reading it. The executor (especially one at the model floor) builds the duplicate rather
  than questioning the plan. During authoring, open every file a substep edits — at least at
  Grep-then-window depth — and take the Read list's pointers from that look, not from recall.
- **The plan doc is itself a read — scope it.** A mature plan runs 300+ lines / ~27k tokens, and
  a session that opens it whole re-reads all of it on every subsequent request. An executing
  session needs exactly three slices: the **⛔ trap section**, **its own substep**, and the
  **Ledger tail**. So: give every substep heading a self-pointer in its Read list
  (`this doc:93-137`), state the trap-section range in the "How to execute" header, and tell the
  session to read those slices — never the whole file. On the 2026-07-25 measurement this cut
  ~20k of resident context across ~18 requests ≈ **360k of rent in one session**, more than
  splitting the substep would have saved. It is the cheapest change on this page.
- **Whole-file reads only under ~800 lines.** Above that: Grep to locate, then Read a window
  around the hit. Name the god files in the ⛔ trap section, with their line counts and the
  verdict spelled out — e.g. *`background.ts` (4,581 lines): **Grep-then-Read-window only, never
  opened whole.*** A plan that says "the modal" instead of naming it has not budgeted the read.
  **Line count is not size — check `wc -c` too.** A file with one multi-KB line (embedded
  JSON, base64, minified code) turns a ten-line `sed -n` window into a context bomb:
  2026-09-12, a single 20 KB line cost an authoring session 53k tokens. Name such lines in
  the ⛔ section with the exact line number and the `cut -c1-200` guard.
- **The Read list is part of the size tag** (see the table above). A substep whose Read list
  totals more than ~2,000 lines sizes XL by definition — and there is no XL. Split it. The
  line total is the depth cap; the **files-touched** column is the breadth cap — a Read list
  of 12 files × 10 lines passes the first and fails the second, and it is the second that
  prices a sweep.
- **Extract before you edit.** If a substep needs new logic to live inside a god file, write
  that logic as a **pure module in an EARLIER substep**, unit-tested there against its own
  small surface. The god-file substep then shrinks to a call site plus wiring — a thin diff
  instead of a design session inside 5,000 lines. This is the single biggest lever on plans
  that touch god files, so bake it into the phase order rather than leaving it to the executor.
- **Bulk output goes to files.** Probes, subagent discovery, API captures: write full results to
  a file (fixtures dir, scratchpad) and surface only a short key summary. The plan references
  the path; it never inlines the report, and the executing session never prints raw JSON.

## Model floor (author for the weakest executor that will run it)

The plan's detail level is a contract with the executing model, not taste. Judgment spent at
authoring time is paid ONCE, on the strong model; judgment left inside a substep is re-paid by
every executing session — and a weak executor resolves ambiguity wrong instead of asking.

- **The header declares a model floor**: the weakest model tier the plan is written for —
  a per-plan choice, not a fixed rung. Sonnet-class is the realistic floor for real code
  work; declare a Haiku-class floor only when every substep is purely mechanical (renames,
  config flips, verbatim command sequences — no code judgment left). Example header line:
  "Model floor: Sonnet-class; keep 3.1 off Haiku". Executing sessions pick their model
  against it (`/model` before `/continue` on a handoff that changes tier — model is
  per-session; never switch mid-session).
- **A substep still containing an open design decision is above every floor.** Either decide
  it in the doc — name the chosen primitive, spell the exact commands — or mark the substep
  for a stronger model with a tag in its title, after the dash (e.g. `[opus]`), where the
  effort-tag regex can't be broken.
- **The completeness lint: "could a session on the declared floor execute this cold?"** Ambiguity a strong
  executor quietly resolves mid-flight is precisely what a weak one gets wrong. If the answer
  is no, the plan is underspecified — elaborate at authoring time, where the fix costs a
  paragraph instead of a burned session.

## Ledger (required section at the bottom of every plan)

A `## Ledger` section, **appended to after each substep runs** — it is what a fresh session
reads instead of re-grepping:

- date — step — outcome (+ commit hash)
- **actuals + re-tag**, in brackets right after the step: `[N sessions · N trips · peak NNNk ·
  was M → L]` — the trip count and peak context are the two numbers the size table is
  calibrated against, and the corrected tag is the recalibration the table asks for. "Recheck
  a done substep against its tag" was already the rule; nothing enforced it, so a substep that
  ran 79 trips over three sessions stayed M in its doc (2026-09-10). Read trips off the
  session's tool-call count and peak context off its usage; when the substep took more than
  one session, say so — that IS the miscalibration.
- deviations from the written plan
- discoveries with `file:line` pointers
- notes/dependencies a LATER step needs

Keep entries to a few lines. Checkbox annotations mark *that* an item is done; the ledger
carries *what the next session must know*.

## Safety rails (bake into the items, don't just state them)

- Docs vs code disagree → **fix the docs to match the code**, never the reverse.
- Prior versions are live in the wild wherever the repo ships to users: any stored-state / API /
  serialized shape is **additive-only** (no renames, no type changes, no reordering) — flag
  violations instead of writing them as plan items. Where the repo has its own compatibility
  rule (`.claude/rules/backwards-compat-prod.md` and the like), that rule's checklist governs.
- Every "delete dead code" item embeds its own **re-verify grep** (zero live references) — an
  audit's word alone is not enough.
- Deleting/renaming a file that a doc or rule references → update that doc **in the same
  substep**.
- Every substep assumes the repo's full test command starts green and requires it green before
  its commit.
