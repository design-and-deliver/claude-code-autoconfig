#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const run = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const postversion = process.argv.includes('--postversion');

// Get all version tags sorted descending
const tags = run('git tag --sort=-v:refname')
  .split('\n')
  .filter(t => /^v\d+\.\d+\.\d+$/.test(t));

if (tags.length < 2) {
  console.log('Not enough tags to generate changelog');
  process.exit(0);
}

const lines = ['# Changelog\n'];

for (let i = 0; i < tags.length - 1 && i < 50; i++) {
  const newer = tags[i];
  const older = tags[i + 1];
  const commits = run(`git log --format="%s" ${older}..${newer}`)
    .split('\n')
    .filter(Boolean)
    .filter(msg => !/^\d+\.\d+\.\d+$/.test(msg)) // skip version bump commits
    .filter(msg => !msg.startsWith('chore:') && !msg.startsWith('chore('));

  if (commits.length === 0) continue;

  lines.push(`## ${newer}`);
  for (const msg of commits) {
    lines.push(`- ${msg}`);
  }
  lines.push('');
}

fs.writeFileSync(
  path.join(__dirname, '..', 'CHANGELOG.md'),
  lines.join('\n') + '\n'
);
console.log(`Generated CHANGELOG.md with ${tags.length - 1} versions`);

// When called with --postversion, commit the changelog and re-tag
if (postversion) {
  const version = require(path.join(__dirname, '..', 'package.json')).version;
  run('git add CHANGELOG.md');
  run('git commit -m "chore: update changelog"');
  run(`git tag -f v${version}`);
  console.log(`Re-tagged v${version} to include changelog`);
}
