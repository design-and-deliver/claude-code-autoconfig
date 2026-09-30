// Watchdog console binding (BH-16): the painter's --find scan returns EVERY console whose title
// contains the needle. A newborn tab's needle is the bare folder placeholder, which sibling tabs
// on the same repo can also contain — so binding must happen only on a unique match.
// Run: node --test terminal-title-bind.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { pickConsole } = require(path.resolve(__dirname, '..', 'terminal-title.js'));

test('a unique console match binds to that pid', () => {
  const d = { matched: [4242] };
  assert.equal(pickConsole(d), 4242);
  assert.equal(d.why, undefined);
});

test('an ambiguous match (placeholder needle hits a sibling tab) binds nothing (BH-16)', () => {
  // The shape recorded in _alarms.log 2026-08-15: placeholder=1 matched=[29728 23964].
  const d = { matched: [29728, 23964], placeholder: true };
  assert.equal(pickConsole(d), 0, 'first-hit-wins would latch the sibling console');
  assert.equal(d.why, 'ambiguous-match');
});

test('no match binds nothing and says why', () => {
  const d = { matched: [] };
  assert.equal(pickConsole(d), 0);
  assert.equal(d.why, 'no-console-match');
});
