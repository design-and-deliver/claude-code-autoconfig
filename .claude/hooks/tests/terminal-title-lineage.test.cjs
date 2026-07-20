// Terminal lineage registry: SessionStart records "which session ran in THIS terminal
// before me" so bare /recover-context can resolve its predecessor without guessing.
// Run: node --test terminal-title-lineage.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ancestryChain, recordLineage } = require(path.resolve(__dirname, '..', 'terminal-title.js'));

function tmpTitles() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tt-lineage-'));
}

// Seed the anchor cache so mechanics tests skip the ~3s ancestry walk and get a known tid.
function seedAnchor(dir, tid) {
  process.env.CLAUDE_CODE_SSE_PORT = 'test-port-1';
  const tdir = path.join(dir, 'terminals');
  fs.mkdirSync(tdir, { recursive: true });
  fs.writeFileSync(path.join(tdir, '.anchor-cache.json'),
    JSON.stringify({ key: 'test-port-1', tid }));
}

function registrations(dir) {
  return fs.readdirSync(path.join(dir, 'terminals')).filter(f => !f.startsWith('.'));
}

// The suite runs as node ← npm ← shell, so the live chain is a realistic stand-in for
// node(hook) ← claude ← shell: it must contain self plus at least one node-ish ancestor.
test('ancestryChain walks the real process tree from self upward', () => {
  // The walk shells out (PowerShell CIM on Windows, ps on POSIX) under a short spawn
  // timeout. Under full-suite parallel load that first spawn can exceed it and return an
  // empty chain — transient, not a regression (production treats a miss as a fail-safe and
  // falls back). Retry a few times so a load-induced timeout doesn't flake the suite; a
  // genuine break still fails every attempt. Isolation is reliable — see the 12/12 note.
  let chain = [];
  for (let attempt = 0; attempt < 3 && chain.length < 2; attempt++) {
    chain = ancestryChain(process.pid);
  }
  assert.ok(chain.length >= 2, `expected >=2 entries, got ${chain.length}`);
  assert.equal(chain[0].pid, process.pid);
  assert.ok(chain.every(e => e.pid > 0 && e.created !== ''), 'every entry has pid + creation stamp');
  assert.ok(chain.some(e => /^(claude|node)/i.test(e.name)), 'self or an ancestor is claude/node');
});

test('first session in a terminal seeds the registry, writes no lineage', () => {
  const dir = tmpTitles();
  seedAnchor(dir, '111-11111');
  recordLineage(dir, 'sid-first', 'startup');
  assert.deepEqual(registrations(dir), ['111-11111.json']);
  const occ = JSON.parse(fs.readFileSync(path.join(dir, 'terminals', '111-11111.json'), 'utf8'));
  assert.equal(occ.sid, 'sid-first');
  assert.ok(!fs.existsSync(path.join(dir, 'sid-first.lineage.json')), 'no predecessor yet');
});

test('rotation in the same terminal stamps the outgoing sid as the new session\'s previous', () => {
  const dir = tmpTitles();
  seedAnchor(dir, '222-22222');
  recordLineage(dir, 'sid-old', 'startup');
  recordLineage(dir, 'sid-new', 'clear'); // same tid -> rotation observed
  const lin = JSON.parse(fs.readFileSync(path.join(dir, 'sid-new.lineage.json'), 'utf8'));
  assert.equal(lin.prevSid, 'sid-old');
  assert.equal(lin.source, 'clear');
  assert.equal(lin.tid, '222-22222');
  assert.ok(lin.ts);
  assert.deepEqual(registrations(dir), ['222-22222.json'], 'occupant replaced, not duplicated');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'terminals', '222-22222.json'), 'utf8')).sid, 'sid-new');
});

test('same sid re-entering (compact/resume) does not overwrite lineage with itself', () => {
  const dir = tmpTitles();
  seedAnchor(dir, '333-33333');
  recordLineage(dir, 'sid-a', 'startup');
  recordLineage(dir, 'sid-b', 'clear');
  recordLineage(dir, 'sid-b', 'compact'); // no rotation — lineage for sid-b must survive intact
  const lin = JSON.parse(fs.readFileSync(path.join(dir, 'sid-b.lineage.json'), 'utf8'));
  assert.equal(lin.prevSid, 'sid-a');
});

test('recordLineage is fail-safe on an empty sid', () => {
  const dir = tmpTitles();
  recordLineage(dir, '', 'startup'); // must not throw, must not write
  assert.ok(!fs.existsSync(path.join(dir, 'terminals')));
});

test('stale terminal registrations are pruned after 30 days', () => {
  const dir = tmpTitles();
  seedAnchor(dir, '444-44444');
  const stale = path.join(dir, 'terminals', 'dead-terminal.json');
  fs.writeFileSync(stale, JSON.stringify({ tid: 'dead-terminal', sid: 'sid-gone' }));
  const old = (Date.now() - 31 * 86400000) / 1000;
  fs.utimesSync(stale, old, old);
  recordLineage(dir, 'sid-live', 'startup');
  assert.ok(!fs.existsSync(stale), 'stale registration removed');
});
