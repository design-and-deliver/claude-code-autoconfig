<p align="center">
  <img src="https://raw.githubusercontent.com/design-and-deliver/claude-code-autoconfig/main/assets/readme/logo.png" width="96" height="96" alt="Claude Code Autoconfig logo">
</p>

<h1 align="center">Claude Code Autoconfig</h1>

<p align="center"><b>Claude Code, optimized.</b></p>

<p align="center">
  One command analyzes your project, configures Claude Code for your stack,<br>
  and shows you what it set up.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/claude-code-autoconfig"><img src="https://img.shields.io/npm/v/claude-code-autoconfig?style=flat-square&color=0b2545&label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/claude-code-autoconfig"><img src="https://img.shields.io/npm/dt/claude-code-autoconfig?style=flat-square&color=0b2545&label=downloads" alt="npm downloads"></a>
  <img src="https://img.shields.io/badge/Claude%20Code-v2.1.237%2B-C15F3C?style=flat-square" alt="Requires Claude Code v2.1.237+">
  <img src="https://img.shields.io/badge/macOS%20%C2%B7%20Linux%20%C2%B7%20Windows-0b2545?style=flat-square" alt="macOS, Linux, Windows">
  <a href="https://github.com/design-and-deliver/claude-code-autoconfig/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/claude-code-autoconfig?style=flat-square&color=0b2545" alt="license"></a>
</p>

<p align="center">
  <a href="https://proswitch.ai/claude-code-autoconfig"><b>Product page</b></a> ·
  <a href="#install">Install</a> ·
  <a href="#features">Features</a> ·
  <a href="#reference">Reference</a>
</p>

<br>

```bash
npx claude-code-autoconfig
```

<p align="center">Then run <b><code>/autoconfig</code></b> in Claude Code. Run <b><code>/show-docs</code></b> any time to see what got set up.</p>

<br>

