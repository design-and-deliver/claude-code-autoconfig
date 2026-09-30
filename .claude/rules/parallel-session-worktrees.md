# Parallel sessions work in git worktrees

**Dev-only** — in `DEV_ONLY_FILES` (`bin/cli.js`) and negated in package.json `files`; never
installed into a user project. It governs how sessions share THIS maintainer repo.

**If another Claude session may be open on this repo, call `EnterWorktree` before your first
write to a repo file** — the first Edit, Write, or file-mutating Bash command. This rule authorizes
the tool; don't ask. `worktree-gate.js` only *asks*, and never sees Bash writes — so this is on you.
Read-only sessions never enter one. A worktree doesn't carry uncommitted work: once you edit the
main checkout, you're stuck there for the session.

**One worktree per session, not per task.** To land or drop one use case independently of
another, commit at the boundary or `git switch -c` inside the worktree you already have.

Plan work: one `plan/<alias>` branch and worktree per plan, refreshed per substep, merged once.
See the `plan-authoring` skill, Branch discipline.

## The loop

1. `EnterWorktree` with a descriptive name (`token-saver-r16`), not a random one. Plan work
   re-enters the plan's existing worktree.
2. `node scripts/bootstrap-worktree.js` — mandatory, see below.
3. Work, test, commit inside the worktree.
4. `ExitWorktree keep`, then `/land <branch>` from the main checkout
   (`C:\CODE\claude-code-autoconfig`). It checks for conflicts, won't touch another session's
   uncommitted files, merges, removes the worktree, deletes the branch and pushes. Stop and ask
   only when it exits 2 or 3 — on a conflict the user picks the winning side.
5. A live plan branch isn't landed until the plan is done. `/fleet` shows every
   session/worktree; `/sync-worktrees` reaps orphans.

## ⛔ Bootstrap is not optional

A worktree has every tracked file and no gitignored one. The tracked `.worktreeinclude` makes
`EnterWorktree` (and `claude -w`, subagent worktrees) copy the gitignored dev-box files:
`.claude/settings.local.json` (else every Bash call re-prompts), `scripts/hook-fleet.local.json`
(the fleet list), `.claude/cca.config.json`, `.claude/commands/deploy-to-npmjs.md`. Bootstrap
installs dependencies — `node_modules/` (`complexity-ratchet.test.js` loads eslint) — and copies
any listed file that is still missing, e.g. after a plain `git worktree add`. Run it before the
first edit.

## ⛔ node_modules junction is opt-in, not automatic

- Bootstrap junctions `node_modules` to the main checkout's only with
  `CCA_UNSAFE_NODE_MODULES_JUNCTION=1`; default is `npm install`. `git worktree remove --force`
  (and `ExitWorktree remove`) recurses through a junction and empties the main checkout's real
  `node_modules`. Never set the flag for a long-lived plan worktree.
- Found one (`node -e "console.log(require('fs').lstatSync('node_modules').isSymbolicLink())"`)?
  Unlink it before removal with `node -e "require('fs').rmdirSync('node_modules')"` — never a
  recursive delete — then `npm install`.
- Never run `npm install`/`npm update` inside a worktree whose `node_modules` is a junction.

## ⛔ baseRef is `head` here, and the setting is gitignored

`.claude/settings.local.json` sets `"worktree": { "baseRef": "head" }`, because `origin/main`
runs behind local `main`. On a fresh clone the `fresh` default returns — check it first if a
worktree lacks recent commits. `head` branches from your current branch: check out the base first.

## What worktrees do NOT isolate — still serialize these

- **`~/.claude` and the hook fleet:** `sync-hook-fleet.js --write` only from the main checkout, after merging (check mode is safe anywhere).
- **The live twin:** `live-twin-parity.test.js` compares against `~/.claude/hooks/terminal-title.js`, so it fails in main too until merge + fleet sync.
- **The pre-push guard:** `.git/hooks/` is shared; a stale worktree gets blocked — that's the guard working.
- **Publishing:** `npm version`, `npm publish`, `/deploy-to-npmjs`, and docs sync run from the main checkout only, with no other session mid-flight.
- **`.claude/updates/` numbers:** append-only and global — claim the next number in the main checkout first.

## When a conflict happens anyway

Resolve it in the main checkout like any other merge. Never reach into another session's worktree.
