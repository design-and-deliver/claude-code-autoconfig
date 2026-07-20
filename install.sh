#!/bin/bash
# Claude Code Autoconfig - RETIRED install script
# https://github.com/design-and-deliver/claude-code-autoconfig
#
# This curl installer is deprecated and intentionally installs nothing.
# It lagged behind the npm package (missing commands and hooks) and could
# overwrite an existing .claude/settings.json, so it was retired in favor
# of the npx installer, which is always current and merges safely.

ORANGE='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${ORANGE}⚠️  This installer has been retired — nothing was installed or modified.${NC}"
echo ""
echo "Install Claude Code Autoconfig with npx instead (from a regular terminal,"
echo "not inside a Claude Code session):"
echo ""
echo -e "  ${CYAN}npx claude-code-autoconfig@latest${NC}"
echo ""
exit 1
