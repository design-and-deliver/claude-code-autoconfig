#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const run = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const postversion = process.argv.includes('--postversion');

// CHANGELOG.md is USER-FACING: bullets surface verbatim in the installer's "what's new"
// summary (bin/update-summary.js). Commit subjects stay technical; the user-facing line
// comes from a `Changelog: <line>` trailer in the commit body (see bulletFor).

// Wording overrides for ALREADY-PUSHED commits whose subjects predate the trailer
// convention (keyed by commit-hash prefix). Value null drops the bullet entirely.
// Do NOT add rows for new work — author a `Changelog:` trailer instead.
const OVERRIDES = {
  '82f27d6': "feat(terminal-title): More reliable 'awaiting your reply' tab indicator",
  '4d43ede': null, // folded into the indicator-reliability line above
  'e347106': "feat(cli): Clearer 'what's new' summary when updating",
};

// The changelog line for one commit, or null to omit it. Precedence:
//   1. OVERRIDES — retroactive rewording of published history
//   2. `Changelog: <line>` body trailer — the authoring path: technical subject,
//      plain-language trailer ("Changelog: none" / "skip" hides the commit)
//   3. the raw subject
// A trailer keeps the subject's `type(scope):` prefix so update-summary.js can still
// classify the bullet as a feature vs a fix.
function bulletFor(hash, subject, body, overrides = OVERRIDES) {
  for (const key of Object.keys(overrides)) {
    if (String(hash).startsWith(key)) return overrides[key];
  }
  const m = String(body || '').match(/^Changelog:\s*(.+)$/im);
  if (m) {
    const text = m[1].trim();
    if (/^(none|skip)$/i.test(text)) return null;
    const prefix = String(subject).match(/^(\w+(?:\([^)]*\))?):/);
    return prefix ? `${prefix[1]}: ${text}` : text;
  }
  return subject;
}

// Version-bump and chore commits never reach the changelog.
function isHousekeeping(subject) {
  return /^\d+\.\d+\.\d+$/.test(subject)
    || subject.startsWith('chore:') || subject.startsWith('chore(');
}

function main() {
  // All version tags sorted descending
  const tags = run('git tag --sort=-v:refname')
    .split('\n')
    .filter(t => /^v\d+\.\d+\.\d+$/.test(t));

  if (tags.length < 2) {
    console.log('Not enough tags to generate changelog');
    return;
  }

  const lines = ['# Changelog\n'];

  for (let i = 0; i < tags.length - 1 && i < 50; i++) {
    const newer = tags[i];
    const older = tags[i + 1];
    // %x1f (unit sep) between fields, %x1e (record sep) between commits — subjects and
    // bodies are free text, so newline-splitting would tear multi-line bodies apart.
    const raw = run(`git log --format="%H%x1f%s%x1f%b%x1e" ${older}..${newer}`);
    const bullets = raw
      .split('\x1e')
      .map(r => r.trim())
      .filter(Boolean)
      .map(r => {
        const [hash, subject, body] = r.split('\x1f');
        if (!subject || isHousekeeping(subject)) return null;
        return bulletFor(hash, subject, body);
      })
      .filter(Boolean);

    if (bullets.length === 0) continue;

    lines.push(`## ${newer}`);
    for (const b of bullets) lines.push(`- ${b}`);
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
}

if (require.main === module) main();
module.exports = { bulletFor, isHousekeeping };
