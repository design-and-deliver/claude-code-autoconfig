#!/usr/bin/env node

/**
 * @name Format Hook
 * @description Runs project formatter after Write/Edit operations
 * @trigger PostToolUse on Write|Edit
 */

const { execSync } = require('child_process');
const path = require('path');

// Read hook input from stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    handleHook(data);
  } catch (err) {
    // Silent exit if no valid input
    process.exit(0);
  }
});

function handleHook(data) {
  const filePath = data?.tool_input?.file_path || '';

  // Skip non-source files
  if (!filePath.match(/\.(js|jsx|ts|tsx|json|css|scss|md|html)$/)) {
    process.exit(0);
  }

  // Skip node_modules and other generated directories
  if (filePath.includes('node_modules') || filePath.includes('dist/') || filePath.includes('build/')) {
    process.exit(0);
  }

  try {
    // Run formatter silently - errors are non-fatal
    execSync('npm run format --silent 2>/dev/null || true', {
      cwd: process.cwd(),
      stdio: 'ignore'
    });
  } catch (err) {
    // Formatting is best-effort, don't block on failure
  }

  process.exit(0);
}
