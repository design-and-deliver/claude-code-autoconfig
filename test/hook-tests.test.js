#!/usr/bin/env node

/**
 * Runs the hook test suites (.claude/hooks/tests/*.test.cjs) as part of `npm test`.
 *
 * Why a runner instead of `node --test <glob>` in package.json: cmd.exe doesn't expand
 * globs and node only globs --test args itself from v21 — CI runs node 18/20/22 on three
 * OSes. Discovery here also means a newly added *.test.cjs runs automatically, with no
 * package.json edit to forget.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '.claude', 'hooks', 'tests');
const files = fs.readdirSync(dir)
  .filter(f => f.endsWith('.test.cjs'))
  .map(f => path.join(dir, f));

if (files.length === 0) {
  console.error(`No *.test.cjs files found in ${dir} — the hook suites are missing.`);
  process.exit(1);
}

console.log(`Running ${files.length} hook test suites via node --test...`);
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (r.status !== 0) {
  console.error('HOOK TESTS FAILED');
  process.exit(r.status === null ? 1 : r.status);
}
console.log('ALL HOOK SUITES PASSED');
