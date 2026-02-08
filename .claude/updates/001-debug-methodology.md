<!-- @title Debug Methodology -->
<!-- @type feature -->
<!-- @description Ensures Claude investigates root cause before making changes instead of guessing -->
<!-- @files MEMORY.md -->

# Apply Debug Methodology Update

Add the following to the user's `MEMORY.md` file (Claude's persistent auto memory). This ensures the debugging methodology is always loaded into Claude's system prompt for every session.

## Content to Add

```markdown
## Debugging — Evidence Before Solutions
NEVER guess the root cause and jump to coding a fix. Ask yourself: is the cause deterministic and verifiable from the error alone (e.g., stack trace, compile error)? If yes, fix it directly. If not:
1. Add logging / check actual data first
2. Confirm root cause with evidence
3. Only then propose and implement a fix
```

## After Applying

Inform the user: "Debug methodology added to MEMORY.md. It will be active in every future Claude session for this project."
