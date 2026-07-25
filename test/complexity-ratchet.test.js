/**
 * Complexity no-growth ratchet — clean-code plan substep 2.3.
 *
 * THE DECISION (reconciling with the 3-rule lint floor): eslint.config.js stays at its
 * deliberate 3-rule floor (weak-model-maintainability-plan substep 2.6) — complexity is NOT
 * a fourth lint rule. Instead this suite runs eslint's `complexity` rule programmatically,
 * over the same file scope the lint floor governs, and holds the violation set (functions
 * at CC >= 10) EXACTLY at the checked-in baseline (test/complexity-baseline.json):
 *
 *   - a NEW violation (or a renamed one) fails: refactor to CC <= 9 — the Phase 3
 *     acceptance bar — rather than growing the baseline;
 *   - a CLEARED violation also fails until the baseline shrinks with it: run
 *       node test/complexity-ratchet.test.js --write-baseline
 *     and commit the tightened baseline IN THE SAME COMMIT as the refactor.
 *
 * Identity is file + function label only (no CC value), so an already-listed offender
 * drifting 97 -> 95 does not churn the baseline. The scope (files/ignores/languageOptions)
 * is REUSED from eslint.config.js at runtime — if the lint floor's scope moves, this suite
 * moves with it. Note an eslint major/minor bump can legitimately shift CC math; if the
 * census moves with zero code changes, re-baseline in the upgrade commit and say so there.
 */

const fs = require('fs');
const path = require('path');
const { test, assert, summary } = require('./_harness');
const { ESLint } = require('eslint');

const REPO = path.join(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'complexity-baseline.json');
const MAX_ALLOWED = 9; // the Phase 3 bar: violations are functions at CC >= 10

async function census() {
  const baseConfig = require(path.join(REPO, 'eslint.config.js'));
  const scope = baseConfig.find(c => Array.isArray(c.files));
  const globalIgnores = baseConfig.filter(c => c.ignores && !c.files);
  assert(scope, 'eslint.config.js must have a files-scoped entry to reuse');
  const eslint = new ESLint({
    cwd: REPO,
    overrideConfigFile: true,
    overrideConfig: [
      ...globalIgnores,
      {
        files: scope.files,
        languageOptions: scope.languageOptions,
        rules: { complexity: ['warn', MAX_ALLOWED] },
      },
    ],
  });
  const results = await eslint.lintFiles(['.']);
  const violations = {};
  for (const r of results) {
    const rel = path.relative(REPO, r.filePath).replace(/\\/g, '/');
    for (const m of r.messages) {
      if (m.ruleId !== 'complexity') continue;
      // "Function 'meter' has a complexity of 33. Maximum allowed is 9." -> "Function 'meter'"
      const label = m.message.split(' has a complexity of')[0];
      (violations[rel] = violations[rel] || []).push(label);
    }
  }
  for (const f of Object.keys(violations)) violations[f].sort();
  return { violations, lintedFiles: results.length };
}

// Multiset diff of two sorted label lists: what's in `next` beyond `prev`.
function extras(prev, next) {
  const counts = new Map();
  for (const l of prev) counts.set(l, (counts.get(l) || 0) + 1);
  const out = [];
  for (const l of next) {
    const n = counts.get(l) || 0;
    if (n > 0) counts.set(l, n - 1);
    else out.push(l);
  }
  return out;
}

function flatten(violations) {
  const out = [];
  for (const f of Object.keys(violations).sort()) {
    for (const l of violations[f]) out.push(`${f}: ${l}`);
  }
  return out;
}

(async () => {
  const actual = await census();

  if (process.argv.includes('--write-baseline')) {
    const doc = {
      '//': 'Baseline for the complexity no-growth ratchet (see complexity-ratchet.test.js). ' +
        'Shrink-only: regenerate with --write-baseline in the same commit that clears a violation.',
      maxAllowed: MAX_ALLOWED,
      violations: actual.violations,
    };
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(doc, null, 2) + '\n');
    console.log(`Baseline written: ${flatten(actual.violations).length} violations ` +
      `in ${Object.keys(actual.violations).length} files.`);
    return;
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));

  test('census sanity: the reused lint scope actually enumerates the repo', () => {
    assert(actual.lintedFiles >= 25,
      `only ${actual.lintedFiles} files linted — scope resolution looks broken`);
  });

  test('baseline threshold matches the Phase 3 bar', () => {
    assert(baseline.maxAllowed === MAX_ALLOWED,
      `baseline maxAllowed ${baseline.maxAllowed} != ${MAX_ALLOWED}`);
  });

  test('no new complexity violations (CC >= 10) beyond the baseline', () => {
    const grown = flatten(
      Object.fromEntries(
        Object.keys(actual.violations)
          .map(f => [f, extras(baseline.violations[f] || [], actual.violations[f])])
          .filter(([, list]) => list.length)
      )
    );
    assert(grown.length === 0,
      `new violations — extract helpers to CC <= ${MAX_ALLOWED} (do not grow the baseline):\n` +
      grown.map(g => `    ${g}`).join('\n'));
  });

  test('baseline is tight — every entry still violates (shrink it in the same commit)', () => {
    const stale = flatten(
      Object.fromEntries(
        Object.keys(baseline.violations)
          .map(f => [f, extras(actual.violations[f] || [], baseline.violations[f])])
          .filter(([, list]) => list.length)
      )
    );
    assert(stale.length === 0,
      'stale baseline entries — run `node test/complexity-ratchet.test.js --write-baseline` ' +
      'and commit the tightened baseline with the refactor:\n' +
      stale.map(s => `    ${s}`).join('\n'));
  });

  summary();
})().catch(e => {
  console.error('complexity-ratchet: census failed:', e);
  process.exit(1);
});
