#!/usr/bin/env node

/**
 * @name Feedback Rule Migration Check
 * @description After FEEDBACK.md is edited, notifies Claude to evaluate
 *              whether any entries would be more reliably delivered as
 *              .claude/rules/ files with glob patterns.
 * @trigger PostToolUse on Write|Edit
 */

// Read hook input from stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const filePath = data?.tool_input?.file_path || '';

    // Only fire for FEEDBACK.md edits
    if (!filePath.endsWith('FEEDBACK.md')) {
      process.exit(0);
    }

    console.log([
      'FEEDBACK.md was just modified.',
      'Review the changes and evaluate whether any entries are tied to specific file types,',
      'frameworks, or patterns that could be scoped with a glob (e.g., *.py, *.tsx, src/api/**).',
      '',
      'If any entries qualify, ask the user:',
      '"Some of this guidance targets specific file types. Want me to migrate it to .claude/rules/',
      'for more reliable delivery? Rules auto-inject when matching files are touched."',
      '',
      'If the user confirms, create the rule file with the appropriate glob and remove the entry from FEEDBACK.md.',
      'If nothing qualifies, do nothing — not every FEEDBACK.md entry needs to be a rule.',
    ].join('\n'));

    process.exit(0);
  } catch (err) {
    process.exit(0);
  }
});
