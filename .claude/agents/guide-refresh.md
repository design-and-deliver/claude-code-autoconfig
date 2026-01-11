<!-- @description Background worker that syncs the guide when .claude/ files change. -->

# Guide Refresh Agent

Incrementally update the guide's treeInfo when `.claude/` files are added or modified.

## Trigger

- PostToolUse hook on Edit|Write to `.claude/`

## Scope

- Read `.claude/**/*.md` for `@description` comments
- Update `.claude/guide/autoconfig.guide.html` treeInfo

## Behavior

1. Check which `.claude/` file was just modified
2. Extract the `<!-- @description ... -->` comment from the top
3. Find the corresponding entry in the guide's `treeInfo` object
4. Update only that entry's `desc` field
5. If file is new, add a new treeInfo entry
6. If file was deleted, remove the treeInfo entry

## Guidelines

- **Be fast**: Only touch the affected entry
- **Be minimal**: Don't reformat or reorganize unrelated code
- **Be silent**: Run in background, no output unless error
