/**
 * Characterization suite for .claude/scripts/plan-progress.js — clean-code plan substep 2.5.
 *
 * plan-progress.js exports nothing (it discovers/parses/renders at require time), so this
 * suite drives the real script as a child process against fixture plan docs in temp dirs —
 * the same behavioral pattern as cli-behavior.test.js. It is the ONLY safety net substep
 * 3.10 (decompose render, CC 32) gets: the "full render, byte-exact" test below is the
 * refactor guard — if 3.10 changes that block, the refactor changed behavior.
 *
 * Contracts pinned here (from .claude/rules/plan-authoring.md):
 *   - a doc is an executable plan ONLY with a `## Ledger` section AND >=1 parseable substep;
 *   - the substep grammar is `### ☑|☐ N.k · S|M|L · ~<N>m|~<N>h — title` — `~45 min` style
 *     tags make the whole doc INVISIBLE (the 2026-07-24 discovery that nearly orphaned the
 *     clean-code plan);
 *   - only `- [ ]`/`- [x]` bullets are microsteps; prose bullets and **Verify:** lines are not;
 *   - discovery scans docs/, .claude/plans/, and the repo root.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, assert, summary } = require('./_harness');

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'plan-progress.js');

const fixtures = [];
function makeFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-planprog-'));
  fixtures.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

function runIn(dir) {
  try {
    const out = execFileSync('node', [SCRIPT], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

// ---- fixture plan docs -----------------------------------------------------

// Full-featured: goal, two phases (one complete), effort tags, >2 done in the current
// phase (elision), microsteps mixed with prose bullets and a Verify line.
const PLAN_A = [
  '# Alpha Plan',
  '',
  '**Goal:** Ship the alpha thing without breaking users.',
  '',
  '## Phase 1 — Groundwork',
  '',
  '### ☑ 1.1 · S · ~30m — First thing',
  '',
  '### ☑ 1.2 · M · ~1h — Second thing',
  '',
  '## Phase 2 — Build',
  '',
  '### ☑ 2.1 · S · ~30m — Third thing',
  '',
  '### ☑ 2.2 · S · ~30m — Fourth thing',
  '',
  '### ☑ 2.3 · S · ~30m — Fifth thing',
  '',
  '### ☐ 2.4 · L · ~1.5h — Current thing',
  '',
  '- [x] first microstep done',
  '- [ ] second microstep pending',
  '- [ ] third microstep pending',
  '- prose note, not a microstep',
  '',
  '**Verify:** not a microstep either.',
  '',
  '### ☐ 2.5 · M · ~45m — Next thing',
  '',
  '## Ledger',
  '',
  '- 2026-01-01 — 1.1 — done.',
  '',
].join('\n');

// The byte-exact render of PLAN_A. 57% = 180 done min / 315 total; ~2h15m left = 90+45;
// phase 1 collapses (all done); of phase 2's three done substeps only the last two show,
// with an elision line; the current substep expands its 1/3 microstep widget.
const EXPECTED_A = [
  '### 📋 Alpha Plan',
  '*Ship the alpha thing without breaking users.*',
  '',
  '**57%** ▓▓▓▓▓▓░░░░  ·  5/7 substeps  ·  ~2h15m left  ·  next → **2.4**',
  '',
  '**Phase 1 — Groundwork** — ✓ 2/2',
  '',
  '**Phase 2 — Build** — 3/5',
  '- _… 1 earlier done_',
  '- ~~2.2 · S · ~30m — Fourth thing~~',
  '- ~~2.3 · S · ~30m — Fifth thing~~',
  '- ▶ **2.4 · L · ~1h30m — Current thing**  ← you are here',
  '      ▓▓▓░░░░░░░  **33%**  ·  1/3 microsteps',
  '      ☑ ~~first microstep done~~',
  '      ☐ second microstep pending',
  '      ☐ third microstep pending',
  '- 2.5 · M · ~45m — Next thing',
].join('\n');

// Untagged substeps, nothing done — CRLF on purpose (parse must split \r\n).
const PLAN_B = [
  '# Beta Plan',
  '',
  '## Phase 1 — Only phase',
  '',
  '### ☐ 1.1 — Do a thing',
  '',
  '### ☐ 1.2 — Do another',
  '',
  '## Ledger',
  '',
].join('\r\n');

const PLAN_C = [
  '# Done Plan',
  '',
  '## Phase 1 — Everything',
  '',
  '### ☑ 1.1 · S · ~20m — Was done',
  '',
  '### ☑ 1.2 · S · ~20m — Also done',
  '',
  '## Ledger',
  '',
].join('\n');

// One of three substeps untagged — percent is effort-weighted over the other two.
const PLAN_E = [
  '# Mixed Plan',
  '',
  '## Phase 1 — P',
  '',
  '### ☑ 1.1 · S · ~30m — Done thing',
  '',
  '### ☐ 1.2 — Untagged thing',
  '',
  '### ☐ 1.3 · M · ~30m — Tagged thing',
  '',
  '## Ledger',
  '',
].join('\n');

// No h1 (title falls back to the filename), no phase heading, one over-long title.
const LONG_TITLE =
  'A very long substep title that keeps going well past the sixty character truncation threshold';
const PLAN_G = [
  '### ☐ 1.1 — Short one',
  '',
  `### ☐ 1.2 — ${LONG_TITLE}`,
  '',
  '## Ledger',
  '',
].join('\n');

// Has a Ledger, but the effort tag uses the WRONG grammar (`~45 min`, not `~45m`) — the
// substep regex rejects it, so the doc must be invisible (zero parseable substeps).
const PLAN_BAD_GRAMMAR = [
  '# Delta Plan',
  '',
  '## Phase 1 — P',
  '',
  '### ☐ 1.1 · M · ~45 min — Thing',
  '',
  '## Ledger',
  '',
].join('\n');

const DOC_NO_LEDGER = [
  '# Not a plan',
  '',
  '### ☐ 1.1 · S · ~10m — Whatever',
  '',
].join('\n');

// ---- full-featured plan: parse + render, byte-exact ------------------------

const dirA = makeFixture({ 'docs/alpha.md': PLAN_A });
const resA = runIn(dirA);

test('plan-progress exits 0 on a parseable plan', () => {
  assert(resA.code === 0, `expected exit 0, got ${resA.code}: ${resA.out}`);
});

test('header: effort-weighted percent, bar, counts, time left, next pointer', () => {
  const want = '**57%** ▓▓▓▓▓▓░░░░  ·  5/7 substeps  ·  ~2h15m left  ·  next → **2.4**';
  assert(resA.out.includes(want), `missing header line "${want}" in:\n${resA.out}`);
});

test('title and goal render; fully-tagged plan shows no weighting caveat', () => {
  assert(resA.out.includes('### 📋 Alpha Plan'), 'missing title line');
  assert(resA.out.includes('*Ship the alpha thing without breaking users.*'), 'missing goal line');
  assert(!resA.out.includes('effort tag'), 'no-tag caveat must not appear for a fully tagged plan');
});

test('a fully-done phase collapses to its heading with a check', () => {
  assert(resA.out.includes('**Phase 1 — Groundwork** — ✓ 2/2'), 'missing collapsed phase heading');
  assert(!resA.out.includes('1.1 · S'), 'collapsed phase must not list its substeps');
});

test('current phase elides all but the last two done substeps', () => {
  assert(resA.out.includes('- _… 1 earlier done_'), 'missing elision line');
  assert(!resA.out.includes('2.1 · S'), 'elided done substep must not render');
  assert(resA.out.includes('- ~~2.2 · S · ~30m — Fourth thing~~'), 'last-two done substeps render struck');
  assert(resA.out.includes('- ~~2.3 · S · ~30m — Fifth thing~~'), 'last-two done substeps render struck');
});

test('current substep gets the ▶ marker and the ~1.5h tag renders as 1h30m', () => {
  assert(
    resA.out.includes('- ▶ **2.4 · L · ~1h30m — Current thing**  ← you are here'),
    'missing current-substep marker line'
  );
});

test('microstep widget: bar + 1/3 count; checkbox bullets only', () => {
  assert(resA.out.includes('      ▓▓▓░░░░░░░  **33%**  ·  1/3 microsteps'), 'missing microstep bar');
  assert(resA.out.includes('      ☑ ~~first microstep done~~'), 'done microstep renders struck');
  assert(resA.out.includes('      ☐ second microstep pending'), 'pending microstep renders plain');
  assert(!resA.out.includes('prose note'), 'prose bullets must not count as microsteps');
  assert(!resA.out.includes('not a microstep either'), 'Verify lines must not count as microsteps');
});

test('full render is byte-exact (the 3.10 refactor guard)', () => {
  const got = resA.out;
  const want = EXPECTED_A + '\n';
  if (got !== want) {
    const g = got.split('\n'), w = want.split('\n');
    let i = 0;
    while (i < Math.max(g.length, w.length) && g[i] === w[i]) i++;
    throw new Error(`render diverged at line ${i + 1}:\n  want: ${JSON.stringify(w[i])}\n  got:  ${JSON.stringify(g[i])}`);
  }
  assert(true, 'unreachable');
});

// ---- count-based / not-started / CRLF ---------------------------------------

const dirB = makeFixture({ 'docs/beta.md': PLAN_B });
const resB = runIn(dirB);

test('CRLF plan parses; zero-done plan is marked not started', () => {
  assert(resB.code === 0, `expected exit 0, got ${resB.code}`);
  assert(resB.out.includes('### 📋 Beta Plan · _not started_'), 'missing not-started status');
});

test('untagged plan falls back to count-based percent with the caveat line', () => {
  assert(resB.out.includes('**0%** ░░░░░░░░░░  ·  0/2 substeps  ·  next → **1.1**'), 'missing count-based header');
  assert(resB.out.includes('_count-based — no effort tags found_'), 'missing count-based caveat');
});

// ---- complete plan -----------------------------------------------------------

const dirC = makeFixture({ 'docs/done.md': PLAN_C });
const resC = runIn(dirC);

test('fully-done plan is marked complete, no next pointer', () => {
  assert(resC.out.includes('### 📋 Done Plan · ✓ _complete_'), 'missing complete status');
  assert(resC.out.includes('**100%** ▓▓▓▓▓▓▓▓▓▓  ·  2/2 substeps'), 'missing 100% header');
  assert(!resC.out.includes('next →'), 'complete plan must not show a next pointer');
  assert(resC.out.includes('**Phase 1 — Everything** — ✓ 2/2'), 'phase must collapse when done');
});

// ---- mixed effort tags -------------------------------------------------------

const dirE = makeFixture({ 'docs/mixed.md': PLAN_E });
const resE = runIn(dirE);

test('partially-tagged plan is effort-weighted over the tagged subset, with caveat', () => {
  assert(resE.out.includes('**50%** ▓▓▓▓▓░░░░░  ·  1/3 substeps  ·  ~30m left  ·  next → **1.2**'), 'missing mixed header');
  assert(
    resE.out.includes('_1/3 substeps carry no effort tag; % is effort-weighted over the rest_'),
    'missing partial-tag caveat'
  );
});

// ---- unphased / no h1 / truncation -------------------------------------------

const dirG = makeFixture({ 'docs/gamma.md': PLAN_G });
const resG = runIn(dirG);

test('no h1 → title falls back to the filename; substeps before any phase are (unphased)', () => {
  assert(resG.out.includes('### 📋 gamma.md'), 'missing filename-fallback title');
  assert(resG.out.includes('**Phase – — (unphased)** — 0/2'), 'missing unphased phase heading');
});

test('over-long substep titles truncate with an ellipsis', () => {
  assert(resG.out.includes('…'), 'missing truncation ellipsis');
  assert(!resG.out.includes(LONG_TITLE), 'full over-long title must not render');
});

// ---- discovery + ordering across the three scan locations --------------------

const dirM = makeFixture({
  'docs/alpha.md': PLAN_A,
  'beta.md': PLAN_B,
  '.claude/plans/done.md': PLAN_C,
});
const resM = runIn(dirM);

test('plans are discovered in docs/, repo root, and .claude/plans/', () => {
  for (const t of ['### 📋 Alpha Plan', '### 📋 Beta Plan', '### 📋 Done Plan']) {
    assert(resM.out.includes(t), `missing ${t} — location not scanned`);
  }
});

test('ordering: in-progress first, then most-complete', () => {
  const a = resM.out.indexOf('### 📋 Alpha Plan');
  const c = resM.out.indexOf('### 📋 Done Plan');
  const b = resM.out.indexOf('### 📋 Beta Plan');
  assert(a < c && c < b, `expected Alpha < Done < Beta, got indexes ${a}, ${c}, ${b}`);
});

// ---- invisibility rules -------------------------------------------------------

const dirEmpty = makeFixture({});
const resEmpty = runIn(dirEmpty);

test('no plans → friendly notice naming the scanned locations, exit 0', () => {
  assert(resEmpty.code === 0, `expected exit 0, got ${resEmpty.code}`);
  assert(resEmpty.out.includes('No plan docs found here.'), 'missing no-plans notice');
  assert(resEmpty.out.includes('docs/, .claude/plans/, repo root'), 'notice must name the scan locations');
});

test('a doc without ## Ledger is not a plan', () => {
  const res = runIn(makeFixture({ 'docs/notaplan.md': DOC_NO_LEDGER }));
  assert(res.out.includes('No plan docs found here.'), 'Ledger-less doc must be invisible');
});

test('wrong time-tag grammar (~45 min) makes the doc invisible — the parser-grammar contract', () => {
  const res = runIn(makeFixture({ 'docs/delta.md': PLAN_BAD_GRAMMAR }));
  assert(res.out.includes('No plan docs found here.'), 'unparseable substeps must make the doc invisible');
});

// ---- the natural fixture: this repo's own clean-code plan ---------------------

test('the real clean-code plan doc parses and renders (loose — doc keeps evolving)', () => {
  const real = fs.readFileSync(path.join(__dirname, '..', 'docs', 'clean-code-remediation-plan.md'), 'utf8');
  const res = runIn(makeFixture({ 'docs/clean-code-remediation-plan.md': real }));
  assert(res.code === 0, `expected exit 0, got ${res.code}`);
  assert(res.out.includes('### 📋 Clean-code remediation plan'), 'real plan title must render');
  assert(/\*\*\d+%\*\*/.test(res.out), 'real plan must show a percent');
  assert(res.out.includes('substeps'), 'real plan must show a substep count');
});

// ---- cleanup ------------------------------------------------------------------

for (const d of fixtures) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* temp dir — best effort */ }
}

summary();
