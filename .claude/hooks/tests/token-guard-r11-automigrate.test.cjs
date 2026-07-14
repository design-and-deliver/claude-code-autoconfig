// R11 auto-migrate: consent marker + tail recovery + arm-offer copy.
// Run: node --test token-guard-r11-automigrate.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');
const { driftNote, recoverTail, resolveMarker, writeMigrateCandidate, clearMarker,
  migrateReceipt } = require(HOOK);

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-r11-'));
  fs.mkdirSync(path.join(dir, '.claude', 'hooks', '.token-guard'), { recursive: true });
  return dir;
}
function markerDir(proj) { return path.join(proj, '.claude', 'hooks', '.token-guard'); }
const CFG = { driftMigrateMarkerTTLmin: 120, driftMigrateMaxInjectTokens: 40000 };

// ---------- driftNote(): the arm-offer branch, and the false-branch unchanged ----------

test('driftNote autoMigrate=true renders the locked self-contained Token-bloat card', () => {
  const note = driftNote('title hooks', 'CCA distribution', 90, true, 117000);
  assert.match(note, /AskUserQuestion/);                 // clickable buttons instead of "type arm it"
  assert.match(note, /pending-migrate\.armed/);          // the consent flag the primary pick writes
  assert.match(note, /~117k of context/);                // total live context, verbatim copy
  assert.match(note, /only needs ~12k/);                 // keep = 117k - round(117k*0.90) = 12k
  assert.match(note, /reduce token cost/);               // "reduce", not "eliminate"
  assert.match(note, /truncating the old ~105k/);        // truncate = round(117k*0.90) = 105k
  assert.match(note, /Continue\?/);                      // the copy's closing question
  assert.match(note, /Token bloat/);                     // header chip (was "Migrate?")
  assert.match(note, /self-contained/);                  // warning lives IN the card, not as prose above
  assert.match(note, /Yes — Please clean it up/);        // primary button label (verbatim)
  assert.match(note, /"Cancel"/);                        // second button
  assert.match(note, /TWO options/);                     // exactly two, not three
  assert.match(note, /descriptions short and user-facing/); // options carry plain outcome copy, not narration
  assert.match(note, /noise to the user/);               // and the mechanism jargon is explicitly banned
  assert.match(note, /Now \/clear your session — your "CCA distribution" context will be restored/); // post-click line names the pinned scope
  assert.doesNotMatch(note, /most recent context/i);     // the vague phrase (read as the whole session) is gone
  assert.match(note, /NEVER run/);                       // never-run guard preserved
  assert.doesNotMatch(note, /heads up/i);                // dropped — read as redundant
  assert.doesNotMatch(note, /migrate-new-session/);      // manual-paste path dropped from the auto nudge
  assert.doesNotMatch(note, /three options/i);           // no longer three
  assert.doesNotMatch(note, /arm it/i);                  // the odd magic word is gone
});

test('driftNote autoMigrate=false is exactly the R6 paste-command copy (no drift)', () => {
  const note = driftNote('title hooks', 'CCA distribution', 90, false);
  assert.match(note, /paste-ready command/);
  assert.match(note, /\/migrate-new-session cca-distribution\b/);
  assert.match(note, /NEVER run either command yourself/);
  assert.doesNotMatch(note, /arm it/i);
  assert.doesNotMatch(note, /pending-migrate\.armed/);
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

// ---------- resolveMarker(): consent + fresh-source + TTL gating ----------

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

// ---------- writeMigrateCandidate() + clearMarker(): staging, invalidation, one-shot ----------

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

// ---------- migrateReceipt(): the deterministic visible (systemMessage) line ----------

test('migrateReceipt names the pinned scope, no numbers', () => {
  const r = migrateReceipt('migrate UX polish');
  assert.equal(r, 'Your "migrate UX polish" context from last session has been preserved.');
  assert.doesNotMatch(r, /\d/);                 // no token numbers — measured before→after was dropped
  assert.doesNotMatch(r, /migrated|cleared/i);  // the before→after verbs are gone too
  assert.doesNotMatch(r, /most recent context/i); // the vague phrase that read as the whole session is gone
});
