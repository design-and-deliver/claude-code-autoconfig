#!/usr/bin/env node
/**
 * Terminal Title — distributable plugin hook (installed to <project>/.claude/hooks/terminal-title.js).
 * ONE self-dispatching hook for five events (keyed on hook_event_name):
 *   UserPromptSubmit -> ⬤ working  + inject the title directive (incl. the {sid}.ask path) +
 *                       clear any stale {sid}.ask flag so it reflects only the turn about to run
 *   PostToolUse      -> ⬤ working  (refresh, so a mid-turn title flip shows live + clears a stale ◐)
 *   Notification     -> ◐ awaiting your approval (permission_prompt matcher only)
 *   Stop             -> ✻ idle / done — OR ◐ awaiting (+ a 2nd BEL = gold tab) when the turn ended
 *                       on a question (last visible response text ends in '?', or a {sid}.ask flag)
 *   SessionStart     -> ✻ idle "Claude Code — New session" (or an existing title on resume/compact)
 *
 * The title is set TWO ways on every event: `process.title` (= SetConsoleTitleW on Windows — the ONLY
 * mechanism that flips the tab on UserPromptSubmit, where Claude Code drops `terminalSequence`) AND
 * `terminalSequence` (honored on the other events). node writes UTF-8 natively, so glyphs go out as-is.
 *
 * Title files are PROJECT-SCOPED at <cwd>/.claude/hooks/.titles/<session_id>.txt — the model authors
 * them; the directive injected each prompt tells it the path + format. Optional forensic log (one line
 * per paint, for tracing an out-of-sync tab) is gated behind CLAUDE_TITLE_DEBUG=1 — default OFF,
 * ~512KB-capped, written to .titles/_debug.log — so it never ships a growing log.
 *
 * Requires `env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE = "1"` (set by plugin.json), or CC's own writer races.
 */
const fs = require('fs');
const path = require('path');

const ESC = '\x1b';
const BEL = '\x07';
const EMDASH = String.fromCodePoint(0x2014);

// State glyphs, built from code points so an editor can't strip the invisible variation selector.
//   working  = U+26AB MEDIUM BLACK CIRCLE + U+FE0E VS15 (text presentation, not emoji)
//   awaiting = U+25D0 half-filled circle — paused, awaiting your approval/answer
//   idle     = U+273B teardrop-spoked asterisk (Claude Code brand mark) while idle/done
const GLYPH = {
  working: String.fromCodePoint(0x26AB, 0xFE0E),
  awaiting: String.fromCodePoint(0x25D0),
  idle: String.fromCodePoint(0x273B),
};

// Per-invocation context for the optional debug log (populated in handle, read by titleLog).
let logCtx = null;

// Only drive from stdin when run AS the hook (`node terminal-title.js`). When require()'d by a test the
// functions below are exported instead, so the stdin read doesn't hang the runner. async because the
// Stop branch may await a short re-read beat (see the flush-race guard in handle).
if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => (input += chunk));
  process.stdin.on('end', async () => {
    try {
      await handle(JSON.parse(input));
    } catch (err) {
      process.exit(0); // never break the turn on a title error — emit nothing
    }
  });
}

