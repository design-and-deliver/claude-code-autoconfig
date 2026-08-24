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

  // ---- v1.0.219 → next-release remediation (already-pushed batch, audited 2026-08-14).
  // Everything nulled below describes dev-gated tooling (DEV_ONLY_FILES in bin/cli.js) or
  // maintainer-only workflow — users never receive those files, so the bullets must not
  // surface. Trailers on pushed commits can't be reworded; OVERRIDES is the sanctioned fix.
  // token-guard (dev-gated):
  '7563802': null, '37b1abc': null, '28632d9': null, '8a59c51': null, '7ba2813': null,
  'a237056': null, '39f4fae': null, 'cf1a9b2': null, '26f4efa': null, '0024049': null,
  'a50b945': null, 'a51194b': null, '6319304': null, 'b8be1ab': null,
  // statusline / cost-compare (dev-gated):
  '3d01c5d': null, '3f8d0e9': null, 'e1c4236': null, '6b8a5c9': null, '412c0f5': null,
  '820d285': null, '8b19379': null, '6c932b2': null, '9f61e99': null, '65bc86c': null,
  // fleet / claim-registry / worktree tooling (dev-gated):
  '3b0bdd0': null, 'b7f046c': null, '727c25a': null, '6d0c739': null, '0c7a467': null,
  '8dcb360': null, '42aa8cd': null, '109b768': null,
  // run-plan + hook-sync + rules bullets (scripts/ never ships; the "kept in sync" story
  // is the dev-box fleet actuator, not anything a user install does):
  'b76f611': null, '763feaa': null, '7085d1c': null, '5d7621d': null, 'ef5824e': null,
  // maintainer-facing docs/test/diagnostics bullets:
  '4d73c4d': null, '757a303': null, '38f62c5': null, 'da683dc': null, 'f423dae': null,
  // Multi-line trailers truncate at line one (bulletFor's regex keeps only the first
  // line), so these pushed commits would ship mid-sentence fragments — reworded whole:
  '9486fae': 'feat(recovery): /continue and /recover-context are much faster and cheaper — they gather everything in a single step instead of a dozen, work correctly in git worktrees, and no longer mistake an unrelated session for a plan you were executing',
  // /clear advisor — reserved for the paid cost-control tier (decision 2026-08-14): the
  // advisory is gated on the project-tier token-guard.js, so user installs never see it.
  // Nulled rather than reworded — advertising it would announce a feature users can't get.
  '016a2e9': null, 'bbf754f': null,
  // …and the v1.0.214 bullets that advertised it (120d3c7) or other token-guard features
  // (ccr's guard flow, drift card, warn ladder, 80% heads-up) — CHANGELOG regenerates from
  // all tags on every release, so these nulls scrub the historical sections too:
  '120d3c7': null, '52bcf21': null, 'c15ab1c': null, '4f0abf1': null, 'eea8c2e': null,
  // …and the v1.0.215/217 token-guard bullets missed in that pass (spike/spend-gate cards,
  // window rungs, idle-return + stale-session recovery cards) — same dev-gated family:
  'a5043d9': null, 'cfe199d': null, 'adc2ce0': null, 'e5ebf85': null, 'b5715ae': null,
  '26c1deb': null, '1d15e99': null,
  'c5e9125': 'feat(continue): /continue now stops instead of racing when another session is already working the same plan doc',
  '21fc336': "fix(terminal-title): The 'awaiting your reply' tab signal now also catches statement-shaped closers on yes/no questions",
  // Subject names the review process, not the fix — reword to the visible outcome:
  '5e7cd63': 'fix(continue): /continue and /recover-context no longer mistake a leftover file from an earlier recovery for this session\'s context',
  // The one row here for an UNPUSHED commit (2026-08-19), against the "author the trailer"
  // rule above. b514201 carries a fully user-facing trailer for the daily recovery-cost
  // note — but that note is token-guard, dev-gated, so users never receive it. Rewording
  // the commit was the by-the-book fix and would have rebased eight hashes on a shared
  // main for one line of wording; the null lands the same bullet-level outcome for free.
  'b514201': null, // token-guard recovery-cost note — dev-gated
  // Pushed subject names the internal directory it sweeps and carries no type prefix, so it
  // would ship as-is under "Fixes & improvements". Reworded to the outcome a user sees —
  // stray files no longer accumulating in their project — and typed as the feature it is.
  'eb021c3': 'feat(terminal-title): Stray per-session files no longer pile up in your project — old ones are now cleaned out automatically',
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

// Version-bump, chore, revert, plan, and merge commits never reach the changelog (BH-9).
// `revert`/`chore`/`plan` are matched as conventional-commit types (`type:` or
// `type(scope):`) — `plan:` subjects are plan-doc tick/ledger bookkeeping and are always
// maintainer-facing. `Merge …`/`Revert …` catch git's own default subjects for
// merge/revert commits (a belt over the `--no-merges` log filter, and it makes reverts
// drop even when authored as a conventional `revert:` bullet). A feature that merely
// mentions the word — e.g. `feat(cli): add a revert command`, `feat(run-plan): …` — is
// NOT housekeeping and must survive.
function isHousekeeping(subject) {
  return /^\d+\.\d+\.\d+$/.test(subject)
    || /^(chore|revert|plan)(:|\()/.test(subject)
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
