---
description: Show the full rationale behind the most recent cost-control verdict card
allowed-tools: Bash(node .claude/hooks/token-guard.js --details:*)
---
<!-- @description Show the full rationale behind the most recent cost-control verdict card — the arithmetic the consolidated card encapsulates. -->
<!-- @version 1 -->
<!-- @response success | Prints the persisted full card verbatim, with which meter fired and when. -->
<!-- @example /cost-control-details | See the math behind the last "deny, then /clear + /continue" card -->

# Cost Control Details

The consolidated cost-control card deliberately leaves out its arithmetic. This command prints
the full card that was persisted when the verdict fired — the newest one across ALL of this
project's sessions, because the natural moment to ask is right after the `/clear` + `/continue`
migration the card recommended, when the session id has already changed.

## Steps

1. Run:

   ```bash
   node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/token-guard.js" --details
   ```

2. Relay the output **verbatim** in a fenced code block — do not paraphrase, reformat, or
   summarize the card; its wording is a pinned copy contract.

3. If it printed `no cost-control verdicts recorded in this project yet.`, say exactly that and
   stop — do not go hunting through state files for older evidence.

Add nothing beyond the relayed output except (optionally) one sentence of plain-language
interpretation if the user asks a follow-up question.
