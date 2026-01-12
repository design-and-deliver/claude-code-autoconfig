/**
 * Box Alignment Tests
 *
 * Validates that all box-drawing characters in cli.js are properly aligned.
 * The "READY TO CONFIGURE" box must have consistent width across all lines.
 */

const fs = require('fs');
const path = require('path');

// Strip ANSI escape codes to get visual character count
const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*m/g, '');

// Extract box lines from cli.js source
function extractBoxLines() {
  const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');
  const content = fs.readFileSync(cliPath, 'utf8');

  // Match console.log lines that contain box-drawing characters
  const boxCharRegex = /console\.log\(['"`]([^'"`]*[╔╗╚╝║═][^'"`]*)['"`]\)/g;
  const lines = [];
  let match;

  while ((match = boxCharRegex.exec(content)) !== null) {
    // Unescape the string (handle \x1b escape sequences)
    const unescaped = match[1].replace(/\\x1b/g, '\x1b');
    lines.push(unescaped);
  }

  return lines;
}

// Test: All box lines should have the same visual width
function testBoxAlignment() {
  const lines = extractBoxLines();

  if (lines.length === 0) {
    console.error('FAIL: No box lines found in cli.js');
    process.exit(1);
  }

  console.log(`Found ${lines.length} box lines to validate\n`);

  const widths = lines.map(line => {
    const stripped = stripAnsi(line);
    return { line: stripped, width: stripped.length };
  });

  // All widths should match the first line (the top border)
  const expectedWidth = widths[0].width;
  let allPass = true;

  widths.forEach((item, index) => {
    const status = item.width === expectedWidth ? 'PASS' : 'FAIL';
    const indicator = item.width === expectedWidth ? '✓' : '✗';

    console.log(`${indicator} Line ${index + 1}: width=${item.width} (expected ${expectedWidth})`);
    console.log(`  "${item.line}"`);

    if (item.width !== expectedWidth) {
      allPass = false;
    }
  });

  console.log();

  if (allPass) {
    console.log(`SUCCESS: All ${lines.length} box lines are aligned at ${expectedWidth} characters`);
    return true;
  } else {
    console.error(`FAILURE: Box lines have inconsistent widths`);
    return false;
  }
}

// Test: Box structure validation
function testBoxStructure() {
  const lines = extractBoxLines();

  console.log('\nValidating box structure...\n');

  let allPass = true;

  // First line should start with ╔ and end with ╗
  const firstStripped = stripAnsi(lines[0]);
  if (!firstStripped.startsWith('╔') || !firstStripped.endsWith('╗')) {
    console.log('✗ First line should start with ╔ and end with ╗');
    allPass = false;
  } else {
    console.log('✓ Top border correct (╔...╗)');
  }

  // Last line should start with ╚ and end with ╝
  const lastStripped = stripAnsi(lines[lines.length - 1]);
  if (!lastStripped.startsWith('╚') || !lastStripped.endsWith('╝')) {
    console.log('✗ Last line should start with ╚ and end with ╝');
    allPass = false;
  } else {
    console.log('✓ Bottom border correct (╚...╝)');
  }

  // Middle lines should start and end with ║
  for (let i = 1; i < lines.length - 1; i++) {
    const stripped = stripAnsi(lines[i]);
    if (!stripped.startsWith('║') || !stripped.endsWith('║')) {
      console.log(`✗ Line ${i + 1} should start and end with ║`);
      allPass = false;
    }
  }

  if (allPass) {
    console.log('✓ All middle lines have correct borders (║...║)');
    console.log('\nSUCCESS: Box structure is valid');
  } else {
    console.error('\nFAILURE: Box structure is invalid');
  }

  return allPass;
}

// Run all tests
console.log('='.repeat(60));
console.log('BOX ALIGNMENT TESTS');
console.log('='.repeat(60));
console.log();

const alignmentPass = testBoxAlignment();
const structurePass = testBoxStructure();

console.log();
console.log('='.repeat(60));

if (alignmentPass && structurePass) {
  console.log('ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log('TESTS FAILED');
  process.exit(1);
}
