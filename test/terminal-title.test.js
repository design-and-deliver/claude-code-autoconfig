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

// Run the real hook with a payload; returns { raw, json, shown, codepoints, directive }
function runHook(payload) {
  const raw = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
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

test('normal turn injects the SHIFT directive (not the COMMAND one)', () => {
  const cwd = mkWorkspace();
  const r = runHook({ hook_event_name: 'UserPromptSubmit', session_id: 's', cwd, prompt: 'do a thing' });
  assert(/SCOPE, use-case, or sub-function SHIFTS/.test(r.directive), 'expected SHIFT directive text');
  assert(!/command NAME is an implementation detail/.test(r.directive), 'SHIFT turn must not use COMMAND text');
});

test('slash-command turn injects the COMMAND directive (not the SHIFT one)', () => {
  const cwd = mkWorkspace();
  const r = runHook({ hook_event_name: 'UserPromptSubmit', session_id: 'c', cwd, prompt: '/bundle-prod ship' });
  assert(/command NAME is an implementation detail/.test(r.directive), 'expected COMMAND directive text');
  assert(!/sub-function SHIFTS/.test(r.directive), 'COMMAND turn must not use SHIFT text');
});

test('injected directive appends the PENDING block (end blocking questions on "?")', () => {
  const cwd = mkWorkspace();
  const shift = runHook({ hook_event_name: 'UserPromptSubmit', session_id: 'p1', cwd, prompt: 'do a thing' });
  const command = runHook({ hook_event_name: 'UserPromptSubmit', session_id: 'p2', cwd, prompt: '/gls show it' });
  assert(/ends with a question mark/.test(shift.directive), 'SHIFT directive should include the PENDING block');
  assert(/ends with a question mark/.test(command.directive), 'COMMAND directive should include the PENDING block');
});

test("injected directive names this session's {sid}.ask flag path + instructs writing it", () => {
  const cwd = mkWorkspace();
  const sid = 'ask-path';
  const r = runHook({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd, prompt: 'do a thing' });
  assert(r.directive.includes(`${sid}.ask`), "directive should name this session's .ask path");
  assert(/Write the flag file/.test(r.directive), 'directive should instruct writing the .ask flag');
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
console.log();

console.log('PostToolUse no-op:');
test('no title file yet -> emits nothing', () => {
  const cwd = mkWorkspace();
  const r = runHook({ hook_event_name: 'PostToolUse', session_id: 'empty', cwd, tool_name: 'Bash' });
  assert(r.raw === '', `expected no output, got "${r.raw}"`);
});
console.log();

console.log('SessionStart:');
test('fresh session -> idle glyph + "New session" placeholder', () => {
  const cwd = mkWorkspace();
  const r = runHook({ hook_event_name: 'SessionStart', session_id: 'ss-1', cwd, source: 'startup' });
  assert(leadsWithGlyph(r.codepoints, IDLE), `expected idle glyph, got ${r.shown}`);
  assert(/New session/.test(titleText(r.shown)), `expected "New session", got "${titleText(r.shown)}"`);
});

test('resume with an existing title -> prefers it over the placeholder', () => {
  const cwd = mkWorkspace();
  const sid = 'ss-2';
  writeTitle(cwd, sid, 'Auth Flow — Fix Login');
  const r = runHook({ hook_event_name: 'SessionStart', session_id: sid, cwd, source: 'resume' });
  assert(titleText(r.shown) === 'Auth Flow — Fix Login', `expected existing title, got "${titleText(r.shown)}"`);
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
