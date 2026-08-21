/**
 * The Choice bullet's copy contract — BOTH recommendations must carry their evidence.
 *
 * Guards the regression found 2026-07-30. R14's two-bullet cut (2026-07-29) dropped the
 * `• Restart:` bullet — correctly; four bullets buried the ask — but that bullet had been the
 * only place the APPROVE recommendation's numbers appeared, and choiceBullet's approve branch
 * built `rv.why` and threw it away. The card then rendered:
 *
 *     ⚠️ Hey — this turn has made 42 round trips carrying ~141k of context.
 *     • Cost: ~4.4M tokens of re-reads … that is rent, not progress …
 *     • Choice: approve (recommended) — push on; denying lands this turn at a commit point …
 *
 * which at a glance reads "4.4M — keep going (recommended)" (Andrew 2026-07-30). The reader
 * fuses the verdict to the nearest big number; the number it actually turns on — liveContext
 * against the fat line — was nowhere on the card. Approve is the branch that needs its evidence
 * MOST: it is the counterintuitive side of every fire, and the side that looks like the script
 * rubber-stamping a spend it just called rent.
 *
 * These assert the RENDERED strings, not the branch shape. The whole failure was copy that
 * parsed fine and read wrong, so a structural test would have passed straight through it.
 */
const os = require('os');
const path = require('path');
const { test, assert, summary } = require('./_harness');
const {
  restartVerdict, choiceBullet, rentAskCopy, meterCanaryNote,
  coldStartTokens, firstContextOfHead, clearTail, restartBullet, restartPos,
} = require('../.claude/hooks/token-guard');

// R20's slots, verbatim from sessionTotalAsk — the same strings R14 wore when it shipped the
// regression (R14's card renders rentVerdictLines since 2026-08-14; its condensed pins are below).
const R20 = {
  neutral: 'approve to push on — or deny, and Claude should land this turn at a commit '
    + 'point so you can /clear + /continue carrying only the next step.',
  denyTail: 'denying lands this turn at a commit point so you can /clear + /continue '
    + 'carrying only the next step.',
};
const GAP = 1_000_000;   // forward budget to the next check
const FAT = 150_000;     // cfg.contextWarnTokens default
const bullet = live => choiceBullet(null, R20, restartVerdict(live, GAP, FAT));

test('approve carries its why', () => {
  const s = bullet(141_000);   // the 4.4M fire — under the fat line
  assert(/approve \(recommended\)/.test(s), `expected an approve recommendation, got: ${s}`);
  assert(/~141k of context is under the ~150k fat line/.test(s),
    `approve must state the comparison it turns on, got: ${s}`);
  assert(/so clearing sheds little/.test(s),
    `approve must state what follows from that reading, got: ${s}`);
});

test('deny why unchanged', () => {
  const s = bullet(163_000);   // past the fat line
  assert(/deny \(recommended\)/.test(s), `expected a deny recommendation, got: ${s}`);
  assert(/~163k of context is past the ~150k fat line/.test(s), `deny lost its why: ${s}`);
  assert(/Approving continues the current work/.test(s), `deny stopped naming the losing option: ${s}`);
});

test('denyTail sentence-cased on approve', () => {
  // denyTail opens lowercase for its mid-sentence slots; on approve it starts a sentence.
  const s = bullet(141_000);
  assert(/push on\. Denying lands this turn/.test(s), `denyTail not sentence-cased: ${s}`);
});

test('dead meter falls back to neutral copy', () => {
  // Nothing measured -> name no side. A recommendation with no evidence is noise.
  const s = choiceBullet(null, R20, null);
  assert(!/\(recommended\)/.test(s), `a dead meter must not recommend a side: ${s}`);
  assert(s.includes(R20.neutral), `neutral copy dropped: ${s}`);
});

