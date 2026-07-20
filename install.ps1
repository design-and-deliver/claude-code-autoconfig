# Claude Code Autoconfig - RETIRED install script (PowerShell)
# https://github.com/design-and-deliver/claude-code-autoconfig
#
# This installer is deprecated and intentionally installs nothing.
# It lagged behind the npm package (missing commands and hooks) and could
# overwrite an existing .claude/settings.json, so it was retired in favor
# of the npx installer, which is always current and merges safely.
#
# NOTE: ASCII only (PowerShell 5.1 misreads BOM-less UTF-8), and no `exit`
# on purpose - the advertised usage was `irm ... | iex`, which runs this in
# the caller's session; `exit` would close their terminal.

Write-Host "This installer has been retired - nothing was installed or modified." -ForegroundColor Yellow
Write-Host ""
Write-Host "Install Claude Code Autoconfig with npx instead (from a regular terminal,"
Write-Host "not inside a Claude Code session):"
Write-Host ""
Write-Host "  npx claude-code-autoconfig@latest" -ForegroundColor Cyan
Write-Host ""
