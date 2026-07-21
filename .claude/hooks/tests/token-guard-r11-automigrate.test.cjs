// R11 drift migration: the /clear + /continue nudge + recover-pointer staging, plus the
// MOTHBALLED SessionStart-injection units (retired 2026-07-21 — kept green for revival;
// see the banner at MIGRATE_CANDIDATE in token-guard.js).
// Run: node --test token-guard-r11-automigrate.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');
const { driftNote, recoverTail, resolveMarker, writeMigrateCandidate, clearMarker,
  migrateReceipt, writeRecoverPointer } = require(HOOK);

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-r11-'));
  fs.mkdirSync(path.join(dir, '.claude', 'hooks', '.token-guard'), { recursive: true });
  return dir;
}
function markerDir(proj) { return path.join(proj, '.claude', 'hooks', '.token-guard'); }
const CFG = { driftMigrateMarkerTTLmin: 120, driftMigrateMaxInjectTokens: 40000 };

// ---------- driftNote(): the /clear + /continue one-liner, and the false-branch unchanged ----------

test('driftNote autoMigrate=true renders the locked one-line nudge (no picker)', () => {
  const note = driftNote('title hooks', 'CCA distribution', 90, true, 117000);
  // The agreed one-liner, verbatim (numbers filled): total live context + keep, then the two-step out.
  assert.match(note, /~117k of context/);                // total live context, verbatim copy
  assert.match(note, /only needs ~12k/);                 // keep = 117k - round(117k*0.90) = 12k
  assert.match(note, /\/clear to drop the unused context, then \/continue to resume the conversation/); // action-first two-step out
  assert.match(note, /VERBATIM/);                        // the copy is locked — relay it as-is
  assert.match(note, /STANDALONE warning block/);        // a plain block, not a card and not woven into the answer
  assert.match(note, /noise to the user/);               // mechanism jargon is explicitly banned
  assert.match(note, /NEVER run/);                       // never-run guard preserved (covers /continue too)
  // Retired 2026-07-21: the Yes/Cancel AskUserQuestion picker collapses to a single locked line.
  assert.doesNotMatch(note, /Yes — Please clean it up/); // primary button label — gone
  assert.doesNotMatch(note, /"Cancel"/);                 // second button — gone
  assert.doesNotMatch(note, /TWO options/);              // no options at all now
  assert.doesNotMatch(note, /BOTH options are bare labels/);
  assert.doesNotMatch(note, /Token bloat/);              // header chip — gone (no card = no chip)
  assert.doesNotMatch(note, /Continue\?/);               // the picker's closing question — gone
  assert.doesNotMatch(note, /Now run \/clear/);          // the post-click line — gone (nothing to click)
  assert.doesNotMatch(note, /105k/);                     // drop is named "the unused context", not a third number
  assert.doesNotMatch(note, /Keeps this topic/);
  assert.doesNotMatch(note, /Leave everything as-is/);
  assert.doesNotMatch(note, /most recent context/i);
  assert.doesNotMatch(note, /heads up/i);
  assert.doesNotMatch(note, /migrate-new-session/);      // manual-paste path stays off the auto nudge
  assert.doesNotMatch(note, /three options/i);
  assert.doesNotMatch(note, /arm it/i);                  // the odd magic word is gone
  // Retired 2026-07-21 with the SessionStart injection: the consent flag and the truncate metaphor.
  assert.doesNotMatch(note, /pending-migrate\.armed/);
  assert.doesNotMatch(note, /truncating/);
  assert.doesNotMatch(note, /will be preserved/);        // the injection-era promise line is gone
});

test('driftNote autoMigrate=false is the R6 prose copy with the same /clear + /continue out', () => {
  const note = driftNote('title hooks', 'CCA distribution', 90, false);
  assert.match(note, /\/clear, then \/continue/);
  assert.match(note, /NEVER run the command/);
  assert.doesNotMatch(note, /arm it/i);
  assert.doesNotMatch(note, /pending-migrate\.armed/);
  assert.doesNotMatch(note, /migrate-new-session/);    // swept 2026-07-21: one metaphor everywhere
  // omitting the 4th arg (legacy call sites) must behave like false
  assert.equal(driftNote('title hooks', 'CCA distribution', 90), note);
});

// ---------- recoverTail(): the JS port of recover-context extraction ----------

