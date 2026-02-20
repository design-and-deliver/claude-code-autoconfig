<!-- @title Debug Methodology -->
<!-- @type feature -->
<!-- @description Ensures Claude investigates root cause before making changes instead of guessing -->
<!-- @files MEMORY.md -->

# Apply Debug Methodology Update

Add the following to the user's `MEMORY.md` file (Claude's persistent auto memory). This ensures the debugging methodology is always loaded into Claude's system prompt for every session.

## Locate MEMORY.md

The file lives at `~/.claude/projects/{encoded-project-path}/memory/MEMORY.md` where the project path is encoded by replacing path separators with dashes and removing colons (e.g., `C:\CODE\my-project` becomes `C--CODE-my-project`).

**Important**: Do NOT write MEMORY.md to the project root. It must go in the Claude Code user directory above. Create the directory if it doesn't exist. Append if the file already exists.

## Content to Add

```markdown
## Debugging — Evidence Before Solutions

**Never guess.** Before writing any fix, ask: do I have a stack trace, compile error, or type error that points directly to the problem?

- **Yes** → Fix it directly.
- **No** → Stop. Add logging first, get real runtime data, confirm the cause, *then* fix.

"I read the code and I think I see the issue" is a guess, not evidence.

**Circuit breaker — going in circles**: If the user reports your fix didn't solve the problem, STOP coding immediately. Add logging. No second guesses. Making another code change for the same symptom without new runtime evidence is going in circles.
```

## After Applying

Inform the user: "Debug methodology added to MEMORY.md. It will be active in every future Claude session for this project."
