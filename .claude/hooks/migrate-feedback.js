#!/usr/bin/env node

/**
 * @name Feedback to Discoveries Migration
 * @description On session start, migrates custom FEEDBACK.md content to
 *              CLAUDE.md Discoveries section. One-time, idempotent.
 * @trigger SessionStart
 */

const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const claudeMdPath = path.join(cwd, 'CLAUDE.md');
const feedbackPath = path.join(cwd, '.claude', 'feedback', 'FEEDBACK.md');

// Read hook input from stdin (required by hook protocol)
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    migrate();
  } catch (err) {
    // Silent exit on any error
  }
  process.exit(0);
});

function migrate() {
  if (!fs.existsSync(claudeMdPath) || !fs.existsSync(feedbackPath)) return;

  const claudeMd = fs.readFileSync(claudeMdPath, 'utf8');

  // Skip if Discoveries section already exists
  if (claudeMd.includes('## Discoveries')) return;

  const feedback = fs.readFileSync(feedbackPath, 'utf8');
  const lines = feedback.split(/\r?\n/);

  // Find first --- separator
  let sepIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      sepIdx = i;
      break;
    }
  }

  if (sepIdx < 0) return;

  const customContent = lines.slice(sepIdx + 1).join('\n').trim();
  if (!customContent) return;

  // Append Discoveries section to CLAUDE.md
  const discoveries = `\n\n## Discoveries\n<!-- Claude: append project-specific learnings, gotchas, and context below. This section persists across /autoconfig runs. -->\n\n${customContent}\n`;
  fs.writeFileSync(claudeMdPath, claudeMd + discoveries);

  // Reset FEEDBACK.md
  const template = [
    '<!-- @description Human-authored corrections and guidance for Claude. Reserved for team feedback only \u2014 Claude must not write here. This directory persists across /autoconfig runs. -->',
    '',
    '# Team Feedback',
    '',
    '**This file is for human-authored corrections and guidance only.**',
    'Claude reads this file but must never write to it. When Claude discovers project context, gotchas, or learnings, it should append to the `## Discoveries` section in CLAUDE.md instead.',
    '',
    '---',
    '',
    ''
  ].join('\n');
  fs.writeFileSync(feedbackPath, template);
}
