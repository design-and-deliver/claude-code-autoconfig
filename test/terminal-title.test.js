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

const { test, assert, summary } = require('./_harness');
const tempDirs = [];

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
  // Budget the WORDING, not the workspace path: the reminder substitutes the title-file path
  // twice, so a total-chars assertion measures mkdtemp. It passed here on a 48-char temp dir
  // (780) and failed on CI's longer one (810) — same wording, different runner.
  const wording = r.directive.split(cwd).join('').length;
  assert(wording < 800, `reminder must stay compact (token guard), got ${wording} chars of wording`);
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
  assert(/'\?'[\s\S]{0,60}last character/.test(r.directive), "reminder should instruct ending on '?'");
  assert(/nothing is solicited, end on a statement/.test(r.directive), 'reminder should carry the inverse (no-signal) rule');
  assert(/DIRECT QUESTION/.test(r.directive), 'reminder should demand the direct-question phrasing');
  assert(/[Dd]eclarative offers?[\s\S]{0,90}count as YES/.test(r.directive), 'reminder should name the declarative-offer failure mode');
  assert(/imperative handoffs?/i.test(r.directive), 'reminder should name the imperative-handoff failure mode');
  assert(/AskUserQuestion/.test(r.directive), 'reminder should route closed choices to the picker');
});

// FRESHNESS: the reminder can only ask "did the scope shift?"; it cannot ask "is the string on
// the tab still true?" unless it SHOWS that string. These pin the arming rule (buried = shown,
// fresh = silent) and the two facts the block must carry.
function seedBurial(cwd, sid, { titleTokens, latest, isoAgeMs }) {
  const dir = path.join(cwd, '.claude', 'hooks', '.titles');
  fs.mkdirSync(dir, { recursive: true });
  const entry = { ts: new Date(Date.now() - isoAgeMs).toISOString(), title: 'Alpha — Beta' };
  if (titleTokens) entry.tokens = titleTokens;
  fs.writeFileSync(path.join(dir, `${sid}.history.jsonl`), `${JSON.stringify(entry)}\n`);
  fs.writeFileSync(path.join(dir, `${sid}.marks.json`), JSON.stringify({ fixed: 60000, latest, n: 10 }));
}

test('a BURIED title is read back to the model, with how buried it is', () => {
  const cwd = mkWorkspace();
  const sid = 'fresh-buried';
  writeTitle(cwd, sid, 'Alpha — Beta');
  const ups = () => runHook({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd, prompt: 'do a thing' });
  // Budget the BLOCK, not the whole injection: every block re-substitutes the title-file path, and
  // that path's length is the temp dir's, so a total-chars assertion measures mkdtemp, not wording.
  const before = ups().directive.length;
  seedBurial(cwd, sid, { titleTokens: 100000, latest: 150000, isoAgeMs: 60 * 1000 });
  const r = ups();
  assert(/Title freshness/.test(r.directive), 'expected the FRESHNESS block once the write is buried');
  assert(r.directive.includes('"Alpha — Beta"'), 'FRESHNESS must quote the CURRENT title verbatim');
  assert(/set 50k tokens ago/.test(r.directive), `expected the measured burial, got: ${r.directive}`);
  assert(/discovery IS a shift/.test(r.directive), 'FRESHNESS must license a mid-task rewrite');
  const grew = r.directive.length - before - cwd.length;
  assert(grew < 400, `FRESHNESS must stay compact (token guard), added ${grew} chars beyond the path`);
});

test('a FRESH title stays silent (no nudge while the write is still in mind)', () => {
  const cwd = mkWorkspace();
  const sid = 'fresh-recent';
  writeTitle(cwd, sid, 'Alpha — Beta');
  seedBurial(cwd, sid, { titleTokens: 100000, latest: 105000, isoAgeMs: 60 * 1000 });
  const r = runHook({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd, prompt: 'do a thing' });
  assert(!/Title freshness/.test(r.directive), 'a 5k-token-old title must not arm FRESHNESS');
});

test('wall-clock arms FRESHNESS when the watermarks are unreadable', () => {
  const cwd = mkWorkspace();
  const sid = 'fresh-clock';
  writeTitle(cwd, sid, 'Alpha — Beta');
  seedBurial(cwd, sid, { titleTokens: 0, latest: 105000, isoAgeMs: 45 * 60 * 1000 });
  const r = runHook({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd, prompt: 'do a thing' });
  assert(/Title freshness/.test(r.directive), 'no usable watermark should fall back to elapsed time');
  assert(/set 45 minutes ago/.test(r.directive), `expected the wall-clock burial, got: ${r.directive}`);
});

