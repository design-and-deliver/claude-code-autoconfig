<!-- @description Snapshot every open Claude session on this repo into one WIP note each — description, work complete, work remaining, merge issues. -->
<!-- @version 1 -->
<!-- @param all | flag | optional | Include idle sessions, not just active ones. -->
<!-- @param mine | flag | optional | Write only this session's note (refresh before a /clear). -->
<!-- @response report | One line per note written, then the single sharpest cross-session finding. -->
<!-- @sideeffect Writes WIP/<YYYY-DD-MON>/<goal-slug>.md in the BASE checkout. Deliberately untracked. -->
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
session lives under its own slug), its working tree, its title, the template in Step 3, and the
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

One file per session at `WIP/<YYYY-DD-MON>/<goal-slug>.md` — e.g. `WIP/2026-19-AUG/`. Always in
the **base checkout** (`C:\CODE\claude-code-autoconfig`), never inside `.claude/worktrees/`, so
every session's note lands in one folder. The slug is the goal in kebab-case, verb first,
parentheticals dropped, ~5 words: "Gate the WIP report command out of user installs" →
`gate-the-wip-report-command.md`.

```markdown
# <The goal, as an imperative — the session's use case, not its last task>

- **Session:** `454463ff` · worktree `wip-report-command` (branch `worktree-wip-report-command`)
- **Plan:** `docs/agy-worktree-adoption-plan.md` — 4 of 11 substeps done
- **Also writes:** `~/.claude` + the hook fleet (`scripts/sync-hook-fleet.js`)
- **Snapshot:** 2026-08-19 ~15:50

## Description

Two to four sentences: what is being changed and why, and the shape of the work. The reader has
no context — this paragraph is the whole frame. Not a log of what happened.

## Work complete

Four substeps done of 11 (~4h nominal):

- **2.1** — worktree gate hook wired into PreToolUse (`794c52b`). Full suite green (14 suites).

## Work remaining

<Step 4's format — this is the load-bearing section.>

## Merge issues

- Where the commits live, whether they are landed on `main`, and whether `main` is pushed.
- Whose the dirty files in the shared base checkout are — never assume they are this session's.
- Ordering hazards: the things worktrees do **not** isolate — `~/.claude` and the hook fleet, the
  live twin (`test/live-twin-parity.test.js`), `.claude/updates/` numbers, publishing.
- "None in git" is a fine answer, but say *why* — "works in the base checkout, no worktree".
```

Drop the **Plan** line when the session is not plan-driven; drop **Also writes** when it stays
inside this repo. Never keep an empty heading.

## Step 4 — the count headers and the remaining list

**Plan-driven session.** A lead line, then one bullet per remaining substep — verbatim number,
size tag, and `~time` from the plan doc, with the title compressed to a short lowercase clause:

```markdown
Seven substeps left, 4 of 11 done (~7h nominal):

- 3.1 · L · ~2h — teach the launcher to adopt an existing worktree
- 3.2 · M · ~1h — reap orphans without recursing through a junction
- 3.3 · M · ~1h — surface the fleet roster in the gate's refusal
```

- Count in words up to ten, digits above. `K of T done` comes straight from the checkbox tally.
- The parenthetical sums the `~time` tags. Say **nominal** — the tags are authoring-time hints,
  not measurements, and a substep that hits a ⛔ trap doubles.
- No bold, no numbering, no prose inside a bullet. The list is scannable or it is worthless.

**Work complete opens with the mirror header** — same grammar, same parenthetical, as its first
line, so the two sections read as one progress bar instead of two unrelated lists:

```markdown
Four substeps done of 11 (~4h nominal):
```

It is `done of T`, not `K done, K of T` — the count already *is* the done count, and repeating it
reads as a typo. The parenthetical sums the `~time` tags of the **done** substeps, so the two
headers add up to the plan's whole nominal budget. A session with no plan gets no header on
either section: there is no denominator to count against.

**Blockers are not substeps.** Anything that must happen before the next substep can ship — a
worktree to reap, a fleet sync to run from base, another session to finish, a release to push —
goes on its own `⛔` line *above* the lead line, with the concrete next command. Numbering a
blocker into the substep list hides it.

```markdown
⛔ **Land this worktree before running the fleet actuator** — `sync-hook-fleet.js --write` run from
a worktree publishes that worktree's possibly-older hooks over newer work in `~/.claude` and every
fleet repo. Merge to `main` in the base checkout first, then
`node scripts/sync-hook-fleet.js --write` from there.

Seven substeps left, 4 of 11 done (~7h nominal):
```

**Session with no plan.** Plain bullets, most-blocking first, each naming the concrete next action
and where it must run — not a topic. "Reap the orphan `.claude/worktrees/token-guard-r16`, from a
*fresh* session in the base checkout: `node .claude/scripts/sync-worktrees.js --write
--keep-branches`" is an item. "Clean up worktrees" is not.

## Step 5 — report

List the files written, one line each, with the session id. Then **one** cross-session finding —
the sharpest thing the notes revealed that no single session could see (two sessions sharing a
working tree, two queued on the same file, an unpushed release nobody owns, two worktrees both
claiming the next `.claude/updates/` number). One. Not a digest of the notes you just wrote; the
user can open them.

Close by saying the folder is untracked and why: WIP notes go stale within hours and would churn
on every merge. They are never committed and never merged — the next `/create-wip-report` replaces
them.

## What it will never do

- **Act on a finding.** It surfaces a collision; standing a session down is the user's call.
- **Touch another session's tree.** Read `git log` and `git status` there; write nothing.
- **Read a whole plan doc or a whole transcript.** Ledger tail, substep list, transcript tail.
- **Trust a transcript over git.** A session that says it committed and has no hash did not.
- **Run anything that writes outside this repo** — no `sync-hook-fleet.js --write`, no `npm
  version`, no publish. Those are base-checkout, one-session-at-a-time operations.
