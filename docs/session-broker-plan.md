# Session broker — serialize the singletons worktrees cannot isolate

**Goal.** Make concurrent Claude sessions on this box safe against the shared, *out-of-tree*
resources that git worktrees deliberately do not isolate — `~/.claude/hooks/*` (the live twin
and the fleet), `npm publish`/`npm version`, and the append-only `.claude/updates/` sequence.
Today those are protected by prose in a rule file. A session that skips the prose corrupts
global state silently; one did on 2026-07-26 (below).

**Evidence / source incidents**
- 2026-07-26 — `.claude/hooks/terminal-title.js` edited at 21:57 in the shared checkout and never
  synced to `~/.claude` (20:16). `test/live-twin-parity.test.js` went red, the dev-box pre-push
  guard blocked an unrelated push, and the fix belonged to a different session. No merge, no
  conflict — a singleton with two writers.
- `.claude/rules/parallel-session-worktrees.md` — the "What worktrees do NOT isolate" section is
  the authoritative list this plan makes executable.
- CLAUDE.md "Invariants & Landmines" — the `.claude/updates/` append-only rule and the
  dev-gating contract.

## How to execute

One substep per fresh session. Each ends with a **Verify** block (real commands), a commit, and a
**Ledger** entry at the bottom of this doc. Then `/clear` + `/continue` — /continue is plan-aware:
it finds this doc, reads the Ledger, checks the last commit hash against git, and resumes at the
next unchecked substep.

**Read this doc in slices — never whole.** An executing session reads exactly three ranges: the
**⛔ trap section (lines 37–81)**, **its own substep**, and the **Ledger tail**. Each substep's
Read list carries a self-pointer. Opening all ~300 lines costs ~27k tokens that stay resident for
every later request in the session.

**Every substep must start from a green `npm test`** and leave it green before its commit. That
suite is the FULL fan-out (see CLAUDE.md "Testing Requirements") including `npm run test:hooks`,
which is the only way the hook suites run at all.

---

## ⛔ Standing trap warnings — read before ANY substep

1. **This guard must fail CLOSED — that inverts the house convention.** Every other hook here
   (`token-guard.js`, `terminal-title.js`) swallows errors and exits 0 by design; a regression
   quietly stops warning instead of crashing. A *permission* guard that fails open is not a
   guard. For guarded paths only, an internal error must exit 2 (block). Everything else still
   exits 0. Write this asymmetry down in the file header or the next reader will "fix" it.

2. **`.claude/settings.json` ships to every user install.** It is NOT negated in package.json
   `files` (verified 2026-07-26). Registering the broker hook there pushes it to every user
   project, where the script is absent because it is dev-gated — their hook then errors on every
   Write. Register in `.claude/settings.local.json` instead, which is gitignored here and
   negated in `files`. Consequence: the registration does not survive a fresh clone. Documented,
   accepted, not "fixed" by moving it.

3. **Dev-only gating lives in THREE places, not one.** `DEV_ONLY_FILES` in `bin/cli.js:433`
   (the list that actually gates installs), the `files` negation in `package.json`, and the
   mirrored `dev_only` literal in `.claude/commands/validate-cca-install.md:73`. Miss one and
   either the file ships or `/validate-cca-install` reports a false positive. Bump that command's
   `<!-- @version N -->` when you touch it.

4. **Commits here need `Changelog: none`.** `bin/update-summary.js` prints feat/fix subjects
   verbatim on users' upgrade screens. This whole plan is dev-gated machinery; announcing it to
   users is a bug. Already-pushed leaks need an OVERRIDES `null` in `scripts/generate-changelog.js`.

5. **A lease with no expiry is a deadlock.** A session that dies holding `hooks-fleet` wedges
   every other session and the pre-push guard forever. TTL **and** PID-liveness reclaim are both
   required in 2.1 — not deferred to "later hardening". This is the single most likely way this
   plan makes things worse than the prose it replaces.

6. **`scripts/sync-hook-fleet.js` is adopt-only and main-checkout-only.** Its `MANIFEST`
   (`scripts/sync-hook-fleet.js:33`) drives what gets published to `~/.claude` and the fleet.
   Decide explicitly in 4.1 whether `broker-guard.js` joins it; a hook in the manifest gets
   pushed to every adopting repo, and adopt-only means it is never *created* in a repo that
   lacks it. Running `--write` from a worktree publishes that worktree's older copies fleet-wide.

7. **God-file read discipline.** `.claude/hooks/token-guard.js` (~2,900 lines) and
   `bin/cli.js` (~1,400 lines): **Grep-then-Read-window only, never opened whole.** token-guard
   is the model for Bash-command parsing (it already detects a full suite behind `cd`, pipes and
   redirects) — grep it for the parsing helper, read that window, do not read the file.

