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
  // ad2a136's pushed trailer also promised "context/idle warnings no longer over-count
  // screenshots" — but that's token-guard, which is dev-gated (not installed/wired for users).
  // Trailer can't be reworded in the pushed commit, so correct it here to the /gls-only benefit.
  'ad2a136': "feat(gls): /gls screenshots now use up to ~60% fewer tokens — large captures are auto-downscaled before display",
  // token-guard and /analyze-session are dev-gated (DEV_ONLY_FILES in bin/cli.js) — users
  // never receive them, so their features must not be announced on the upgrade screen.
  // These pushed commits predate that rule or lack a "Changelog: none" trailer:
  'a17f267': null, // token-guard Cost Control modes — dev-gated
  'a3927a9': null, // token-guard R11 auto-migrate — dev-gated
  '43dd441': null, // token-guard R6 drift nudge — dev-gated
  '629c11c': null, // token-guard dev-only staging — dev-gated
  '0bf89e3': null, // token-guard R12a confirm card — trailer reads user-facing but the feature is dev-gated
  '9f57ce4': null, // /analyze-session zero-token tip — the command is dev-only
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

// Version-bump, chore, revert, and merge commits never reach the changelog (BH-9).
// `revert`/`chore` are matched as conventional-commit types (`type:` or `type(scope):`);
// `Merge …`/`Revert …` catch git's own default subjects for merge/revert commits (a
// belt over the `--no-merges` log filter, and it makes reverts drop even when authored
// as a conventional `revert:` bullet). A feature that merely mentions the word — e.g.
// `feat(cli): add a revert command` — is NOT housekeeping and must survive.
function isHousekeeping(subject) {
  return /^\d+\.\d+\.\d+$/.test(subject)
    || /^(chore|revert)(:|\()/.test(subject)
    || /^(Merge |Revert )/.test(subject);
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

  const lines = [
    '# Changelog',
    '',
    '<!-- GENERATED FILE — do not edit by hand. scripts/generate-changelog.js rebuilds this',
    '     from git history on every `npm version`. Reword a published bullet via its',
    '     OVERRIDES map; shape future bullets with a `Changelog:` commit-body trailer. -->',
    '',
  ];

  for (let i = 0; i < tags.length - 1 && i < 50; i++) {
    const newer = tags[i];
    const older = tags[i + 1];
    // %x1f (unit sep) between fields, %x1e (record sep) between commits — subjects and
    // bodies are free text, so newline-splitting would tear multi-line bodies apart.
    const raw = run(`git log --no-merges --format="%H%x1f%s%x1f%b%x1e" ${older}..${newer}`);
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
    // A regenerated changelog can be byte-identical (every commit since the last tag hidden
    // by trailers/OVERRIDES). `git commit` would then exit non-zero and abort `npm version`
    // AFTER the bump commit+tag exist — half-versioned repo. Nothing staged → the tag npm
    // just created already points at the right commit; skip the commit and re-tag.
    if (!run('git diff --cached --name-only -- CHANGELOG.md')) {
      console.log('CHANGELOG.md unchanged — skipping changelog commit/re-tag');
      return;
    }
    run('git commit -m "chore: update changelog"');
    run(`git tag -f v${version}`);
    console.log(`Re-tagged v${version} to include changelog`);
  }
}

if (require.main === module) main();
module.exports = { bulletFor, isHousekeeping };