function writeTranscript(lines) {
  const fp = path.join(os.tmpdir(), `tg-r11-tail-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(fp, lines.map(o => JSON.stringify(o)).join('\n'));
  return fp;
}

test('recoverTail keeps only user/assistant text at or after the cutoff, in order', () => {
  const fp = writeTranscript([
    { type: 'user', timestamp: '2026-07-13T17:10:00.000Z', message: { content: 'BEFORE cutoff' } },
    { type: 'user', timestamp: '2026-07-13T17:20:00.000Z', message: { content: 'hello AFTER' } },
    { type: 'assistant', timestamp: '2026-07-13T17:21:00.000Z',
      message: { content: [{ type: 'text', text: 'hi BACK' }] } },
    { type: 'user', timestamp: '2026-07-13T17:22:00.000Z',
      message: { content: [{ type: 'tool_result', content: 'echo' }] } }, // skipped
    { type: 'summary', timestamp: '2026-07-13T17:23:00.000Z', message: { content: 'noise' } }, // skipped
  ]);
  const r = recoverTail(fp, '2026-07-13T17:15:00.000Z', 40000);
  assert.equal(r.messages, 2);
  assert.match(r.text, /hello AFTER/);
  assert.match(r.text, /hi BACK/);
  assert.doesNotMatch(r.text, /BEFORE cutoff/);
  assert.doesNotMatch(r.text, /echo/);
  assert.ok(r.text.indexOf('hello AFTER') < r.text.indexOf('hi BACK'), 'oldest first');
  assert.equal(r.truncated, false);
  fs.unlinkSync(fp);
});

test('recoverTail truncates to the most-recent slice when over the token cap', () => {
  const many = [];
  for (let i = 0; i < 20; i++) {
    many.push({ type: 'user', timestamp: `2026-07-13T18:${String(i).padStart(2, '0')}:00.000Z`,
      message: { content: `msg ${i} ` + 'x'.repeat(400) } });
  }
  const fp = writeTranscript(many);
  const r = recoverTail(fp, '2026-07-13T17:00:00.000Z', 200); // tiny cap
  assert.equal(r.truncated, true);
  assert.ok(r.messages >= 1 && r.messages < 20, `kept a slice, got ${r.messages}`);
  assert.match(r.text, /msg 19/, 'keeps the newest message');
  assert.doesNotMatch(r.text, /msg 0\b/, 'drops the oldest');
  fs.unlinkSync(fp);
});

test('recoverTail on a missing transcript degrades to empty, never throws', () => {
  const r = recoverTail(path.join(os.tmpdir(), 'nope-does-not-exist.jsonl'), '2026-01-01T00:00:00Z', 40000);
  assert.deepEqual(r, { messages: 0, tokens: 0, truncated: false, text: '' });
});

// ---------- writeRecoverPointer(): the boundary-pinned pointer the card's Yes relies on ----------

test('writeRecoverPointer pins an explicit boundaryIso as the cutoff (drift staging)', () => {
  const proj = tmpProject();
  const rec = writeRecoverPointer(proj, 'SID-9', 42, '2026-07-21T16:34:46.742Z');
  assert.equal(rec.cutoffIso, '2026-07-21T16:34:46.742Z');
  const onDisk = JSON.parse(fs.readFileSync(path.join(markerDir(proj), 'recover.json'), 'utf8'));
  assert.equal(onDisk.cutoffIso, '2026-07-21T16:34:46.742Z');
  assert.equal(onDisk.sid, 'SID-9');
});

test('writeRecoverPointer without boundaryIso keeps the minutes-derived cutoff (R4 path unchanged)', () => {
  const proj = tmpProject();
  const before = Date.now();
  const rec = writeRecoverPointer(proj, 'SID-9', 15);
  const cut = Date.parse(rec.cutoffIso);
  assert.ok(Math.abs((before - 15 * 60000) - cut) < 5000, 'cutoff ≈ now - 15min');
});

// ---------- resolveMarker(): consent + fresh-source + TTL gating (MOTHBALLED consumer) ----------

function stage(proj, { armed = true, keyword = 'kw', writtenIso } = {}) {
  const dir = markerDir(proj);
  fs.writeFileSync(path.join(dir, 'pending-migrate.json'), JSON.stringify({
    keyword, sid: '89496bec-6fe9-4b3f', boundaryIso: '2026-07-13T17:13:39.743Z',
    scope: 'token guard R11', writtenIso: writtenIso || new Date().toISOString(),
  }));
  if (armed) fs.writeFileSync(path.join(dir, 'pending-migrate.armed'), '1');
}

test('resolveMarker returns the candidate on a fresh clear with consent', () => {
  const proj = tmpProject(); stage(proj);
  const m = resolveMarker(proj, 'clear', CFG);
  assert.ok(m && m.sid && m.boundaryIso, 'candidate returned');
  assert.equal(m.keyword, 'kw');
});

test('resolveMarker honors startup as a fresh context too', () => {
  const proj = tmpProject(); stage(proj);
  assert.ok(resolveMarker(proj, 'startup', CFG));
});

test('resolveMarker rejects resume/compact (context is retained — would double-inject)', () => {
  const proj = tmpProject(); stage(proj);
  assert.equal(resolveMarker(proj, 'resume', CFG), null);
  assert.equal(resolveMarker(proj, 'compact', CFG), null);
});

test('resolveMarker requires the armed flag (candidate alone is inert)', () => {
  const proj = tmpProject(); stage(proj, { armed: false });
  assert.equal(resolveMarker(proj, 'clear', CFG), null);
});

test('resolveMarker rejects a stale arm past the TTL', () => {
  const proj = tmpProject();
  stage(proj, { writtenIso: new Date(Date.now() - 999 * 60000).toISOString() });
  assert.equal(resolveMarker(proj, 'clear', CFG), null);
});

test('resolveMarker returns null when nothing is staged', () => {
  const proj = tmpProject();
  assert.equal(resolveMarker(proj, 'clear', CFG), null);
});

// ---------- writeMigrateCandidate() + clearMarker(): staging, invalidation, one-shot (MOTHBALLED) ----------

test('writeMigrateCandidate stages the pinned pointer with slug(scope) as keyword', () => {
  const proj = tmpProject();
  writeMigrateCandidate(proj, 'SID-123', 'token-guard R11', '2026-07-13T17:13:39.743Z');
  const c = JSON.parse(fs.readFileSync(path.join(markerDir(proj), 'pending-migrate.json'), 'utf8'));
  assert.equal(c.keyword, 'token-guard-r11');
  assert.equal(c.sid, 'SID-123');
  assert.equal(c.boundaryIso, '2026-07-13T17:13:39.743Z');
});

test('a new-scope candidate invalidates prior consent (re-arm must be explicit)', () => {
  const proj = tmpProject();
  stage(proj, { keyword: 'old-scope' });           // armed for old scope
  writeMigrateCandidate(proj, 'SID-123', 'brand new scope', '2026-07-13T18:00:00.000Z');
  assert.ok(!fs.existsSync(path.join(markerDir(proj), 'pending-migrate.armed')), 'armed flag dropped');
  assert.equal(resolveMarker(proj, 'clear', CFG), null, 'no consent until re-armed');
});

test('the same-scope candidate leaves an existing consent intact', () => {
  const proj = tmpProject();
  stage(proj, { keyword: 'token-guard-r11' });
  writeMigrateCandidate(proj, 'SID-123', 'token-guard R11', '2026-07-13T18:00:00.000Z');
  assert.ok(fs.existsSync(path.join(markerDir(proj), 'pending-migrate.armed')), 'consent kept');
});

test('clearMarker removes both files (one-shot consume)', () => {
  const proj = tmpProject(); stage(proj);
  clearMarker(proj);
  assert.ok(!fs.existsSync(path.join(markerDir(proj), 'pending-migrate.json')));
  assert.ok(!fs.existsSync(path.join(markerDir(proj), 'pending-migrate.armed')));
  clearMarker(proj); // idempotent, no throw
});

// ---------- migrateReceipt(): the deterministic visible (systemMessage) line (MOTHBALLED) ----------

test('migrateReceipt names the pinned scope, no numbers', () => {
  const r = migrateReceipt('migrate UX polish');
  assert.equal(r, 'Your "migrate UX polish" context from last session has been preserved.');
  assert.doesNotMatch(r, /\d/);                 // no token numbers — measured before→after was dropped
  assert.doesNotMatch(r, /migrated|cleared/i);  // the before→after verbs are gone too
  assert.doesNotMatch(r, /most recent context/i); // the vague phrase that read as the whole session is gone
});
