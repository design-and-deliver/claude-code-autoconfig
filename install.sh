#!/bin/bash
# Claude Code Autoconfig - Install Script
# https://github.com/design-and-deliver/claude-code-autoconfig

set -e

REPO_BASE="https://raw.githubusercontent.com/design-and-deliver/claude-code-autoconfig/main"

echo "🚀 Installing Claude Code Autoconfig..."

# Create directory structure
mkdir -p .claude/commands
mkdir -p .claude/rules
mkdir -p .claude/guide

echo "📁 Created .claude/ directory structure"

# Download CLAUDE.md (won't overwrite if exists)
if [ -f "CLAUDE.md" ]; then
    echo "⚠️  CLAUDE.md already exists, saving template as CLAUDE.md.template"
    curl -fsSL "$REPO_BASE/CLAUDE.md" -o "CLAUDE.md.template"
else
    curl -fsSL "$REPO_BASE/CLAUDE.md" -o "CLAUDE.md"
    echo "✅ Created CLAUDE.md"
fi

# Download .claude files
curl -fsSL "$REPO_BASE/.claude/settings.json" -o ".claude/settings.json"
echo "✅ Created .claude/settings.json"

# Download commands
curl -fsSL "$REPO_BASE/.claude/commands/autoconfig.md" -o ".claude/commands/autoconfig.md"
curl -fsSL "$REPO_BASE/.claude/commands/commit-and-push.md" -o ".claude/commands/commit-and-push.md"
curl -fsSL "$REPO_BASE/.claude/commands/guide.md" -o ".claude/commands/guide.md"
curl -fsSL "$REPO_BASE/.claude/commands/test.md" -o ".claude/commands/test.md"
echo "✅ Created .claude/commands/"

# Download guide
curl -fsSL "$REPO_BASE/.claude/guide/autoconfig.guide.html" -o ".claude/guide/autoconfig.guide.html"
echo "✅ Created .claude/guide/"

echo ""
echo "✨ Claude Code Autoconfig installed!"
echo ""
echo "Next steps:"
echo "  1. Open Claude Code in this project"
echo "  2. Run /autoconfig to configure for your project"
echo "  3. Run /guide to open the interactive guide"
echo ""
echo "Repo: https://github.com/design-and-deliver/claude-code-autoconfig"