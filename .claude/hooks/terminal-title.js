#!/usr/bin/env node

/**
 * @name Terminal Title
 * @description Renders a descriptive, state-aware title on the terminal tab:
 *              "{glyph} {scope} — {use-case}". The model authors the
 *              text (a use-case compass title: design scope + goal level) into a per-session file; this
 *              hook prepends a live state glyph and emits the title.
 * @trigger UserPromptSubmit, Stop, Notification(permission_prompt), PostToolUse
 *
 * ONE self-dispatching hook for four events (keyed on hook_event_name):
 *   UserPromptSubmit -> ⬤ working  + inject the title directive into context
 *   PostToolUse      -> ⬤ working  (refresh, so a mid-turn title flip shows live)
 *   Notification     -> ◐ awaiting your approval (permission_prompt matcher only)
 *   Stop             -> ✻ idle / done — OR ◐ awaiting when the turn ended on a question
 *                       (last visible response text ends in '?', or a {sid}.ask flag was set)
 *
 * The visible title is authored BY THE MODEL into:
 *   <cwd>/.claude/hooks/.titles/<session_id>.txt
 * Title format + glyph meanings live in terminal-title.directive.md, which this
 * hook injects into the model's context on each prompt.
 *
 * Requires `env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE = "1"` in settings.json — without
 * it, Claude Code's own title writer races this hook and the title flickers.
 *
 * Node writes UTF-8 to stdout directly, so glyphs go out as-is (no escaping needed).
 */

const fs = require('fs');
const path = require('path');

const ESC = '\x1b';
const BEL = '\x07';
const EMDASH = String.fromCodePoint(0x2014);

// State glyphs, built from code points (pure-ASCII source) so an editor can't
// silently strip the invisible variation selector.
//   working  = U+26AB MEDIUM BLACK CIRCLE + U+FE0E VS15 text-presentation selector
//              (the size between U+25CF small and U+2B24 large). If a font ignores
//              VS15 and shows an emoji circle, use 0x25CF (small) or 0x2B24 (large).
//   awaiting = U+25D0 half-filled circle — paused mid-flow, awaiting your approval
//   idle     = U+273B teardrop-spoked asterisk (Claude Code brand mark) while idle
const GLYPH = {
  working: String.fromCodePoint(0x26AB, 0xFE0E),
  awaiting: String.fromCodePoint(0x25D0),
  idle: String.fromCodePoint(0x273B),
};

// Read hook input from stdin (mirrors the other hooks in this directory)
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  try {
    handle(JSON.parse(input));
  } catch (err) {
    // Never break the turn on a title error — emit nothing.
    process.exit(0);
  }
});

function handle(data) {
  const event = data.hook_event_name || '';
  const sid = data.session_id || '';
  const cwd = data.cwd || process.cwd();
  const dir = path.join(cwd, '.claude', 'hooks', '.titles');
  const file = path.join(dir, `${sid}.txt`);

  if (event === 'UserPromptSubmit') {
    // Ensure the state dir exists, but NOT the file itself — the model's Write
    // tool refuses to overwrite a file it hasn't read, so a pre-created empty
    // file would make its first title write fail.
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* ignore */ }
    const title = normalize(readTitle(file) || folderName(cwd));
    emit({
      terminalSequence: seq(GLYPH.working, title),
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: buildDirective(data, file, cwd),
      },
    });
    return;
  }

  if (event === 'PostToolUse') {
    // Only refresh once a real title exists; don't stamp the bare folder over
    // whatever UserPromptSubmit already showed.
    const raw = readTitle(file);
    if (!raw) process.exit(0);
    emit({ terminalSequence: seq(GLYPH.working, normalize(raw)) });
    return;
  }

  // Notification = awaiting (a permission prompt is open). Stop = idle, UNLESS the turn ended on a
  // question the user must answer — then awaiting, so the tab signals "blocked on your reply"
  // instead of looking done. "Ended on a question" is detected two ways (either flips to awaiting):
  //   (1) HEURISTIC — the last visible assistant text ends in '?' (read from the transcript).
  //   (2) an explicit {sid}.ask flag the model dropped (belt-and-suspenders override; consumed here).
  let glyph;
  if (event === 'Notification') {
    glyph = GLYPH.awaiting;
  } else {
    // Stop
    const askFile = path.join(dir, `${sid}.ask`);
    let pending = lastResponseEndsWithQuestion(data.transcript_path);
    if (!pending && fileExists(askFile)) pending = true;
    if (fileExists(askFile)) { try { fs.unlinkSync(askFile); } catch (_) { /* ignore */ } }
    glyph = pending ? GLYPH.awaiting : GLYPH.idle;
  }
  emit({ terminalSequence: seq(glyph, normalize(readTitle(file) || folderName(cwd))) });
}

