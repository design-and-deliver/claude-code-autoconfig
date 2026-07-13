#!/usr/bin/env node

/**
 * Behavioral tests for the terminal-title hook.
 *
 * These drive the REAL hook (.claude/hooks/terminal-title.js) via child_process
 * with mock Claude Code payloads — not a stand-in — and assert on what it emits
 * for each of the four hook events. Catches regressions in:
 *   - state-glyph selection per event (working / idle / awaiting)
 *   - directive block selection (SHIFT vs COMMAND)
 *   - title normalization (' - ' -> ' — ') and per-segment capitalization
 *   - the no-pre-create invariant (dir created, title file is NOT)
 *   - PostToolUse no-op before a title exists
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOOK = path.join(__dirname, '..', '.claude', 'hooks', 'terminal-title.js');

// Expected state glyph code points (must match terminal-title.js GLYPH)
const WORKING = [0x26ab, 0xfe0e];
const AWAITING = [0x25d0];
const IDLE = [0x273b];

let passed = 0;
let failed = 0;
const tempDirs = [];

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

function mkWorkspace() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-test-'));
  tempDirs.push(cwd);
  return cwd;
}

function titleFileFor(cwd, sid) {
  return path.join(cwd, '.claude', 'hooks', '.titles', `${sid}.txt`);
}

function writeTitle(cwd, sid, text) {
  const file = titleFileFor(cwd, sid);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

// Run the real hook with a payload; returns { raw, json, shown, codepoints, directive }.
// `envOverrides` merges into the child env; CLAUDE_PROJECT_DIR is STRIPPED by default so the
// ambient session env can't leak into the ownerDir keying under test — tests that exercise the
// keying pass it explicitly. `hookPath` lets a test drive a copy of the hook installed elsewhere
// (the fake-home stand-down tests).
function runHook(payload, envOverrides, hookPath) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  Object.assign(env, envOverrides || {});
  const raw = execFileSync(process.execPath, [hookPath || HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env,
  });
  if (!raw) return { raw: '', json: null, shown: null, codepoints: [], directive: null };
  const json = JSON.parse(raw);
  const seq = json.terminalSequence || '';
  const m = seq.match(/\x1b\]0;([\s\S]*?)\x07/);
  const shown = m ? m[1] : null;
  const codepoints = shown ? [...shown].map(c => c.codePointAt(0)) : [];
  const directive =
    json.hookSpecificOutput && json.hookSpecificOutput.additionalContext
      ? json.hookSpecificOutput.additionalContext
      : null;
  return { raw, json, shown, codepoints, directive };
}

// Does the emitted title lead with the given glyph code points (then a space)?
function leadsWithGlyph(codepoints, glyph) {
  for (let i = 0; i < glyph.length; i++) {
    if (codepoints[i] !== glyph[i]) return false;
  }
  return codepoints[glyph.length] === 0x20; // space after the glyph
}

function titleText(shown) {
  // strip the leading glyph + single space
  const idx = shown.indexOf(' ');
  return idx >= 0 ? shown.slice(idx + 1) : shown;
}

console.log('============================================================');
console.log('TERMINAL-TITLE HOOK TESTS');
console.log('============================================================');
console.log();

console.log('Source:');
test('terminal-title.js exists', () => {
  assert(fs.existsSync(HOOK), `hook not found: ${HOOK}`);
});
test('terminal-title.directive.md exists', () => {
  assert(
    fs.existsSync(path.join(__dirname, '..', '.claude', 'hooks', 'terminal-title.directive.md')),
    'directive template not found'
  );
});
console.log();

console.log('UserPromptSubmit:');
test('no title file -> working glyph + folder name + injected directive', () => {
  const cwd = mkWorkspace();
  const sid = 'ups-1';
  const r = runHook({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd, prompt: 'hello' });
  assert(leadsWithGlyph(r.codepoints, WORKING), `expected working glyph, got ${r.shown}`);
  // Folder name is the fallback title; it also passes through normalize() (first
  // letter capitalized), so compare case-insensitively.
  assert(
    titleText(r.shown).toLowerCase() === path.basename(cwd).toLowerCase(),
    `expected folder name, got "${titleText(r.shown)}"`
  );
  assert(r.directive && r.directive.length > 0, 'expected an injected directive');
});

test('creates the .titles dir but NOT the title file (Write-tool invariant)', () => {
  const cwd = mkWorkspace();
  const sid = 'ups-2';
  runHook({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd, prompt: 'hi' });
  const file = titleFileFor(cwd, sid);
  assert(fs.existsSync(path.dirname(file)), '.titles dir should be created');
  assert(!fs.existsSync(file), 'title file must NOT be pre-created (the model must create it)');
});

test('normal turn injects the compact REMINDER, not the full rulebook', () => {
  const cwd = mkWorkspace();
  const sid = 's';
  writeTitle(cwd, sid, 'Alpha — Beta'); // title exists -> no BASELINE addendum
  const r = runHook({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd, prompt: 'do a thing' });
  assert(/Terminal-title reminder/.test(r.directive), 'expected the REMINDER block');
  assert(/full rules were injected\s+at session start/.test(r.directive), 'reminder should point back to session-start rules');
  assert(!/DESIGN SCOPE/.test(r.directive), 'per-prompt injection must not carry the full RULES text');
  assert(!/implementation detail/.test(r.directive), 'normal turn must not carry the COMMAND addendum');
  assert(r.directive.length < 800, `reminder must stay compact (token guard), got ${r.directive.length} chars`);
});

test('slash-command turn appends the COMMAND addendum (with the command name)', () => {
  const cwd = mkWorkspace();
  const sid = 'c';
  writeTitle(cwd, sid, 'Alpha — Beta');
  const r = runHook({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd, prompt: '/bundle-prod ship' });
  assert(/implementation detail/.test(r.directive), 'expected the COMMAND addendum');
  assert(r.directive.includes('bundle-prod'), 'COMMAND addendum should name the command');
  assert(/Terminal-title reminder/.test(r.directive), 'REMINDER must still lead the injection');
});

test('first turn (no title file) appends the BASELINE addendum; later turns do not', () => {
  const cwd = mkWorkspace();
  const fresh = runHook({ hook_event_name: 'UserPromptSubmit', session_id: 'b1', cwd, prompt: 'hi' });
  assert(/baseline/.test(fresh.directive), 'no-title turn should carry the BASELINE addendum');
  const cwd2 = mkWorkspace();
  writeTitle(cwd2, 'b2', 'Alpha — Beta');
  const later = runHook({ hook_event_name: 'UserPromptSubmit', session_id: 'b2', cwd: cwd2, prompt: 'hi' });
  assert(!/baseline/.test(later.directive), 'with a title present, no BASELINE addendum');
});

test("reminder keeps both critical actions: title write + this session's {sid}.ask flag + '?'", () => {
  const cwd = mkWorkspace();
  const sid = 'ask-path';
  const r = runHook({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd, prompt: 'do a thing' });
  assert(r.directive.includes(`${sid}.txt`), "reminder should name this session's title file");
  assert(r.directive.includes(`${sid}.ask`), "reminder should name this session's .ask path");
  assert(/write the\s+flag file/i.test(r.directive), 'reminder should instruct writing the .ask flag');
  assert(/make '\?' the message's last character/.test(r.directive), "reminder should instruct ending on '?'");
  assert(/nothing is solicited, end on a statement/.test(r.directive), 'reminder should carry the inverse (no-signal) rule');
  assert(/DIRECT QUESTION/.test(r.directive), 'reminder should demand the direct-question phrasing');
  assert(/never a declarative offer/.test(r.directive), 'reminder should name the declarative-offer failure mode');
});

test('UserPromptSubmit clears a stale {sid}.ask flag from an interrupted prior turn', () => {
  const cwd = mkWorkspace();
  const sid = 'ups-ask';
  const askFile = path.join(cwd, '.claude', 'hooks', '.titles', `${sid}.ask`);
  fs.mkdirSync(path.dirname(askFile), { recursive: true });
  fs.writeFileSync(askFile, '1');
  runHook({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd, prompt: 'hi' });
  assert(!fs.existsSync(askFile), 'a stale .ask flag should be cleared at UserPromptSubmit');
});
console.log();

console.log('Title normalization:');
test("' - ' becomes ' — ' and each segment is capitalized", () => {
  const cwd = mkWorkspace();
  const sid = 'norm';
  writeTitle(cwd, sid, 'job agent - new jobs window');
  const r = runHook({ hook_event_name: 'PostToolUse', session_id: sid, cwd, tool_name: 'Edit' });
  assert(titleText(r.shown) === 'Job agent — New jobs window', `got "${titleText(r.shown)}"`);
});

test('already-normalized title is left stable (idempotent)', () => {
  const cwd = mkWorkspace();
  const sid = 'idem';
  const already = 'Job Agent — New Jobs Window';
  writeTitle(cwd, sid, already);
  const r = runHook({ hook_event_name: 'PostToolUse', session_id: sid, cwd, tool_name: 'Edit' });
  assert(titleText(r.shown) === already, `expected unchanged, got "${titleText(r.shown)}"`);
});
console.log();

console.log('State glyphs per event:');
function withTitle(event, extra) {
  const cwd = mkWorkspace();
  const sid = 'glyph';
  writeTitle(cwd, sid, 'Alpha — Beta');
  return runHook(Object.assign({ hook_event_name: event, session_id: sid, cwd }, extra || {}));
}

test('PostToolUse -> working glyph', () => {
  const r = withTitle('PostToolUse', { tool_name: 'Bash' });
  assert(leadsWithGlyph(r.codepoints, WORKING), `expected working glyph, got ${r.shown}`);
});

test('Stop -> idle glyph', () => {
  const r = withTitle('Stop');
  assert(leadsWithGlyph(r.codepoints, IDLE), `expected idle glyph, got ${r.shown}`);
});

test('Notification -> awaiting glyph', () => {
  const r = withTitle('Notification');
  assert(leadsWithGlyph(r.codepoints, AWAITING), `expected awaiting glyph, got ${r.shown}`);
});
console.log();

console.log('Question-state (Stop -> awaiting when the turn ended on a question):');

function writeTranscript(cwd, name, entries) {
  const file = path.join(cwd, `${name}.jsonl`);
  fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

// An assistant transcript entry holding the given content blocks.
function asst(blocks) {
  return { type: 'assistant', message: { role: 'assistant', content: blocks } };
}

function stopWithTranscript(cwd, sid, entries) {
  writeTitle(cwd, sid, 'Alpha — Beta');
  const tp = writeTranscript(cwd, sid, entries);
  return runHook({ hook_event_name: 'Stop', session_id: sid, cwd, transcript_path: tp });
}

test('Stop -> awaiting when the last response text ends in "?"', () => {
  const r = stopWithTranscript(mkWorkspace(), 'q-yes', [
    { type: 'user', message: { role: 'user', content: 'hi' } },
    asst([{ type: 'text', text: 'Should I add the heuristic fallback?' }]),
  ]);
  assert(leadsWithGlyph(r.codepoints, AWAITING), `expected awaiting glyph, got ${r.shown}`);
});

test('Stop -> idle when the last response text does NOT end in "?"', () => {
  const r = stopWithTranscript(mkWorkspace(), 'q-no', [
    asst([{ type: 'text', text: 'Done. The fix is applied.' }]),
  ]);
  assert(leadsWithGlyph(r.codepoints, IDLE), `expected idle glyph, got ${r.shown}`);
});

test('Stop -> awaiting when the "?" text block is followed by a tool_use in the same message', () => {
  const r = stopWithTranscript(mkWorkspace(), 'q-tool', [
    asst([
      { type: 'text', text: 'Want me to apply it?' },
      { type: 'tool_use', name: 'Write', input: {} },
    ]),
  ]);
  assert(leadsWithGlyph(r.codepoints, AWAITING), `expected awaiting glyph, got ${r.shown}`);
});

test('Stop -> skips a trailing pure-tool_use turn to find the last visible text', () => {
  const r = stopWithTranscript(mkWorkspace(), 'q-skip', [
    asst([{ type: 'text', text: 'Which option do you prefer?' }]),
    asst([{ type: 'tool_use', name: 'Write', input: {} }]), // no visible text
  ]);
  assert(leadsWithGlyph(r.codepoints, AWAITING), `expected awaiting glyph, got ${r.shown}`);
});

test('Stop -> awaiting via the {sid}.ask flag override, and the flag is consumed', () => {
  const cwd = mkWorkspace();
  const sid = 'q-flag';
  writeTitle(cwd, sid, 'Alpha — Beta');
  const askFile = path.join(cwd, '.claude', 'hooks', '.titles', `${sid}.ask`);
  fs.writeFileSync(askFile, '1');
  const r = runHook({ hook_event_name: 'Stop', session_id: sid, cwd }); // no transcript
  assert(leadsWithGlyph(r.codepoints, AWAITING), `expected awaiting glyph, got ${r.shown}`);
  assert(!fs.existsSync(askFile), 'the .ask flag should be consumed (deleted) by Stop');
});

test('Stop -> idle when there is no transcript and no flag', () => {
  const cwd = mkWorkspace();
  const sid = 'q-none';
  writeTitle(cwd, sid, 'Alpha — Beta');
  const r = runHook({ hook_event_name: 'Stop', session_id: sid, cwd });
  assert(leadsWithGlyph(r.codepoints, IDLE), `expected idle glyph, got ${r.shown}`);
});

test('Stop -> awaiting on a HUGE transcript (tail-read still finds the final "?")', () => {
  const cwd = mkWorkspace();
  const sid = 'q-huge';
  writeTitle(cwd, sid, 'Alpha — Beta');
  // >1MB transcript: ~800 filler lines of ~2KB each, then a user prompt, then the final question.
  // Exercises inspectLastResponse's tail-read branch (size > 1MB) added for the stuck-⬤ fix — a broken
  // tail-read (dropped final line / wrong offset) would return idle here.
  const filler = JSON.stringify(asst([{ type: 'text', text: 'x'.repeat(2000) }]));
  const lines = [];
  for (let i = 0; i < 800; i++) lines.push(filler);
  lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: 'go' } }));
  lines.push(JSON.stringify(asst([{ type: 'text', text: 'All done — should I ship it?' }])));
  const tp = path.join(cwd, `${sid}.jsonl`);
  fs.writeFileSync(tp, lines.join('\n') + '\n');
  assert(fs.statSync(tp).size > 1024 * 1024, 'fixture should exceed the 1MB tail threshold');
  const r = runHook({ hook_event_name: 'Stop', session_id: sid, cwd, transcript_path: tp });
  assert(leadsWithGlyph(r.codepoints, AWAITING), `expected awaiting on huge transcript, got ${r.shown}`);
});

test('Stop -> awaiting via {sid}.ask flag even with a huge non-question transcript (grade skipped)', () => {
  const cwd = mkWorkspace();
  const sid = 'q-flag-fast';
  writeTitle(cwd, sid, 'Alpha — Beta');
  const askFile = path.join(cwd, '.claude', 'hooks', '.titles', `${sid}.ask`);
  fs.mkdirSync(path.dirname(askFile), { recursive: true });
  fs.writeFileSync(askFile, '1');
  // Large transcript ending in a STATEMENT — the flag fast-path must win, and consume the flag.
  const filler = JSON.stringify(asst([{ type: 'text', text: 'y'.repeat(2000) }]));
  const lines = [];
  for (let i = 0; i < 800; i++) lines.push(filler);
  lines.push(JSON.stringify(asst([{ type: 'text', text: 'All finished. Nothing more to do.' }])));
  const tp = path.join(cwd, `${sid}.jsonl`);
  fs.writeFileSync(tp, lines.join('\n') + '\n');
  const r = runHook({ hook_event_name: 'Stop', session_id: sid, cwd, transcript_path: tp });
  assert(leadsWithGlyph(r.codepoints, AWAITING), `flag fast-path should paint awaiting, got ${r.shown}`);
  assert(!fs.existsSync(askFile), 'the .ask flag should be consumed');
});
console.log();

console.log('PostToolUse no-op:');
test('no title file yet -> emits nothing', () => {
  const cwd = mkWorkspace();
  const r = runHook({ hook_event_name: 'PostToolUse', session_id: 'empty', cwd, tool_name: 'Bash' });
  assert(r.raw === '', `expected no output, got "${r.raw}"`);
});
console.log();

console.log('SessionStart:');
test('fresh session -> idle glyph + "New session" placeholder + injects the FULL rules', () => {
  const cwd = mkWorkspace();
  const r = runHook({ hook_event_name: 'SessionStart', session_id: 'ss-1', cwd, source: 'startup' });
  assert(leadsWithGlyph(r.codepoints, IDLE), `expected idle glyph, got ${r.shown}`);
  assert(/New session/.test(titleText(r.shown)), `expected "New session", got "${titleText(r.shown)}"`);
  assert(r.directive && /DESIGN SCOPE/.test(r.directive), 'SessionStart should inject the full RULES block');
  assert(/Pending-question signal/.test(r.directive), 'RULES should include the pending-question protocol');
  assert(r.directive.includes('ss-1.txt') && r.directive.includes('ss-1.ask'),
    'RULES should name this session\'s title + ask paths');
});

test('resume with an existing title -> prefers it over the placeholder', () => {
  const cwd = mkWorkspace();
  const sid = 'ss-2';
  writeTitle(cwd, sid, 'Auth Flow — Fix Login');
  const r = runHook({ hook_event_name: 'SessionStart', session_id: sid, cwd, source: 'resume' });
  assert(titleText(r.shown) === 'Auth Flow — Fix Login', `expected existing title, got "${titleText(r.shown)}"`);
});

test('compact source re-injects the FULL rules (a squeezed context re-learns them)', () => {
  const cwd = mkWorkspace();
  const r = runHook({ hook_event_name: 'SessionStart', session_id: 'ss-3', cwd, source: 'compact' });
  assert(r.directive && /DESIGN SCOPE/.test(r.directive), 'compact SessionStart should re-inject RULES');
});
console.log();

console.log('Dedupe (user-level copy stands down when a project copy exists):');
const { shouldDefer } = require(HOOK);

test('project copy never defers (selfDir is not the home hooks dir)', () => {
  const cwd = mkWorkspace();
  assert(
    shouldDefer(cwd, path.join(cwd, '.claude', 'hooks'), path.join(cwd, '.claude', 'hooks', 'terminal-title.js'),
      path.join(cwd, 'FAKE-HOME', '.claude', 'hooks')) === false,
    'a project-level copy must never defer'
  );
});

test('user-level copy defers when the project ships its own copy', () => {
  const cwd = mkWorkspace();
  const projHook = path.join(cwd, '.claude', 'hooks', 'terminal-title.js');
  fs.mkdirSync(path.dirname(projHook), { recursive: true });
  fs.writeFileSync(projHook, '// project copy');
  const homeHooks = path.join(cwd, 'FAKE-HOME', '.claude', 'hooks');
  assert(
    shouldDefer(cwd, homeHooks, path.join(homeHooks, 'terminal-title.js'), homeHooks) === true,
    'the user-level copy must defer to a project copy'
  );
});

test('user-level copy does NOT defer when the project has no copy', () => {
  const cwd = mkWorkspace();
  const homeHooks = path.join(cwd, 'FAKE-HOME', '.claude', 'hooks');
  assert(
    shouldDefer(cwd, homeHooks, path.join(homeHooks, 'terminal-title.js'), homeHooks) === false,
    'with no project copy, the user-level copy must keep working'
  );
});
console.log();

console.log('Awaiting bell (a 2nd BEL rings the gold tab — Stop prose-question only):');
function belCount(r) {
  return r.json && r.json.terminalSequence ? r.json.terminalSequence.split('\x07').length - 1 : -1;
}
test('Stop idle -> single BEL (no ring)', () => {
  const cwd = mkWorkspace();
  const sid = 'bel-idle';
  writeTitle(cwd, sid, 'Alpha — Beta');
  const r = runHook({ hook_event_name: 'Stop', session_id: sid, cwd });
  assert(belCount(r) === 1, `expected 1 BEL, got ${belCount(r)}`);
});
test('Stop awaiting (ends in "?") -> two BELs (ring)', () => {
  const r = stopWithTranscript(mkWorkspace(), 'bel-ask', [
    asst([{ type: 'text', text: 'Proceed?' }]),
  ]);
  assert(belCount(r) === 2, `expected 2 BELs, got ${belCount(r)}`);
});
test('Notification -> single BEL (CC already rang its own bell)', () => {
  const cwd = mkWorkspace();
  const sid = 'bel-notif';
  writeTitle(cwd, sid, 'Alpha — Beta');
  const r = runHook({ hook_event_name: 'Notification', session_id: sid, cwd });
  assert(belCount(r) === 1, `expected 1 BEL, got ${belCount(r)}`);
});
console.log();

console.log('Flush-race guard (inspectLastResponse.suspectRace — race-proof grading under transcript-flush lag):');

// Unit-test the detector directly (require works because the hook guards its stdin drive behind
// require.main === module and exports these). suspectRace is what makes handle re-read a few times
// before grading, so a turn that really ended on '?' isn't painted idle off a stale earlier block.
const { inspectLastResponse } = require(HOOK);

test('race: newest on-disk block is text-less (tool_use/thinking) after a statement -> suspectRace, not ended', () => {
  const cwd = mkWorkspace();
  const tp = writeTranscript(cwd, 'race', [
    asst([{ type: 'text', text: 'Working on the extraction change:' }]),
    asst([{ type: 'tool_use', name: 'Edit', input: {} }]),
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '...' }] } },
  ]);
  const q = inspectLastResponse(tp);
  assert(q.ends === false && q.suspectRace === true, `expected {ends:false, suspectRace:true}, got ${JSON.stringify(q)}`);
});

test('after the "?" text flushes in as the newest block -> ends:true', () => {
  const cwd = mkWorkspace();
  const tp = writeTranscript(cwd, 'race-flushed', [
    asst([{ type: 'text', text: 'Working on the extraction change:' }]),
    asst([{ type: 'tool_use', name: 'Edit', input: {} }]),
    asst([{ type: 'text', text: 'Want me to apply it?' }]),
  ]);
  const q = inspectLastResponse(tp);
  assert(q.ends === true, `expected ends:true, got ${JSON.stringify(q)}`);
});

test('fully-flushed statement (newest block has text, no "?") -> not ended, no race suspected (zero-delay path)', () => {
  const cwd = mkWorkspace();
  const tp = writeTranscript(cwd, 'flushed-stmt', [
    asst([{ type: 'text', text: 'Done. The fix is applied.' }]),
  ]);
  const q = inspectLastResponse(tp);
  assert(q.ends === false && q.suspectRace === false, `expected {ends:false, suspectRace:false}, got ${JSON.stringify(q)}`);
});

test('race: prior turn ended on "?", a NEW user prompt followed, current-turn text not flushed -> suspectRace, not ended', () => {
  // The exact stuck-◐ bug: a pure-text statement turn graded ◐ awaiting off the PREVIOUS turn's "?"
  // because its own final text had not flushed to the JSONL yet. Walking back must stop at the real
  // user prompt and flag a race — NOT fall through to the stale "?" block one turn older.
  const cwd = mkWorkspace();
  const tp = writeTranscript(cwd, 'stale-q-race', [
    asst([{ type: 'text', text: 'Want me to drop a deploy-cca.bat for the zero-typing path?' }]),
    { type: 'user', message: { role: 'user', content: 'nah i dont think theres a need for that' } },
    // the current turn's assistant reply has NOT flushed yet — nothing after the user prompt
  ]);
  const q = inspectLastResponse(tp);
  assert(q.ends === false && q.suspectRace === true, `stale-'?' after a new user prompt must be a race, not ends:true; got ${JSON.stringify(q)}`);
});
console.log();

console.log('Parenthetical closing question (fallback regex tolerates one trailing aside):');

// A closing question followed by a single parenthetical aside ("...option 2? (I lean 2.)") is a common
// shape and IS a blocking question — the fallback regex allows one trailing (...) group after the '?'.
// These guard both directions: the aside cases must grade ends:true, and a plain statement ending in
// ')' / a mid-message rhetorical '?' must still grade ends:false (the widening added no false positives).
test('question then a trailing parenthetical aside -> ends:true', () => {
  const cwd = mkWorkspace();
  const tp = writeTranscript(cwd, 'paren-aside', [
    asst([{ type: 'text', text: 'How should we handle it? (I lean option 2.)' }]),
  ]);
  const q = inspectLastResponse(tp);
  assert(q.ends === true, `a question + trailing (aside) should grade ends:true, got ${JSON.stringify(q)}`);
});

test('question fully wrapped in parens -> ends:true', () => {
  const cwd = mkWorkspace();
  const tp = writeTranscript(cwd, 'paren-wrap', [
    asst([{ type: 'text', text: '(So how should we handle it?)' }]),
  ]);
  const q = inspectLastResponse(tp);
  assert(q.ends === true, `a parenthesized question should grade ends:true, got ${JSON.stringify(q)}`);
});

test('plain statement ending in a paren -> ends:false (no false positive)', () => {
  const cwd = mkWorkspace();
  const tp = writeTranscript(cwd, 'paren-stmt', [
    asst([{ type: 'text', text: 'I updated the file (finally).' }]),
  ]);
  const q = inspectLastResponse(tp);
  assert(q.ends === false, `a statement ending in ")" must NOT grade as a question, got ${JSON.stringify(q)}`);
});

test('mid-message rhetorical "?" then a closing statement -> ends:false (no false positive)', () => {
  const cwd = mkWorkspace();
  const tp = writeTranscript(cwd, 'paren-rhetorical', [
    asst([{ type: 'text', text: 'I asked: is this right? Then I fixed it and moved on.' }]),
  ]);
  const q = inspectLastResponse(tp);
  assert(q.ends === false, `a mid-message "?" must NOT grade as a closing question, got ${JSON.stringify(q)}`);
});
console.log();

console.log('Sign-off tolerance (a short trailing sign-off line after a question still grades awaiting):');

test('question then a "Let me know." sign-off line -> ends:true via signoff', () => {
  const cwd = mkWorkspace();
  const tp = writeTranscript(cwd, 'signoff-basic', [
    asst([{ type: 'text', text: 'Which option do you prefer?\n\nLet me know.' }]),
  ]);
  const q = inspectLastResponse(tp);
  assert(q.ends === true && q.via === 'signoff', `expected {ends:true, via:'signoff'}, got ${JSON.stringify(q)}`);
});

test("direct closing question reports via:'qtail'", () => {
  const cwd = mkWorkspace();
  const tp = writeTranscript(cwd, 'signoff-qtail', [
    asst([{ type: 'text', text: 'Which option do you prefer?' }]),
  ]);
  const q = inspectLastResponse(tp);
  assert(q.ends === true && q.via === 'qtail', `expected via:'qtail', got ${JSON.stringify(q)}`);
});

test('same-line trailing statement ("…? Done.") stays ends:false (rhetorical shape)', () => {
  const cwd = mkWorkspace();
  const tp = writeTranscript(cwd, 'signoff-sameline', [
    asst([{ type: 'text', text: 'Want me to proceed? Done.' }]),
  ]);
  const q = inspectLastResponse(tp);
  assert(q.ends === false, `a same-line trailer must NOT count as a sign-off, got ${JSON.stringify(q)}`);
});

test('question followed by a list is NOT a sign-off (elaboration stays idle)', () => {
  const cwd = mkWorkspace();
  const tp = writeTranscript(cwd, 'signoff-list', [
    asst([{ type: 'text', text: 'Which one?\n- option A\n- option B' }]),
  ]);
  const q = inspectLastResponse(tp);
  assert(q.ends === false, `list lines must not count as sign-offs, got ${JSON.stringify(q)}`);
});

test('long trailing line (>48 chars) is NOT a sign-off', () => {
  const cwd = mkWorkspace();
  const tp = writeTranscript(cwd, 'signoff-long', [
    asst([{ type: 'text', text: 'Which one?\nThis trailing explanation line is definitely much longer than the cap allows.' }]),
  ]);
  const q = inspectLastResponse(tp);
  assert(q.ends === false, `a long trailer must not count as a sign-off, got ${JSON.stringify(q)}`);
});

test('two trailing statement lines are NOT tolerated (one sign-off line max)', () => {
  const cwd = mkWorkspace();
  const tp = writeTranscript(cwd, 'signoff-two', [
    asst([{ type: 'text', text: 'Which one?\nDone with part A.\nLet me know.' }]),
  ]);
  const q = inspectLastResponse(tp);
  assert(q.ends === false, `two trailing lines must not be tolerated, got ${JSON.stringify(q)}`);
});

test('the graded message\'s model id is captured for per-model diagnostics', () => {
  const cwd = mkWorkspace();
  const tp = writeTranscript(cwd, 'signoff-model', [
    { type: 'assistant', message: { role: 'assistant', model: 'test-model', content: [{ type: 'text', text: 'Ship it?' }] } },
  ]);
  const q = inspectLastResponse(tp);
  assert(q.model === 'test-model', `expected model 'test-model', got ${JSON.stringify(q)}`);
});

test('BEHAVIORAL: Stop -> awaiting + ring when the turn ends question-then-sign-off', () => {
  const r = stopWithTranscript(mkWorkspace(), 'signoff-stop', [
    { type: 'user', message: { role: 'user', content: 'go' } },
    asst([{ type: 'text', text: 'Deploy now or wait?\n\nReady when you are.' }]),
  ]);
  assert(leadsWithGlyph(r.codepoints, AWAITING), `expected awaiting glyph, got ${r.shown}`);
  assert(belCount(r) === 2, `expected the gold-tab ring (2 BELs), got ${belCount(r)}`);
});

test('BEHAVIORAL: Stop tolerates a transcript_path that is a directory (grade error -> idle, exit 0)', () => {
  const cwd = mkWorkspace();
  const sid = 'grade-err';
  writeTitle(cwd, sid, 'Alpha — Beta');
  const r = runHook({ hook_event_name: 'Stop', session_id: sid, cwd, transcript_path: cwd });
  assert(leadsWithGlyph(r.codepoints, IDLE), `a failed grade must fall back to idle, got ${r.shown}`);
});
console.log();

console.log('Deferred flag-turn grade (--post-grade child logs a StopDiag line):');

test('child grades an EXISTING transcript and appends StopDiag (TDZ regression guard)', () => {
  // The child dispatch runs during module evaluation; a module-level const referenced by the
  // grade (the old top-level QTAIL) would still be in its temporal dead zone on exactly this
  // path — and only when the transcript EXISTS (a missing one hits an await first, letting
  // evaluation finish). This drives the real child synchronously and requires the log line.
  const cwd = mkWorkspace();
  const titlesDir = path.join(cwd, '.claude', 'hooks', '.titles');
  fs.mkdirSync(titlesDir, { recursive: true });
  const tp = writeTranscript(cwd, 'post-grade', [
    { type: 'user', message: { role: 'user', content: 'go' } },
    { type: 'assistant', message: { role: 'assistant', model: 'test-model', content: [{ type: 'text', text: 'Deploy now or wait?\n\nReady when you are.' }] } },
  ]);
  const payload = JSON.stringify({ sid: 'pg-child', dir: titlesDir, transcriptPath: tp, title: 'Alpha — Beta' });
  execFileSync(process.execPath, [HOOK, '--post-grade', payload], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { CLAUDE_TITLE_DEBUG: '1' }),
  });
  const log = fs.readFileSync(path.join(titlesDir, '_debug.log'), 'utf8');
  const diagLines = log.split('\n').filter(l => l.trimStart().split(/\s+/)[1] === 'StopDiag');
  assert(diagLines.length === 1, `expected exactly one StopDiag line, got ${diagLines.length}`);
  assert(/ask=1 qmark=1 via=signoff/.test(diagLines[0]), `expected qmark=1 via=signoff, got: ${diagLines[0]}`);
  assert(/model=test-model/.test(diagLines[0]), `expected model=test-model, got: ${diagLines[0]}`);
});

test('debug OFF -> the flag fast-path spawns no child and the .titles dir stays log-free', () => {
  const cwd = mkWorkspace();
  const sid = 'no-debug';
  writeTitle(cwd, sid, 'Alpha — Beta');
  const askFile = path.join(cwd, '.claude', 'hooks', '.titles', `${sid}.ask`);
  fs.writeFileSync(askFile, '1');
  const env = Object.assign({}, process.env);
  delete env.CLAUDE_TITLE_DEBUG;
  const raw = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: sid, cwd }),
    encoding: 'utf8', env,
  });
  const seq = JSON.parse(raw).terminalSequence || '';
  assert(seq.includes(String.fromCodePoint(0x25d0)), 'flag turn must still paint awaiting with debug off');
  assert(!fs.existsSync(path.join(cwd, '.claude', 'hooks', '.titles', '_debug.log')),
    'no debug log may appear when CLAUDE_TITLE_DEBUG is unset');
});
console.log();

console.log("Lexical solicitation rescue (solicitsReply — the '?'-less offer slip):");
const { solicitsReply } = require(HOOK);

test("declarative offer closer ('Say the word…') -> solicits", () => {
  assert(solicitsReply("Both fixes are in and verified. Say the word and I'll apply them.") === true,
    'the 2026-07-08 real-world miss must fire the lexicon');
});
test("statement-form offer ('Want me to…' with no '?') -> solicits", () => {
  assert(solicitsReply('All three edits are staged. Want me to push.') === true,
    'question-shaped offers missing their ? must fire');
});
test('courtesy sign-off after completed work -> does NOT solicit', () => {
  assert(solicitsReply('Published 1.0.201 and pushed the tag. Let me know if anything breaks.') === false,
    "weak phrases ('let me know') must stay log-only, never enforce");
});
test('plain completion report -> does NOT solicit', () => {
  assert(solicitsReply('All tests green; ledger updated and memory now reflects same-day parity.') === false,
    'a normal statement ending must never fire');
});
test("closing line WITH a '?' -> lexicon stands down (the question grade owns it)", () => {
  assert(solicitsReply('Want me to push?') === false,
    'the lexicon must never second-guess a line the qtail/signoff grade already judges');
});
test('offer phrase mid-message but a statement close -> does NOT solicit', () => {
  assert(solicitsReply('Earlier I asked whether you want me to continue.\nAll wrapped up.') === false,
    'only the closing sentence of the final line may fire');
});
test('imperative green-light close -> solicits; past-tense mention does not', () => {
  assert(solicitsReply("Green-light it and I'll publish.") === true, 'sentence-initial imperative must fire');
  assert(solicitsReply('Andrew green-lighted the batch this evening.') === false,
    'a recap that merely mentions green-lighting must not fire');
});
test('BEHAVIORAL: Stop on a declarative-offer close -> awaiting ◐ + ring (fails on pre-lexicon grade)', () => {
  const r = stopWithTranscript(mkWorkspace(), 'lex-offer', [
    { type: 'user', message: { role: 'user', content: 'ok apply them' } },
    asst([{ type: 'text', text: "Both fixes are in and verified. Say the word and I'll publish." }]),
  ]);
  assert(leadsWithGlyph(r.codepoints, AWAITING), `expected awaiting glyph, got: ${r.shown}`);
  assert(belCount(r) === 2, `lex-rescued awaiting must ring the gold tab (2 BELs), got ${belCount(r)}`);
});
test('BEHAVIORAL: Stop on a courtesy sign-off close -> stays idle (no false-◐)', () => {
  const r = stopWithTranscript(mkWorkspace(), 'lex-courtesy', [
    asst([{ type: 'text', text: 'Done and verified. Let me know if anything breaks.' }]),
  ]);
  assert(leadsWithGlyph(r.codepoints, IDLE), `expected idle glyph, got: ${r.shown}`);
});
console.log();

console.log('Owner-project keying (CLAUDE_PROJECT_DIR beats the live cwd — the mid-session-cd fix):');

test('.titles state stays under the OWNER project when cwd has wandered elsewhere', () => {
  const owner = mkWorkspace();
  const cdTarget = mkWorkspace();
  const sid = 'owner-keyed';
  writeTitle(owner, sid, 'Alpha — Beta');
  const r = runHook(
    { hook_event_name: 'PostToolUse', session_id: sid, cwd: cdTarget },
    { CLAUDE_PROJECT_DIR: owner }
  );
  assert(leadsWithGlyph(r.codepoints, WORKING), `expected working glyph, got: ${r.shown}`);
  assert(titleText(r.shown) === 'Alpha — Beta', `expected the owner project's title, got: ${r.shown}`);
});
test('no CLAUDE_PROJECT_DIR (older Claude Code) -> falls back to cwd keying, no regression', () => {
  const cwd = mkWorkspace();
  const sid = 'cwd-fallback';
  writeTitle(cwd, sid, 'Alpha — Beta');
  const r = runHook({ hook_event_name: 'PostToolUse', session_id: sid, cwd });
  assert(leadsWithGlyph(r.codepoints, WORKING), `expected working glyph, got: ${r.shown}`);
});

// Stand-down keying needs the hook to BE the user-level copy: install it into a fake home and point
// os.homedir() there (USERPROFILE on win32, HOME elsewhere) so selfDir === homeHooksDir inside the child.
function installFakeUserCopy() {
  const fakeHome = mkWorkspace();
  const homeHooks = path.join(fakeHome, '.claude', 'hooks');
  fs.mkdirSync(homeHooks, { recursive: true });
  fs.copyFileSync(HOOK, path.join(homeHooks, 'terminal-title.js'));
  fs.copyFileSync(
    path.join(path.dirname(HOOK), 'terminal-title.directive.md'),
    path.join(homeHooks, 'terminal-title.directive.md')
  );
  return { fakeHome, userCopy: path.join(homeHooks, 'terminal-title.js') };
}
function copyShippingRepo() {
  const repo = mkWorkspace();
  const hooksDir = path.join(repo, '.claude', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(path.join(hooksDir, 'terminal-title.js'), '// managed project copy (placeholder)\n');
  return repo;
}

test('GUARDRAIL: user-level copy still paints after a cd INTO a copy-shipping repo (owner project elsewhere)', () => {
  const { fakeHome, userCopy } = installFakeUserCopy();
  const owner = mkWorkspace();
  const cdTarget = copyShippingRepo();
  const sid = 'cd-into-repo';
  writeTitle(owner, sid, 'Alpha — Beta');
  const r = runHook(
    { hook_event_name: 'PostToolUse', session_id: sid, cwd: cdTarget },
    { CLAUDE_PROJECT_DIR: owner, USERPROFILE: fakeHome, HOME: fakeHome },
    userCopy
  );
  // Pre-fix keying (cwd) deferred here -> empty output and a permanently stale tab glyph.
  assert(r.raw !== '', 'the user-level copy must NOT stand down for a repo whose settings are not loaded');
  assert(leadsWithGlyph(r.codepoints, WORKING), `expected working glyph, got: ${r.shown}`);
});
test('user-level copy still defers when the OWNER project itself ships the managed copy', () => {
  const { fakeHome, userCopy } = installFakeUserCopy();
  const owner = copyShippingRepo();
  const sid = 'dogfood-defer';
  writeTitle(owner, sid, 'Alpha — Beta');
  const r = runHook(
    { hook_event_name: 'PostToolUse', session_id: sid, cwd: owner },
    { CLAUDE_PROJECT_DIR: owner, USERPROFILE: fakeHome, HOME: fakeHome },
    userCopy
  );
  assert(r.raw === '', 'the project copy owns this session; the user-level copy must stay silent');
});
console.log();

console.log('Harness-contract canary (debug-only platform-change alarm):');
test('missing CLAUDE_PROJECT_DIR -> debug log carries contract=degraded', () => {
  const cwd = mkWorkspace();
  const sid = 'canary-degraded';
  writeTitle(cwd, sid, 'Alpha — Beta');
  runHook({ hook_event_name: 'PostToolUse', session_id: sid, cwd }, { CLAUDE_TITLE_DEBUG: '1' });
  const log = fs.readFileSync(path.join(cwd, '.claude', 'hooks', '.titles', '_debug.log'), 'utf8');
  assert(/contract=degraded\(CLAUDE_PROJECT_DIR\)/.test(log),
    `expected contract=degraded(CLAUDE_PROJECT_DIR) in debug log, got: ${log.trim().split('\n').pop()}`);
});
test('full contract present -> no degraded marker', () => {
  const cwd = mkWorkspace();
  const sid = 'canary-clean';
  writeTitle(cwd, sid, 'Alpha — Beta');
  runHook(
    { hook_event_name: 'PostToolUse', session_id: sid, cwd },
    { CLAUDE_TITLE_DEBUG: '1', CLAUDE_PROJECT_DIR: cwd }
  );
  const log = fs.readFileSync(path.join(cwd, '.claude', 'hooks', '.titles', '_debug.log'), 'utf8');
  assert(!/contract=degraded/.test(log), `no degraded marker expected, got: ${log.trim().split('\n').pop()}`);
});
console.log();

console.log('Shipped settings template (cd-proof hook registrations):');
test('every .claude/hooks command in the shipped settings.json is CLAUDE_PROJECT_DIR-anchored', () => {
  const shipped = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '.claude', 'settings.json'), 'utf8')
  );
  for (const matchers of Object.values(shipped.hooks || {})) {
    for (const matcher of matchers) {
      for (const h of matcher.hooks || []) {
        if (/\.claude\/hooks\//.test(h.command)) {
          assert(
            h.command.includes('${CLAUDE_PROJECT_DIR:-.}'),
            `cwd-relative hook command would break on mid-session cd: ${h.command}`
          );
        }
      }
    }
  }
});
console.log();

// ============================================================================
// --turn-watch cancel watchdog (the user-interrupt rescue). Ported from the
// scratchpad `watchdog-test.sh` 12-case suite (preserved at
// ~/.claude/hooks/title-test-harnesses/). Drives the REAL detached watchdog
// child with sessionPid INJECTED, so it never exercises `--find` (console
// identity) — that path is only reachable against a real claude.exe and is
// covered by the live e2e probe (e2e-live-idle.js), not here.
//
// WINDOWS-ONLY: the CPU-idle rescue samples via title-painter-v4.exe (a .NET
// AttachConsole/TotalProcessorTime helper the watchdog lazy-compiles with the
// in-box csc). Off win32 there is no painter, so `sampleCpu` returns null and
// the CPU path can't fire — the suite is skipped there.
//
// TRAP 1 (co-tenancy): a session can't be tested from within itself. We sidestep
// it entirely by injecting a FAKE isolated node process as sessionPid.
// TRAP 2 (bursty fakes): a short CPU window can't see a 1/sec burst, so the busy
// fake must be CONTINUOUSLY busy (~15ms of every 100ms ≈ 15%), like a real
// thinking claude — never a periodic spike.
// ============================================================================
console.log('Cancel watchdog (--turn-watch rescue, Windows-only):');
if (process.platform !== 'win32') {
  console.log('  (skipped — not win32; the painter-backed CPU sampler is Windows-only)');
} else if (process.env.SKIP_WATCHDOG_TESTS === '1') {
  console.log('  (skipped — SKIP_WATCHDOG_TESTS=1)');
} else {
  const { spawn } = require('child_process');

  const wcwd = mkWorkspace();
  const wsid = 'watchdog-selftest';
  const wdir = path.join(wcwd, '.claude', 'hooks', '.titles');
  fs.mkdirSync(wdir, { recursive: true });
  fs.writeFileSync(path.join(wdir, `${wsid}.txt`), 'canceled title');
  const OLD = new Date(Date.now() - 10000).toISOString(); // a "stale" (>2.5s) prompt timestamp
  const watchProcs = [];
  let wIdlePid = 0, wBusyPid = 0, wd3 = null, wd4 = null, wd5 = null;

  // Synchronous sleep (the test runner is synchronous; the watchdog runs in a
  // separate process and communicates via files, so a blocked event loop is fine).
  function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  function isAlive(pid) { try { process.kill(pid, 0); return true; } catch (_) { return false; } }
  function waitDead(pid, timeoutMs) {
    const d = Date.now() + timeoutMs;
    while (Date.now() < d) { if (!isAlive(pid)) return true; sleepSync(200); }
    return false;
  }
  function wglyph() {
    try { return fs.readFileSync(path.join(wdir, `${wsid}.glyph`), 'utf8'); } catch (_) { return ''; }
  }
  function waitWGlyph(prefix, timeoutS) {
    const d = Date.now() + timeoutS * 1000;
    while (Date.now() < d) { if (wglyph().startsWith(prefix)) return true; sleepSync(300); }
    return false;
  }
  // Write {sid}.<ext> state files, e.g. setState({ glyph: 'working|UserPromptSubmit', watch: 'n1' }).
  function setState(obj) {
    for (const [ext, val] of Object.entries(obj)) fs.writeFileSync(path.join(wdir, `${wsid}.${ext}`), val);
  }
  function spawnFake(kind) {
    const code = kind === 'busy'
      ? 'setInterval(()=>{const t=Date.now();while(Date.now()-t<15){}},100)' // continuous ~15% of a core
      : 'setTimeout(()=>{},600000)';                                          // parked/idle (~0%)
    const c = spawn(process.execPath, ['-e', code], { stdio: 'ignore' });
    watchProcs.push(c);
    return c.pid;
  }
  function mkWTranscript(tag, kind) {
    const tp = path.join(wdir, `${wsid}-${tag}.jsonl`);
    let line;
    if (kind === 'prompt') {
      line = JSON.stringify({ type: 'user', timestamp: OLD, message: { role: 'user', content: 'whats the history of italy?' } });
    } else if (kind === 'marker') {
      line = JSON.stringify({ type: 'assistant', timestamp: OLD, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } })
        + '\n' + JSON.stringify({ type: 'user', timestamp: OLD, message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } });
    } else { // assistant / tool_use tail
      line = JSON.stringify({ type: 'assistant', timestamp: OLD, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } });
    }
    fs.writeFileSync(tp, line + '\n');
    return tp;
  }
  // Spawn the detached watchdog with sessionPid injected (skips --find console resolution).
  function runWatch(transcript, pid, nonce) {
    const payload = JSON.stringify({
      sid: wsid, dir: wdir, file: path.join(wdir, `${wsid}.txt`), cwd: wcwd,
      nonce, transcript, ppid: pid, sessionPid: pid,
    });
    const c = spawn(process.execPath, [HOOK, '--turn-watch', payload], { detached: true, stdio: 'ignore' });
    watchProcs.push(c);
    return c;
  }

  // --- 1. marker tail -> instant rescue (no CPU needed), stale .ask cleared, self-exit ---
  let wd1 = null;
  test('watchdog: marker tail -> rescued to idle (the tool-phase cancel path)', () => {
    wIdlePid = spawnFake('idle');
    sleepSync(300);
    setState({ glyph: 'working|UserPromptSubmit', ask: '1', watch: 'n1' });
    wd1 = runWatch(mkWTranscript('t1', 'marker'), wIdlePid, 'n1');
    assert(waitWGlyph('idle|TurnWatch', 8), `marker cancel should rescue to idle|TurnWatch, glyph="${wglyph()}"`);
  });
  test("watchdog: the cancel's stale {sid}.ask is cleared by the rescue", () => {
    assert(!fs.existsSync(path.join(wdir, `${wsid}.ask`)), 'a leftover .ask flag must be cleared on rescue');
  });
  test('watchdog: exits after the marker rescue', () => {
    assert(waitDead(wd1.pid, 4000), 'the watchdog should self-exit once it has rescued');
  });

  // --- 2. stalled prompt + IDLE parent -> CPU-idle rescue ---
  test('watchdog: stalled prompt + idle parent -> CPU-idle rescue (thinking-phase cancel)', () => {
    setState({ glyph: 'working|UserPromptSubmit', watch: 'n2' });
    runWatch(mkWTranscript('t2', 'prompt'), wIdlePid, 'n2');
    assert(waitWGlyph('idle|TurnWatch', 25), `an idle parent under a stalled prompt should rescue via CPU, glyph="${wglyph()}"`);
  });

  // --- 3. stalled prompt + BUSY parent (live thinking) -> NO rescue; exits on conclude ---
  test('watchdog: stalled prompt + BUSY parent -> never rescued (a live turn burns CPU)', () => {
    wBusyPid = spawnFake('busy');
    sleepSync(300);
    setState({ glyph: 'working|UserPromptSubmit', watch: 'n3' });
    wd3 = runWatch(mkWTranscript('t3', 'prompt'), wBusyPid, 'n3');
    sleepSync(15000);
    assert(wglyph() === 'working|UserPromptSubmit', `a busy parent must not be rescued, glyph="${wglyph()}"`);
  });
  test("watchdog: exits when the glyph concludes (Stop) and does NOT overwrite Stop's paint", () => {
    setState({ glyph: 'idle|Stop' }); // simulate Stop concluding the turn
    assert(waitDead(wd3.pid, 4000), 'the watchdog should stand down once the glyph concludes');
    assert(wglyph() === 'idle|Stop', `Stop's own paint must be left intact, glyph="${wglyph()}"`);
  });

  // --- 4. assistant/tool_use tail + IDLE parent (silent Bash / open dialog) -> NO CPU rescue ---
  test('watchdog: assistant tail + idle parent -> never CPU-rescued (a silent tool looks the same)', () => {
    setState({ glyph: 'working|PostToolUse', watch: 'n4' });
    wd4 = runWatch(mkWTranscript('t4', 'assistant'), wIdlePid, 'n4');
    sleepSync(15000);
    assert(wglyph() === 'working|PostToolUse', `an assistant/tool tail must never CPU-rescue, glyph="${wglyph()}"`);
  });
  test('watchdog: exits on a superseded nonce', () => {
    setState({ watch: 'n4-superseded' });
    assert(waitDead(wd4.pid, 4000), 'the watchdog should stand down when the next turn supersedes its nonce');
  });

  // --- 5. dead parent -> watchdog exits without painting ---
  test('watchdog: dead session pid -> exits without painting', () => {
    const dead = spawnFake('idle');
    sleepSync(300);
    try { process.kill(dead); } catch (_) { /* ignore */ }
    assert(waitDead(dead, 4000), 'the fake session process should be dead before the watch starts');
    setState({ glyph: 'working|UserPromptSubmit', watch: 'n5' });
    wd5 = runWatch(mkWTranscript('t5', 'prompt'), dead, 'n5');
    assert(waitDead(wd5.pid, 5000), 'the watchdog should exit when the session pid is gone');
    assert(wglyph() === 'working|UserPromptSubmit', `there must be no paint for a dead parent, glyph="${wglyph()}"`);
  });

  // --- 6. UPS spawns the watchdog + writes the {sid}.watch nonce ---
  test('watchdog: UserPromptSubmit spawns the watchdog and writes the {sid}.watch nonce', () => {
    try { fs.unlinkSync(path.join(wdir, `${wsid}.watch`)); } catch (_) { /* ignore */ }
    const tp = mkWTranscript('t6', 'prompt');
    const env = { ...process.env, CLAUDE_PROJECT_DIR: wcwd };
    execFileSync(process.execPath, [HOOK], {
      input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: wsid, cwd: wcwd, prompt: 'hi', transcript_path: tp }),
      encoding: 'utf8', env,
    });
    assert(fs.existsSync(path.join(wdir, `${wsid}.watch`)), 'UserPromptSubmit should write the {sid}.watch nonce');
    setState({ watch: 'superseded' }); // stand down the real watchdog UPS just spawned
    sleepSync(1500);
  });

  // Reap every fake + watchdog process this suite spawned, and stand down any straggler.
  setState({ watch: 'final-cleanup' });
  sleepSync(500);
  for (const c of watchProcs) { try { process.kill(c.pid); } catch (_) { /* already gone */ } }
}
console.log();


// Cleanup
for (const dir of tempDirs) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
}

console.log('============================================================');
if (failed === 0) {
  console.log(`ALL TESTS PASSED (${passed} tests)`);
} else {
  console.log(`TESTS FAILED: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
