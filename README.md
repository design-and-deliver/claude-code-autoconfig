# Claude Code Autoconfig

Intelligent, self-configuring setup for Claude Code. One command and it analyzes your project, configures itself, and shows you what it did.

## Quick Install

**Add to an existing project:**

macOS / Linux / WSL:
```bash
curl -fsSL https://raw.githubusercontent.com/YOURUSERNAME/claude-code-autoconfig/main/install.sh | bash
```

Windows (PowerShell):
```powershell
irm https://raw.githubusercontent.com/YOURUSERNAME/claude-code-autoconfig/main/install.ps1 | iex
```

## After Install

1. Run `/autoconfig` — Claude analyzes your project and configures itself
2. Run `/guide` — Opens an interactive guide showing what got set up

That's it. Your Claude Code environment is configured and ready.

## What's Included

```
your-project/
├── CLAUDE.md                      # Project context for Claude
└── .claude/
    ├── settings.json              # Permissions & security
    ├── commands/                  # Slash commands
    │   ├── autoconfig.md          # /autoconfig - self-configures
    │   ├── guide.md               # /guide - interactive walkthrough
    │   ├── test.md                # /test - run tests
    │   └── commit-and-push.md     # /commit-and-push - git workflow
    ├── rules/                     # Path-scoped context (empty by default)
    └── guide/
        └── autoconfig.guide.html  # Interactive guide
```

## The Autoconfig Difference

Most templates are static — copy, paste, manually fill in.

This one is **self-configuring**. Run `/autoconfig` and Claude:
- Scans your project structure
- Detects your tech stack
- Populates CLAUDE.md with real values
- Configures settings.json for your ecosystem

You get a custom-fit configuration without the manual work.

## Custom Rules

The `rules/` directory is intentionally empty. Effective rules require understanding your codebase patterns, team conventions, and quality standards.

**Want optimized rules for your project?**  
Reach out: [info@adac1001.com](mailto:info@adac1001.com)

## Links

- [Claude Code Docs](https://docs.anthropic.com/en/docs/claude-code/overview)
- [Slash Commands Reference](https://docs.anthropic.com/en/docs/claude-code/slash-commands)

---

Built by [ADAC 1001](https://adac1001.com)
