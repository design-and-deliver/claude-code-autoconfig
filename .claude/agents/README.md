<!-- @description Placeholder — drop your project's custom subagent definitions in this directory. -->

# Agents

This directory is where you define **subagents** — focused assistants Claude can delegate to during a task (e.g., a code reviewer, a test writer, a security auditor).

claude-code-autoconfig ships this folder empty so you can populate it with agents tuned to your project. Each agent is a single Markdown file with frontmatter describing its purpose, tools, and system prompt.

See Anthropic's subagents docs for the file format:
https://docs.anthropic.com/en/docs/claude-code/sub-agents