test("no 'undefined' leaks into copy", () => {
  // A why threaded through the wrong branch stringifies into the card rather than throwing.
  for (const live of [141_000, 163_000]) {
    assert(!/undefined/.test(bullet(live)), `undefined leaked at liveContext=${live}`);
  }
  assert(!/undefined/.test(choiceBullet(null, R20, null)), 'undefined leaked in neutral copy');
});

/* ── R14's rendered card: one unit across the whole message ──────────────────────────────────
 * Second half of the 2026-07-30 pass. `rent` meters cache reads RAW; `work` (workOne) already
 * counts them at 0.1x. The Cost line set one against the other — "~4.4M of re-reads against
 * ~161k of actual work" — so the ratio it asserted, 27:1, was a unit artifact of a true 2.7:1.
 * Rent now renders cache-weighted, and the next-check tail converts with it or the card
 * re-mixes units in the same breath. Reproduces the exact fire from the screenshot.           */
const CARD = (rvIn, verdict = null) => rentAskCopy({
  cfg: { contextWarnTokens: 150_000 },
  m: {
    liveContext: 141_000,
    main: { turns: 42, perModel: { opus: { inp: 601_000, out: 0, cw: 0, cr: 0 } } },
    agents: { perModel: {} },
  },
  // work = workTokens(601k) - 0 - 4.4M*0.1 = 161k
  st: { turnStartReqs: 0, turnStartWorkTok: 0, rentGateAt: 8_400_000, rentGateFires: 3 },
  verdict,
}, 4_400_000, rvIn);

// These two assert the INVARIANT, not the sentence. Written 2026-07-30 they pinned the exact
// prose — `(a cache read, ~10% weight)` — and a legitimate rewrite the next day (the explicit
// `trips × avg × rate =` equation) broke both while preserving every number and the unit itself.
// A copy test that fails on rewording it should welcome is a brake on the file, so what is pinned
// now is what the change was FOR: the weighted figure, the raw one's absence, the weight named
// somewhere, and the two figures adjacent in one comparison.
test('cost figure is cache-weighted, not raw', () => {
  const s = CARD();
  assert(/~440k\b/.test(s), `expected the weighted rent figure, got: ${s}`);
  assert(!/4\.4M/.test(s), `raw rent figure still printed: ${s}`);
  assert(/10%/.test(s) && /cache read/.test(s),
    `the weight must be named inline, not left as a coined unit: ${s}`);
});

test('rent and work are comparable', () => {
  // The whole point of the change: both sides of the comparison in one unit, and adjacent —
  // a weighted rent figure parked a paragraph away from the work figure re-opens the same trap.
  const s = CARD();
  assert(/~440k[^\n]{0,60}~161k of actual work/.test(s),
    `the comparison is not same-unit and adjacent: ${s}`);
});

test('next-check tail converts with the cost figure', () => {
  const s = CARD();
  // Case-insensitive on the leading letter: the tail is a sentence of its own on the rendered
  // card, so it capitalizes. What this test is for is the CONVERSION (840k, not 8.4M) — pinning
  // the lowercase "e" made it fail on a capitalization that changed no number and no unit.
  assert(/[Ee]ach approval doubles the gap to the next \(≈ 840k\)/.test(s),
    `tail must convert too, or the card re-mixes units: ${s}`);
  assert(!/8\.4M/.test(s), `raw threshold still printed: ${s}`);
});

test('no 7-figure token count survives anywhere on the card', () => {
  // The reader-facing goal, asserted directly: nothing on this card reads as "4M".
  const s = CARD();
  const millions = s.match(/~?\d+(\.\d+)?M\b/g);
  assert(millions === null, `M-suffixed figures still on the card: ${millions}`);
});

