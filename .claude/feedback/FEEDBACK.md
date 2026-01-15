<!-- @description Team-maintained corrections and guidance for Claude. Add notes here when Claude does something wrong — it learns for next time. This directory persists across /autoconfig runs. -->

# Team Feedback

Add corrections and guidance here when Claude does something wrong.
Claude reads this directory and learns for next time.

---

## Design Principles

- Each file should have a single responsibility (one reason to change)
- If a file exceeds 500 LOC, it likely lacks separation of concerns — look for decomposition opportunities
- Keep cyclomatic complexity under 10 per function — extract helper functions or simplify branching if higher

## Development Rules

### Testing Requirements

**CRITICAL: Before committing or outputting any changes to `bin/cli.js`, you MUST run tests and verify they pass:**

```bash
npm test
```

This runs tests which validate:
1. All box-drawing lines have consistent visual width (accounting for ANSI escape codes)
2. Box structure is valid (correct corner and border characters)
3. CLI install files exist and are properly configured

**DO NOT commit or present code changes if tests fail.** Fix the issues first.

### Box Drawing Guidelines

When modifying the "READY TO CONFIGURE" box in `bin/cli.js`:

1. All lines must be exactly 46 visible characters wide (including the `║` borders)
2. ANSI escape codes (`\x1b[...m`) don't count toward visible width
3. Place color codes outside content spacing: `\x1b[33m║\x1b[0m` + 44 chars of content + `\x1b[33m║\x1b[0m`
4. Always run `npm test` after any box modifications
