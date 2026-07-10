# Changelog

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

## v1.0.170
- revert: remove /extract-rules from deployed build

## v1.0.169
- feat: add /extract-rules command

## v1.0.168
- feat: remove /sync-claude-md command

## v1.0.167
- fix: postversion creates separate commit instead of amending

## v1.0.165
- debug: add temporary changelog debug logging

## v1.0.164
- fix: use postversion hook so changelog includes current version

## v1.0.163
- fix: correct AUTOCONFIG_FILES list (guide→docs, add rules)

## v1.0.162
- feat: show changelog on upgrade

## v1.0.161
- fix(docs): top-align and left-align table cells in sync script

## v1.0.160
- fix: hide same-version updates in CLI output, top-align docs tables

