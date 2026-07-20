#!/usr/bin/env node
// PostToolUse(Bash) — arm the "a session is actively sorting out commits" flag.
//
// When ANY session in this repo runs a git *write* command (add/commit/push/
// pull/rebase/merge/stash/cherry-pick/revert), stamp a flag inside .git/. The
// Stop hook (see settings.json) treats that flag as live for a few minutes and
// suppresses its "Uncommitted work…" reminder while it's live — so the other
// terminals sharing this one working tree don't nag about the very files the
// committing session is mid-flight on.
//
// Why .git/ : git never tracks anything under .git/, so the flag is invisible
// to `git status` (can't inflate the file count it guards) and can never be
// committed by accident. No .gitignore entry needed.
//
// Self-expiring by design: freshness is judged by the flag's mtime, not an
// explicit "done" signal. A session that dies mid-commit just stops refreshing
// the flag; ~5 min later the Stop hook's reminder comes back on its own. Nothing
// to clean up, no stale lock to get wedged on.
//
// Read-only git (`status`/`log`/`diff`) deliberately does NOT arm the flag — the
// Stop hook itself runs those, so arming on reads would silence every session
// permanently.

const fs = require('fs');
const path = require('path');

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(raw || '{}');
    const cmd = String(data.tool_input?.command || '');
    // git, optionally with leading global flags (-C dir, --no-pager, …), then a
    // mutating subcommand. Matches `git commit`, `git -C . push`, `git add -A`.
    const isGitWrite =
      /\bgit\b(?:\s+-[^\s]+(?:\s+[^\s]+)?)*\s+(add|commit|push|pull|rebase|merge|stash|cherry-pick|revert|am|apply)\b/.test(
        cmd,
      );
    if (!isGitWrite) return;

    const dir = process.env.CLAUDE_PROJECT_DIR || data.cwd || '.';
    const gitDir = path.join(dir, '.git');
    if (!fs.existsSync(gitDir) || !fs.statSync(gitDir).isDirectory()) return; // worktree/.git-file → skip

    fs.writeFileSync(
      path.join(gitDir, '.cc-commit-active'),
      JSON.stringify({ session: data.session_id || null, at: Date.now() }),
    );
  } catch {
    // Best-effort: never break the tool pipeline over a flag write.
  }
});
