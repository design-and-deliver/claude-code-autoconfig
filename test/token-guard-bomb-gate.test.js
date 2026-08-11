/**
 * The Bash bomb rows and the output-bound escape hatch (2026-08-10).
 *
 * Every row's deny sentence is a claim about output that STAYS resident — "re-read on every
 * remaining trip", "lands in context and stays there". A real pipe into head/tail/wc discards
 * the rest before it ever reaches the tool result, so on those commands the sentence is false.
 * It fired that way for real: `cd api && npx jest 2>&1 | tail -35` drew the full-suite deny
 * (session 12cbde51), because isFullSuite strips pipes on purpose — that stripping scopes the
 * RUN, and was being read as if it scoped the OUTPUT.
 *
 * The four "bounded" cases below all return a deny on the pre-fix code; row (b) is the one
 * that already honored the bound (it carried its own copy of the test since R16), which is
 * exactly how the asymmetry survived unnoticed.
 */
const { test, assert, summary } = require('./_harness');
const { bashVerdict } = require('../.claude/hooks/token-guard');

const kind = (cmd) => (bashVerdict(cmd) || {}).kind || 'null';
const why = (cmd) => (bashVerdict(cmd) || {}).why || '';

// --- a real pipe into head/tail/wc clears every row -------------------------------------------

test('a full suite piped into tail is not a bomb', () => {
  // The observed false positive, verbatim.
  assert(kind('cd api && npx jest 2>&1 | tail -35') === 'null',
    `~35 lines land, so no row's sentence is true: ${why('cd api && npx jest 2>&1 | tail -35')}`);
});

test('a full suite piped into head is not a bomb', () => {
  assert(kind('pnpm test --run | head -20') === 'null',
    'head bounds the output the same way tail does');
});

test('a full patch piped into head is not a bomb', () => {
  assert(kind('git diff | head -40') === 'null',
    `the whole diff never lands, so it cannot be re-read: ${why('git diff | head -40')}`);
});

test('a full patch piped into wc is not a bomb', () => {
  assert(kind('git show HEAD | wc -l') === 'null', 'wc emits one line regardless of input size');
});

test('an unbounded search piped into head stays clear', () => {
  // Row (b) already honored this before the shared check; pin it so the shared one cannot
  // regress what the per-row copy was doing.
  assert(kind('rg TODO src/ | head -20') === 'null', 'row (b) must keep its downstream bound');
});

// --- the denies the rows exist for are all still live -----------------------------------------

test('an unpiped full suite still denies', () => {
  assert(kind('npx jest') === 'deny', 'the plain full suite is the row that started all this');
  assert(kind('cd api && pnpm test --run') === 'deny', 'a cd prefix does not scope the suite');
});

test('an unpiped full patch still denies', () => {
  assert(kind('git diff') === 'deny', 'a working diff with no --stat is a bomb');
});

test('an unbounded bash search still denies', () => {
  assert(kind('rg TODO src/') === 'deny', 'no cap, no downstream bound');
});

test('&& is not an output bound', () => {
  // `npx jest && tail -5 log` runs the suite to completion FIRST — its output has already
  // landed in full. Only a real pipe discards anything.
  assert(kind('npx jest && tail -5 log') === 'deny',
    'a sequenced tail bounds nothing — the suite output already landed');
});

test('|| is not read as a pipe', () => {
  // The single-pipe split must not tear `||` in half and see a bounded right-hand side.
  assert(kind('npx jest || tail -5 log') === 'deny', '`||` is a control operator, not a pipe');
});

// --- precedence: a turn-ender still outranks every row ----------------------------------------

test('turn-enders still skip the gate entirely', () => {
  assert(kind('git status') === 'skip', 'the turn-ender check must stay ahead of the bombs');
  assert(kind('git add -A && git commit -m "wip"') === 'skip',
    'a commit is the move the gate wants, never a deny');
});

summary();
