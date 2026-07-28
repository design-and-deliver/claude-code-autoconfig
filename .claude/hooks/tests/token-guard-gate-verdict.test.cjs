// gateVerdict — the recommendation layer on the two in-turn tripwires (R13b work, R14 rent).
//
// The premise: token math measures the TURN'S STATE and is identical whether the next call is a
// commit or another god-file read, so it cannot discriminate between two pending calls. For THAT
// the discriminator is the SHAPE of the call, which PreToolUse already hands the hook.
//
// Refined 2026-07-26 (Andrew: "a user shouldn't be forced to figure out if 2M means keep going or
// clear/continue"). The original reading of the premise — leave the Choice bullet neutral unless
// the CALL is a bomb — left the common case unlabelled, which put the arithmetic back on the
// reader, the one thing the card exists to prevent. The correction: turn state cannot rank two
// calls, but it CAN rank restart-vs-push-on. So the Choice bullet now always names a side — from
// the call when it is a bomb, from the numbers otherwise, and neutral only when the meter is
// empty. It is the same verdict the Restart bullet was already reaching, promoted to the line the
// eye actually lands on.
//
// Corrected again 2026-07-27. The first cut read that side off "is the context cheap to rebuild?"
// (liveContext × 3 ≤ gap) and recommended clearing when it was. Backwards and constant: a restart
// pays off by the rent it STOPS, not the context it rebuilds, so the FAT window is the one worth
// clearing — and the gap reduces to base × 2^(fires−1) ≥ 1M, which no real liveContext clears, so
// `approve (recommended)` was dead code. The verdict now keys on the script's own fat-context
// threshold (cfg.contextWarnTokens), the same line fatContextGuard and bombGateWhenFat already
// use, so there is ONE definition of too-much-context. Both directions stay pinned below, because
// a recommendation that only ever says one thing is exactly the wallpaper this layer avoids.
//
// Born from the 2026-07-26 screenshot: R14 fired on `git add … && git status --short` — the exact
// "land at a commit point" its own Choice bullet was asking for, three lines above. Two behaviors
// are pinned here: a turn-ender DEFERS the gate entirely (no fire, no re-arm — silence beats a
// green "approve recommended" label, which would teach the user the warnings are theatre), and a
// bomb (full suite / explicitly-unbounded Grep) fires with deny LEADING the Choice bullet.
// Run: node --test token-guard-gate-verdict.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'token-guard.js');

const usageLine = (id, inp) => JSON.stringify({ type: 'assistant',
  message: { id, model: 'claude-fable-5', usage: { input_tokens: inp, output_tokens: 10 } } }) + '\n';
const roundTrip = (id, cr) => JSON.stringify({ type: 'assistant',
  message: { id, model: 'claude-fable-5',
    usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: cr } } }) + '\n';

function mkFixture(guardCfg) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'tgv-'));
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'cca.config.json'),
    // R13b parked high: these cases are about rent (R14), which is what the screenshot showed.
    JSON.stringify({ tokenGuard: Object.assign(
      { turnGateTokens: 10000000, turnRentGateTokens: 100000 }, guardCfg) }));
  const tp = path.join(proj, 'main.jsonl');
  fs.writeFileSync(tp, usageLine('m1', 1000));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tgv-home-'));
  return { proj, home, tp };
}

function runHook(fix, payload) {
  const env = Object.assign({}, process.env, {
    CLAUDE_PROJECT_DIR: fix.proj, USERPROFILE: fix.home, HOME: fix.home,
    ANTHROPIC_API_KEY: 'sk-test',
  });
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(Object.assign({ session_id: 'sid-tgv', transcript_path: fix.tp }, payload)),
    encoding: 'utf8', env, timeout: 20000,
  });
  return r.stdout || '';
}

const call = (fix, tool_name, tool_input) =>
  runHook(fix, { hook_event_name: 'PreToolUse', tool_name, tool_input });
