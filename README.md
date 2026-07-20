[![npm version](https://img.shields.io/npm/v/claude-code-autoconfig.svg)](https://www.npmjs.com/package/claude-code-autoconfig)
[![npm downloads](https://img.shields.io/npm/dt/claude-code-autoconfig.svg)](https://www.npmjs.com/package/claude-code-autoconfig)
[![license](https://img.shields.io/npm/l/claude-code-autoconfig.svg)](https://github.com/design-and-deliver/claude-code-autoconfig/blob/main/LICENSE)

# Claude Code Autoconfig

Intelligent, self-configuring setup for Claude Code. One command analyzes your project, configures Claude, and shows you what it did.

## Why

Claude Code is powerful out of the box, but every new project means manually writing CLAUDE.md, configuring settings.json, setting up slash commands, and tuning permissions for your stack. It's repetitive, easy to get wrong, and most developers skip it entirely — leaving Claude underinformed about their project.

**Autoconfig does it in one step.** Run `/autoconfig` and Claude scans your project, detects your tech stack, and generates a tailored configuration. No templates to fill in. No boilerplate to copy-paste.

## Quick Install

Run it from a regular terminal — not from inside a Claude Code session (the installer detects that and asks you to switch to a separate terminal).

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
    │   ├── check-commit.md            #   /check-commit - uncommitted-work check
    │   ├── commit-and-push.md         #   /commit-and-push - git workflow
    │   ├── continue.md                #   /continue - resume the last session's work
    │   ├── enable-retro.md            #   /enable-retro - opt-in tech-debt log
    │   ├── enable-status-beeps.md     #   /enable-status-beeps - tab status beeps on
    │   ├── disable-status-beeps.md    #   /disable-status-beeps - tab status beeps off
    │   ├── enable-arcade-beeps.md     #   (deprecated alias of /enable-status-beeps)
    │   ├── disable-arcade-beeps.md    #   (deprecated alias of /disable-status-beeps)
    │   ├── extract-rules.md            #   /extract-rules - scan & extract rules
    │   ├── gls.md                     #   /gls - view latest screenshot
    │   ├── recover-context.md         #   /recover-context - restore context after compaction
    │   ├── show-docs.md               #   /show-docs - interactive walkthrough
    │   ├── submit-claude-code-github-issue.md # /submit-claude-code-github-issue - file upstream issue
    │   ├── sync-claude-md.md          #   /sync-claude-md - repair CLAUDE.md structure
    │   ├── test.md                    #   /test - run tests
    │   └── validate-cca-install.md   #   /validate-cca-install - verify installation
    ├── agents/                        # Custom subagents (add your own)
    │   ├── README.md                  #   How to define agents
    │   ├── create-retro-item.md       #   Logs tech debt as story files (see /enable-retro)
    │   └── docs-refresh.md            #   Keeps interactive docs in sync with .claude/
    ├── feedback/                      # Team corrections for Claude
    │   └── FEEDBACK.md                #   Add entries when Claude errs
    ├── hooks/                         # Hook scripts
    │   ├── format.js                  #   Auto-format on Write/Edit
    │   ├── terminal-title.js          #   Use-case terminal tab titles + live state
    │   ├── terminal-title.directive.md # Injected title directive (tunable wording)
    │   ├── arcade-beeps.js            #   Optional Pole Position status beeps (opt-in)
    │   ├── auto-guard.js              #   Opt-in deterministic guardrails under auto mode
    │   ├── feedback-rule-check.js     #   Nudges FEEDBACK.md entries toward .claude/rules/
    │   ├── mark-commit-active.js      #   Quiets the uncommitted-work reminder mid-commit
    │   └── migrate-feedback.js        #   One-time FEEDBACK.md → Discoveries migration
    ├── docs/                          # Interactive documentation
    │   └── autoconfig.docs.html       #   Open with /show-docs
    ├── scripts/                       # Utility scripts
    │   ├── gls-downscale.js           #   Shrink /gls screenshots to save image tokens
    │   └── sync-docs.js               #   Regenerate interactive HTML docs
    ├── sounds/                        # Status-cue audio for the status beeps
    │   ├── pp3-getready-G4.wav        #   Awaiting tone (get-ready tick)
    │   └── pp3-go-F#5.wav             #   Complete tone (GO beep)
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

### Slash Commands

| Command | Description |
|---------|-------------|
| `/autoconfig` | Configures Claude Code scaffolding for your project |
| `/autoconfig-update` | Check for and install configuration updates |
| `/show-docs` | Opens interactive docs in browser |
| `/test` | Runs your test suite (auto-detects framework) |
| `/commit-and-push` | Stages, commits with good message, and pushes |
| `/recover-context` | Recovers conversation context after compaction |
| `/continue` | Continues where the previous session in this terminal left off |
| `/gls` | Views latest screenshot (auto-downscaled to save tokens) |
| `/validate-cca-install` | Validates installation against latest published version |
| `/extract-rules` | Scan Claude artifacts and extract structured rules |
| `/check-commit` | Checks whether uncommitted work has piled up |
| `/sync-claude-md` | Repairs CLAUDE.md markers and Discoveries section |
| `/enable-retro` | Opt-in: Claude logs tech debt to `.claude/retro/` |
| `/submit-claude-code-github-issue` | Files an upstream issue with duplicate-checking |
| `/enable-status-beeps` | Turn on opt-in Pole Position status beeps |
| `/disable-status-beeps` | Turn off the status beeps |
| `/enable-arcade-beeps` | Deprecated alias for `/enable-status-beeps` (upgrades only) |
| `/disable-arcade-beeps` | Deprecated alias for `/disable-status-beeps` (upgrades only) |

### Updates

When new features or improvements are released, just run the install again:

```bash
npx claude-code-autoconfig@latest
```

Installing a specific older version isn't supported — if an old release is laid down explicitly (`npx claude-code-autoconfig@1.0.186`), the next `/autoconfig` announces it and brings the project up to the latest version.

Autoconfig detects existing installations and automatically launches `/autoconfig-update` instead of a full reconfigure. Your own content is preserved — feedback entries, hooks you wrote, and your settings customizations (settings are merged, never replaced) — while CCA-managed files (commands, managed hooks, scripts, sounds, docs) are refreshed to the new version.

Use `--force` for a clean slate reset if needed:

```bash
npx claude-code-autoconfig@latest --force
```

### MEMORY.md

Autoconfig writes a debug methodology to Claude's persistent memory (`MEMORY.md`), ensuring Claude investigates root causes with evidence before jumping to fixes. This loads into every future session automatically.

### Terminal Titles

Run several Claude Code sessions at once and the tabs all look alike. Autoconfig retitles each tab as `{scope} — {what you're working on}` with a live state indicator — ⬤ working, ◐ waiting on you, ✻ idle — so you can tell sessions apart at a glance. Claude updates the title itself as the work shifts; nothing to configure.

### Status Beeps (opt-in)

Prefer your ears to your eyes? Run `/enable-status-beeps` for Pole Position–style tab cues that mirror the title glyph: a low get-ready tick when a session is **waiting on you** and a higher GO tone when it **finishes**. Cross-platform (Windows / macOS / Linux) and off unless you opt in — fresh installs ask once at the end of `/autoconfig`, upgrades ask once during `/autoconfig-update`, and you can flip the answer any time with `/enable-status-beeps` / `/disable-status-beeps`. (The old `/enable-arcade-beeps` and `/disable-arcade-beeps` names still work as deprecated aliases.)

### Auto Permission Mode (opt-in)

Fresh installs and upgrades ask once whether to enable Claude Code's **auto permission mode**: routine commands run without approval prompts, and Claude still asks before destructive or external actions. Saying yes writes `permissions.defaultMode: "auto"` to your user-level `~/.claude/settings.json` — Claude Code deliberately ignores auto mode in project settings (a repo can't grant itself auto mode), so this is a per-user choice autoconfig can only offer, never ship as a project default. Revert any time with Shift+Tab in a session or by deleting the key.

### Auto-Guard (opt-in)

Auto mode's classifier is an LLM judgment per command; **auto-guard** is a guarantee under it. A small PreToolUse hook (`.claude/hooks/auto-guard.js`) inspects every Bash command and forces a prompt before pushes, new package installs, credential-file touches (`.env`, `~/.ssh`, `~/.aws`), and destructive git commands — and hard-blocks downloads piped into a shell — even when an allow rule or auto mode would have waved the command through. Unlike the template's tool-level deny rules (which prefix-match the command start), the hook sees the whole command string, so `cd x && curl … | bash` doesn't slip past. Asked once during `/autoconfig` or `/autoconfig-update`; inert unless you opt in (`autoGuard.enabled` in `.claude/cca.config.json`), with each category tunable to `"ask"`, `"deny"`, or `"off"`. Honest scope: it guards against accidents and casual prompt-injection, not a determined adversary — pattern-matching shell text is a seatbelt, not a sandbox.

### Team Feedback

When Claude makes a mistake, add an entry to `.claude/feedback/FEEDBACK.md`:

```markdown
## 2026-01-07: Don't use deprecated API
Claude used `oldFunction()` instead of `newFunction()`.
Always use the v2 API for user endpoints.
```

Claude reads this directory and learns for next time. Persists across `/autoconfig` runs.

### Rules

Claude Code supports path-scoped context rules in `.claude/rules/` that activate when Claude edits matching files. Autoconfig doesn't install any rules itself — write your own, or run `/extract-rules` to generate them from your existing Claude artifacts.

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