/* ── R15b/R15c: the fat line is MEASURED, not flat ───────────────────────────────────────────
 * `fatAt = coldStart + contextExcessTokens`. Every restart recommendation this script ever made
 * priced the saving and left the price blank — "clearing stops that rent from the next trip on"
 * is true only if a fresh session starts at zero, and none does. It starts at the fixed payload
 * this repo hands every session, re-read on every trip exactly as the old one's was. So only the
 * EXCESS over that floor is shed-able, the threshold belongs on the excess, and a flat line
 * mismeasures anyone whose floor differs.
 *
 * Same copy discipline as the R14 block above: these assert rendered strings wherever a reader
 * sees one, because the failure mode here is a sentence that parses fine and overstates.        */
const FLOOR = 62_000;    // this machine's measured median (coldStartTokens, 2026-07-31)
const K = 88_000;        // DEFAULTS.contextExcessTokens
const rv = (live, floor) => restartVerdict(live, GAP, FAT, floor, floor ? K : undefined);
const R13B = {           // r13bTurnSpendGuard's slots — it talks about the plan, not the clear
  neutral: 'approve to push on — or deny, and Claude should stop and propose that plan.',
  denyTail: 'denying means Claude stops and proposes that plan.',
};

test('an unmeasured floor leaves the flat line exactly where it was', () => {
  // Under COLD_START_MIN_N samples the reading is the pre-R15 one, word for word. The script
  // does not quote a floor it has not measured, and does not move the line pretending it did.
  const stay = rv(141_000, null);
  const clear = rv(163_000, null);
  assert(/under the ~150k fat line, so clearing sheds little$/.test(stay.why), stay.why);
  assert(/past the ~150k fat line, so clearing stops that rent from the next trip on$/
    .test(clear.why), clear.why);
  assert(stay.coldStart === undefined && clear.coldStart === undefined,
    'an unmeasured floor must not surface as a number the copy can print');
});

test('a measured floor moves the line, so identical windows read opposite', () => {
  // The reason the change exists: two sessions at 130k are opposite situations at a 20k floor
  // (110k of shed-able cruft) and at a 100k floor (30k, against a 100k restart price).
  assert(rv(130_000, 20_000).clear === true, 'a 20k floor puts the line at 108k — 130k is fat');
  assert(rv(130_000, 100_000).clear === false, 'a 100k floor puts the line at 188k — 130k is not');
  // ...and the flat line would have called both of them lean, which is the floor-blindness.
  assert(rv(130_000, null).clear === false, 'flat-line control moved — rewrite this pair');
});

test('the excess budget is back-fit to reproduce the flat line at this floor', () => {
  // 88k is not a fresh opinion about how fat is too fat. It is the number that makes the
  // measured line land on the flat one HERE, so the change is a no-op on the machine it was
  // written on and adapts everywhere else. If either constant moves, this says whether the
  // move was deliberate. Bounded above by auto-compaction (~165k on a 200k window): a line
  // past the point where the harness compacts anyway can never fire.
  const line = FLOOR + K;
  assert(Math.abs(line - FAT) / FAT < 0.01, `line drifted off the flat default: ${line} vs ${FAT}`);
  assert(line < 165_000, `line is past auto-compaction and could never fire: ${line}`);
});

test('the not-fat tail states the real share, never "most"', () => {
  // This branch covers the whole band below coldStart + K, where startup's share falls to 41%
  // at a 62k floor. "Most of that window is startup a fresh session re-pays anyway" was
  // therefore false across the top third of its own range — a 141k window on a 62k floor is
  // 44% (2026-07-31). The share is computed, so it cannot drift back into a superlative.
  const fat141 = restartBullet(restartPos(42), 141_000, GAP, rv(141_000, FLOOR));
  assert(!/Most of that window/.test(fat141), `superlative back on a window it is false for: ${fat141}`);
  assert(/Startup alone is ~44% of that window/.test(fat141), `share missing or wrong: ${fat141}`);
  assert(/Startup alone is ~69% of that window/
    .test(restartBullet(restartPos(42), 90_000, GAP, rv(90_000, FLOOR))),
  'the share must track the window, not be a second constant');
});

