# Changelog

<!-- GENERATED FILE — do not edit by hand. scripts/generate-changelog.js rebuilds this
     from git history on every `npm version`. Reword a published bullet via its
     OVERRIDES map; shape future bullets with a `Changelog:` commit-body trailer. -->

## v1.0.220
- feat(continue): /continue now opens with 'Recovering the previous session's active context.' — the old improvised line was vaguer than what recovery actually returns
- fix(recovery): /continue can now recover a session the moment it ends — it no longer waits out a 3-minute liveness window before a just-closed session becomes visible.
- feat(continue): /continue now recovers on a cheap model and stops at a "Picking up where we left off" report — reply "go" and the work resumes on your session's main model at full quality.
- perf(recovery): /continue and /recover-context no longer blow up your context window on a long session — recovery now brings back the most recent thread instead of the whole transcript
- feat(recovery): /continue and /recover-context are much faster and cheaper — they gather everything in a single step instead of a dozen, work correctly in git worktrees, and no longer mistake an unrelated session for a plan you were executing
- fix(continue): /continue and /recover-context no longer mistake a leftover file from an earlier recovery for this session's context
- fix(terminal-title): The 'awaiting your reply' tab signal now also catches statement-shaped closers on yes/no questions
- fix(terminal-title): More reliable terminal tab status updates
- perf(continue): Resuming a plan with /continue no longer re-reads the whole plan document, so long plans cost far less to pick back up
- feat(continue): /continue now stops instead of racing when another session is already working the same plan doc
- feat(continue): /continue resumes plan work faster — after a cleanly finished plan step it reads the plan itself instead of re-recovering the old session's transcript
- fix(ccr): Hardened the session-recovery launcher against tampered recovery pointer files
- fix(plugins): Plugin removal no longer claims success when settings.json could not be updated - it explains the problem and stays safely retryable

## v1.0.219
- fix(terminal-title): /clear now resets the tab title to "New session" instead of carrying the old session's title; /continue still restores it

## v1.0.218
- fix(continue): The /continue command now resumes phased plans kept in .claude/plans/ as well as docs/
- perf(pack): Smaller download on install and update
- fix(terminal-title): Terminal title: the awaiting half-circle now resets when you Esc a question or permission dialog that sat open longer than 30 minutes.

## v1.0.217
- feat(terminal-title): - Duplicate-session guard now catches a second tab adopting your work mid-turn, not just at the next prompt
- fix(recover-context): - /continue and /recover-context auto mode no longer resume work that is actively running in another terminal tab
- fix(terminal-title): Fixed brand-new terminals inheriting the previous tab's title
- docs(plan): ledger substep 3.1 — pending updates survive a bootstrap upgrade (BH-3)
- fix(updates): Configuration updates that haven't run yet are no longer skipped after an upgrade
- fix(hooks): No more false "duplicate session" warning right after /clear
- fix(plugins): Reinstalling then removing a plugin no longer leaves orphaned files behind
- fix(settings): Upgrades no longer register a hook twice when settings share a hook across matchers
- fix(plugins): Removing a plugin now keeps any env/hook/permission you had configured yourself
- fix(cli): A file named 'nul' in your project is no longer removed on macOS/Linux
- fix(changelog): Revert and merge commits no longer clutter the release notes
- feat(terminal-title): New: duplicate-session guard warns when another Claude tab is already working on the same repo+task (near-identical title) so the two don't clobber each other's edits. Set CLAUDE_TITLE_DUPE=kill to have the newer tab automatically stand down, or =off to disable.
- fix(cli): Upgrades now preserve your saved /gls screenshot folder from very old installs
- feat(terminal-title): After /clear, the tab keeps showing your last title (ideal for /continue) instead of briefly flashing the folder name.
- fix: Node 18 or newer is now required (matches what we test on)
- fix(cli): A corrupted settings or config file now produces a clear error instead of silent data loss
- fix(docs): The interactive docs no longer show commands that aren't part of your install
- fix(token-guard): the "something just loaded a huge payload" warning now gives honest
- fix(token-guard): Spend-gate confirmations now show token counts instead of dollar amounts when you're on a Claude subscription plan.
- feat(token-guard): the usage-spike warning now tells you what matters — how long until
- fix(autoconfig): /autoconfig sets up the format hook in the reliable path-anchored form
- fix(commands): /validate-cca-install no longer reports false "missing command" errors
- fix(install): Removed the outdated curl installer — install with npx claude-code-autoconfig instead
- feat(hooks): auto-guard — opt-in deterministic rails under auto mode

