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
2. **`/show-docs`** — Opens an interactive guide showing what got set up

That's it. Your Claude Code environment is configured and ready.

## What Gets Installed

```
your-project/
├── CLAUDE.md                          # Project context (auto-populated)
└── .claude/
    ├── commands/                      # Slash commands
    │   ├── autoconfig.md              #   /autoconfig - self-configures
    │   ├── commit-and-push.md         #   /commit-and-push - git workflow
    │   ├── enable-retro.md            #   /enable-retro - opt-in tech debt tracking
    │   ├── show-docs.md              #   /show-docs - interactive walkthrough
    │   ├── sync-claude-md.md          #   /sync-claude-md - update CLAUDE.md
    │   └── test.md                    #   /test - run tests
    ├── feedback/                      # Team corrections for Claude
    │   └── FEEDBACK.md                #   Add entries when Claude errs
    ├── docs/                          # Interactive documentation
    │   └── autoconfig.docs.html       #   Open with /show-docs
    ├── rules/                         # Path-scoped context (empty)
    ├── .mcp.json                      # MCP server configs (empty placeholder)
    └── settings.json                  # Permissions & security
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
| `/sync-claude-md` | Re-analyzes project and updates CLAUDE.md |
| `/show-docs` | Opens interactive docs in browser |
| `/test` | Runs your test suite (auto-detects framework) |
| `/commit-and-push` | Stages, commits with good message, and pushes |
| `/enable-retro` | (Experimental) Enable tech debt tracking |

### Team Feedback

When Claude makes a mistake, add an entry to `.claude/feedback/FEEDBACK.md`:

```markdown
## 2026-01-07: Don't use deprecated API
Claude used `oldFunction()` instead of `newFunction()`.
Always use the v2 API for user endpoints.
```

Claude reads this directory and learns for next time. Persists across `/autoconfig` runs.

### Retro Items (Experimental)

Opt-in feature for tracking tech debt. Run `/enable-retro` to activate.

When enabled, Claude logs improvement opportunities as structured story files in `.claude/retro/`:
- Problem description
- Acceptance criteria
- Suggested approach
- Priority & effort sizing
- Files involved

Work through items anytime: *"Hey Claude, fix retro #001"*

### Rules

The `rules/` directory is intentionally empty. Effective rules require understanding your codebase patterns, team conventions, and quality standards.

**Want optimized rules for your project?**
Reach out: [info@adac1001.com](mailto:info@adac1001.com)

## Permissions & Security

The included `settings.json` provides sensible defaults that balance productivity with safety:

- **`allow`** — Auto-approved operations (file edits, tests, git commands)
- **`deny`** — Always blocked (secrets, destructive commands, network calls)

Review and adjust these for your team's needs. Run `/permissions` in Claude Code to inspect your current configuration.

See [Claude Code Security Docs](https://docs.anthropic.com/en/docs/claude-code/security) for best practices.

## Links

- [Claude Code Docs](https://docs.anthropic.com/en/docs/claude-code/overview)
- [Slash Commands Reference](https://docs.anthropic.com/en/docs/claude-code/slash-commands)

---

Built by [ADAC 1001](https://adac1001.com)
