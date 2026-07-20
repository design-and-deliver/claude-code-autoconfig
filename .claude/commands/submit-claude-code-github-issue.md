<!-- @description File a GitHub issue on anthropics/claude-code, with duplicate-check due diligence. -->
<!-- @version 1 -->
<!-- @response success | Issue filed (or upvote/comment on an existing one) after explicit user approval. -->
<!-- @example /submit-claude-code-github-issue plan names should be meaningful | File with context -->

File a GitHub issue on the anthropics/claude-code repository, with due diligence.

Usage:
- `/submit-claude-code-github-issue` - Start the workflow
- `/submit-claude-code-github-issue plan names should be meaningful` - Start with context from arguments

Arguments: $ARGUMENTS

Workflow:

### Phase 1: Understand the Issue
1. Ask the user what the issue is about, OR use any context/description provided in the arguments
2. Summarize the core request in 1-2 sentences to confirm understanding

### Phase 2: Due Diligence — Search Existing Issues
3. Search for similar/duplicate issues using multiple keyword variations:
   - `gh search issues --repo anthropics/claude-code "<keywords>" --limit 15`
   - Also search closed issues: `gh search issues --repo anthropics/claude-code "<keywords>" --state closed --limit 10`
4. Categorize each result by match strength:
   - **Exact** — Same issue, same ask. Filing would be a duplicate.
   - **Strong** — Very similar issue, minor differences in scope or framing.
   - **High** — Related topic, but meaningfully different request or context.
   - Discard anything below High — don't show medium/low matches.
5. Present findings in a markdown table:

   | # | Match | Status | Title | URL |
   |---|-------|--------|-------|-----|
   | 1234 | Exact | Open | Plan filenames should be descriptive | https://... |
   | 987 | Strong | Closed | Allow custom names for plan files | https://... |

6. Based on findings, offer options via AskUserQuestion:
   - If **Exact match (open)**: Recommend upvote + optional comment. Options: "Upvote + Comment", "File new anyway", "Cancel"
   - If **Exact match (closed)**: Note it was closed, recommend filing new if still relevant or commenting to reopen. Options: "File new", "Comment on closed issue", "Cancel"
   - If **Strong/High matches only**: Show table, note the differences, let user decide. Options: "File new", "Comment on existing", "Cancel"
   - If **No matches**: Proceed directly to Phase 3

   For upvote: `gh api repos/anthropics/claude-code/issues/{number}/reactions -f content='+1'`
   For comment: `gh issue comment {number} --repo anthropics/claude-code --body "<comment>"`

### Phase 3: Draft the Issue
7. Draft a concise issue title and body in markdown
8. Present the draft to the user for review using AskUserQuestion:
   - Option 1: "Publish" — submit as-is
   - Option 2: "Edit" — user provides feedback, redraft
   - Option 3: "Cancel" — abort

### Phase 4: Publish
9. If approved, run: `gh issue create --repo anthropics/claude-code --title "<title>" --body "<body>"`
10. Return the issue URL to the user

Guidelines:
- Keep titles short and actionable (under 80 chars)
- Body should include: clear description, current behavior, expected behavior, relevant context
- Add a footer: `Filed via [Claude Code](https://claude.ai/claude-code)`
- NEVER publish, comment, or react without explicit user approval
- If `gh` is not authenticated, inform the user and stop
- We can close our own issues and delete our own comments later if needed, but cannot fully delete issues on repos we don't own
