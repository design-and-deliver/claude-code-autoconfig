#!/usr/bin/env node

/**
 * @name Feedback Rule Check
 * @description On commit, holds new FEEDBACK.md entries once so /extract-rules can turn them into rules.
 *              The new lines go through /extract-rules --source <FEEDBACK.md> --staged. Entries
 *              that convert become .claude/rules/ files (logged in EXTRACTED.md, not FEEDBACK.md); the
 *              rest stay as feedback, and the retried commit goes through.
 * @trigger PreToolUse on Bash (git commit)
 */

// Why a commit gate and not PostToolUse(Edit|Write): FEEDBACK.md is human-authored, so
// Claude's own edits almost never touch it. A commit is where a teammate's new feedback
// actually passes through Claude — and converting it there lands the rules in that same commit.
//
// "Once" is tracked in <git-dir>/cca-feedback-evaluated.json: every added line the gate has
// already sent through /extract-rules. A retry whose remaining new lines are all in that set is
// let through — otherwise feedback that is not rule material would block the commit forever.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FEEDBACK_REL = '.claude/feedback/FEEDBACK.md';
const LEDGER_NAME = 'cca-feedback-evaluated.json';
// git, optionally with leading global flags (-C dir, --no-pager, …), then `commit`.
const COMMIT_RE = /\bgit\b(?:\s+-[^\s]+(?:\s+[^\s]+)?)*\s+commit\b/;
// The same command also stages files (`git add … && git commit`, `git commit -a/-am/--all`),
// so the diff to judge is against HEAD, not just the index.
const STAGES_TOO_RE = /\bgit\b(?:\s+-[^\s]+(?:\s+[^\s]+)?)*\s+add\b|\bcommit\b[^;&|]*\s(?:-[a-zA-Z]*a[a-zA-Z]*|--all)\b/;
// Pointer lines older /extract-rules runs wrote into FEEDBACK.md (upgrades move them to EXTRACTED.md).
const POINTER_RE = /^-\s*→\s*Moved to rule\b/;
const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const MAX_LISTED = 20;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// 1-based line number of the first `---` separator; entries live below it. 0 = none (all count).
function separatorLine(text) {
  const idx = text.split(/\r?\n/).findIndex((l) => l.trim() === '---');
  return idx + 1;
}

// Added lines of a -U0 diff, with their line numbers in the new file.
function addedLines(diff) {
  const out = [];
  let next = 0;
  for (const line of diff.split(/\r?\n/)) {
    const hunk = HUNK_RE.exec(line);
    if (hunk) { next = Number(hunk[1]); continue; }
    if (line.startsWith('+') && !line.startsWith('+++')) out.push({ n: next++, text: line.slice(1).trim() });
  }
  return out;
}

function isCandidate(entry, sep) {
  return entry.n > sep && entry.text !== '' && !POINTER_RE.test(entry.text);
}

// New feedback lines this commit would carry, or [] when FEEDBACK.md is not part of it.
function newFeedbackLines(root, withUnstaged) {
  const diff = git(root, ['diff', withUnstaged ? 'HEAD' : '--cached', '-U0', '--no-color', '--', FEEDBACK_REL]);
  if (!diff.trim()) return [];
  const current = withUnstaged
    ? fs.readFileSync(path.join(root, FEEDBACK_REL), 'utf8')
    : git(root, ['show', `:${FEEDBACK_REL}`]);
  const sep = separatorLine(current);
  return addedLines(diff).filter((e) => isCandidate(e, sep)).map((e) => e.text);
}

function readLedger(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed.lines) ? parsed.lines : [];
  } catch (_) {
    return [];
  }
}

function denyReason(lines) {
  const listed = lines.slice(0, MAX_LISTED).map((l) => `  ${l}`);
  if (lines.length > MAX_LISTED) listed.push(`  … and ${lines.length - MAX_LISTED} more`);
  return [
    `This commit adds new team feedback to ${FEEDBACK_REL}:`,
    ...listed,
    '',
    `Before committing, run /extract-rules --source ${FEEDBACK_REL} --staged.`,
    'It turns any entry that targets specific files into a .claude/rules/ file, moves that entry out',
    'to .claude/feedback/EXTRACTED.md, and stages all three. Then retry the same commit — it goes through once these',
    'lines have been evaluated, even if none of them became a rule.',
  ].join('\n');
}

function decide(data) {
  const cmd = String(data?.tool_input?.command || '');
  if (!COMMIT_RE.test(cmd)) return null;

  const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const root = git(cwd, ['rev-parse', '--show-toplevel']).trim();
  const lines = newFeedbackLines(root, STAGES_TOO_RE.test(cmd));
  if (!lines.length) return null;

  const ledgerFile = path.resolve(root, git(root, ['rev-parse', '--git-dir']).trim(), LEDGER_NAME);
  const seen = readLedger(ledgerFile);
  const fresh = lines.filter((l) => !seen.includes(l));
  if (!fresh.length) return null;

  fs.writeFileSync(ledgerFile, JSON.stringify({ lines: [...seen, ...fresh] }, null, 2));
  return denyReason(lines);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  try {
    const reason = decide(JSON.parse(input));
    if (reason) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      }));
    }
  } catch (_) {
    // Fail open: never block a commit because this check itself broke.
  }
  process.exit(0);
});