test('no history trail at all -> no FRESHNESS (never an estimated figure)', () => {
  const cwd = mkWorkspace();
  const sid = 'fresh-none';
  writeTitle(cwd, sid, 'Alpha — Beta');
  const r = runHook({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd, prompt: 'do a thing' });
  assert(!/Title freshness/.test(r.directive), 'an unmeasurable burial must stay silent');
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

console.log('Title history:');
test('every title change appends one {sid}.history.jsonl line; repeats do not', () => {
  const cwd = mkWorkspace();
  const sid = 'hist';
  const histFile = path.join(cwd, '.claude', 'hooks', '.titles', `${sid}.history.jsonl`);
  writeTitle(cwd, sid, 'Alpha — First context');
  runHook({ hook_event_name: 'PostToolUse', session_id: sid, cwd, tool_name: 'Edit' });
  runHook({ hook_event_name: 'PostToolUse', session_id: sid, cwd, tool_name: 'Edit' });
  let lines = fs.readFileSync(histFile, 'utf8').trim().split('\n');
  assert(lines.length === 1, `unchanged title must not re-append (got ${lines.length} lines)`);
  writeTitle(cwd, sid, 'Alpha — Second context');
  runHook({ hook_event_name: 'PostToolUse', session_id: sid, cwd, tool_name: 'Edit' });
  lines = fs.readFileSync(histFile, 'utf8').trim().split('\n');
  assert(lines.length === 2, `changed title must append (got ${lines.length} lines)`);
  const entries = lines.map(l => JSON.parse(l));
  assert(entries[0].title === 'Alpha — First context', `got "${entries[0].title}"`);
  assert(entries[1].title === 'Alpha — Second context', `got "${entries[1].title}"`);
  assert(entries.every(e => !Number.isNaN(Date.parse(e.ts))), 'each entry needs a parseable ts');
  // No transcript_path in these payloads → the optional tokens watermark must be ABSENT, not 0.
  assert(entries.every(e => !('tokens' in e)), 'no-transcript paints must not stamp a tokens field');
});
console.log();

console.log('/clear advisor (context-size watermarks + break-even advisory):');

// A main-loop assistant transcript entry whose usage sums to exactly `ctx` context tokens.
function usageAsst(ctx, text, extra) {
  return Object.assign({
    type: 'assistant',
    timestamp: new Date().toISOString(),
    message: {
      role: 'assistant', model: 'claude-test',
      content: [{ type: 'text', text: text || 'All set.' }],
      usage: { input_tokens: 10, cache_read_input_tokens: ctx - 10, cache_creation_input_tokens: 0, output_tokens: 5 },
    },
  }, extra || {});
}

function writeUsageTranscript(cwd, name, entries) {
  const file = path.join(cwd, `${name}.jsonl`);
  fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

function seedHistory(cwd, sid, rows) {
  const hf = path.join(cwd, '.claude', 'hooks', '.titles', `${sid}.history.jsonl`);
  fs.mkdirSync(path.dirname(hf), { recursive: true });
  fs.writeFileSync(hf, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  // The advisory's install gate wants token-guard.js beside .titles (user installs lack it);
  // planting it here keeps the silent-case tests proving thresholds, not the gate.
  fs.writeFileSync(path.join(cwd, '.claude', 'hooks', 'token-guard.js'), '// cost tooling marker\n');
  return hf;
}

test('readContextTokens: newest MAIN-LOOP usage wins; sidechains are skipped', () => {
  const { readContextTokens } = require(HOOK);
  const cwd = mkWorkspace();
  const tp = writeUsageTranscript(cwd, 'ctx', [
    { type: 'user', message: { role: 'user', content: 'hi' } },
    usageAsst(50000),
    usageAsst(900000, 'subagent noise', { isSidechain: true }), // newer but not the main loop
  ]);
  assert(readContextTokens(tp) === 50000, `expected 50000, got ${readContextTokens(tp)}`);
  assert(readContextTokens(path.join(cwd, 'missing.jsonl')) === 0, 'missing transcript must read 0');
});

test('a title change stamps the tokens watermark from the transcript', () => {
  const cwd = mkWorkspace();
  const sid = 'stamp';
  const tp = writeUsageTranscript(cwd, 'stamp', [usageAsst(60000)]);
  writeTitle(cwd, sid, 'Alpha — Ledger');
  runHook({ hook_event_name: 'PostToolUse', session_id: sid, cwd, tool_name: 'Edit', transcript_path: tp });
  const lines = fs.readFileSync(path.join(cwd, '.claude', 'hooks', '.titles', `${sid}.history.jsonl`), 'utf8')
    .trim().split('\n').map(l => JSON.parse(l));
  assert(lines.length === 1 && lines[0].tokens === 60000, `expected tokens=60000, got ${JSON.stringify(lines)}`);
});

test('Stop advises /clear once when buried topics exceed 2x fixed overhead', () => {
  const cwd = mkWorkspace();
  const sid = 'adv1';
  writeTitle(cwd, sid, 'Alpha — Three');
  seedHistory(cwd, sid, [
    { ts: '2026-07-18T10:00:00.000Z', title: 'Alpha — One', tokens: 20000 },
    { ts: '2026-07-18T10:20:00.000Z', title: 'Alpha — Two', tokens: 60000 },
    { ts: '2026-07-18T10:40:00.000Z', title: 'Alpha — Three', tokens: 130000 },
  ]);
  const tp = writeUsageTranscript(cwd, 'adv1', [
    { type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: 'go' } },
    usageAsst(150000),
  ]);
  const r = runHook({ hook_event_name: 'Stop', session_id: sid, cwd, transcript_path: tp });
  const msg = r.json.systemMessage || '';
  // dead = 130k − 20k = 110k; pct = 110k/150k ≈ 73%; 2 buried topics — all measured, none guessed.
  assert(msg.includes('/clear'), `advisory missing (systemMessage="${msg}")`);
  assert(msg.includes('~110k'), `dead-tokens figure wrong: "${msg}"`);
  assert(msg.includes('2 earlier topics'), `topic count wrong: "${msg}"`);
  assert(msg.includes('~73%'), `savings pct wrong: "${msg}"`);
  const again = runHook({ hook_event_name: 'Stop', session_id: sid, cwd, transcript_path: tp });
  assert(!again.json.systemMessage, 'the advisory must be one-shot per topic segment');
});

test('Stop stays silent below the 2x threshold', () => {
  const cwd = mkWorkspace();
  const sid = 'adv2';
  writeTitle(cwd, sid, 'Alpha — Two');
  seedHistory(cwd, sid, [
    { ts: '2026-07-18T11:00:00.000Z', title: 'Alpha — One', tokens: 50000 },
    { ts: '2026-07-18T11:20:00.000Z', title: 'Alpha — Two', tokens: 130000 }, // dead 80k ≥ floor, < 2×F
  ]);
  const tp = writeUsageTranscript(cwd, 'adv2', [usageAsst(140000)]);
  const r = runHook({ hook_event_name: 'Stop', session_id: sid, cwd, transcript_path: tp });
  assert(!r.json.systemMessage, `must stay silent below 2x overhead, got "${r.json.systemMessage}"`);
});

test('a watermark shrink (auto-compact) re-bases the advisory window', () => {
  const cwd = mkWorkspace();
  const sid = 'adv3';
  writeTitle(cwd, sid, 'Alpha — Four');
  seedHistory(cwd, sid, [
    { ts: '2026-07-18T12:00:00.000Z', title: 'Alpha — One', tokens: 20000 },
    { ts: '2026-07-18T12:20:00.000Z', title: 'Alpha — Two', tokens: 150000 },
    { ts: '2026-07-18T12:40:00.000Z', title: 'Alpha — Three', tokens: 40000 }, // compact happened
    { ts: '2026-07-18T12:50:00.000Z', title: 'Alpha — Four', tokens: 90000 }, // dead 50k < 2×40k
  ]);
  const tp = writeUsageTranscript(cwd, 'adv3', [usageAsst(100000)]);
  const r = runHook({ hook_event_name: 'Stop', session_id: sid, cwd, transcript_path: tp });
  assert(!r.json.systemMessage, `pre-compact watermarks must not count, got "${r.json.systemMessage}"`);
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
  assert(/CLOSED CHOICE/.test(r.directive) && /AskUserQuestion/.test(r.directive),
    'RULES should route closed choices to the AskUserQuestion picker');
  assert(/OPEN-ENDED/.test(r.directive), 'RULES should keep the open-ended text-question branch');
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

// ---- Title carry-over across a /clear (lineage -> previous session's last title) ----
// recordLineage stamps {sid}.lineage.json{prevSid,source} on a rotation. A same-tab RELAUNCH
// (source 'startup') carries the previous session's last title unconditionally — the tab is still
// that work. A /CLEAR (source 'clear') does NOT carry: the next context could be anything, so the
// tab shows the New-session placeholder until a /continue prompt stamps {sid}.continued and re-arms
// the carry. carriedTitle/displayTitle centralize this, and the carried title must NOT seed the
// file (else BASELINE stops firing and the model can't re-author).
console.log('Title carry-over (lineage):');

function writeLineage(cwd, sid, prevSid, source = 'clear') {
  const file = path.join(cwd, '.claude', 'hooks', '.titles', `${sid}.lineage.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(
    { prevSid, tid: 't-test', source, ts: '2026-07-20T00:00:00.000Z' }));
}

test('post-/clear /continue -> re-arms the carry: stamps {sid}.continued + paints the previous title', () => {
  const cwd = mkWorkspace();
  const sid = 'carry-1', prevSid = 'carry-prev-1';
  writeTitle(cwd, prevSid, 'Title Hooks — Carry Last Title');   // the previous session's final title
  writeLineage(cwd, sid, prevSid);
  const r = runHook({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd, prompt: '/continue' });
  assert(titleText(r.shown) === 'Title Hooks — Carry Last Title',
    `expected the carried title, got "${titleText(r.shown)}"`);
  const flag = path.join(cwd, '.claude', 'hooks', '.titles', `${sid}.continued`);
  assert(fs.existsSync(flag), '/continue must stamp {sid}.continued');
  const r2 = runHook({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd, prompt: 'keep going' });
  assert(titleText(r2.shown) === 'Title Hooks — Carry Last Title',
    `the carry must stay armed on later prompts, got "${titleText(r2.shown)}"`);
});

test('SessionStart with a relaunch predecessor -> idle glyph + carried title (kills the folder-name flicker)', () => {
  const cwd = mkWorkspace();
  const sid = 'carry-2', prevSid = 'carry-prev-2';
  writeTitle(cwd, prevSid, 'Journal Modal — Fix Overflow');
  writeLineage(cwd, sid, prevSid, 'startup');
  const r = runHook({ hook_event_name: 'SessionStart', session_id: sid, cwd, source: 'startup' });
  assert(leadsWithGlyph(r.codepoints, IDLE), `expected idle glyph, got ${r.shown}`);
  assert(titleText(r.shown) === 'Journal Modal — Fix Overflow',
    `expected the carried title over the placeholder, got "${titleText(r.shown)}"`);
});

test('SessionStart after a /clear -> New-session placeholder, NOT the old title', () => {
  const cwd = mkWorkspace();
  const sid = 'carry-5', prevSid = 'carry-prev-5';
  writeTitle(cwd, prevSid, 'GWS Domain Reclaim — Diagnose Association');
  writeLineage(cwd, sid, prevSid);                              // source: 'clear'
  const r = runHook({ hook_event_name: 'SessionStart', session_id: sid, cwd, source: 'clear' });
  assert(leadsWithGlyph(r.codepoints, IDLE), `expected idle glyph, got ${r.shown}`);
  assert(/New session/.test(titleText(r.shown)),
    `expected the New-session placeholder, got "${titleText(r.shown)}"`);
});

test('carry-over does NOT seed the title file -> BASELINE still fires (model re-authors)', () => {
  const cwd = mkWorkspace();
  const sid = 'carry-3', prevSid = 'carry-prev-3';
  writeTitle(cwd, prevSid, 'Old Scope — Old Goal');
  writeLineage(cwd, sid, prevSid);
  const r = runHook({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd, prompt: 'start a new thing' });
  assert(!fs.existsSync(titleFileFor(cwd, sid)), 'carry-over must not pre-create the title file');
  assert(r.directive && r.directive.length > 0, 'the first-turn directive must still be injected');
  assert(titleText(r.shown) !== 'Old Scope — Old Goal',
    'a post-/clear prompt that is not /continue must not wear the old title');
});

test('the session\'s own authored title wins over a carried title', () => {
  const cwd = mkWorkspace();
  const sid = 'carry-4', prevSid = 'carry-prev-4';
  writeTitle(cwd, prevSid, 'Carried — Should Lose');
  writeLineage(cwd, sid, prevSid);
  writeTitle(cwd, sid, 'Authored — Should Win');                // this session already authored one
  const r = runHook({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd, prompt: 'hi' });
  assert(titleText(r.shown) === 'Authored — Should Win', `own title must win, got "${titleText(r.shown)}"`);
});

test('carriedTitle() unit: no lineage -> empty; lineage + prev file -> that title', () => {
  const { carriedTitle } = require(HOOK);
  const cwd = mkWorkspace();
  const dir = path.join(cwd, '.claude', 'hooks', '.titles');
  fs.mkdirSync(dir, { recursive: true });
  assert(carriedTitle(dir, 'orphan') === '', 'no lineage file must yield an empty carried title');
  fs.writeFileSync(path.join(dir, 'orphan.lineage.json'), JSON.stringify({ prevSid: 'p' }));
  fs.writeFileSync(path.join(dir, 'p.txt'), 'Prev — Title');
  assert(carriedTitle(dir, 'orphan') === 'Prev — Title', 'carriedTitle should read {prevSid}.txt');
  // /clear-stamped lineage suppresses the carry until {sid}.continued re-arms it; relaunch/resume
  // sources — and legacy stamps with no source at all (above) — carry unconditionally.
  fs.writeFileSync(path.join(dir, 'orphan.lineage.json'), JSON.stringify({ prevSid: 'p', source: 'clear' }));
  assert(carriedTitle(dir, 'orphan') === '', 'a /clear lineage must not carry before /continue');
  fs.writeFileSync(path.join(dir, 'orphan.continued'), '1');
  assert(carriedTitle(dir, 'orphan') === 'Prev — Title', 'the .continued flag must re-arm the carry');
  fs.unlinkSync(path.join(dir, 'orphan.continued'));
  fs.writeFileSync(path.join(dir, 'orphan.lineage.json'), JSON.stringify({ prevSid: 'p', source: 'startup' }));
  assert(carriedTitle(dir, 'orphan') === 'Prev — Title', 'a relaunch lineage must carry unconditionally');
});

// Regression (2026-07-21): the anchor cache was keyed by CLAUDE_CODE_SSE_PORT, which is per
// VS Code WINDOW (every tab inherits the same value), not per claude process — so a brand-new
// terminal cache-hit the OLD tab's tid, was recorded as a same-tab rotation, and wore the old
// tab's title. A stale cache entry keyed by anything but THIS session's sid must be ignored:
// a fresh sid re-walks its own ancestry and must never inherit another tab's anchor.
test('stale anchor cache under a shared env key must not fabricate a lineage for a new terminal', () => {
  const cwd = mkWorkspace();
  const tdir = path.join(cwd, '.claude', 'hooks', '.titles', 'terminals');
  fs.mkdirSync(tdir, { recursive: true });
  // The exact state the buggy code trusted: a port-keyed cache entry + that terminal occupied by tab A.
  fs.writeFileSync(path.join(tdir, '.anchor-cache.json'), JSON.stringify({ key: '25935', tid: 'tab-A' }));
  fs.writeFileSync(path.join(tdir, 'tab-A.json'), JSON.stringify({ tid: 'tab-A', sid: 'session-A', updatedAt: 1 }));
  runHook({ hook_event_name: 'SessionStart', session_id: 'session-B', cwd, source: 'startup' },
    { CLAUDE_CODE_SSE_PORT: '25935' });
  const lin = path.join(cwd, '.claude', 'hooks', '.titles', 'session-B.lineage.json');
  assert(!fs.existsSync(lin),
    'a brand-new terminal must not inherit another tab\'s lineage via a shared-env cache key');
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
  // The user-level copy roots its title state in ~/.claude (fakeHome), not the owner project — it's a
  // fallback for many projects and must not scatter .titles into them. Seed the title THERE so the
  // PostToolUse refresh has something to repaint (a prior UPS would have created it in the same place).
  writeTitle(fakeHome, sid, 'Alpha — Beta');
  const r = runHook(
    { hook_event_name: 'PostToolUse', session_id: sid, cwd: cdTarget },
    { CLAUDE_PROJECT_DIR: owner, USERPROFILE: fakeHome, HOME: fakeHome },
    userCopy
  );
  // Pre-fix keying (cwd) deferred here -> empty output and a permanently stale tab glyph.
  assert(r.raw !== '', 'the user-level copy must NOT stand down for a repo whose settings are not loaded');
  assert(leadsWithGlyph(r.codepoints, WORKING), `expected working glyph, got: ${r.shown}`);
});
test('ROOT SELECTION: user-level copy roots .titles in ~/.claude; project copy roots in the project', () => {
  // Locks in the runtime tier-branch (isUserLevel ? os.homedir() : ownerDir) that replaced the old
  // source fork. The user-level copy must keep its state under ~/.claude and never create .titles
  // inside the project it's only a fallback for; the project copy must root in the project.
  const { fakeHome, userCopy } = installFakeUserCopy();
  const owner = mkWorkspace();
  const upsFor = (hookPath) => runHook(
    { hook_event_name: 'UserPromptSubmit', session_id: 'root-select', cwd: owner, prompt: 'hi' },
    { CLAUDE_PROJECT_DIR: owner, USERPROFILE: fakeHome, HOME: fakeHome },
    hookPath
  );
  // User-level copy → title dir under ~/.claude (fakeHome), NOT the owner project.
  upsFor(userCopy);
  assert(fs.existsSync(path.join(fakeHome, '.claude', 'hooks', '.titles')),
    'user-level copy must create its .titles under ~/.claude');
  assert(!fs.existsSync(path.join(owner, '.claude', 'hooks', '.titles')),
    'user-level copy must NOT scatter .titles into the fallback project');
  // Same code, project copy (repo HOOK) → title dir under the project root.
  upsFor(HOOK);
  assert(fs.existsSync(path.join(owner, '.claude', 'hooks', '.titles')),
    'project copy must root .titles in the project');
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

// _alarms.log is what /audit-titles reads, and a tee that quietly stops matching would make the
// audit report a reassuring zero instead of an outage. The two positive lines below are VERBATIM
// captures from real watchdog output, so a diag-format change breaks these tests rather than the
// investigation.
console.log('Alarm tee (_alarms.log — the lines /audit-titles reads):');
{
  const { ALARM_RE, appendCapped } = require(HOOK);
  const DEADLINE_OK = '2026-07-29T22:55:07.628Z  TurnWatch        working  ring=0 note=watch-exit sid=a | T  deadline polls=10 pid=23100 glyph=working|UserPromptSubmit tail=assistant tailAge=2s verify=ok actual="bash.exe"';
  const COLLISION = '2026-07-29T22:55:05.216Z  TurnWatch        working  ring=0 note=watch    sid=a | T  session resolved pid=23100 cands=33 matched=[23100 7788]   PID-COLLISION pid=23100 alsoClaimedBy=[b] ambiguousMatch=1';
  const ORDINARY = '2026-07-29T22:38:25.283Z  TurnWatch        working  ring=0 note=watch    sid=a | T  ineligible kind=assistant glyph=working age=0s pid=11268';

  test('a stranded deadline is teed', () => {
    assert(ALARM_RE.test(DEADLINE_OK.replace('verify=ok', 'verify=STRANDED')), 'verify=STRANDED must match');
  });
  test('a pid collision is teed', () => assert(ALARM_RE.test(COLLISION), 'PID-COLLISION must match'));
  test('a HEALTHY deadline is not teed (verify=ok is not an alarm)', () => {
    assert(!ALARM_RE.test(DEADLINE_OK), 'verify=ok must not match');
  });
  test('an ordinary watch poll is not teed', () => assert(!ALARM_RE.test(ORDINARY), 'plain watch line must not match'));
  test('ALARM_RE carries no /g or /y flag (a sticky regex would skip every other alarm)', () => {
    assert(!ALARM_RE.global && !ALARM_RE.sticky, `flags must not include g or y, got "${ALARM_RE.flags}"`);
  });

  test('appendCapped appends, then rotates exactly once past the cap', () => {
    const dir = mkWorkspace();
    const f = path.join(dir, '_alarms.log');
    appendCapped(f, 'one\n', 1024);
    appendCapped(f, 'two\n', 1024);
    assert(fs.readFileSync(f, 'utf8') === 'one\ntwo\n', 'both lines should land in a fresh file');
    appendCapped(f, `${'x'.repeat(1100)}\n`, 1024); // pushes size past the cap
    appendCapped(f, 'after-rotate\n', 1024);        // this call sees size > cap and rotates
    assert(fs.existsSync(`${f}.1`), 'expected a single .1 rotation');
    assert(fs.readFileSync(f, 'utf8') === 'after-rotate\n', 'the live file should hold only the post-rotation line');
    assert(fs.readFileSync(`${f}.1`, 'utf8').startsWith('one\ntwo\n'), 'the rotation should retain the earlier lines');
  });

  test('an ordinary paint leaves no _alarms.log behind', () => {
    const cwd = mkWorkspace();
    const sid = 'alarm-none';
    writeTitle(cwd, sid, 'Alpha — Beta');
    runHook({ hook_event_name: 'PostToolUse', session_id: sid, cwd }, { CLAUDE_TITLE_DEBUG: '1', CLAUDE_PROJECT_DIR: cwd });
    const alarms = path.join(cwd, '.claude', 'hooks', '.titles', '_alarms.log');
    assert(!fs.existsSync(alarms), 'a healthy turn must not create _alarms.log');
  });
}
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
test('the shipped PostToolUse terminal-title matcher covers the subagent tool under both names', () => {
  const shipped = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '.claude', 'settings.json'), 'utf8')
  );
  const entry = (shipped.hooks.PostToolUse || []).find(m =>
    (m.hooks || []).some(h => /terminal-title\.js"$/.test(h.command)));
  assert(entry, 'terminal-title must be registered under PostToolUse');
  const re = new RegExp(`^(${entry.matcher})$`);
  // Claude Code renamed Task -> Agent (2.1.x); older builds still send Task.
  assert(re.test('Agent'), `matcher must fire for Agent (current builds), got: ${entry.matcher}`);
  assert(re.test('Task'), `matcher must still fire for Task (older builds), got: ${entry.matcher}`);
});
console.log();

// ---- Duplicate-session guard (warn / kill on a live colliding twin) --------
const { titlesCollide, isPlaceholderTitle } = require(HOOK);

console.log('Duplicate-session guard — title similarity:');
test('titlesCollide: the 2026-07-20 real collision (Build-prefixed dup)', () => {
  assert(titlesCollide(
    'journal open-to-all — guest-journaling server (phase a)',
    'journal open-to-all — build guest-journaling server (phase a)'),
    'near-identical Phase-A titles must collide');
});
test('titlesCollide: identical titles collide', () => {
  assert(titlesCollide('foo — bar baz qux', 'foo — bar baz qux'));
});
test('titlesCollide: distinct use-cases under one scope do NOT collide', () => {
  assert(!titlesCollide('title hooks — fix stuck glyph on cancel', 'title hooks — add arcade beeps'),
    'different goals under the same scope should not collide');
});
test('titlesCollide: unrelated tabs do NOT collide', () => {
  assert(!titlesCollide('faf trial offer — deploy friends offer to prod',
    'journal open-to-all — build guest-journaling server (phase a)'),
    'unrelated work must not collide');
});
test('isPlaceholderTitle: folder name + new-session placeholder are placeholders', () => {
  assert(isPlaceholderTitle('myrepo', path.join('x', 'myrepo')), 'bare folder name is a placeholder');
  assert(isPlaceholderTitle('Claude Code - New session', path.join('x', 'myrepo')));
  assert(!isPlaceholderTitle('myrepo — do a real thing', path.join('x', 'myrepo')), 'an authored title is not a placeholder');
});
console.log();

// Behavioral: drive the REAL hook on a UserPromptSubmit with a sibling session pre-seeded into the
// .titles dir. A "live" sibling has a fresh {sid}.glyph (the per-turn heartbeat); "older" is set via
// its {sid}.session.json startedAt. No transcript_path in the payload → spawnTurnWatch no-ops.
function seedTwin(cwd, sid, title, opts) {
  opts = opts || {};
  const tdir = path.join(cwd, '.claude', 'hooks', '.titles');
  fs.mkdirSync(tdir, { recursive: true });
  fs.writeFileSync(path.join(tdir, `${sid}.txt`), title);
  fs.writeFileSync(path.join(tdir, `${sid}.glyph`), 'working|UserPromptSubmit');
  fs.writeFileSync(path.join(tdir, `${sid}.session.json`),
    JSON.stringify({ startedAt: opts.startedAt || Date.now() }));
  if (opts.glyphAgeMs) {
    const t = (Date.now() - opts.glyphAgeMs) / 1000;
    fs.utimesSync(path.join(tdir, `${sid}.glyph`), t, t);
  }
}
function runUPS(cwd, sid, env) {
  return runHook({ hook_event_name: 'UserPromptSubmit', session_id: sid, cwd, prompt: 'go' }, env);
}
const MINE = 'journal open-to-all — build guest-journaling server (phase a)';
const TWIN = 'journal open-to-all — guest-journaling server (phase a)';

console.log('Duplicate-session guard — behavioral (real hook, seeded twin):');
test('warn: a fresh colliding twin surfaces a systemMessage, no block', () => {
  const cwd = mkWorkspace();
  writeTitle(cwd, 'meSid', MINE);
  seedTwin(cwd, 'twinSid', TWIN, { startedAt: Date.now() - 60000 });
  const { json } = runUPS(cwd, 'meSid', { CLAUDE_TITLE_DUPE: 'warn' });
  assert(json && typeof json.systemMessage === 'string' && /duplicate/i.test(json.systemMessage),
    'expected a duplicate-session warning');
  assert(!json.decision, 'warn mode must not block the prompt');
});
test('warn is the DEFAULT mode (no env set)', () => {
  const cwd = mkWorkspace();
  writeTitle(cwd, 'meSid', MINE);
  seedTwin(cwd, 'twinSid', TWIN, {});
  const { json } = runUPS(cwd, 'meSid', {});
  assert(json && /duplicate/i.test(json.systemMessage || ''), 'default mode should warn');
});
test('kill: the newer tab is blocked when an older twin is live', () => {
  const cwd = mkWorkspace();
  writeTitle(cwd, 'meSid', MINE);
  seedTwin(cwd, 'twinSid', TWIN, { startedAt: Date.now() - 60000 });
  const { json } = runUPS(cwd, 'meSid', { CLAUDE_TITLE_DUPE: 'kill' });
  assert(json && json.decision === 'block', 'kill mode should block the newer session');
  assert(/standing down/i.test(json.reason || ''), 'block reason should explain the stand-down');
});
test('stale twin (glyph older than the window) does NOT trigger', () => {
  const cwd = mkWorkspace();
  writeTitle(cwd, 'meSid', MINE);
  seedTwin(cwd, 'twinSid', TWIN, { glyphAgeMs: 10 * 60 * 1000 });
  const { json } = runUPS(cwd, 'meSid', { CLAUDE_TITLE_DUPE: 'kill' });
  assert(json && !json.decision, 'a stale twin must not block');
  assert(!json.systemMessage, 'a stale twin must not warn');
});
test('off: disabled even with a fresh colliding twin', () => {
  const cwd = mkWorkspace();
  writeTitle(cwd, 'meSid', MINE);
  seedTwin(cwd, 'twinSid', TWIN, {});
  const { json } = runUPS(cwd, 'meSid', { CLAUDE_TITLE_DUPE: 'off' });
  assert(json && !json.decision && !json.systemMessage, 'off mode must do nothing');
});
test('a non-colliding fresh twin is ignored', () => {
  const cwd = mkWorkspace();
  writeTitle(cwd, 'meSid', MINE);
  seedTwin(cwd, 'twinSid', 'faf trial offer — deploy friends offer to prod', {});
  const { json } = runUPS(cwd, 'meSid', { CLAUDE_TITLE_DUPE: 'kill' });
  assert(json && !json.decision && !json.systemMessage, 'unrelated tab must not trigger');
});
test('a lone session never flags itself', () => {
  const cwd = mkWorkspace();
  writeTitle(cwd, 'soloSid', MINE);
  fs.writeFileSync(path.join(cwd, '.claude', 'hooks', '.titles', 'soloSid.glyph'), 'working|UserPromptSubmit');
  const { json } = runUPS(cwd, 'soloSid', { CLAUDE_TITLE_DUPE: 'kill' });
  assert(json && !json.decision && !json.systemMessage, 'a lone session must never flag itself');
});
// The 2026-07-21 false positive: /clear mints a new sid in the SAME tab; until it authors a title,
// displayTitle CARRIES the predecessor's title verbatim — which then collided with the
// predecessor's own still-fresh glyph. The lineage prevSid chain must exempt those ghosts.
test('own /clear predecessor (lineage prevSid) is NOT a twin', () => {
  const cwd = mkWorkspace();
  const tdir = path.join(cwd, '.claude', 'hooks', '.titles');
  seedTwin(cwd, 'oldSid', MINE, { startedAt: Date.now() - 60000 }); // the pre-/clear ghost, glyph fresh
  fs.mkdirSync(tdir, { recursive: true });
  fs.writeFileSync(path.join(tdir, 'newSid.lineage.json'),
    JSON.stringify({ prevSid: 'oldSid', tid: 't1', source: 'clear', ts: new Date().toISOString() }));
  // newSid has NO title file of its own → displayTitle carries oldSid's title, the exact repro.
  const { json } = runUPS(cwd, 'newSid', { CLAUDE_TITLE_DUPE: 'kill' });
  assert(json && !json.decision, 'a session must not be blocked by its own predecessor');
  assert(!json.systemMessage, 'a session must not be warned about its own predecessor');
});
test('rapid double-/clear: the grandparent ghost is exempt too, a REAL twin still fires', () => {
  const cwd = mkWorkspace();
  const tdir = path.join(cwd, '.claude', 'hooks', '.titles');
  seedTwin(cwd, 'gpSid', MINE, {});
  seedTwin(cwd, 'oldSid', MINE, {});
  seedTwin(cwd, 'otherTab', TWIN, { startedAt: Date.now() - 60000 }); // a genuine concurrent tab
  fs.writeFileSync(path.join(tdir, 'oldSid.lineage.json'), JSON.stringify({ prevSid: 'gpSid' }));
  fs.writeFileSync(path.join(tdir, 'newSid.lineage.json'), JSON.stringify({ prevSid: 'oldSid' }));
  const { json } = runUPS(cwd, 'newSid', { CLAUDE_TITLE_DUPE: 'warn' });
  assert(json && /duplicate/i.test(json.systemMessage || ''), 'the real concurrent tab must still warn');
  // Exactly ONE twin listed (the guard says "is", not "are") and no ghost title: MINE's "build"
  // word appears only in the lineage ghosts' titles, so it must be absent from the message.
  assert(/is\s+active/.test(json.systemMessage || ''), 'only the one real tab should be listed');
  assert(!/build/i.test(json.systemMessage || ''), 'lineage ghosts must not appear in the warning');
});
console.log();

// Paint-time: a collision BORN MID-TURN (a /continue adopting another tab's work, or the model
// authoring a twin title between prompts) never meets the UserPromptSubmit check. The 2026-07-21
// incident: the hijacker's only prompt wore the exempt placeholder; the colliding title arrived
// two minutes into the autonomous turn; neither tab was prompted again → zero warnings.
function runPTU(cwd, sid, env) {
  return runHook({ hook_event_name: 'PostToolUse', session_id: sid, cwd }, env);
}
console.log('Duplicate-session guard — paint-time (collision born mid-turn):');
test('the 2026-07-21 hijack: placeholder at UPS, colliding title authored mid-turn → PostToolUse warns', () => {
  const cwd = mkWorkspace();
  seedTwin(cwd, 'twinSid', TWIN, { startedAt: Date.now() - 60000 });
  writeTitle(cwd, 'meSid', path.basename(cwd)); // placeholder at prompt time → UPS exempt
  let r = runUPS(cwd, 'meSid', { CLAUDE_TITLE_DUPE: 'warn' });
  assert(r.json && !r.json.systemMessage, 'placeholder title must not warn at UPS');
  writeTitle(cwd, 'meSid', MINE); // the turn authors the colliding title mid-flight
  r = runPTU(cwd, 'meSid', { CLAUDE_TITLE_DUPE: 'warn' });
  assert(r.json && /duplicate/i.test(r.json.systemMessage || ''), 'paint-time must warn the user');
  assert(r.directive && /duplicate/i.test(r.directive), 'model-visible context must be injected');
});
test('unchanged title: the next PostToolUse stays silent (one check per title change)', () => {
  const cwd = mkWorkspace();
  seedTwin(cwd, 'twinSid', TWIN, {});
  writeTitle(cwd, 'meSid', MINE);
  runPTU(cwd, 'meSid', { CLAUDE_TITLE_DUPE: 'warn' });
  const r = runPTU(cwd, 'meSid', { CLAUDE_TITLE_DUPE: 'warn' });
  assert(r.json && !r.json.systemMessage && !r.directive, 'same title must not re-fire');
});
test('paint-time kill mode: urgent stand-down context, but never a mid-turn block', () => {
  const cwd = mkWorkspace();
  seedTwin(cwd, 'twinSid', TWIN, { startedAt: Date.now() - 60000 });
  writeTitle(cwd, 'meSid', MINE);
  const r = runPTU(cwd, 'meSid', { CLAUDE_TITLE_DUPE: 'kill' });
  assert(r.json && !r.json.decision, 'PostToolUse must not block a running turn');
  assert(r.directive && /stop|stand/i.test(r.directive), 'kill mode should direct the turn to stand down');
});
test('paint-time off mode: silent even with a fresh colliding twin', () => {
  const cwd = mkWorkspace();
  seedTwin(cwd, 'twinSid', TWIN, {});
  writeTitle(cwd, 'meSid', MINE);
  const r = runPTU(cwd, 'meSid', { CLAUDE_TITLE_DUPE: 'off' });
  assert(r.json && !r.json.systemMessage && !r.directive, 'off must do nothing');
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
// WINDOWS-ONLY: the rescue paths lean on title-painter-v5.exe (a .NET
// AttachConsole helper the watchdog lazy-compiles with the in-box csc) for
// --cpu sampling and the --live screen probe. Off win32 there is no painter,
// so neither path can fire — the suite is skipped there.
//
// The screen probe's needle ("esc to interrupt", CC's bottom-bar hint) is a
// HARNESS CONTRACT with Claude Code's UI: if CC renames the hint, live turns
// read "dead" — the sampleCpu rename-belt keeps streaming turns from
// false-firing and thinking turns degrade to the 120s CPU fallback;
// CLAUDE_TITLE_LIVE_NEEDLE is the no-code-change fix. Tests force the probe
// via CLAUDE_TITLE_TEST_LIVE ('1'/'0'/other = live/dead/blind) and still
// drive the REAL watchdog loop.
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
      // Continuous ~50% of a core. Real streaming claude reads 9–19%, but this fake exists to
      // exercise the busy BRANCH, not calibrate the 6% threshold — and under full-suite load a
      // ~15% fake can get descheduled below 6% for one 300ms sample, which is all the rename-belt
      // needs to false-rescue (observed 2026-07-15). 50% keeps it unambiguous; still continuous
      // per TRAP 2 (never a periodic burst a short window can miss).
      ? 'setInterval(()=>{const t=Date.now();while(Date.now()-t<50){}},100)'
      : 'setTimeout(()=>{},600000)'; // parked/idle (~0%)
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
  // `live` forces the screen probe via the CLAUDE_TITLE_TEST_LIVE seam: '1' = needle on
  // screen (live turn), '0' = attached-but-absent (cancelled), 'dialog' = bottom rows show
  // "esc to cancel" (permission dialog / question card open), 'blind' = no determination
  // (painter missing / attach denied). A fake node parent has no CC console to read, so
  // every probing case must force one of the four.
  function runWatch(transcript, pid, nonce, live, deadlineMs) {
    const payload = JSON.stringify({
      sid: wsid, dir: wdir, file: path.join(wdir, `${wsid}.txt`), cwd: wcwd,
      nonce, transcript, ppid: pid, sessionPid: pid,
    });
    const env = { ...process.env };
    if (live !== undefined) env.CLAUDE_TITLE_TEST_LIVE = live;
    if (deadlineMs !== undefined) env.CLAUDE_TITLE_TEST_DEADLINE_MS = String(deadlineMs);
    const c = spawn(process.execPath, [HOOK, '--turn-watch', payload], { detached: true, stdio: 'ignore', env });
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

  // --- 2. stalled prompt + probe DEAD + idle parent -> no-esc-hint rescue (a real cancel) ---
  test('watchdog: stalled prompt + dead screen probe -> rescued (thinking-phase cancel)', () => {
    setState({ glyph: 'working|UserPromptSubmit', watch: 'n2' });
    runWatch(mkWTranscript('t2', 'prompt'), wIdlePid, 'n2', '0');
    assert(waitWGlyph('idle|TurnWatch', 25), `a dead probe + idle parent under a stalled prompt should rescue, glyph="${wglyph()}"`);
  });

  // --- 2b. stalled prompt + probe LIVE -> NEVER rescued. The 2026-07-15 thinking false-fire
  // guard: server-side thinking parks the client at ~0% CPU with an unmoved transcript —
  // indistinguishable from a cancel by CPU alone. Positive screen liveness must block the
  // rescue outright. FAILS on round-7 code (which rescued on CPU quiet in ~2.3s). ---
  let wd2b = null;
  test('watchdog: LIVE screen probe -> never rescued (thinking turn, ~0% CPU)', () => {
    setState({ glyph: 'working|UserPromptSubmit', watch: 'n2b' });
    wd2b = runWatch(mkWTranscript('t2b', 'prompt'), wIdlePid, 'n2b', '1');
    sleepSync(12000);
    assert(wglyph() === 'working|UserPromptSubmit', `a live probe must block the rescue no matter how quiet the CPU, glyph="${wglyph()}"`);
  });
  test('watchdog: live-probe watchdog stands down on a superseded nonce', () => {
    setState({ watch: 'n2b-superseded' });
    assert(waitDead(wd2b.pid, 4000), 'the live-probe watchdog should stand down when superseded');
  });

  // --- 2c. stalled prompt + BLIND probe -> no rescue before the 120s CPU fallback age
  // (quiet CPU alone cannot tell thinking from cancelled; slow beats wrong) ---
  test('watchdog: BLIND probe -> no CPU rescue before the 120s fallback age', () => {
    setState({ glyph: 'working|UserPromptSubmit', watch: 'n2c' });
    runWatch(mkWTranscript('t2c', 'prompt'), wIdlePid, 'n2c', 'blind');
    sleepSync(12000);
    assert(wglyph() === 'working|UserPromptSubmit', `a blind probe must not CPU-rescue before FALLBACK_AGE_MS, glyph="${wglyph()}"`);
    setState({ watch: 'n2c-superseded' });
  });

  // --- 2d. needle-distrust flag -> dead reads demote to blind (no rescue before the 120s
  // fallback). This is the self-healing half of the needle-drift canary: once a false-dead is
  // proven, a renamed hint can't resurrect the thinking false-fire. ---
  test('watchdog: needle-distrust flag demotes dead probes to the 120s fallback', () => {
    fs.writeFileSync(path.join(wdir, 'needle-distrust'), 'planted-by-test');
    setState({ glyph: 'working|UserPromptSubmit', watch: 'n2d' });
    runWatch(mkWTranscript('t2d', 'prompt'), wIdlePid, 'n2d', '0');
    sleepSync(12000);
    assert(wglyph() === 'working|UserPromptSubmit', `a distrusted dead probe must not rescue before FALLBACK_AGE_MS, glyph="${wglyph()}"`);
    setState({ watch: 'n2d-superseded' });
  });

  // --- 2e. a LIVE read retracts the distrust flag (the needle is proven good again) ---
  test('watchdog: a LIVE probe retracts the needle-distrust flag', () => {
    // flag still present from 2d
    setState({ glyph: 'working|UserPromptSubmit', watch: 'n2e' });
    runWatch(mkWTranscript('t2e', 'prompt'), wIdlePid, 'n2e', '1');
    const d = Date.now() + 8000;
    while (Date.now() < d && fs.existsSync(path.join(wdir, 'needle-distrust'))) sleepSync(300);
    assert(!fs.existsSync(path.join(wdir, 'needle-distrust')), 'a live read should clear the distrust flag');
    setState({ watch: 'n2e-superseded' });
  });

  // --- 2f. the canary itself: PostToolUse + a SAME-nonce dead-read breadcrumb = the turn was
  // provably alive when the probe said dead -> flag drift. A MISMATCHED nonce is a real cancel's
  // leftover -> consumed silently, never flagged. ---
  function drivePostToolUse() {
    execFileSync(process.execPath, [HOOK], {
      input: JSON.stringify({ hook_event_name: 'PostToolUse', session_id: wsid, cwd: wcwd, tool_name: 'Bash' }),
      encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: wcwd },
    });
  }
  test('watchdog: PostToolUse flags needle drift on a same-turn dead read', () => {
    fs.writeFileSync(path.join(wdir, `${wsid}.probe`), 'nX|123');
    setState({ watch: 'nX' });
    drivePostToolUse();
    assert(fs.existsSync(path.join(wdir, 'needle-distrust')), 'a same-nonce dead-read breadcrumb must write the distrust flag');
    assert(!fs.existsSync(path.join(wdir, `${wsid}.probe`)), 'the breadcrumb is consumed one-shot');
    fs.unlinkSync(path.join(wdir, 'needle-distrust')); // don't leak the flag into later cases
  });
  test("watchdog: PostToolUse ignores a PRIOR turn's breadcrumb (nonce mismatch)", () => {
    fs.writeFileSync(path.join(wdir, `${wsid}.probe`), 'old-turn-nonce|123');
    setState({ watch: 'current-turn-nonce' });
    drivePostToolUse();
    assert(!fs.existsSync(path.join(wdir, 'needle-distrust')), "a real cancel's leftover breadcrumb must not flag drift");
    assert(!fs.existsSync(path.join(wdir, `${wsid}.probe`)), 'the stale breadcrumb is still consumed');
  });

  // --- 2g. an open dialog reads 'dialog', not dead: a turn's FIRST tool call opens its
  // permission prompt while the tail still reads 'prompt' (live-traced 2026-07-15 in wifi-app:
  // v5 read it dead -> false ✻ rescue + a wrongly-set needle-distrust flag). The dialog state
  // must flip ◐ as awaiting|Notification (the real notification's exact paint), leave no
  // dead-read breadcrumb, and keep watching. FAILS on v5 code. ---
  let wd2g = null;
  test('watchdog: dialog probe on a prompt tail -> flips ◐, no false rescue, no drift flag', () => {
    setState({ glyph: 'working|UserPromptSubmit', watch: 'n2g' });
    wd2g = runWatch(mkWTranscript('t2g', 'prompt'), wIdlePid, 'n2g', 'dialog');
    assert(waitWGlyph('awaiting|Notification', 15), `an open dialog must flip ◐ awaiting|Notification, glyph="${wglyph()}"`);
    assert(!fs.existsSync(path.join(wdir, `${wsid}.probe`)), 'a dialog read must not drop a dead-read breadcrumb');
    assert(!fs.existsSync(path.join(wdir, 'needle-distrust')), 'a dialog read must never set the distrust flag');
  });
  test('watchdog: keeps watching after the dialog flip (an approval resumes the turn)', () => {
    assert(!waitDead(wd2g.pid, 2500), 'the watchdog must keep running while the dialog is open');
    setState({ watch: 'n2g-superseded' });
    assert(waitDead(wd2g.pid, 4000), 'the watchdog should stand down when superseded');
  });

  // --- 2h. mid-turn dialogs (assistant tail): the gentle ~2s dialog-only scan must flip ◐ too —
  // this is the "6 seconds to go ◐" case from 2026-07-15. FAILS on v5 code (assistant tails
  // were never probed at all). ---
  test('watchdog: dialog probe on an assistant tail -> flips ◐ (mid-turn permission prompt)', () => {
    setState({ glyph: 'working|PostToolUse', watch: 'n2h' });
    runWatch(mkWTranscript('t2h', 'assistant'), wIdlePid, 'n2h', 'dialog');
    assert(waitWGlyph('awaiting|Notification', 15), `a mid-turn dialog must flip ◐, glyph="${wglyph()}"`);
    setState({ watch: 'n2h-superseded' });
  });

  // --- 2i. the dialog scan is flip-only: a DEAD read on an assistant tail is what a long
  // silent Bash tool looks like -> no rescue, and NO drift breadcrumb either. ---
  test('watchdog: dead probe on an assistant tail -> no rescue, no breadcrumb (flip-only scan)', () => {
    setState({ glyph: 'working|PostToolUse', watch: 'n2i' });
    runWatch(mkWTranscript('t2i', 'assistant'), wIdlePid, 'n2i', '0');
    sleepSync(9000);
    assert(wglyph() === 'working|PostToolUse', `an assistant-tail dead read must never rescue, glyph="${wglyph()}"`);
    assert(!fs.existsSync(path.join(wdir, `${wsid}.probe`)), 'an assistant-tail dead read must not drop a breadcrumb');
    setState({ watch: 'n2i-superseded' });
  });

  // --- 2j. deadline roll: a dialog parked on the user (◐ awaiting|Notification) must outlive
  // the watch deadline. The 2026-07-22 stuck-◐: an AskUserQuestion sat open past the 30min
  // deadline, the watchdog stood down ('watch-exit deadline'), and the user's Esc an hour later
  // flushed a cancel marker no watcher was left alive to read — the ◐ stayed stuck until the
  // next prompt. The deadline ROLLS while the dialog is up, so the marker still rescues.
  // FAILS on pre-roll code (deadline exit with the dialog open). ---
  test('watchdog: awaiting|Notification rolls the deadline — alive past it, Esc marker still rescues', () => {
    setState({ glyph: 'awaiting|Notification', watch: 'n2j' });
    const tp2j = mkWTranscript('t2j', 'assistant');
    const wd2j = runWatch(tp2j, wIdlePid, 'n2j', '0', 1500);
    sleepSync(5000); // > 3x the 1.5s test deadline
    assert(!waitDead(wd2j.pid, 250), 'the watchdog must stay alive past the deadline while a dialog is parked on the user');
    // the user Esc's the dialog: the interrupt marker flushes -> instant rescue, glyph resets
    fs.appendFileSync(tp2j, JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } }) + '\n');
    assert(waitWGlyph('idle|TurnWatch', 8), `an Esc'd dialog must rescue to idle, glyph="${wglyph()}"`);
    assert(waitDead(wd2j.pid, 4000), 'the watchdog should self-exit once it has rescued');
  });
  test('watchdog: a working glyph does NOT roll the deadline (the backstop still bounds runaways)', () => {
    setState({ glyph: 'working|PostToolUse', watch: 'n2k' });
    const wd2k = runWatch(mkWTranscript('t2k', 'assistant'), wIdlePid, 'n2k', '0', 1500);
    assert(waitDead(wd2k.pid, 8000), 'without a dialog the deadline must still stand the watchdog down');
  });

  // --- 3. stalled prompt + probe dead + BUSY parent -> NO rescue. The rename-belt: if CC
  // ever renames the bottom-bar hint, live turns read "dead" — but a streaming client burns
  // CPU, so the sample still blocks the rescue. ---
  test('watchdog: dead probe + BUSY parent -> never rescued (CPU rename-belt)', () => {
    wBusyPid = spawnFake('busy');
    sleepSync(300);
    setState({ glyph: 'working|UserPromptSubmit', watch: 'n3' });
    wd3 = runWatch(mkWTranscript('t3', 'prompt'), wBusyPid, 'n3', '0');
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
    wd4 = runWatch(mkWTranscript('t4', 'assistant'), wIdlePid, 'n4', '0');
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

summary();
