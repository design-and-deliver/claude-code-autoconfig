#!/usr/bin/env node

/**
 * @name Feedback Rule Migration Check
 * @description After FEEDBACK.md is edited, scans for entries that could be
 *              more reliably delivered as .claude/rules/ files with glob patterns.
 * @trigger PostToolUse on Write|Edit
 */

const fs = require('fs');
const path = require('path');

// File extension patterns that suggest rule-eligible content
const FILE_PATTERNS = [
  { regex: /\*\.py\b/i, ext: '*.py', lang: 'Python' },
  { regex: /\*\.js\b/i, ext: '*.js', lang: 'JavaScript' },
  { regex: /\*\.jsx\b/i, ext: '*.jsx', lang: 'JSX' },
  { regex: /\*\.ts\b/i, ext: '*.ts', lang: 'TypeScript' },
  { regex: /\*\.tsx\b/i, ext: '*.tsx', lang: 'TSX' },
  { regex: /\*\.go\b/i, ext: '*.go', lang: 'Go' },
  { regex: /\*\.rs\b/i, ext: '*.rs', lang: 'Rust' },
  { regex: /\*\.rb\b/i, ext: '*.rb', lang: 'Ruby' },
  { regex: /\*\.java\b/i, ext: '*.java', lang: 'Java' },
  { regex: /\*\.cpp\b|\.c\b|\.h\b/i, ext: '*.cpp', lang: 'C/C++' },
  { regex: /\*\.css\b|\.scss\b/i, ext: '*.css', lang: 'CSS' },
  { regex: /\*\.sql\b/i, ext: '*.sql', lang: 'SQL' },
  { regex: /\.vue\b/i, ext: '*.vue', lang: 'Vue' },
  { regex: /\.swift\b/i, ext: '*.swift', lang: 'Swift' },
  { regex: /\.kt\b|\.kotlin\b/i, ext: '*.kt', lang: 'Kotlin' },
];

// Read hook input from stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    handleHook(data);
  } catch (err) {
    process.exit(0);
  }
});

function handleHook(data) {
  const filePath = data?.tool_input?.file_path || '';

  // Only fire for FEEDBACK.md edits
  if (!filePath.endsWith('FEEDBACK.md')) {
    process.exit(0);
  }

  // Read the updated FEEDBACK.md
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    process.exit(0);
  }

  // Scan for file-type patterns
  const candidates = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of FILE_PATTERNS) {
      if (pattern.regex.test(line)) {
        // Get surrounding context (the section this line belongs to)
        let sectionStart = i;
        while (sectionStart > 0 && !lines[sectionStart - 1].startsWith('##')) {
          sectionStart--;
        }
        const sectionHeader = lines[sectionStart].startsWith('##')
          ? lines[sectionStart].replace(/^#+\s*/, '')
          : 'Unknown section';

        candidates.push({
          lang: pattern.lang,
          ext: pattern.ext,
          line: i + 1,
          section: sectionHeader,
          text: line.trim()
        });
        break; // One match per line is enough
      }
    }
  }

  if (candidates.length === 0) {
    process.exit(0);
  }

  // Deduplicate by language
  const uniqueLangs = [...new Set(candidates.map(c => c.lang))];

  // Output suggestion for Claude to relay to user
  const suggestions = uniqueLangs.map(lang => {
    const matches = candidates.filter(c => c.lang === lang);
    const ext = matches[0].ext;
    return `  - ${lang} (${ext}): ${matches.length} mention${matches.length > 1 ? 's' : ''} found`;
  }).join('\n');

  console.log(`FEEDBACK.md contains guidance that references specific file types.`);
  console.log(`These entries may be more reliably delivered as .claude/rules/ files:\n`);
  console.log(suggestions);
  console.log(`\nConsider asking the user if they'd like to migrate these to rules.`);
  console.log(`Rules auto-inject when matching files are touched — more deterministic than FEEDBACK.md.`);

  process.exit(0);
}
