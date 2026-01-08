#!/bin/bash
# Claude Code Autoconfig - Install Script
# https://github.com/design-and-deliver/claude-code-autoconfig

set -e

REPO_BASE="https://raw.githubusercontent.com/design-and-deliver/claude-code-autoconfig/main"

# Colors
ORANGE='\033[0;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}🚀 Installing Claude Code Autoconfig...${NC}"

# Create directory structure
mkdir -p .claude/commands
mkdir -p .claude/rules
mkdir -p .claude/guide

echo -e "${GREEN}📁 Created .claude/ directory structure${NC}"

# Download CLAUDE.md (won't overwrite if exists)
if [ -f "CLAUDE.md" ]; then
    echo -e "${ORANGE}⚠️  CLAUDE.md already exists, saving template as CLAUDE.md.template${NC}"
    curl -fsSL "$REPO_BASE/CLAUDE.md" -o "CLAUDE.md.template"
else
    curl -fsSL "$REPO_BASE/CLAUDE.md" -o "CLAUDE.md"
    echo -e "${GREEN}✅ Created CLAUDE.md${NC}"
fi

# Download .claude files
curl -fsSL "$REPO_BASE/.claude/settings.json" -o ".claude/settings.json"
echo -e "${GREEN}✅ Created .claude/settings.json${NC}"

# Download commands
curl -fsSL "$REPO_BASE/.claude/commands/autoconfig.md" -o ".claude/commands/autoconfig.md"
curl -fsSL "$REPO_BASE/.claude/commands/commit-and-push.md" -o ".claude/commands/commit-and-push.md"
curl -fsSL "$REPO_BASE/.claude/commands/show-guide.md" -o ".claude/commands/show-guide.md"
curl -fsSL "$REPO_BASE/.claude/commands/test.md" -o ".claude/commands/test.md"
echo -e "${GREEN}✅ Created .claude/commands/${NC}"

# Download guide
curl -fsSL "$REPO_BASE/.claude/guide/autoconfig.guide.html" -o ".claude/guide/autoconfig.guide.html"
echo -e "${GREEN}✅ Created .claude/guide/${NC}"

echo ""
echo -e "${CYAN}✨ Claude Code Autoconfig installed!${NC}"
echo ""
echo "Once Claude Code is open:"
echo "  1. Run /autoconfig to configure for your project"
echo "  2. Run /show-guide to open the interactive guide"
echo ""
read -p $'\033[0;33mOpen Claude Code now? [Press Enter to continue]\033[0m '
claude