<!-- @title Debug Methodology -->
<!-- @type feature -->
<!-- @description Ensures Claude investigates root cause before making changes instead of guessing -->
<!-- @files MEMORY.md -->

# Apply Debug Methodology Update

Add the following to the user's `MEMORY.md` file (Claude's persistent auto memory). This ensures the debugging methodology is always loaded into Claude's system prompt for every session.

## Content to Add

```markdown
## Debugging — Evidence Before Solutions
NEVER guess the root cause and jump to coding a fix. Always:
1. Add logging / check actual data first
2. Confirm root cause with evidence
3. Only then propose and implement a fix
If you can't determine the cause from code alone, add diagnostic logging and verify with runtime data.
CRITICAL: A plausible-looking cause from code reading is NOT confirmed evidence. Even if a mismatch looks obvious across multiple files, verify with runtime data before implementing. The more "obvious" the cause looks, the more important it is to verify — that's when the temptation to skip evidence gathering is strongest.
```

## After Applying

Inform the user: "Debug methodology added to MEMORY.md. It will be active in every future Claude session for this project."
