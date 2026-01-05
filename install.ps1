# Claude Code Autoconfig - Install Script (PowerShell)
# https://github.com/design-and-deliver/claude-code-autoconfig

$ErrorActionPreference = "Stop"

$RepoBase = "https://raw.githubusercontent.com/design-and-deliver/claude-code-autoconfig/main"

Write-Host "🚀 Installing Claude Code Autoconfig..." -ForegroundColor Cyan

# Create directory structure
New-Item -ItemType Directory -Force -Path ".claude/commands" | Out-Null
New-Item -ItemType Directory -Force -Path ".claude/rules" | Out-Null
New-Item -ItemType Directory -Force -Path ".claude/guide" | Out-Null

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
Write-Host "✅ Created .claude/settings.json" -ForegroundColor Green

# Download commands
Invoke-RestMethod "$RepoBase/.claude/commands/autoconfig.md" -OutFile ".claude/commands/autoconfig.md"
Invoke-RestMethod "$RepoBase/.claude/commands/commit-and-push.md" -OutFile ".claude/commands/commit-and-push.md"
Invoke-RestMethod "$RepoBase/.claude/commands/guide.md" -OutFile ".claude/commands/guide.md"
Invoke-RestMethod "$RepoBase/.claude/commands/test.md" -OutFile ".claude/commands/test.md"
Write-Host "✅ Created .claude/commands/" -ForegroundColor Green

# Download guide
Invoke-RestMethod "$RepoBase/.claude/guide/autoconfig.guide.html" -OutFile ".claude/guide/autoconfig.guide.html"
Write-Host "✅ Created .claude/guide/" -ForegroundColor Green

Write-Host ""
Write-Host "✨ Claude Code Autoconfig installed!" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Run /autoconfig to configure for your project"
Write-Host "  2. Run /guide to open the interactive guide"
Write-Host ""
Write-Host "Repo: https://github.com/design-and-deliver/claude-code-autoconfig" -ForegroundColor Gray