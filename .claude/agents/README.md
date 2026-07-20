<!-- @description Subagent definitions — two ship with autoconfig; add your project's own here too. -->

# Agents

This directory is where you define **subagents** — focused assistants Claude can delegate to during a task (e.g., a code reviewer, a test writer, a security auditor).

claude-code-autoconfig ships two agents here — `create-retro-item.md` (used by `/enable-retro`) and `docs-refresh.md` — and you can add your own agents tuned to your project alongside them. Each agent is a single Markdown file with frontmatter describing its purpose, tools, and system prompt.

See Anthropic's subagents docs for the file format:
https://docs.anthropic.com/en/docs/claude-code/sub-agents
