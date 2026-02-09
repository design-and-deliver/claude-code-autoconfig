[![npm version](https://img.shields.io/npm/v/claude-code-autoconfig.svg)](https://www.npmjs.com/package/claude-code-autoconfig)
[![npm downloads](https://img.shields.io/npm/dt/claude-code-autoconfig.svg)](https://www.npmjs.com/package/claude-code-autoconfig)
[![license](https://img.shields.io/npm/l/claude-code-autoconfig.svg)](https://github.com/design-and-deliver/claude-code-autoconfig/blob/main/LICENSE)

# Claude Code Autoconfig

Intelligent, self-configuring setup for Claude Code. One command analyzes your project, configures Claude, and shows you what it did.

## Why

Claude Code is powerful out of the box, but every new project means manually writing CLAUDE.md, configuring settings.json, setting up slash commands, and tuning permissions for your stack. It's repetitive, easy to get wrong, and most developers skip it entirely — leaving Claude underinformed about their project.

**Autoconfig does it in one step.** Run `/autoconfig` and Claude scans your project, detects your tech stack, and generates a tailored configuration. No templates to fill in. No boilerplate to copy-paste.

## Quick Install

**npm:**
```bash
npx claude-code-autoconfig
```

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
    │   ├── autoconfig-update.md       #   /autoconfig-update - install updates
    │   ├── commit-and-push.md         #   /commit-and-push - git workflow
    │   ├── enable-retro.md            #   /enable-retro - opt-in tech debt tracking
    │   ├── show-docs.md               #   /show-docs - interactive walkthrough
    │   ├── sync-claude-md.md          #   /sync-claude-md - update CLAUDE.md
    │   └── test.md                    #   /test - run tests
    ├── agents/                        # Agent definitions
    │   ├── create-retro-item.md       #   Retro item creation agent
    │   └── docs-refresh.md            #   Docs sync agent
    ├── feedback/                      # Team corrections for Claude
    │   └── FEEDBACK.md                #   Add entries when Claude errs
    ├── hooks/                         # Hook scripts
    │   └── format.js                  #   Auto-format on Write/Edit
    ├── docs/                          # Interactive documentation
    │   └── autoconfig.docs.html       #   Open with /show-docs
    ├── updates/                       # Pending config updates
    ├── rules/                         # Path-scoped context (empty)
    ├── .mcp.json                      # MCP server configs (empty placeholder)
    └── settings.json                  # Permissions & security
```

## How It Works

### Self-Configuration

Most Claude Code templates are static — copy, paste, manually fill in the blanks. If your project changes, your config is already stale.

Autoconfig is **self-configuring**. Run `/autoconfig` and Claude:

1. **Detects your environment** — Windows, macOS, or Linux
2. **Scans your project** — Package files, framework indicators, test setup
3. **Populates CLAUDE.md** — Project name, tech stack, commands, conventions
4. **Configures settings.json** — Permissions tuned to your ecosystem

**Supported stacks:** JavaScript/TypeScript, Python, Rust, Go, Ruby, Java, .NET, PHP

| Feature | JS/TS | Python, Rust, Go, Ruby, Java, .NET, PHP |
|---------|-------|------------------------------------------|
| CLAUDE.md introspection | Yes | Yes |
| Slash commands | Yes | Yes |
| MEMORY.md | Yes | Yes |
| Auto-format hook | Yes | Coming soon |
| Optimized permissions | Yes | Coming soon |

Run `/sync-claude-md` anytime your project evolves to keep the configuration current.

### Slash Commands

| Command | Description |
|---------|-------------|
| `/autoconfig` | Analyzes project and populates configuration |
| `/autoconfig-update` | Check for and install configuration updates |
| `/sync-claude-md` | Re-analyzes project and updates CLAUDE.md |
| `/show-docs` | Opens interactive docs in browser |
| `/test` | Runs your test suite (auto-detects framework) |
| `/commit-and-push` | Stages, commits with good message, and pushes |
| `/enable-retro` | (Experimental) Enable tech debt tracking |

### Updates

When new features or improvements are released, just run the install again:

```bash
npx claude-code-autoconfig@latest
```

Autoconfig detects existing installations and automatically launches `/autoconfig-update` instead of a full reconfigure. Your customizations (feedback, hooks, settings) are preserved — only new files are added.

Use `--force` for a clean slate reset if needed:

```bash
npx claude-code-autoconfig@latest --force
```

### MEMORY.md

Autoconfig writes a debug methodology to Claude's persistent memory (`MEMORY.md`), ensuring Claude investigates root causes with evidence before jumping to fixes. This loads into every future session automatically.

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

Review and adjust these for your team's needs.

See [Claude Code Security Docs](https://docs.anthropic.com/en/docs/claude-code/security) for best practices.

## Links

- [npm package](https://www.npmjs.com/package/claude-code-autoconfig)
- [Claude Code Docs](https://docs.anthropic.com/en/docs/claude-code/overview)
- [Slash Commands Reference](https://docs.anthropic.com/en/docs/claude-code/slash-commands)

---

Built by [Andrew Ciccarelli](https://www.linkedin.com/in/andrewciccarelli/) at [ADAC 1001](https://adac1001.com) — a solo dev who ships.