async function handle(data) {
  const event = data.hook_event_name || '';
  const sid = data.session_id || '';
  const cwd = data.cwd || process.cwd();
  // PROJECT-SCOPED title dir (cwd-relative) — the plugin installs per-project. (The live ~/.claude
  // variant uses os.homedir() instead; that is the only difference between the two.)
  const dir = path.join(cwd, '.claude', 'hooks', '.titles');
  const file = path.join(dir, `${sid}.txt`);
  logCtx = { event, sid, dir, note: '' };

  if (event === 'UserPromptSubmit') {
    // Ensure the state dir exists, but NOT the file — the model's Write tool refuses to overwrite a
    // file it hasn't read, so a pre-created empty file would make its first title write fail.
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* ignore */ }
    // Clear any stale {sid}.ask left by an interrupted prior turn (Stop never ran to consume it), so a
    // leftover flag can't paint a false ◐ on this turn's end. The flag must reflect ONLY this turn.
    const askFile = path.join(dir, `${sid}.ask`);
    if (fileExists(askFile)) { try { fs.unlinkSync(askFile); } catch (_) { /* ignore */ } }
    const title = normalize(readTitle(file) || folderName(cwd));
    const out = setTitle(GLYPH.working, title);
    out.hookSpecificOutput = {
      hookEventName: 'UserPromptSubmit',
      additionalContext: buildDirective(data, file, cwd),
    };
    emit(out);
    return;
  }

  if (event === 'PostToolUse') {
    // Only refresh once a real title exists; don't stamp the bare folder over what UPS showed.
    const raw = readTitle(file);
    if (!raw) process.exit(0);
    emit(setTitle(GLYPH.working, normalize(raw)));
    return;
  }

  if (event === 'SessionStart') {
    // Fresh-session placeholder; on resume/compact an existing model-authored title is preferred.
    const title = normalize(readTitle(file) || 'Claude Code - New session');
    emit(setTitle(GLYPH.idle, title));
    return;
  }

  if (event === 'Notification') {
    // A permission prompt is open. Single BEL only — CC already rings its own bell here (tab already gold).
    emit(setTitle(GLYPH.awaiting, normalize(readTitle(file) || folderName(cwd))));
    return;
  }

  // Stop: idle, UNLESS the turn ended on a question the user must answer — then awaiting + a 2nd BEL
  // so VS Code paints the (otherwise bell-less) tab gold. "Ended on a question" = last visible
  // assistant text ends in '?' (transcript heuristic) OR an explicit {sid}.ask flag (consumed here).
  const askFile = path.join(dir, `${sid}.ask`);
  const askPresent = fileExists(askFile);

  // Grade the transcript, guarding the flush race: the final assistant text can land in the JSONL a beat
  // AFTER Stop fires (the screen renders from the live stream; the file append lags by ~200ms). The tell
  // is `suspectRace`: the freshest on-disk assistant block is text-less (thinking/tool_use only), or no
  // text was found at all — both mean the real final message is still flushing. When that's the case,
  // re-read a few times (~120ms apart) before grading, so a turn that actually ended on '?' isn't painted
  // ✻ idle off a stale earlier block. A fully-flushed turn hits the text block first → suspectRace=false →
  // zero delay. The {sid}.ask flag remains the race-proof backstop.
  let q = inspectLastResponse(data.transcript_path);
  let reread = 0;
  while (!q.ends && (q.suspectRace || !q.found) && reread < 7) {
    await delay(120);
    reread++;
    q = inspectLastResponse(data.transcript_path);
    if (q.ends || (q.found && !q.suspectRace)) break;
  }

  let pending = q.ends;
  let note = pending ? 'q-mark' : 'idle';
  if (!pending && askPresent) { pending = true; note = 'ask-flag'; }
  if (askPresent) { try { fs.unlinkSync(askFile); } catch (_) { /* ignore */ } }
  if (logCtx) {
    logCtx.note = note;
    logCtx.diag = `ask=${askPresent ? 1 : 0} qmark=${q.ends ? 1 : 0} found=${q.found ? 1 : 0} reread=${reread} tail="${q.tail}"`;
  }
  const glyph = pending ? GLYPH.awaiting : GLYPH.idle;
  emit(setTitle(glyph, normalize(readTitle(file) || folderName(cwd)), pending));
}

// Set the tab title two ways and return the hook payload. `process.title` is the instant flip and the
// only mechanism CC honors on UserPromptSubmit. `ring` appends a second BEL (Stop-awaiting only) →
// VS Code renders a gold "needs you" tab.
function setTitle(glyph, title, ring) {
  const text = `${glyph} ${title}`;
  try { process.title = text; } catch (_) { /* ignore */ }
  let seq = `${ESC}]0;${text}${BEL}`;
  if (ring) seq += BEL;
  titleLog(glyph, title, ring);
  return { terminalSequence: seq };
}

