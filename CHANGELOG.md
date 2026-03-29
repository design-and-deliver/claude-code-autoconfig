# Changelog

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

## v1.0.141
- fix: replace Windows NUL cleanup with cross-platform command

## v1.0.140
- docs: trim recover-context usage to essential examples

## v1.0.139
- fix: render usage params as structured HTML list in docs info cards

## v1.0.138
- feat: auto-include Usage sections in docs info cards

## v1.0.137
- docs: add usage params to recover-context docs and make dash optional

## v1.0.136
- fix: modernize permission syntax and merge perms on upgrade

## v1.0.135
- feat: auto-sync docs with .claude/ contents via sync-docs.js

## v1.0.134
- fix: add missing hooks/updates to docs, expand sync tests

## v1.0.133
- fix: add recover-context, gls, and autoconfig-update to interactive docs

## v1.0.132
- fix: strengthen bootstrap step instruction so Claude executes it

## v1.0.131
- feat: support running autoconfig from inside Claude Code sessions

## v1.0.130
- fix: block interactive install from inside Claude Code sessions

## v1.0.129
- fix: tighten /recover-context confirmation to single line

## v1.0.128
- fix: show estimated tokens instead of bytes in /recover-context

## v1.0.127
- feat: SessionStart hook for feedback migration, merge hooks on upgrade

## v1.0.126
- feat: add FEEDBACK.md migration to /autoconfig Step 0

## v1.0.125
- feat: auto-migrate FEEDBACK.md to Discoveries during CLI upgrade

## v1.0.124
- fix: remove Step 0 from /autoconfig, clarify terminal requirement

## v1.0.123
- fix: use npm exec instead of npx in Step 0

## v1.0.122
- feat: /autoconfig pulls latest package before configuring

## v1.0.121
- feat: add feedback-to-discoveries migration update (004)

## v1.0.120
- feat: separate Claude discoveries from human feedback

## v1.0.119
- fix: remove nul deny rules that block Windows bash redirections