const promptSubmit = fix => runHook(fix, { hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
const gateOut = raw => (JSON.parse(raw || '{}').hookSpecificOutput || {});

// Arms a turn that is 3 gate-widths into rent — R14 is primed to fire on the next call.
function primed(guardCfg) {
  const fix = mkFixture(guardCfg);
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, roundTrip('m2', 300000));
  return fix;
}

test('turn-ender defers the gate: the screenshot command does not fire', () => {
  const fix = primed();
  // The literal 2026-07-26 case. Fails on the pre-verdict hook, which fired here.
  const out = gateOut(call(fix, 'Bash', {
    command: 'cd C:/CODE/job-agent-extension && git add src/a.ts src/b.ts && git status --short' }));
  assert.equal(out.permissionDecision, undefined);
});

test('deferral does NOT re-arm — the very next non-turn-ender call takes the check', () => {
  const fix = primed();
  assert.equal(gateOut(call(fix, 'Bash', { command: 'git commit -m "wip"' })).permissionDecision,
    undefined);
  // Same rent, ordinary call ⇒ the gate the commit deferred fires now. This is what separates
  // "deferred" from "suppressed"; a re-arm on skip would have swallowed it.
  assert.equal(gateOut(call(fix, 'Bash', { command: 'ls -la' })).permissionDecision, 'ask');
});

test('one non-turn-ender segment disqualifies the whole command (fails closed)', () => {
  const fix = primed();
  const out = gateOut(call(fix, 'Bash', { command: 'git add . && pnpm run build' }));
  assert.equal(out.permissionDecision, 'ask');
});

test('full test suite fires with deny LEADING the Choice bullet', () => {
  const fix = primed();
  const out = gateOut(call(fix, 'Bash', { command: 'pnpm test --run' }));
  assert.equal(out.permissionDecision, 'ask');
  const lines = out.permissionDecisionReason.split('\n');
  assert.equal(lines.length, 5);                       // R14's pinned shape survives (5 since R15)
  assert.match(lines[4], /^• Choice: deny \(recommended\) — /);
  assert.match(lines[4], /whole test suite/);
  // Advisory, not authoritarian: the approve path is still stated.
  assert.match(lines[4], /Approving pushes on/);
});

// The two ways a full suite actually gets typed. Both read as "scoped" to a check that anchors at
// string start and counts shell operators as path arguments — so the deny label almost never fired
// on a real run (observed 2026-07-26: the gate stayed neutral on every full-suite command in the
// session that prompted this test).
test('a full suite behind `cd &&` still fires — the check is per segment, not anchored', () => {
  const fix = primed();
  const out = gateOut(call(fix, 'Bash', { command: 'cd C:/CODE/repo && pnpm test --run' }));
  assert.equal(out.permissionDecision, 'ask');
  assert.match(out.permissionDecisionReason.split('\n')[4], /^• Choice: deny \(recommended\) — /);
});

test('redirects and pipes are not scope — `pnpm test --run 2>&1 | tail -30` is a full suite', () => {
  const fix = primed();
  const out = gateOut(call(fix, 'Bash', { command: 'pnpm test --run 2>&1 | tail -30' }));
  assert.equal(out.permissionDecision, 'ask');
  assert.match(out.permissionDecisionReason.split('\n')[4], /^• Choice: deny \(recommended\) — /);
});

// A scoped run still gets a recommendation — the NUMBERS one — so the assertion here is about
// the bomb label, not about neutrality: the verdict layer must not call a two-file test run a
// full suite. Matching on the bomb's own reason keeps this independent of which way the fixture's
// restart arithmetic happens to fall.
test('a SCOPED test run is not a bomb — no call-driven deny', () => {
  const fix = primed();
  const out = gateOut(call(fix, 'Bash', { command: 'pnpm test --run src/utils/foo.test.ts' }));
  assert.equal(out.permissionDecision, 'ask');
  const lines = out.permissionDecisionReason.split('\n');
  assert.doesNotMatch(lines[4], /whole test suite/);

  // The other half of the redirect fix: stripping operators must not swallow a REAL path arg.
  // This is the literal command from the 2026-07-26 screenshot — cd, pipe, redirect AND a scope.
  const piped = gateOut(call(primed(), 'Bash',
    { command: 'cd C:/CODE/repo && pnpm test --run src/utils/foo.test.ts 2>&1 | tail -30' }));
  assert.doesNotMatch(piped.permissionDecisionReason.split('\n')[4], /whole test suite/);
});

test('explicitly-unbounded Grep is a bomb; an unset head_limit (caps at 250) is not', () => {
  const bomb = gateOut(call(primed(), 'Grep',
    { pattern: 'foo', output_mode: 'content', head_limit: 0 }));
  assert.match(bomb.permissionDecisionReason.split('\n')[4], /^• Choice: deny \(recommended\) — /);
  assert.match(bomb.permissionDecisionReason, /explicitly unbounded/);

  const ordinary = gateOut(call(primed(), 'Grep', { pattern: 'foo', output_mode: 'content' }));
  assert.equal(ordinary.permissionDecision, 'ask');
  assert.doesNotMatch(ordinary.permissionDecisionReason, /explicitly unbounded/);
});

// ── The numbers-driven half (the 2026-07-26 refinement) ───────────────────────────────────────
// The screenshot case: an ordinary command, no bomb shape, ~2.1M of rent — and the Choice bullet
// said "approve to push on — or deny", handing the arithmetic straight back to the reader.
// Rent alone does not decide the side; the LIVE CONTEXT does, against the fat line.
test('an ordinary call on a LEAN window recommends approve — clearing would rebuild it back', () => {
  const fix = mkFixture({ turnRentGateTokens: 1000000 });
  promptSubmit(fix);
  // Rent piles up across the turn, but the LAST message is thin — the window carries ~50k, well
  // under the 150k fat line, so a /clear here sheds almost nothing and re-pays a cold start.
  for (const id of ['a', 'b', 'c', 'd']) fs.appendFileSync(fix.tp, roundTrip(id, 300000));
  fs.appendFileSync(fix.tp, roundTrip('e', 50000));
  const lines = gateOut(call(fix, 'Bash', { command: 'ls -la' }))
    .permissionDecisionReason.split('\n');
  assert.match(lines[3], /Lean enough that a restart would rebuild most of it back/);
  assert.match(lines[4], /^• Choice: approve \(recommended\) — push on; /);
  assert.match(lines[4], /denying lands this turn at a commit point/);   // losing option stays
});

test('…and deny on a FAT window — clearing stops that rent from the next trip on', () => {
  // primed() leaves ~300k resident, past the 150k fat line.
  const lines = gateOut(call(primed(), 'Bash', { command: 'ls -la' }))
    .permissionDecisionReason.split('\n');
  assert.match(lines[3], /Past the fat line/);
  assert.match(lines[4], /^• Choice: deny \(recommended\) — /);
  assert.match(lines[4], /past the ~150k fat line/);
  assert.match(lines[4], /Approving pushes on; /);     // the losing option stays on the card
});

// The two bullets are one thought split in half — evidence, then verdict. If they ever disagree
// the card is worse than neutral, because the reader now has to arbitrate between them.
test('reading and recommendation never argue — the Restart evidence decides the Choice side', () => {
  // Two fat fixtures at different gate widths, plus a lean one, so the pivot is checked on BOTH
  // sides — a same-side sweep would pass on a bullet pair that always agreed by accident.
  const lean = mkFixture({ turnRentGateTokens: 1000000 });
  promptSubmit(lean);
  for (const id of ['a', 'b', 'c', 'd']) fs.appendFileSync(lean.tp, roundTrip(id, 300000));
  fs.appendFileSync(lean.tp, roundTrip('e', 50000));
  for (const fix of [primed(), primed({ turnRentGateTokens: 250000 }), lean]) {
    const lines = gateOut(call(fix, 'Bash', { command: 'ls -la' }))
      .permissionDecisionReason.split('\n');
    assert.match(lines[4], /^• Choice: (?:approve|deny) \(recommended\) — /);
    assert.match(lines[4],
      /Past the fat line/.test(lines[3]) ? /^• Choice: deny/ : /^• Choice: approve/);
  }
});

// ── R16: the three bomb classes the two-case deny list missed ─────────────────────────────────
// Observed 2026-07-27: the gate fired on a `cd && head && grep` and the Choice bullet came from
// the ratio alone — the same answer it gives for every non-bomb call at that context reading,
// which is the wallpaper the layer exists to avoid. Each class below is pinned BOTH ways. The
// stays-neutral half is the load-bearing one: a deny list that over-fires trains dismissal, and
// dismissal is worse than no label at all.
//
// Note the neutral assertions match on the BOMB'S OWN reason string, never on the absence of a
// fire — primed() is deliberately fat, so the numbers-driven verdict still says "deny" there.
// That is correct and unrelated; what must not happen is the CALL being labelled a bomb.
const BIG = 200 * 1024;                        // over BIG_READ_BYTES (120k) with margin
function bigFile(fix, name = 'god.ts') {
  const p = path.join(fix.proj, name);
  fs.writeFileSync(p, 'x'.repeat(BIG));
  return p;
}
const choice = out => out.permissionDecisionReason.split('\n')[4];

// (a) — the class that was in the written patch and got DROPPED on inspection. R8's payload door
// already owns the unranged-Read shape, fires earlier, and prices it off cfg.bombJumpTokens; a
// second hard-coded threshold in gateVerdict would have been a few-KB-wide band plus a rival
// definition of "god file". This pins WHICH gate answers, so a future re-add is a red test rather
// than a silent duplicate.
test('(a) a god-file Read is R8 door work, not a gateVerdict bomb — one gate owns it', () => {
  const fix = primed();
  const god = bigFile(fix);
  const out = gateOut(call(fix, 'Read', { file_path: god }));
  assert.equal(out.permissionDecision, 'ask');
  assert.match(out.permissionDecisionReason, /reading god\.ts in full adds/);   // R8's copy
  assert.equal(out.permissionDecisionReason.split('\n').length, 1);             // not R14's card
  // R8's own escape hatch, re-pinned here because dropping (a) makes it the only one left.
  for (const ranged of [{ limit: 80 }, { offset: 3000 }]) {
    const r = gateOut(call(primed(), 'Read', Object.assign({ file_path: god }, ranged)));
    assert.doesNotMatch(r.permissionDecisionReason, /in full adds/, JSON.stringify(ranged));
  }
});

test('(b) an unbounded Bash search is a bomb; -m/-l/-c or a downstream head clears it', () => {
  const bomb = gateOut(call(primed(), 'Bash', { command: 'rg TODO src/' }));
  assert.equal(bomb.permissionDecision, 'ask');
  assert.match(choice(bomb), /^• Choice: deny \(recommended\) — /);
  assert.match(choice(bomb), /no -m\/-l bound/);
  // Behind a cd, same as the full-suite case — the check is per segment, not anchored.
  assert.match(choice(gateOut(call(primed(), 'Bash', { command: 'cd C:/CODE/repo && grep -rn foo .' }))),
    /no -m\/-l bound/);

  for (const cmd of ['rg TODO -l src/', 'rg -c TODO src/', 'rg --max-count 5 TODO src/',
                     'grep -rn foo . | head -20', 'rg TODO src/ | wc -l']) {
    assert.doesNotMatch(choice(gateOut(call(primed(), 'Bash', { command: cmd }))),
      /no -m\/-l bound/, cmd);
  }
});

test('(c) catting a big file is a bomb; a small cat is not', () => {
  const fix = primed();
  const god = bigFile(fix, 'huge.log');
  const bomb = gateOut(call(fix, 'Bash', { command: 'cat ' + god }));
  assert.equal(bomb.permissionDecision, 'ask');
  assert.match(choice(bomb), /^• Choice: deny \(recommended\) — /);
  assert.match(choice(bomb), /cats a file big enough/);

  const small = path.join(fix.proj, 'package.json');
  fs.writeFileSync(small, '{"name":"x"}');
  assert.doesNotMatch(choice(gateOut(call(primed(), 'Bash', { command: 'cat ' + small }))),
    /cats a file big enough/);
});

test('(d) a full-patch git command is a bomb; the --stat spellings stay turn-enders', () => {
  for (const cmd of ['git diff', 'git show HEAD', 'git log -p -5', 'git log --patch']) {
    const out = gateOut(call(primed(), 'Bash', { command: cmd }));
    assert.equal(out.permissionDecision, 'ask', cmd);
    assert.match(choice(out), /prints a full patch/, cmd);
  }
  // These are turn-enders: they must not merely stay neutral, they must DEFER the gate entirely.
  for (const cmd of ['git diff --stat', 'git diff --cached --stat', 'git log --oneline -5']) {
    assert.equal(gateOut(call(primed(), 'Bash', { command: cmd })).permissionDecision, undefined, cmd);
  }
  // --name-only is not in the turn-ender allowlist, so it fires — but not as a patch bomb.
  assert.doesNotMatch(choice(gateOut(call(primed(), 'Bash', { command: 'git diff --name-only' }))),
    /prints a full patch/);
});

// The four new per-segment matchers are four fresh chances to break the deferral that started
// this whole layer. A commit message is prose and will happily contain the words that trip them.
test('a commit message quoting the bomb words still defers the gate', () => {
  const fix = primed();
  const out = gateOut(call(fix, 'Bash',
    { command: 'git commit -m "run pnpm test and rg everything, then cat the log"' }));
  assert.equal(out.permissionDecision, undefined);
});

test('R13b carries the same verdict layer', () => {
  // Work gate armed low, rent gate off ⇒ the fire below is R13b's, not R14's.
  const fix = mkFixture({ turnGateTokens: 50000, turnRentGateTokens: null });
  promptSubmit(fix);
  fs.appendFileSync(fix.tp, usageLine('m2', 200000));
  assert.equal(gateOut(call(fix, 'Bash', { command: 'git status --short' })).permissionDecision,
    undefined);
  const out = gateOut(call(fix, 'Bash', { command: 'vitest' }));
  assert.equal(out.permissionDecision, 'ask');
  assert.match(out.permissionDecisionReason, /spiraled/);            // R13b's framing
  assert.match(out.permissionDecisionReason, /deny \(recommended\)/);
});