## v1.0.216
- docs: regenerate interactive docs after cca- block protocol change
- feat(commands): preserve flavor-package cca- marker blocks in CLAUDE.md
- feat(commands): auto permission mode opt-in — asked once in /autoconfig + /autoconfig-update
- feat(continue): /continue now recognizes plan-driven sessions: after /clear it picks up a

## v1.0.215
- feat(commands): New /sync-claude-md repairs CLAUDE.md structure if markers go missing; /submit-claude-code-github-issue files an upstream Claude Code issue with duplicate-checking first; a new docs-refresh agent keeps the interactive docs current when .claude files change.
- feat(retro): New opt-in /enable-retro — when enabled, Claude logs tech debt and improvement ideas it notices into .claude/retro as small structured story files you can pick up later.
- feat(commit-guard): Claude now reminds you when a lot of uncommitted work piles up, and knows to stay quiet while you're actively committing in any terminal. New /check-commit command runs the check on demand.
- feat(terminal-title): Terminal tabs for plan-driven work now lead with the plan's name, so parallel sessions from the same plan group together visually.
- feat(token-guard): Usage-spike warnings now tell you when other open sessions drove the spend, instead of blaming your last turn here.
- feat(terminal-title): Claude now answers yes/no questions with a numbered 1-yes/2-no
- fix(token-guard): Usage-window checkpoints now announce once per window cycle across all your sessions, instead of repeating in every new session.
- feat(commands): New /continue command — after /clear (or a fresh session in the same
- feat(terminal-title): /recover-context (no arguments) now recovers exactly the session that
- feat(commands): /recover-context now works with no arguments — after /clear or in a
- feat(token-guard): The "session sat idle" warning now gives you a short command to type in
- feat(token-guard): The stale-session warning can now end with a one-click Yes/No card — pick Yes and a recovered session opens in a new terminal window, no retyping.

## v1.0.214
- feat(terminal-title): Terminal tab titles are now remembered per session, so you can look back at how a session's work shifted over time.

## v1.0.213
- fix(terminal-title): Tab status flips to 'awaiting your approval' in a couple of seconds when Claude asks permission (was ~6s), and no longer briefly shows a false 'done' on some permission prompts

## v1.0.212
- feat(terminal-title): Tab status stays reliable even if a Claude Code update renames the 'esc to interrupt' hint
- fix(terminal-title): Tab status no longer flips to 'done' while Claude is still thinking on long turns
- fix(install): Upgrades no longer show a false "Backed up existing config" warning, and status beeps pick the "awaiting your reply" tone more reliably

## v1.0.211
- feat(gls): /gls screenshots now use up to ~60% fewer tokens — large captures are auto-downscaled before display
- refactor(title-hooks): unify the user-level/project fork into one runtime-branched file
- fix(title-hooks): canonicalize shouldDefer paths so the user-level copy stands down on CI
- feat(title-hooks): port interrupt-rescue idle-glyph reset from job-agent-extension

## v1.0.210
- feat(status-beeps): Updating now also offers to turn on the status beeps — asked once, and your answer is remembered

## v1.0.209
- feat(upgrade): Installing an outdated version now clearly announces that it's unsupported and installs the latest version instead

## v1.0.208
- feat(upgrade): Upgrades now end with a checklist of the new features and fixes you just received, instead of only "no new updates available"

## v1.0.207
- fix(status-beeps): Clearer one-line setup question for the status beeps opt-in

## v1.0.206
- feat(status-beeps): New installs now ask once during setup whether to turn on status beeps — sounds stay off unless you say yes

## v1.0.205
- fix(status-beeps): Fresh installs no longer receive the deprecated /enable-arcade-beeps and /disable-arcade-beeps commands — only upgrades that already had them keep the renamed aliases

## v1.0.204
- feat(status-beeps): Beep toggle commands renamed to /enable-status-beeps and /disable-status-beeps — the old arcade-beeps names still work but are deprecated

## v1.0.203
- fix(arcade-beeps): Arcade beeps are now off by default in every install — turn them on per project with /enable-arcade-beeps, off again with /disable-arcade-beeps.

## v1.0.202
- feat(terminal-title): The 'awaiting your reply' tab indicator now also catches sign-off style endings like 'Ready when you are', and quietly logs a warning if a Claude Code update changes the data the hooks rely on.

## v1.0.201
- fix(install): Hook commands now survive cd'ing around your project — no more 'Cannot find module' errors after changing directories, and upgrades fix existing installs automatically.
- fix(terminal-title): The tab title no longer freezes when a session cd's into another project, and the 'awaiting your reply' half-circle now catches replies that ask for your go-ahead without a question mark.

## v1.0.200
- feat(changelog): Release notes now written in plain language

## v1.0.199
- feat(cli): Clearer 'what's new' summary when updating
- feat(terminal-title): More reliable 'awaiting your reply' tab indicator

## v1.0.198
- feat(arcade-beeps): ship opt-in Pole Position status beeps via CCA

## v1.0.197
- perf(terminal-title): deliver the directive once per session; dedupe user/project hooks

## v1.0.196
- fix(terminal-title): stop at the turn boundary when grading the closing '?' (stale-awaiting race)
- fix(cli): require non-TTY stdout for inside-Claude block (env var alone false-positives in inherited terminals)

## v1.0.195
- fix(terminal-title): flip awaiting ◐ for a closing question with a trailing parenthetical aside

## v1.0.194
- fix(terminal-title): guard the Stop question-grade against the transcript-flush race

## v1.0.193
- fix(installer): always refresh cca-managed title hooks on upgrade
- fix(terminal-title): arm the {sid}.ask flag so awaiting ◐ is race-free
- docs(publish): document web-auth/passkey publish flow in Discoveries

## v1.0.192
- fix(pkg): exclude runtime .titles/ from published tarball

## v1.0.191
- docs(readme): list terminal-title.directive.md in the hooks tree
- feat(terminal-title): add opt-in CLAUDE_TITLE_DEBUG forensic logging

## v1.0.190
- docs(readme): document the bundled terminal-title hook
- feat(terminal-title): bundle the terminal-title hook into core

## v1.0.189
- fix: drop redundant nul cleanup that errored after the install finale

## v1.0.188
- feat(plugins): add drop-in plugin system (plugin add/remove/list)

## v1.0.187
- refactor(terminal-title): reframe directive to use-case vocabulary (scope + infinitive goal)
- docs: add TODO for deterministic settings.json deny list
- feat(terminal-title): add question-awaiting state + AskUserQuestion refresh

## v1.0.186
- fix: increase bottom padding in docs file tree

## v1.0.183
- fix: stop copying updates dir to user projects and clean up existing ones

## v1.0.182
- fix: tight column alignment in docs parameter tables

## v1.0.181
- fix: tighten td code padding in docs parameter tables

## v1.0.180
- fix: improve autoconfig-update messaging when all updates are applied

## v1.0.179
- fix: add settings.local.json to AUTOCONFIG_FILES, tighten docs table columns

## v1.0.178
- fix: move insideClaude check before file copying

## v1.0.177
- feat: add pre-install diagnostic logging and fix AUTOCONFIG_FILES

## v1.0.176
- fix: add feedback to AUTOCONFIG_FILES to prevent false upgrade detection

## v1.0.175
- fix: include extract-rules command in user installs

## v1.0.174
- feat: add pre-publish rules for README and docs sync

## v1.0.173
- feat: ship /extract-rules to users

## v1.0.172
- feat: /extract-rules v3 — auto-apply, --keep-sources, changelog with paths

## v1.0.171
- feat: /extract-rules v3 — automatic flow, --keep-sources, changelog summary