function fileExists(file) {
  try { return fs.existsSync(file); } catch (_) { return false; }
}

// Heuristic for the Stop indicator: did the turn end on a question? Reads the JSONL transcript,
// finds the most-recent assistant message that has VISIBLE text (skipping pure tool_use turns so a
// final title/memory Write doesn't mask the question), and tests whether that text ends in '?'
// (allowing trailing whitespace / markdown closers like ) * _ "). Best-effort: any error -> false.
function lastResponseEndsWithQuestion(transcriptPath) {
  if (!transcriptPath) return false;
  let content;
  try {
    content = fs.readFileSync(transcriptPath, 'utf8');
  } catch (_) {
    return false;
  }
  const lines = content.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch (_) { continue; }
    if (!obj || obj.type !== 'assistant' || !obj.message) continue;
    const c = obj.message.content;
    let text = '';
    if (typeof c === 'string') {
      text = c;
    } else if (Array.isArray(c)) {
      text = c
        .filter(b => b && b.type === 'text' && typeof b.text === 'string')
        .map(b => b.text)
        .join('\n');
    }
    if (text.trim()) return /\?[\s)*_"]*$/.test(text);
  }
  return false;
}

function readTitle(file) {
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  } catch (_) { /* ignore */ }
  return '';
}

function folderName(cwd) {
  const base = cwd ? path.basename(cwd) : '';
  return base || 'Claude Code';
}

// Normalize ' - ' to ' — ' and capitalize the first letter of each segment.
function normalize(title) {
  const sep = ` ${EMDASH} `;
  return title
    .split(' - ').join(sep)
    .split(sep)
    .map(s => s.replace(/^(\P{L}*)(\p{L})/u, (_, lead, ch) => lead + ch.toUpperCase()))
    .join(sep);
}

function seq(glyph, title) {
  return `${ESC}]0;${glyph} ${title}${BEL}`;
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

// Build the title directive from terminal-title.directive.md. The file holds two
// token-templated blocks: COMMAND (this turn is a /slash-command) and SHIFT
// (a normal turn). Wording lives in the .md so it can be tuned without code edits.
function buildDirective(data, file, cwd) {
  let tpl = '';
  try {
    tpl = fs.readFileSync(path.join(__dirname, 'terminal-title.directive.md'), 'utf8');
  } catch (_) {
    return '';
  }
  const prompt = typeof data.prompt === 'string' ? data.prompt : '';
  const m = prompt.match(/^\s*\/([A-Za-z0-9][\w:.-]*)/);
  const cmd = m ? m[1] : '';
  const block = extractBlock(tpl, cmd ? 'COMMAND' : 'SHIFT');
  if (!block) return '';
  // Append the shared PENDING-question block (if present) to whichever block was selected, so the
  // model knows to end blocking questions on a '?' (which flips the Stop indicator to awaiting).
  const pending = extractBlock(tpl, 'PENDING');
  const combined = pending ? `${block}\n\n${pending}` : block;
  return combined
    .split('{{TITLE_FILE}}').join(file)
    .split('{{FOLDER}}').join(folderName(cwd))
    .split('{{EMDASH}}').join(EMDASH)
    .split('{{CMD}}').join(cmd);
}

function extractBlock(tpl, name) {
  const re = new RegExp(
    `<!-- DIRECTIVE:${name} -->\\s*([\\s\\S]*?)\\s*<!-- /DIRECTIVE:${name} -->`
  );
  const m = tpl.match(re);
  return m ? m[1].trim() : '';
}