8. **`test/golden-endings.json` is append-only** and `.claude/updates/` numbers are append-only
   and globally sequential (next is `005`). Do not renumber, relabel, or delete entries.

---

## Phase 1 — make the shared-resource list executable

Right now the list of "things worktrees do not isolate" exists only as prose. Code cannot read
prose, and the doc drifts from whatever the guard actually enforces.

### ☐ 1.1 · S · ~20m — Name the guarded resources in one machine-readable file

**Read:** this doc:88-109 · `.claude/rules/parallel-session-worktrees.md:60-87` (the "do NOT
isolate" section) · `CLAUDE.md` "Invariants & Landmines"

- [ ] Create `scripts/guarded-resources.json`: an array of `{ id, kind, match, why }` where
      `kind` is `path` or `command`. Seed it with the four known singletons — `hooks-fleet`
      (`~/.claude/hooks/**` + `sync-hook-fleet.js --write`), `npm-release` (`npm publish`,
      `npm version`), `updates-seq` (`.claude/updates/**`), `git-push`.
- [ ] Each entry's `why` is one sentence naming the failure it prevents, quoted from the rule.
- [ ] Point the rule doc's "do NOT isolate" section at this file as the source of truth — the
      prose stays, but stops being the only copy.

⚠ Do not wire anything to this file yet. This substep ships data and a doc pointer only, so a
bad guess about the schema costs nothing to correct in 2.1.

**Verify:** `node -e "const r=require('./scripts/guarded-resources.json');console.log(r.length,r.map(x=>x.id).join(','))"`
prints 4 ids · `npm test` green.

**Commit:** `chore(broker): declare the guarded singletons as data` + `Changelog: none`

---

## Phase 2 — the broker, as a pure module first

Per the "extract before you edit" rule: the lease logic gets written and unit-tested against its
own small surface *before* any hook depends on it. The hook substep then shrinks to a call site.

### ☐ 2.1 · M · ~45m — Lease core: pure module + unit tests

**Read:** this doc:116-138 · `scripts/guarded-resources.json` (from 1.1) · `test/` for the
suite's registration pattern (grep `test:hooks` in `package.json`)

- [ ] `scripts/lib/lease.js` — pure, no CLI, no process.exit. Exports `acquire(resource, sid,
      opts)`, `release(resource, sid)`, `inspect(resource)`, `reap()`. State lives in
      `.claude/broker/<resource>.lease` (JSON: `sid`, `pid`, `acquired`, `expires`, `label`).
- [ ] Atomic acquire: write to a temp file then `fs.renameSync` — `renameSync` over an existing
      path is the atomic primitive; two racing sessions must not both win.
- [ ] **TTL + stale reclaim (trap 5).** A lease past `expires`, or whose `pid` is no longer
      alive, is reclaimable by the next caller. `reap()` clears them.
- [ ] Re-acquire by the *same* sid is a no-op success (re-entrant), not a deadlock.
- [ ] `test/lease.test.js` — cover: acquire/release round trip, second holder refused, TTL
      expiry, dead-PID reclaim, re-entrant acquire, and `.claude/broker/` absent on first run.
- [ ] Add `.claude/broker/` to `.gitignore`.

⚠ No timing-dependent tests — inject a clock, don't `sleep`. The suite runs on CI.

**Verify:** `node --test test/lease.test.js` green · `npm test` green (confirm the new file is
actually picked up — a test that never runs is worse than no test).

**Commit:** `feat(broker): lease core with TTL and stale-PID reclaim` + `Changelog: none`

### ☐ 2.2 · M · ~40m — `scripts/broker.js` CLI over the core

**Read:** this doc:140-160 · `scripts/lib/lease.js` (from 2.1) · `scripts/sync-hook-fleet.js:180-230`
for this repo's CLI arg + exit-code conventions

- [ ] `scripts/broker.js` with `acquire <id>`, `release <id>`, `status`, `reap`. Exit 0 on
      success, non-zero on refusal, and print the *current holder's* label on refusal so the
      blocked session knows who to wait for.
- [ ] `status` with no args prints all resources and their holders — this is what a human runs
      when something is wedged.
- [ ] Session id from `CLAUDE_SESSION_ID` when present, else pid — never invent one per call, or
      release stops matching acquire.
- [ ] `test/broker-cli.test.js` — drive the real CLI against a throwaway dir (model it on
      `test/hook-fleet-sync.test.js`, which does exactly this).

**Verify:** `node scripts/broker.js acquire hooks-fleet && node scripts/broker.js status && node scripts/broker.js release hooks-fleet`
round-trips · `npm test` green.

**Commit:** `feat(broker): acquire/release/status CLI` + `Changelog: none`

---

## Phase 3 — enforcement, so skipping the broker is impossible

A broker sessions are merely *supposed* to call is the prose we already have. This phase is the
only part that changes outcomes.

### ☐ 3.1 · L · ~1.5h — PreToolUse guard on Write/Edit paths, fail-closed

**Read:** this doc:167-194 · `.claude/settings.json:1-40` (hook registration shape) ·
`.claude/hooks/token-guard.js` — **grep for the PreToolUse entry point and read that window
only, never the whole file** · `scripts/lib/lease.js`

- [ ] `.claude/hooks/broker-guard.js`. Reads the hook JSON on stdin, resolves
      `tool_input.file_path`, matches it against the `kind: "path"` entries from 1.1.
- [ ] Unguarded path → exit 0, say nothing. Guarded path **and** this sid holds the lease →
      exit 0. Guarded path and no lease → **exit 2** with a stderr message naming the resource,
      the current holder, and the exact `node scripts/broker.js acquire <id>` command.
- [ ] **Fail closed (trap 1):** wrap the guarded-path branch so an internal throw still exits 2.
      Put the asymmetry in the file header comment, next to why it differs from every sibling hook.
- [ ] Resolve paths through `fs.realpathSync` before matching — `~/.claude/hooks/../hooks/x.js`
      and a symlinked home must not slip the matcher.
- [ ] `.claude/hooks/tests/broker-guard.test.cjs` — guarded-with-lease, guarded-without,
      unguarded, traversal attempt, and **the throw case exits 2**. These run only under
      `npm run test:hooks`; confirm the fan-out picks the file up.

⚠ Do NOT register the hook in `.claude/settings.json` (trap 2). This substep writes the script
and its tests only — wiring is 4.1. That ordering means a broken guard cannot wedge your own
session mid-plan.

**Verify:** `npm run test:hooks` green · pipe a fabricated payload by hand:
`echo '{"tool_input":{"file_path":"'$HOME'/.claude/hooks/terminal-title.js"}}' | node .claude/hooks/broker-guard.js; echo "exit=$?"`
prints `exit=2` without a lease, `exit=0` with one · `npm test` green.

**Commit:** `feat(broker): fail-closed PreToolUse guard for guarded paths` + `Changelog: none`

### ☐ 3.2 · M · ~50m — Extend the guard to Bash command gating

The fleet sync and every npm release run through Bash, not Write. Path matching alone misses the
exact commands that caused the 2026-07-26 incident.

**Read:** this doc:196-217 · `.claude/hooks/broker-guard.js` (from 3.1) · `token-guard.js` —
grep for the full-suite command detection and read that window; it already handles `cd`, pipes
and redirects, and that parser is the thing to reuse rather than re-derive.

- [ ] Match `kind: "command"` entries against `tool_input.command` for Bash tool calls.
- [ ] Reuse token-guard's normalizer so `cd /x && npm publish`, `npm publish | tee log`, and
      `npm  publish` all match. Re-deriving this is how the two implementations drift.
- [ ] `sync-hook-fleet.js` **without** `--write` (check mode) stays unguarded — it is read-only
      and safe anywhere. Only `--write` needs the lease.
- [ ] Extend the hook test file with the command cases, including the `cd`/pipe/redirect forms.

**Verify:** `npm run test:hooks` green · hand-pipe a Bash payload for `cd /tmp && npm publish`
and confirm `exit=2` · `npm test` green.

**Commit:** `feat(broker): gate guarded Bash commands behind the lease` + `Changelog: none`

---

## Phase 4 — adopt it

### ☐ 4.1 · M · ~35m — Gate dev-only, register the hook, update the rule doc

**Read:** this doc:221-245 · `bin/cli.js:425-440` · `package.json:55-70` ·
`.claude/commands/validate-cca-install.md:68-78` · `.claude/rules/parallel-session-worktrees.md:60-87`

- [ ] Add `broker-guard.js` and `broker.js` to `DEV_ONLY_FILES` (`bin/cli.js:433`), the
      `package.json` `files` negations, and the `dev_only` mirror in `validate-cca-install.md`
      — **all three** (trap 3). Bump that command's `@version`.
- [ ] Register the `PreToolUse` hook with a `Write|Edit|Bash` matcher in
      `.claude/settings.local.json` — **not** `settings.json` (trap 2).
- [ ] Decide and record whether `broker-guard.js` joins the `sync-hook-fleet.js` MANIFEST
      (trap 6). Default: **no** — it is CCA-specific machinery, and adopt-only means adopting
      repos would need the lease core too.
- [ ] Rewrite the rule doc's "do NOT isolate" section: the list is now enforced for the entries
      in `guarded-resources.json`, still prose-only for the rest. Say which is which.
- [ ] Add the recovery line a wedged session needs: `node scripts/broker.js status`, then
      `reap` if the holder is dead.

**Verify:** `npx claude-code-autoconfig` into a throwaway dir and confirm neither script lands
there · `/validate-cca-install` reports clean · `npm test` green · `node scripts/sync-hook-fleet.js`
(check mode) reports zero drift.

**Commit:** `chore(broker): gate dev-only, register the guard, document recovery` + `Changelog: none`

---

## Does this actually reach git-flow smoothness?

**No — and the gap is worth stating before anyone builds this.** Git flow is smooth for 100
developers because each has a separate *machine*: separate home directory, separate global
config, separate npm login. Worktrees bought the branch half of that. This plan does not buy the
machine half; it makes contention *loud and serialized* instead of silent and last-writer-wins.

The realistic ceiling: every remaining collision becomes either a normal merge conflict or an
explicit "resource held by session X" refusal. That is a large improvement over a red parity test
that blocks an unrelated push. It is not the same as isolation, and no amount of layering makes a
singleton concurrent — the singleness of `~/.claude/hooks/terminal-title.js` **is the product**,
and one npm version number is one npm version number.

## Prior art (checked 2026-07-26 — none is a drop-in)

- **[Agent-MCP `file-lock-manager.js`](https://glama.ai/mcp/servers/@rinadelph/Agent-MCP/blob/89651ba7f84d81ccd403b4ed5c66f8f1dfed735b/agent_mcp/hooks/file-lock-manager.js)**
  — the closest thing: a PreToolUse hook intercepting Edit/Write/MultiEdit for file-level
  locking. Validates the mechanism. Locks files *inside* a repo, which worktrees already solve.
- **[agent-orchestration](https://github.com/madebyaris/agent-orchestration)** — MCP server with
  resource locks, shared memory, and a task queue. Closest to the "manager service" shape; a
  heavier dependency than a lease file, and still repo-scoped.
- **[Network-AI](https://github.com/ggml-org/llama.cpp/discussions/19675)** — per-key atomic
  commits under a filesystem mutex, hash-based conflict detection.
- **[ATM: CID-Brokered Pre-Write Admission](https://arxiv.org/pdf/2607.00041)** and
  **[CodeCRDT](https://arxiv.org/pdf/2510.18893)** — the pre-write admission-control pattern this
  plan is an instance of.
- **[Claude Code hooks reference](https://code.claude.com/docs/en/agent-sdk/hooks)** — confirms
  PreToolUse + exit code 2 blocks the call and returns stderr to the model.

**Why build rather than adopt:** every project above scopes locks to files within one repo. The
resources that actually break here are *outside* any repo — `~/.claude`, the npm registry, a
global update sequence. That is a much smaller problem than what these solve, and the delta is
roughly the 200 lines in Phase 2.

## Deferred — considered, deliberately not planned

- **Per-session `CLAUDE_CONFIG_DIR`.** Real and respected everywhere (confirmed in the Claude
  Code changelog). Rejected *for the hooks*: CCA exists to install one user-level hook that every
  project shares, and `live-twin-parity.test.js` enforces that singleness. Isolating it per
  session would make the parity test compare each session to its own copy — always green, always
  meaningless. Revisit only for genuinely per-session state.
- **A long-running broker daemon.** A lease file plus TTL needs no process to babysit, no port,
  and no startup ordering. Revisit only if cross-machine coordination is ever needed.
- **Auto-acquire (guard silently takes the lease instead of refusing).** Turns the guard back
  into last-writer-wins with extra steps; the refusal is the feature.
- **Guarding `.git/hooks/`.** Shared across worktrees, but the pre-push guard is already
  mechanical and self-enforcing.
- **Queueing/blocking on a held lease.** Refuse-and-report first. A session that *waits* burns
  context doing nothing. Revisit once `status` shows real contention.

---

## Ledger

| Date | Step | Outcome | Commit |
|------|------|---------|--------|
| 2026-07-26 | — | Plan authored. Trigger: `terminal-title.js` edited in the shared checkout at 21:57, never synced to `~/.claude` (20:16) — parity red, unrelated push blocked, fix owned by another session. | — |

**Notes for later steps**
- `.claude/updates/` next number is `005`; `002` is a retired tombstone. Claim numbers in the
  main checkout, never in a worktree (two worktrees both pick "the next one").
- The dev-box pre-push guard runs `npm test` + `sync-hook-fleet.js` check mode. It is shared by
  every worktree (`.git/hooks/` lives in the common git dir), so a stale worktree gets blocked —
  that is the guard working.
- `.claude/settings.local.json` is gitignored here, so the hook registration from 4.1 does not
  survive a fresh clone. Same class as the `worktree.baseRef: head` gap already documented in
  `.claude/rules/parallel-session-worktrees.md:43`.
