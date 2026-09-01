---
description: Show the full rationale behind a TokenSaver verdict card
allowed-tools: Bash(node .claude/hooks/token-guard.js --details:*)
---
<!-- @description Show the full rationale behind a TokenSaver verdict card — the arithmetic the consolidated card encapsulates. -->
<!-- @version 3 -->
<!-- @param token | string | optional | Session token printed on the card face (the firing session id's first 8 chars). Pins the lookup to that session's ledger. -->
<!-- @response success | Prints the persisted full card verbatim, with which meter fired and when. -->
<!-- @example /token-saver-rationale | See the math behind the newest TokenSaver card -->
<!-- @example /token-saver-rationale 08be8cda | See the math behind the card that session 08be8cda printed -->

# TokenSaver Rationale

The consolidated TokenSaver card deliberately leaves out its arithmetic. This command prints the
full card that was persisted when the verdict fired. Every card face ends with a session token
(`/token-saver-rationale <token>`); passing it pins the lookup to the session that fired, so a
parallel session's newer card can't shadow the one the user is asking about. Without a token it
prints the newest card across ALL of this project's sessions, because the natural moment to ask
is right after the `/clear` + `/continue` migration the card recommended, when the session id
has already changed.

## Steps

1. Run (passing the token only if one was given):

   ```bash
   node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/token-guard.js" --details "${CLAUDE_PROJECT_DIR:-.}" $ARGUMENTS
   ```

2. Relay the output **verbatim** in a fenced code block — do not paraphrase, reformat, or
   summarize the card; its wording is a pinned copy contract.

3. If it printed `no cost-control verdicts recorded ...`, say exactly that and stop — do not go
   hunting through state files for older evidence.

Add nothing beyond the relayed output except (optionally) one sentence of plain-language
interpretation if the user asks a follow-up question.