test('the floor figure is quoted exactly once per R13b card', () => {
  // restartBullet owns it there. Until 2026-07-30 rv.why carried it too and the card printed
  // "~62k of startup" twice inside four lines; the fix was to give the floor one owner per
  // card and let why name the shed-able NET instead.
  const v = rv(163_000, FLOOR);
  const card = restartBullet(restartPos(42), 163_000, GAP, v) + choiceBullet(null, R13B, v);
  assert((card.match(/~62k/g) || []).length === 1, `floor quoted more than once: ${card}`);
  // ...and since 2026-07-31 that NET is CACHE-WEIGHTED (101k of raw window × 10%), because the
  // 62k it sits beside is fresh input a fresh session writes to cache. Two figures one clause
  // apart, billed ~10x differently, both printed as bare "k" read as a 2:1 win on trip one when
  // the real per-trip saving is ~10k. Same unit fix the Cost bullet already made for rent.
  assert(/sheds ~10k a trip net of startup/.test(card), `why lost the shed-able net: ${card}`);
  assert(!/~101k/.test(card), `the raw window is back, unweighted, beside a written figure: ${card}`);
});

test('the restart-pays branch asks for a checkpoint handoff', () => {
  // The WHAT-SURVIVES half of a restart (2026-08-07). A plan's Ledger records completion
  // explicitly, so /continue resumes plan work losslessly; everything else fell back to
  // transcript walk-back, which is inference. The card already said "what this turn ruled out
  // is not on disk" and stopped there — this branch now says where to put it, and /continue
  // (v8) reads that file ahead of the transcript. Pinned as RENDERED copy because both halves
  // are a contract with another reader: the path is what the writer writes and the recovery
  // ladder opens, and the four headings are what it parses.
  const fat = restartBullet(restartPos(42), 163_000, GAP, rv(163_000, FLOOR), 'abc-123');
  assert(fat.includes('.claude/hooks/.titles/abc-123.handoff.md'),
    `the handoff path must be templated with the live sid: ${fat}`);
  for (const h of ['## Done', '## In flight', '## Next', '## Pointers']) {
    assert(fat.includes(h), `handoff section ${h} missing from the ask: ${fat}`);
  }
  assert(/ISO/.test(fat), `the first-line timestamp went unstated: ${fat}`);
  // A sid-less caller renders the placeholder, never the string "undefined" — same discipline as
  // the no-'undefined'-leaks pin above: this is copy a model acts on, and an undefined path is a
  // file written somewhere nothing reads.
  const noSid = restartBullet(restartPos(42), 163_000, GAP, rv(163_000, FLOOR));
  assert(noSid.includes('.claude/hooks/.titles/<sid>.handoff.md'), `placeholder lost: ${noSid}`);
  assert(!/undefined/.test(noSid), `undefined leaked into the handoff path: ${noSid}`);
  // ...and the not-fat branch stays clean. Asking for a checkpoint on the card that just
  // recommended NOT clearing is work for nothing, and it would bury the reading it opens on.
  const lean = restartBullet(restartPos(42), 141_000, GAP, rv(141_000, FLOOR), 'abc-123');
  assert(!/handoff/.test(lean), `the not-fat branch must not ask for a handoff: ${lean}`);
});

test('the deny tail prices the restart (clearTail, riding R20)', () => {
  // Born on R14: no Restart bullet meant the card recommended /clear + /continue and priced
  // it at nothing until clearTail rode along in denyTail. R14's condensed card prices the
  // same trade in its rationale line now (pinned below); R20's denyTail still rides this.
  const priced = clearTail(rv(163_000, FLOOR));
  // Both halves of the trade in one clause, in one unit: a price, and the trips that price takes
  // to earn back (62k floor ÷ ~10k shed a trip = 7). Deliberately a FLOOR — the cache-write
  // premium on the floor is charged at 1x and a cleared window refills as it works, so real
  // payback lands later, never earlier. It decides nothing; it prints the division the reader
  // would otherwise do wrong.
  assert(/a fresh session here re-pays ~62k of startup, ~7 trips to break even, then carries only the next step$/
    .test(priced), priced);
  // Unmeasured => the pre-2026-07-30 wording, word for word, so R14's slots read unchanged.
  assert(clearTail(rv(163_000, null)) === ' carrying only the next step', 'fallback wording moved');
  assert(clearTail(null) === ' carrying only the next step', 'a dead meter must not price it');
});

