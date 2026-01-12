# Claude Code Autoconfig - Install Script (PowerShell)
# https://github.com/design-and-deliver/claude-code-autoconfig

$ErrorActionPreference = "Stop"

$RepoBase = "https://raw.githubusercontent.com/design-and-deliver/claude-code-autoconfig/main"

Write-Host "🚀 Installing Claude Code Autoconfig..." -ForegroundColor Cyan

# Create directory structure
New-Item -ItemType Directory -Force -Path ".claude/commands" | Out-Null
New-Item -ItemType Directory -Force -Path ".claude/rules" | Out-Null
New-Item -ItemType Directory -Force -Path ".claude/docs" | Out-Null

Write-Host "📁 Created .claude/ directory structure" -ForegroundColor Green

# Download CLAUDE.md (won't overwrite if exists)
if (Test-Path "CLAUDE.md") {
    Write-Host "⚠️  CLAUDE.md already exists, saving template as CLAUDE.md.template" -ForegroundColor Yellow
    Invoke-RestMethod "$RepoBase/CLAUDE.md" -OutFile "CLAUDE.md.template"
} else {
    Invoke-RestMethod "$RepoBase/CLAUDE.md" -OutFile "CLAUDE.md"
    Write-Host "✅ Created CLAUDE.md" -ForegroundColor Green
}

# Download .claude files
Invoke-RestMethod "$RepoBase/.claude/settings.json" -OutFile ".claude/settings.json"
Invoke-RestMethod "$RepoBase/.claude/.mcp.json" -OutFile ".claude/.mcp.json"
Write-Host "✅ Created .claude/settings.json and .mcp.json" -ForegroundColor Green

# Download commands
Invoke-RestMethod "$RepoBase/.claude/commands/autoconfig.md" -OutFile ".claude/commands/autoconfig.md"
Invoke-RestMethod "$RepoBase/.claude/commands/commit-and-push.md" -OutFile ".claude/commands/commit-and-push.md"
Invoke-RestMethod "$RepoBase/.claude/commands/enable-retro.md" -OutFile ".claude/commands/enable-retro.md"
Invoke-RestMethod "$RepoBase/.claude/commands/show-docs.md" -OutFile ".claude/commands/show-docs.md"
Invoke-RestMethod "$RepoBase/.claude/commands/sync-claude-md.md" -OutFile ".claude/commands/sync-claude-md.md"
Invoke-RestMethod "$RepoBase/.claude/commands/test.md" -OutFile ".claude/commands/test.md"
Write-Host "✅ Created .claude/commands/" -ForegroundColor Green

# Download docs
Invoke-RestMethod "$RepoBase/.claude/docs/autoconfig.docs.html" -OutFile ".claude/docs/autoconfig.docs.html"
Write-Host "✅ Created .claude/docs/" -ForegroundColor Green

Write-Host ""
Write-Host "✨ Claude Code Autoconfig installed!" -ForegroundColor Cyan
Write-Host ""
Write-Host "Once Claude Code is open:" -ForegroundColor White
Write-Host "  1. Run /autoconfig to configure for your project"
Write-Host "  2. Run /show-docs to open the interactive docs"
Write-Host ""
Write-Host "Open Claude Code now? [Press Enter to continue]" -ForegroundColor DarkYellow -NoNewline
Read-Host
claude