## Features

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="https://www.linkedin.com/pulse/boris-chernys-claude-code-setup-got-over-67m-views-so-ciccarelli-wikge"><img src="https://proswitch.ai/claude-code-autoconfig/covers/boris-setup.jpg" alt="The creator's setup, automated"></a>
      <h3>The creator's setup, automated</h3>
      Boris Cherny's Claude Code setup got over 6.7M views. Autoconfig turns it into one installable command, with some improvements.
      <br><br><a href="https://www.linkedin.com/pulse/boris-chernys-claude-code-setup-got-over-67m-views-so-ciccarelli-wikge">Read the article →</a>
    </td>
    <td width="50%" valign="top">
      <a href="https://www.linkedin.com/pulse/i-caught-claude-code-guessing-heres-how-fixed-andrew-ciccarelli-hhupe"><img src="https://proswitch.ai/claude-code-autoconfig/covers/root-cause.jpg" alt="Evidence before fixes"></a>
      <h3>Evidence before fixes</h3>
      Claude verifies the root cause before it writes a fix, in every session, instead of guessing.
      <br><br><a href="https://www.linkedin.com/pulse/i-caught-claude-code-guessing-heres-how-fixed-andrew-ciccarelli-hhupe">Read the article →</a>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="https://www.linkedin.com/pulse/skip-init-let-claude-code-organically-grow-your-andrew-ciccarelli-doure"><img src="https://proswitch.ai/claude-code-autoconfig/covers/skip-init.jpg" alt="A CLAUDE.md that grows with your project"></a>
      <h3>A CLAUDE.md that grows with your project</h3>
      No generated boilerplate diluting context. It says only what Claude can't infer, and grows as Claude learns your project.
      <br><br><a href="https://www.linkedin.com/pulse/skip-init-let-claude-code-organically-grow-your-andrew-ciccarelli-doure">Read the article →</a>
    </td>
    <td width="50%" valign="top">
      <a href="https://www.linkedin.com/pulse/make-claude-code-more-deterministic-one-simple-slash-ciccarelli-sqhre"><img src="https://proswitch.ai/claude-code-autoconfig/covers/extract-rules-v6.jpg" alt="Rules that load exactly when they apply"></a>
      <h3>Rules that load exactly when they apply</h3>
      <code>/extract-rules</code> moves instructions out of CLAUDE.md into path-scoped rules, so Claude behaves the same way every time.
      <br><br><a href="https://www.linkedin.com/pulse/make-claude-code-more-deterministic-one-simple-slash-ciccarelli-sqhre">Read the article →</a>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="https://www.linkedin.com/pulse/maximize-your-multitasking-claude-code-smart-terminal-ciccarelli-3duse"><img src="https://proswitch.ai/claude-code-autoconfig/covers/terminal-titles-v10.jpg" alt="Smart terminal titles"></a>
      <h3>Smart terminal titles</h3>
      Every session names its own tab — <code>{scope} — {what you're working on}</code> — so a wall of terminals reads like a dashboard.
      <br><br><a href="https://www.linkedin.com/pulse/maximize-your-multitasking-claude-code-smart-terminal-ciccarelli-3duse">Read the article →</a>
    </td>
    <td width="50%" valign="top">
      <a href="https://www.linkedin.com/pulse/waiting-state-indicator-youve-been-claude-code-andrew-ciccarelli-sc64e"><img src="https://proswitch.ai/claude-code-autoconfig/covers/terminal-titles-v8.jpg" alt="Live status indicators"></a>
      <h3>Live status indicators</h3>
      A glyph in each tab shows which session is working ⬤, which needs you ◐, and which is done ✻.
      <br><br><a href="https://www.linkedin.com/pulse/waiting-state-indicator-youve-been-claude-code-andrew-ciccarelli-sc64e">Read the article →</a>
    </td>
  </tr>
</table>

### Also included

- **Same work, fewer words.** Turns on Claude Code's built-in Concise output style: Claude leads with the result and skips the narration.
- **Pick up where you left off.** `/continue` resumes the last session's work; `/recover-context` restores context after compaction.
- **Opt-in extras.** Auto permission mode, auto-guard safety checks under it, and Pole Position status beeps — each asked once, off unless you say yes.

## Install

```bash
npx claude-code-autoconfig
```

- Same command on macOS, Linux and Windows. Run it from a regular terminal — inside a Claude Code session, the installer stops and asks you to switch.
- Needs Claude Code **v2.1.237 or newer**. On an older version the installer stops and tells you to run `claude update`.
- Expect a few seconds of silence while npx starts; the first run also downloads the tool.

**Updating:** run `npx claude-code-autoconfig@latest` again. It detects the existing install and runs `/autoconfig-update`: CCA-managed files (commands, managed hooks, scripts, sounds, docs) refresh; your feedback entries, your own hooks, and your settings are kept (settings are merged, never replaced). Add `--force` for a clean reset.

## Reference

<details>
<summary><b>Slash commands</b></summary>

| Command | Description |
|---------|-------------|
| `/autoconfig` | Configures Claude Code scaffolding for your project |
| `/autoconfig-update` | Checks for and installs configuration updates |
| `/show-docs` | Opens interactive docs in the browser |
| `/test` | Runs your test suite (auto-detects the framework) |
| `/commit-and-push` | Stages, commits with a good message, and pushes |
| `/continue` | Continues where the previous session in this terminal left off |
| `/recover-context` | Recovers conversation context after compaction |
| `/gls` | Shows your latest screenshot (auto-downscaled to save tokens) |
| `/extract-rules` | Scans Claude artifacts and extracts structured rules |
| `/check-commit` | Checks whether uncommitted work has piled up |
| `/sync-claude-md` | Repairs CLAUDE.md markers and the Discoveries section |
| `/submit-claude-code-github-issue` | Files an upstream issue with duplicate-checking |
| `/enable-auto-mode` · `/disable-auto-mode` | Turns auto-guard prompts off / back on for one category |
| `/enable-status-beeps` · `/disable-status-beeps` | Turns the status beeps on / off |

</details>

<details>
<summary><b>What gets installed</b></summary>

```
your-project/
├── CLAUDE.md                          # Project context (auto-populated)
└── .claude/
    ├── commands/                      # The slash commands above
    ├── agents/                        # Custom subagents (add your own)
    │   ├── README.md                  #   How to define agents
    │   └── docs-refresh.md            #   Keeps interactive docs in sync with .claude/
    ├── feedback/
    │   └── FEEDBACK.md                # Team corrections for Claude
    ├── hooks/
    │   ├── format.js                  # Auto-format on Write/Edit
    │   ├── terminal-title.js          # Tab titles + live state
    │   ├── terminal-title.directive.md # Title directive (tunable wording)
    │   ├── arcade-beeps.js            # Status beeps (opt-in)
    │   ├── auto-guard.js              # Guardrails under auto mode (opt-in)
    │   ├── feedback-rule-check.js     # On commit, turns new FEEDBACK.md entries into .claude/rules/
    │   ├── mark-commit-active.js      # Quiets the uncommitted-work reminder mid-commit
    │   └── migrate-feedback.js        # One-time FEEDBACK.md → Discoveries migration
    ├── docs/autoconfig.docs.html      # Interactive docs (/show-docs)
    ├── scripts/
    │   ├── auto-guard-set.js          # Backend for /enable-auto-mode + /disable-auto-mode
    │   ├── docs-previews.js           # Shows your project's files in the docs
    │   ├── gls-downscale.js           # Shrinks /gls screenshots
    │   └── sync-docs.js               # Regenerates the interactive docs
    ├── sounds/                        # Status-beep audio
    ├── package.json                   # Keeps hooks CommonJS in "type": "module" repos
    └── settings.json                  # Permissions, hooks, Concise output style
```

</details>

<details>
<summary><b>Supported stacks</b></summary>

`/autoconfig` detects your OS, scans package files, framework indicators and test setup, then populates CLAUDE.md and tunes `settings.json` permissions to your ecosystem.

| Feature | JS/TS | Python, Rust, Go, Ruby, Java, .NET, PHP |
|---------|-------|------------------------------------------|
| CLAUDE.md introspection | Yes | Yes |
| Slash commands | Yes | Yes |
| MEMORY.md | Yes | Yes |
| Auto-format hook | Yes | Coming soon |
| Optimized permissions | Yes | Coming soon |

</details>

<details>
<summary><b>Auto permission mode &amp; auto-guard</b></summary>

**Auto permission mode.** Installs and upgrades ask once whether to turn it on: routine commands run without approval prompts, and Claude still asks before destructive or external actions. Yes writes `permissions.defaultMode: "auto"` to your user-level `~/.claude/settings.json` — Claude Code ignores auto mode in project settings, so a repo can't grant it to itself. Revert with Shift+Tab or by deleting the key.

**Auto-guard.** Auto mode's classifier is a per-command LLM judgment; auto-guard is a guarantee under it. A PreToolUse hook inspects every Bash command and forces a prompt before pushes, new package installs, credential-file access (`.env`, `~/.ssh`, `~/.aws`) and destructive git commands, and hard-blocks downloads piped into a shell. It sees the whole command string, so `cd x && curl … | bash` doesn't slip past a prefix rule. Off unless you opt in (`autoGuard.enabled` in `.claude/cca.config.json`); each category can be `"ask"`, `"deny"` or `"off"`. It guards against accidents and casual prompt injection — a seatbelt, not a sandbox.

</details>

<details>
<summary><b>Status beeps</b></summary>

`/enable-status-beeps` adds Pole Position–style cues that mirror the tab glyph: a low get-ready tick when a session is waiting on you, a higher GO tone when it finishes. Works on Windows, macOS and Linux; `/disable-status-beeps` turns them off.

</details>

<details>
<summary><b>Team feedback, rules &amp; memory</b></summary>

**Feedback.** When Claude makes a mistake, add an entry to `.claude/feedback/FEEDBACK.md`; CLAUDE.md imports it, so Claude loads it every session, and it survives `/autoconfig` runs.

```markdown
## 2026-01-07: Don't use deprecated API
Claude used `oldFunction()` instead of `newFunction()`.
Always use the v2 API for user endpoints.
```

**Rules.** Autoconfig installs no `.claude/rules/` of its own — write your own, or run `/extract-rules` to generate them. Want optimized rules for your project? [info@adac1001.com](mailto:info@adac1001.com)

**Memory.** Autoconfig writes the evidence-before-fixes debugging method into Claude's persistent `MEMORY.md`, so it loads into every session.

</details>

<details>
<summary><b>Permissions &amp; security</b></summary>

The included `settings.json` ships defaults that balance speed with safety: `deny` always blocks secrets, destructive commands and network calls. A recommended `allow` list (file edits, tests, git) is offered as an opt-in during `/autoconfig`, so nothing is pre-approved until you say yes. Review them for your team — see the [Claude Code security docs](https://docs.anthropic.com/en/docs/claude-code/security).

</details>

## More writing on Claude Code

<table>
  <tr>
    <td width="33%" valign="top">
      <a href="https://www.linkedin.com/pulse/claude-code-luddites-andrew-ciccarelli-lgn9c"><img src="https://proswitch.ai/claude-code-autoconfig/covers/luddites.jpg" alt="Claude Code for Luddites"></a>
      <br><a href="https://www.linkedin.com/pulse/claude-code-luddites-andrew-ciccarelli-lgn9c"><b>Claude Code for Luddites</b></a>
    </td>
    <td width="33%" valign="top">
      <a href="https://www.linkedin.com/pulse/claude-code-50k-line-codebases-andrew-ciccarelli-akpge"><img src="https://proswitch.ai/claude-code-autoconfig/covers/50k-codebases.jpg" alt="Claude Code for 50K+ Line Codebases"></a>
      <br><a href="https://www.linkedin.com/pulse/claude-code-50k-line-codebases-andrew-ciccarelli-akpge"><b>Claude Code for 50K+ Line Codebases</b></a>
    </td>
    <td width="33%" valign="top">
      <a href="https://www.linkedin.com/pulse/claude-code-subagents-arent-multithreading-hidden-cost-ciccarelli-qtple"><img src="https://proswitch.ai/claude-code-autoconfig/covers/subagents.jpg" alt="Claude Code subagents aren't multithreading"></a>
      <br><a href="https://www.linkedin.com/pulse/claude-code-subagents-arent-multithreading-hidden-cost-ciccarelli-qtple"><b>Claude Code subagents aren't multithreading</b></a>
    </td>
  </tr>
</table>

---

<p align="center">
  Built by <a href="https://www.linkedin.com/in/andrewdciccarelli">Andrew Ciccarelli</a> at <a href="https://adac1001.com">ADAC 1001</a> · <a href="https://proswitch.ai/claude-code-autoconfig">proswitch.ai</a> · MIT licensed
</p>
