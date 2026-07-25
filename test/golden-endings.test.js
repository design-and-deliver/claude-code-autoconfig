#!/usr/bin/env node

/**
 * Golden-endings corpus test — the spec ratchet for the awaiting-◐ classification.
 *
 * Runs every corpus entry (test/golden-endings.json) through the FULL text-layer
 * classification stack — endsOnQuestion (qtail + signoff rescue) OR solicitsReply
 * (the '?'-less lexical rescue) — and asserts the expected tab state.
 *
 * Why this exists (2026-07-08): the suite used to pin the directive's PHRASING, so a
 * directive rewrite that weakened classification ("optional offers → declarative")
 * passed every test while shipping a wrong spec. This corpus pins OUTCOMES on real
 * endings instead — implementation-independent AND directive-independent.
 *
 * The corpus is APPEND-ONLY: relabeling or deleting an entry requires Andrew's
 * explicit sign-off (see _readme in the JSON).
 *
 * If the live user-level hook exists on this machine (~/.claude/hooks/terminal-title.js),
 * the same corpus runs against it too — behavioral parity comes free.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CORPUS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'golden-endings.json'), 'utf8')
).entries;

const TWIN = path.join(__dirname, '..', '.claude', 'hooks', 'terminal-title.js');
const LIVE = path.join(os.homedir(), '.claude', 'hooks', 'terminal-title.js');

const { test, summary } = require('./_harness');

function classify(hook, text) {
  const q = hook.endsOnQuestion(text);
  return (q.ends || hook.solicitsReply(text)) ? 'awaiting' : 'idle';
}

function runCorpus(label, hookPath) {
  const hook = require(hookPath);
  console.log(`${label} (${CORPUS.length} endings):`);
  for (const e of CORPUS) {
    const short = e.text.replace(/\s+/g, ' ').slice(0, 58);
    test(`[${e.expect}] "${short}"`, () => {
      const got = classify(hook, e.text);
      if (got !== e.expect) {
        throw new Error(`expected ${e.expect}, got ${got}${e.note ? ` (${e.note})` : ''}`);
      }
    });
  }
  console.log();
}

console.log('============================================================');
console.log('GOLDEN-ENDINGS CORPUS (append-only spec ratchet)');
console.log('============================================================');
console.log();

runCorpus('Twin (.claude/hooks/terminal-title.js)', TWIN);

if (fs.existsSync(LIVE)) {
  runCorpus('LIVE user-level hook (~/.claude/hooks)', LIVE);
} else {
  console.log('LIVE hook not present on this machine — SKIPPED (no live hook) — parity NOT verified (twin-only run, expected off the dev box).');
  console.log();
}

summary();
