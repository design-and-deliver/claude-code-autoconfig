# claude-code-autoconfig

CLI tool that auto-configures Claude Code for any project.

## Development Rules

### Testing Requirements

**CRITICAL: Before committing or outputting any changes to `bin/cli.js`, you MUST run tests and verify they pass:**

```bash
npm test
```

This runs `test/box-alignment.test.js` which validates:
1. All box-drawing lines have consistent visual width (accounting for ANSI escape codes)
2. Box structure is valid (correct corner and border characters)

**DO NOT commit or present code changes if tests fail.** Fix the alignment issues first.

### Box Drawing Guidelines

When modifying the "READY TO CONFIGURE" box in `bin/cli.js`:

1. All lines must be exactly 46 visible characters wide (including the `║` borders)
2. ANSI escape codes (`\x1b[...m`) don't count toward visible width
3. Place color codes outside content spacing: `\x1b[33m║\x1b[0m` + 44 chars of content + `\x1b[33m║\x1b[0m`
4. Always run `npm test` after any box modifications

## Commands

- `npm test` - Run box alignment tests
