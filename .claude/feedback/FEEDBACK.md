<!-- @description Human-authored corrections and guidance for Claude. Reserved for team feedback only — Claude must not write here. This directory persists across /autoconfig runs. -->

# Team Feedback

**This file is for human-authored corrections and guidance only.**
Claude reads this file but must never write to it. When Claude discovers project context, gotchas, or learnings, it should append to the `## Discoveries` section in CLAUDE.md instead.

---

## Debugging Methodology — Evidence Before Solutions

**NEVER jump to a fix based on assumptions.** When investigating a bug:

1. **Gather evidence first** — add logging, check server logs, inspect actual data
2. **Confirm the root cause** — present findings to the user with evidence
3. **Only then propose a fix** — based on what you observed, not what you guessed

If you can't determine the root cause from code reading alone, **add diagnostic logging** and ask the user to reproduce. Do NOT:
- Guess the root cause and immediately start coding a fix
- Assume data mismatches without checking the actual data
- Rewrite logic because you think values "might" differ

The cost of a wrong fix is high: wasted time, unnecessary code complexity, and potentially masking the real issue.

---

## Update System Guidelines

The `.claude/updates/` directory is for updates that **require Claude to execute instructions** — writing to MEMORY.md, modifying user config, running migrations, etc.

**Do NOT create update files for simple command file drops.** Command files in `.claude/commands/` are automatically installed/updated by `copyDir` in the CLI. The CLI detects new and modified commands and reports them in the console output. Creating an update file for a command that's already shipped via `copyDir` is redundant.

**Rule:** If the update is just a file → put it in the right directory and let the CLI copy it. If the update needs instructions → create a `NNN-*.md` update file.

**Command versioning:** Every command file must have a `<!-- @version N -->` comment (typically line 2, after `@description`). Bump the version number whenever you modify a command. The CLI parses this to show version transitions on upgrade (e.g., `↑ /recover-context (v1 → v2)`).

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
