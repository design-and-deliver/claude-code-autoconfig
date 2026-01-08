# Claude Code Autoconfig

Intelligent, self-configuring setup for Claude Code. One command analyzes your project, configures Claude, and shows you what it did.

## Quick Install

**macOS / Linux / WSL:**
```bash
curl -fsSL https://raw.githubusercontent.com/design-and-deliver/claude-code-autoconfig/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/design-and-deliver/claude-code-autoconfig/main/install.ps1 | iex
```

## After Install

1. **`/autoconfig`** — Claude analyzes your project and configures itself
2. **`/show-guide`** — Opens an interactive guide showing what got set up

That's it. Your Claude Code environment is configured and ready.

## What Gets Installed

```
your-project/
├── CLAUDE.md                          # Project context (auto-populated)
└── .claude/
    ├── settings.json                  # Permissions & security
    ├── commands/                      # Slash commands
    │   ├── autoconfig.md              #   /autoconfig - self-configures
    │   ├── autoconfig-refresh.md      #   /autoconfig-refresh - incremental sync
    │   ├── show-guide.md              #   /show-guide - interactive walkthrough
    │   ├── test.md                    #   /test - run tests
    │   └── commit-and-push.md         #   /commit-and-push - git workflow
    ├── agents/                        # Background subagents
    │   ├── refresh-guide.md           #   Syncs guide when files change
    │   └── create-retro-item.md       #   Creates retro items for tech debt
    ├── feedback/                      # Team corrections for Claude
    │   └── FEEDBACK.md                #   Add entries when Claude errs
    ├── retro/                         # Tech debt & improvements
    │   └── README.md                  #   Stories created by Claude
    ├── rules/                         # Path-scoped context (empty)
    └── guide/
        └── autoconfig.guide.html      # Interactive guide
```

## How It Works

### Self-Configuration

Most templates are static — copy, paste, manually fill in.

This one is **self-configuring**. Run `/autoconfig` and Claude:

1. **Detects your environment** — Windows vs macOS/Linux for correct command syntax
2. **Scans your project** — Package files, framework indicators, test setup
3. **Populates CLAUDE.md** — Project name, tech stack, commands, conventions
4. **Configures settings.json** — Permissions tuned to your ecosystem

You get a custom-fit configuration without the manual work.

### Slash Commands

| Command | Description |
|---------|-------------|
| `/autoconfig` | Analyzes project and populates configuration |
| `/autoconfig-refresh` | Incrementally syncs guide when `.claude/` files change |
| `/show-guide` | Opens interactive guide in browser |
| `/test` | Runs your test suite (auto-detects framework) |
| `/commit-and-push` | Stages, commits with good message, and pushes |

### Subagents

Background workers that automate workflows:

| Agent | Purpose |
|-------|---------|
| `refresh-guide` | Syncs the guide when `.claude/` files change |
| `create-retro-item` | Creates formatted story files when Claude spots tech debt |

### Team Feedback

When Claude makes a mistake, add an entry to `.claude/feedback/FEEDBACK.md`:

```markdown
## 2026-01-07: Don't use deprecated API
Claude used `oldFunction()` instead of `newFunction()`.
Always use the v2 API for user endpoints.
```

Claude reads this directory and learns for next time. Persists across `/autoconfig` runs.

### Retro Items

Tech debt and improvements surfaced during development. Claude creates story files in `.claude/retro/` with:

- Problem description
- Acceptance criteria
- Suggested approach
- Priority & effort sizing
- Files involved

Work through items anytime: *"Hey Claude, pick something from .claude/retro/ and fix it"*

### Rules

The `rules/` directory is intentionally empty. Effective rules require understanding your codebase patterns, team conventions, and quality standards.

**Want optimized rules for your project?**
Reach out: [info@adac1001.com](mailto:info@adac1001.com)

## Links

- [Claude Code Docs](https://docs.anthropic.com/en/docs/claude-code/overview)
- [Slash Commands Reference](https://docs.anthropic.com/en/docs/claude-code/slash-commands)

---

Built by [ADAC 1001](https://adac1001.com)
