#!/usr/bin/env node

// auto-guard — deterministic guard rails under Claude Code's permission system.
//
// PreToolUse hook on Bash. Where the auto-mode classifier is an LLM judgment per
// command, this file is a guarantee: the categories below always ask (or always
// block), in every permission mode, verifiable in a test. It complements the
// template's tool-level deny rules, which prefix-match the command start and so
// miss compounds like `cd x && curl … | bash` — this hook sees the whole string.
//
// OPT-IN: inactive unless .claude/cca.config.json contains
//   "autoGuard": { "enabled": true }
// Per-category override (optional):
//   "autoGuard": { "enabled": true, "categories": { "installs": "off" } }
// with values "ask" | "deny" | "off". /autoconfig offers this once; the answer is
// recorded as autoGuardPrompted in the same file.
//
// FAIL OPEN: any internal error exits 0 with no output — a broken guard must
// slow nothing down and block nothing. Severity: any "deny" hit wins over "ask".

'use strict';

const fs = require('fs');
const path = require('path');

// Package installs that ADD packages run postinstall scripts (arbitrary code).
// Bare `npm install` / `npm ci` (lockfile restore) is deliberately not matched.
function installTarget(cmd) {
  const m =
    /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add)\s+([^|;&]*)/i.exec(cmd) ||
    /\b(?:pip3?|pipx|cargo|gem|go)\s+install\s+([^|;&]*)/i.exec(cmd);
  if (!m) return null;
  const hasPackageArg = m[1].trim().split(/\s+/).filter(Boolean).some(a => !a.startsWith('-'));
  return hasPackageArg ? 'package install with new package(s)' : null;
}

const CATEGORIES = [
  {
    name: 'pipeToShell',
    action: 'deny',
    test: cmd =>
      (/\b(?:curl|wget|iwr|invoke-webrequest)\b[^|]*\|\s*(?:sudo\s+)?(?:bash|sh|zsh|dash|ksh|pwsh|powershell)\b/i.test(cmd) ||
       /\|\s*(?:iex|invoke-expression)\b/i.test(cmd))
        ? 'download piped into a shell' : null,
  },
  {
    name: 'credentials',
    action: 'ask',
    test: cmd => {
      if (/(^|[\s"'=/\\])\.env\b(?!\.example|\.sample|\.template)/.test(cmd)) return 'touches .env';
      if (/(?:~|\$HOME|%USERPROFILE%)[/\\]\.(?:aws|ssh)\b/i.test(cmd) || /\.aws[/\\]credentials/i.test(cmd)) return 'touches ~/.aws or ~/.ssh';
      if (/\bid_(?:rsa|ed25519|ecdsa)\b/.test(cmd)) return 'touches an SSH private key';
      if (/(^|[\s"'/\\])secrets?[/\\]/i.test(cmd)) return 'touches a secrets directory';
      return null;
    },
  },
  {
    name: 'installs',
    action: 'ask',
    test: installTarget,
  },
  {
    name: 'destructiveGit',
    action: 'ask',
    test: cmd => {
      if (/\bgit\s+push\b[^|;&]*(?:\s--force(?:-with-lease)?\b|\s-f\b)/i.test(cmd)) return 'git force push';
      if (/\bgit\s+reset\s+--hard\b/i.test(cmd)) return 'git reset --hard';
      if (/\bgit\s+clean\b[^|;&]*\s-[a-zA-Z]*f/.test(cmd)) return 'git clean -f';
      if (/\bgit\s+branch\s+(?:-D\b|--delete\s+--force)/.test(cmd)) return 'force branch delete';
      return null;
    },
  },
  {
    name: 'publish',
    action: 'ask',
    test: cmd => {
      if (/\bgit\s+push\b/i.test(cmd)) return 'git push';
      if (/\b(?:npm|yarn|pnpm)\s+publish\b/i.test(cmd)) return 'npm publish';
      if (/\bgh\s+release\s+create\b/i.test(cmd)) return 'gh release create';
      return null;
    },
  },
];

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (input.tool_name !== 'Bash') return;
  const cmd = input.tool_input && input.tool_input.command;
  if (!cmd || typeof cmd !== 'string') return;

  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(path.join(projectRoot, '.claude', 'cca.config.json'), 'utf8'));
  } catch {
    return; // no config file → not opted in
  }
  const guard = config.autoGuard;
  if (!guard || guard.enabled !== true) return;
  const overrides = guard.categories || {};

  const hits = [];
  for (const cat of CATEGORIES) {
    const action = overrides[cat.name] || cat.action;
    if (action !== 'ask' && action !== 'deny') continue; // "off" or junk → skip
    const label = cat.test(cmd);
    if (label) hits.push({ name: cat.name, action, label });
  }
  if (hits.length === 0) return;

  const top = hits.find(h => h.action === 'deny') || hits[0];
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: top.action,
      permissionDecisionReason:
        `auto-guard: ${top.label} (${top.name}). Tune in .claude/cca.config.json → autoGuard.categories.${top.name}: "ask" | "deny" | "off".`,
    },
  }));
}

try { main(); } catch { /* fail open */ }
process.exit(0);