/* ── R14's condensed card: four label — value bullets (2026-08-14) ───────────────────────────
 * The Choice paragraph collapsed into a verdict + rationale pair wearing the same label-dash
 * grammar as /cost-compare's readout. Pinned as rendered strings for the same reason as every
 * block above: the failure mode here is copy that parses fine and reads wrong.               */
test('the card wears the four-bullet label grammar', () => {
  const s = CARD(rv(163_000, FLOOR));
  for (const label of ['• this turn — ', '• if it continues — ', '• verdict — ', '• rationale — ']) {
    assert(s.includes(label), `label missing from the card: "${label}"\n${s}`);
  }
});

test('a fat window reads deny, priced by the measured cold start', () => {
  const s = CARD(rv(163_000, FLOOR));
  assert(/• verdict — deny: land at a commit point, then \/clear \+ \/continue/.test(s), s);
  // Price and payback in one clause, in trips — clearTail's trade, owned by the rationale here.
  assert(/• rationale — a fresh session's ~62k cold start repays itself in ~7 trips/.test(s), s);
});

test('an unmeasured floor keeps the fat-line wording in the rationale', () => {
  // Same no-floor-no-claim discipline as clearTail's fallback: the script does not quote a
  // price it has not measured, so the rationale falls back to rv.why's own reading.
  const s = CARD(rv(163_000, null));
  assert(/• rationale — ~163k of context is past the ~150k fat line/.test(s), s);
  assert(!/cold start/.test(s), `an unmeasured floor must not be priced: ${s}`);
});

test('a dead meter names no side and prints no rationale', () => {
  const s = CARD(null);
  assert(/• verdict — your call: approve to push on, or deny to land at a commit point/.test(s), s);
  assert(!/• rationale — /.test(s), `a rationale with nothing measured behind it is a bluff: ${s}`);
});

test('a bomb call names the subject in the rationale', () => {
  // The 2026-08-05 fix carries over: the sentence needs a subject, or "deny — this runs the
  // whole test suite" reads as the DENY running the suite.
  const s = CARD(rv(141_000, FLOOR), { kind: 'deny', why: 'runs the whole 40-minute suite' });
  assert(/• verdict — deny: land at a commit point/.test(s), s);
  assert(/• rationale — approving continues the current work, whose next step runs the whole 40-minute suite/
    .test(s), s);
});

test('the cold-start meter says nothing rather than guessing', () => {
  // Same no-measurement-no-claim discipline as restartVerdict's dead-meter branch: a store
  // under COLD_START_MIN_N reads null, and every caller falls back to its pre-R15 copy.
  assert(coldStartTokens(null, 'sid', null, null) === null, 'no projectDir must read null');
  assert(coldStartTokens(path.join(os.tmpdir(), 'cca-no-such-project'), 'sid', null, null) === null,
    'an empty store must read null, not 0');
  assert(firstContextOfHead(path.join(os.tmpdir(), 'cca-no-such-transcript.jsonl')) === 0,
    'a missing transcript must read 0, never throw on the PreToolUse path');
});

test('the meter-canary line carries both numbers and no $ figure', () => {
  const s = meterCanaryNote({ hours: 26, warnHours: 24 });
  assert(/~26h/.test(s), `the age must appear, got: ${s}`);
  assert(/past 24h/.test(s), `the threshold must appear (a number needs its threshold), got: ${s}`);
  assert(!/\$/.test(s), `window copy never carries $, got: ${s}`);
});

summary();
