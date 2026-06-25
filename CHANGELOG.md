# Changelog

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

## v1.0.159
- fix: exclude cca.config.json from npm publish

## v1.0.158
- fix(gls): persist screenshot path in local config, fix Windows paths

## v1.0.157
- feat: stop pre-populating CLAUDE.md with project descriptions

## v1.0.156
- fix: clean up inside-Claude block message wording

## v1.0.155
- feat: pre-approve permissions for all shipped command dependencies

## v1.0.154
- fix: enforce ls -t over find in gls command to avoid permission prompts

## v1.0.153
- style: left-align all table cells in docs info cards

## v1.0.152
- fix: warn against ! prefix workaround in inside-Claude message

## v1.0.151
- fix: scope find permission to project directory for security

## v1.0.150
- style: use pointing emoji in inside-Claude message

## v1.0.149
- style: consolidate inside-Claude message to two lines

## v1.0.148
- fix: refine inside-Claude error wording

## v1.0.147
- fix: make inside-Claude error message more specific

## v1.0.146
- style: improve inside-Claude block message formatting

## v1.0.145
- fix: block npx install from inside Claude Code session

## v1.0.144
- feat: swagger-style docs, wider layout, better install UX

## v1.0.143
- feat: add /validate-cca-install command

## v1.0.142
- feat(recover-context): support cross-session recovery