// Optional forensic log (default OFF — gate: CLAUDE_TITLE_DEBUG=1). One line per paint, so a tab that
// ends up out of sync (e.g. a ◐ that never cleared to ✻) can be traced to the exact event + glyph that
// last painted it. Bounded to ~512KB with a single rotation; wrapped so it can never break a turn.
function titleLog(glyph, title, ring) {
  if (process.env.CLAUDE_TITLE_DEBUG !== '1' || !logCtx) return;
  try {
    const name = glyph === GLYPH.working ? 'working'
      : glyph === GLYPH.awaiting ? 'awaiting'
      : glyph === GLYPH.idle ? 'idle' : 'other';
    const diag = logCtx.diag ? `  ${logCtx.diag}` : '';
    const line = `${new Date().toISOString()}  ${logCtx.event.padEnd(16)} `
      + `${name.padEnd(8)} ring=${ring ? 1 : 0} note=${(logCtx.note || '-').padEnd(8)} `
      + `sid=${logCtx.sid} | ${title}${diag}\n`;
    const f = path.join(logCtx.dir, '_debug.log');
    try { if (fs.statSync(f).size > 512 * 1024) fs.renameSync(f, `${f}.1`); } catch (_) { /* none yet */ }
    fs.appendFileSync(f, line);
  } catch (_) { /* logging must never throw */ }
}

function fileExists(file) {
  try { return fs.existsSync(file); } catch (_) { return false; }
}

// Stop heuristic: did the turn end on a question? Read the JSONL transcript, find the most-recent
// assistant message with VISIBLE text (skip pure tool_use turns so a final title/memory Write doesn't
// mask the question), test whether it ends in '?' (allowing trailing whitespace / ) * _ "). Returns a
// diagnostic record { ends, found, tail }: `ends` is the old boolean the caller branches on; `found`
// and `tail` feed the debug log so a missing half-circle can be told apart — a transcript-flush race
// shows found=0 (or a stale tail), a genuine regex miss shows a tail that's present but doesn't end
// in '?'. Any error → a blank record (treated as "no question"), matching the old false return.
function inspectLastResponse(transcriptPath) {
  const blank = { ends: false, found: false, tail: '', suspectRace: false };
  if (!transcriptPath) return blank;
  let content;
  try {
    content = fs.readFileSync(transcriptPath, 'utf8');
  } catch (_) {
    return blank;
  }
  const lines = content.split('\n');
  // Did we pass a TEXT-LESS assistant block (thinking-only / tool_use-only) on the way back to the last
  // text block? At a fully-flushed Stop the final assistant message HAS text, so we hit it first and this
  // stays false. If it's true, the turn's real final text is most likely still being appended to the
  // JSONL (the flush race) — the caller re-reads after a beat before grading rather than trust this block.
  let sawTextlessAssistant = false;
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
    if (text.trim()) {
      // last ~60 chars, collapsed to one line and quote-stripped so it can't break the log framing
      const tail = text.trim().slice(-60).replace(/\s+/g, ' ').replace(/"/g, "'");
      return { ends: /\?[\s)*_"]*$/.test(text), found: true, tail, suspectRace: sawTextlessAssistant };
    }
    // assistant message with no visible text = a thinking-only or tool_use-only block sitting AFTER the
    // last text we'll grade — a strong hint the final text line hasn't flushed yet.
    sawTextlessAssistant = true;
  }
  return blank;
}

// Event-loop-friendly sleep for the Stop flush-race re-read beat (handle awaits this; no busy-wait).
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

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

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

// Build the injected directive from terminal-title.directive.md (COMMAND block for a /slash-command
// turn, SHIFT otherwise; PENDING tail appended). Wording lives in the .md so it tunes without code edits.
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
  const pending = extractBlock(tpl, 'PENDING');
  const combined = pending ? `${block}\n\n${pending}` : block;
  return combined
    .split('{{TITLE_FILE}}').join(file)
    .split('{{ASK_FILE}}').join(file.replace(/\.txt$/, '.ask'))
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

// Exported for tests (require()'d when require.main !== module). The hook itself never reads these.
module.exports = { inspectLastResponse, normalize, GLYPH };
