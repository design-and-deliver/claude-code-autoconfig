#!/usr/bin/env node
/**
 * Terminal Title — distributable plugin hook (installed to <project>/.claude/hooks/terminal-title.js).
 * ONE self-dispatching hook for five events (keyed on hook_event_name):
 *   UserPromptSubmit -> ⬤ working  + inject the per-prompt REMINDER one-liner (+BASELINE while no
 *                       title exists, +COMMAND on /slash turns) + clear any stale {sid}.ask flag
 *   PostToolUse      -> ⬤ working  (refresh, so a mid-turn title flip shows live + clears a stale ◐)
 *   Notification     -> ◐ awaiting your approval (permission_prompt matcher only)
 *   Stop             -> ✻ idle / done — OR ◐ awaiting (+ a 2nd BEL = gold tab) when the turn ended
 *                       on a question (last visible response text ends in '?', or a {sid}.ask flag;
 *                       flag turns hand the skipped grade to a detached --post-grade child that logs
 *                       a StopDiag line when CLAUDE_TITLE_DEBUG=1 — paint-first, diagnostics after)
 *   SessionStart     -> ✻ idle "Claude Code — New session" (or an existing title on resume/compact)
 *                       + inject the FULL RULES block — once per session instead of every prompt
 *                       (~90% less directive overhead); resume/compact re-inject so a squeezed
 *                       context re-learns the rules.
 *
 * Dedupe: when this file is the USER-LEVEL copy (~/.claude/hooks) and the project ships its own
 * managed copy (<cwd>/.claude/hooks/terminal-title.js), this copy stands down entirely — otherwise
 * both hooks inject directives naming two different title files (double tokens, double Writes).
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
const os = require('os');

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
  if (process.argv[2] === '--post-grade') {
    // Detached child mode: grade a flag-turn transcript purely for the debug log (see postGrade).
    // No stdin — the payload rides argv so the parent never waits on this process. setImmediate
    // defers the run until module evaluation has finished, so no declaration below this block can
    // be hit while still in its temporal dead zone.
    setImmediate(() => postGrade(process.argv[3]).then(() => process.exit(0), () => process.exit(0)));
  } else {
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
}

async function handle(data) {
  const event = data.hook_event_name || '';
  const sid = data.session_id || '';
  const cwd = data.cwd || process.cwd();
  // User-level copy stands down when the SESSION'S OWN project ships a managed copy (see header).
  // Keyed to CLAUDE_PROJECT_DIR (the dir whose settings registered this hook run), NOT the event's
  // cwd: a mid-session `cd` into a copy-shipping repo must not silence this copy — that repo's
  // settings aren't loaded, so its copy never runs and nobody would paint.
  const ownerDir = process.env.CLAUDE_PROJECT_DIR || cwd;
  if (shouldDefer(ownerDir, __dirname, __filename, path.join(os.homedir(), '.claude', 'hooks'))) {
    process.exit(0);
  }
  // PROJECT-SCOPED title dir — anchored to the session's project root (CLAUDE_PROJECT_DIR, with cwd
  // fallback on older Claude Code versions that don't set it) so a mid-session `cd` can't scatter
  // title state across directories. (The live ~/.claude variant uses os.homedir() instead; that is
  // the only difference between the two.)
  const dir = path.join(ownerDir, '.claude', 'hooks', '.titles');
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
    const out = setTitle(GLYPH.idle, title);
    // Inject the FULL rulebook here — once per session — instead of on every prompt. All sources
    // get it: startup/clear teach a fresh context, resume/compact re-teach a squeezed one.
    const rules = buildBlocks(['RULES'], file, cwd, '');
    if (rules) {
      out.hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext: rules };
    }
    emit(out);
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

  // FAILSAFE PRE-PAINT — flip to ✻ idle SYNCHRONOUSLY now, before the async grade below. That grade
  // reads/re-reads the transcript to dodge the flush race and can either throw (caught → exit 0, emits
  // nothing) or be killed on a huge, slow-to-flush final message — either way it would otherwise leave
  // the tab stuck on the last ⬤. process.title (SetConsoleTitleW) takes effect immediately and persists
  // after exit, so the tab is correct even if we die below. Idle is the default Stop outcome; the grade
  // only ever UPGRADES it to ◐ awaiting (worst case: a <1s ✻ flash before ◐ on a question turn, and the
  // {sid}.ask flag already backstops that case).
  try { process.title = `${GLYPH.idle} ${normalize(readTitle(file) || folderName(cwd))}`; } catch (_) { /* ignore */ }

  const askFile = path.join(dir, `${sid}.ask`);
  const askPresent = fileExists(askFile);
  if (askPresent) { try { fs.unlinkSync(askFile); } catch (_) { /* ignore */ } }

  // FAST PATH — the {sid}.ask flag is the race-proof "ended on a question" signal, written to disk BEFORE
  // Stop fires. When present, paint ◐ awaiting and emit() IMMEDIATELY, skipping the transcript grade below.
  // This is the stuck-⬤ fix: emit() (the terminalSequence CC applies on clean exit) is the ONLY paint VS
  // Code honors, and the async grade can be KILLED on a huge / slow-to-flush transcript before it reaches
  // emit() — which froze the tab on the last ⬤ working. Reaching emit() synchronously here closes that
  // window for every flagged question turn (the common case).
  if (askPresent) {
    const deferred = spawnDeferredGrade(data, dir, sid, file, cwd);
    if (logCtx) {
      logCtx.note = 'ask-flag';
      logCtx.diag = `ask=1 fast-path (${deferred ? 'grade deferred to StopDiag' : 'grade skipped'})`;
    }
    emit(setTitle(GLYPH.awaiting, normalize(readTitle(file) || folderName(cwd)), true));
    return; // emit() exits; the return keeps control flow honest if that ever changes
  }

  // No flag → default idle, but the turn may have ended on '?' without one. Grade the transcript, guarding
  // the flush race: the final assistant text can land in the JSONL a beat AFTER Stop fires (~200ms append
  // lag). `suspectRace` (freshest on-disk assistant block is text-less, or none found) means the real final
  // message is still flushing → re-read a few times before grading. Each pass reads only the transcript
  // TAIL, so the loop stays fast on a multi-MB transcript and always reaches emit().
  let q = inspectLastResponse(data.transcript_path);
  let reread = 0;
  while (!q.ends && (q.suspectRace || !q.found) && reread < 7) {
    await delay(120);
    reread++;
    q = inspectLastResponse(data.transcript_path);
    if (q.ends || (q.found && !q.suspectRace)) break;
  }

  // LEXICAL RESCUE — no '?' on the final line, but its closing sentence is a formulaic offer
  // ("Say the word and I'll…", "Want me to…"): the phrasing directive slipped. Paint ◐ anyway so
  // the user still gets the awaiting signal; via=lex marks it a prose DEFECT for the miss-audit,
  // not a working-as-intended path.
  const lex = !q.ends && q.solicits === true;
  const pending = q.ends || lex;
  if (logCtx) {
    logCtx.note = pending ? (lex ? 'lex' : 'q-mark') : 'idle';
    logCtx.diag = `ask=0 qmark=${q.ends ? 1 : 0} via=${lex ? 'lex' : (q.via || '-')} found=${q.found ? 1 : 0} reread=${reread} model=${q.model || '-'} tail="${q.tail}"`;
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
// mask the question), test whether it ends in '?' (allowing trailing whitespace / ) * _ ", plus one
// trailing parenthetical aside — see the endsOnQuestion regex below). Returns a
// diagnostic record { ends, found, tail }: `ends` is the old boolean the caller branches on; `found`
// and `tail` feed the debug log so a missing half-circle can be told apart — a transcript-flush race
// shows found=0 (or a stale tail), a genuine regex miss shows a tail that's present but doesn't end
// in '?'. Any error → a blank record (treated as "no question"), matching the old false return.
function inspectLastResponse(transcriptPath) {
  const blank = { ends: false, via: '', found: false, tail: '', suspectRace: false, model: '', solicits: false };
  if (!transcriptPath) return blank;
  let content;
  try {
    // Read only the TAIL of the transcript. The current turn's final message sits at the very end, and
    // reading the whole multi-MB JSONL of a long session — then re-reading it up to 7× in the flush-race
    // loop — is what let a Stop grade run long enough to be killed before it painted (the stuck-⬤ bug).
    // A fixed tail keeps every pass fast regardless of session length; the leading partial line is dropped.
    const TAIL_BYTES = 1024 * 1024;
    const size = fs.statSync(transcriptPath).size;
    if (size <= TAIL_BYTES) {
      content = fs.readFileSync(transcriptPath, 'utf8');
    } else {
      const fd = fs.openSync(transcriptPath, 'r');
      try {
        const buf = Buffer.alloc(TAIL_BYTES);
        fs.readSync(fd, buf, 0, TAIL_BYTES, size - TAIL_BYTES);
        const tail = buf.toString('utf8');
        const nl = tail.indexOf('\n');
        content = nl >= 0 ? tail.slice(nl + 1) : tail; // drop the partial first line
      } finally {
        fs.closeSync(fd);
      }
    }
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
    if (!obj || !obj.message) continue;
    // The current turn's response always sits AFTER the last real user prompt. Crossing one while
    // scanning back for that response means it hasn't flushed to the JSONL yet (~200ms lag) — force a
    // re-read (suspectRace) instead of falling through to the PRIOR turn's text, which may end in '?'
    // and would wrongly paint the awaiting ◐ on what was really a statement turn.
    if (obj.type === 'user' && isRealUserPrompt(obj)) {
      return { ends: false, found: false, tail: '', suspectRace: true };
    }
    if (obj.type !== 'assistant') continue;
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
      const q = endsOnQuestion(text);
      // `model` (e.g. "claude-fable-5") rides into the debug diag so per-model miss rates can be
      // compared straight from _debug.log.
      return {
        ends: q.ends, via: q.via, found: true, tail,
        suspectRace: sawTextlessAssistant, model: (obj.message && obj.message.model) || '',
        solicits: solicitsReply(text),
      };
    }
    // assistant message with no visible text = a thinking-only or tool_use-only block sitting AFTER the
    // last text we'll grade — a strong hint the final text line hasn't flushed yet.
    sawTextlessAssistant = true;
  }
  return blank;
}

// Did the text end on a question the user must answer? Two tiers (via names the matched one):
//   'qtail'   — the text itself ends on '?', tolerating trailing whitespace / ) * _ " AND one
//               trailing parenthetical aside ("How should we handle it? (I lean option 2.)").
//               A mid-message rhetorical '?' or a plain statement ending in ')' won't match.
//   'signoff' — the text ends on ONE short declarative sign-off line BELOW a question-ending
//               line ("…which do you prefer?\n\nLet me know."). The directive forbids the
//               sign-off, but a model that forgets it shouldn't cost the user the ◐ — so
//               tolerate exactly one trailing line, and only when it is short (≤48 chars),
//               '?'-free, and not list/heading/quote/table/fence content, so a question
//               followed by real elaboration (options list, explanation) still grades idle.
//               Same-line trailing statements ("Want me to proceed? Done.") stay non-questions
//               — a mid-line '?' is exactly the rhetorical shape the grade must not fire on.
// Belt to the {sid}.ask flag's suspenders: the flag is the primary, parse-free path; this only
// hardens the transcript fallback for turns that didn't write one.
// QTAIL lives INSIDE the function (not module-level const) — the --post-grade child calls into
// this during module evaluation, and a module-level const below the require.main block is still
// in its temporal dead zone at that point.
function endsOnQuestion(text) {
  const QTAIL = /\?[\s)*_"]*(\([^()]*\)[\s.*_"]*)?$/;
  if (QTAIL.test(text)) return { ends: true, via: 'qtail' };
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const last = lines[lines.length - 1];
    const isSignoff = last.length <= 48 && !last.includes('?')
      && !/^(?:[-*•>]\s|#{1,6}\s|\||\d+[.)]\s|`{3})/.test(last);
    if (isSignoff && QTAIL.test(lines[lines.length - 2])) return { ends: true, via: 'signoff' };
  }
  return { ends: false, via: '' };
}

// A genuine human prompt (real text) vs a tool_result-carrier user message (content is only
// tool_result blocks). Marks the boundary of the current turn's response while walking the transcript.
function isRealUserPrompt(obj) {
  const c = obj.message && obj.message.content;
  if (typeof c === 'string') return c.trim().length > 0;
  if (Array.isArray(c)) return c.some(b => b && b.type === 'text' && typeof b.text === 'string' && b.text.trim().length > 0);
  return false;
}

// Event-loop-friendly sleep for the Stop flush-race re-read beat (handle awaits this; no busy-wait).
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// LEXICAL solicitation detector (the '?'-less rescue). STRONG, formulaic offer phrases only, tested
// against the CLOSING SENTENCE of the final non-empty line. Weak/courtesy phrases ("let me know",
// "if you want", "happy to") are deliberately absent: as sign-offs after completed work they are
// legitimate statement endings, and enforcing them would trade a rare false-✻ for chronic false-◐.
// "green-light"/"confirm" are imperative-anchored (sentence-initial) so a recap that merely MENTIONS
// them ("Andrew green-lighted the batch.") can't fire.
const SOLICIT_STRONG = [
  /\bwant me to\b/i,
  /\bwould you like\b/i,
  /\bshould i\b/i,
  /\bshall i\b/i,
  /\bdo you want\b/i,
  /\bsay the word\b/i,
  /\by\/n\b/i,
  /\bok(?:ay)? to proceed\b/i,
  /^green-?light\b/i,
  /^confirm\b/i,
];
function solicitsReply(text) {
  if (!text) return false;
  const lines = String(text).trim().split('\n').filter(l => l.trim());
  const lastLine = (lines[lines.length - 1] || '').trim();
  // Any '?' on the final line means the question grade (qtail/signoff) owns the verdict — the
  // lexicon exists solely for the question-less slip, and must never second-guess a graded line.
  if (!lastLine || lastLine.includes('?')) return false;
  const parts = lastLine.split(/[.!:;]\s+/);
  const closing = (parts[parts.length - 1] || '').trim();
  return SOLICIT_STRONG.some(re => re.test(closing));
}

// Deferred flag-turn grade (debug-gated). The `.ask` fast path paints ◐ without reading the
// transcript, which blinded _debug.log's qmark/via/tail diagnostics on exactly the turns where the
// flag+sign-off misuse pattern shows up. Grading BEFORE emit() would re-open the kill window the
// fast path exists to close, and nothing runs after emit() (it exits) — so hand the grade to a
// DETACHED child (this same file, --post-grade) that logs on its own time. unref() + ignored stdio
// mean the parent's exit — and therefore the paint — is never delayed by even one re-read beat.
function spawnDeferredGrade(data, dir, sid, file, cwd) {
  if (process.env.CLAUDE_TITLE_DEBUG !== '1') return false;
  try {
    const payload = JSON.stringify({
      sid, dir,
      transcriptPath: data.transcript_path || '',
      title: normalize(readTitle(file) || folderName(cwd)),
    });
    const { spawn } = require('child_process');
    spawn(process.execPath, [__filename, '--post-grade', payload], {
      detached: true, stdio: 'ignore', windowsHide: true,
      env: Object.assign({}, process.env, { CLAUDE_TITLE_DEBUG: '1' }),
    }).unref();
    return true;
  } catch (_) {
    return false; // diagnostics are best-effort; the paint path never depends on this
  }
}

// Child mode (--post-grade): grade the transcript purely for the debug log, after the paint already
// happened. Same flush-race re-read loop as the main Stop grade (and by child-start the final message
// has usually flushed, so this data is CLEANER than an inline grade would have been). Logs as
// event=StopDiag, so flag-turn protocol compliance reads straight out of _debug.log:
//   qmark=1 via=qtail   -> full compliance (flag AND '?'-last)
//   qmark=1 via=signoff -> flag + banned closer appended after the question (the either/or pattern)
//   qmark=0             -> flag-only; the message ended on a statement
async function postGrade(payloadJson) {
  const p = JSON.parse(payloadJson || '{}');
  let q = inspectLastResponse(p.transcriptPath);
  let reread = 0;
  while (!q.ends && (q.suspectRace || !q.found) && reread < 7) {
    await delay(120);
    reread++;
    q = inspectLastResponse(p.transcriptPath);
    if (q.ends || (q.found && !q.suspectRace)) break;
  }
  logCtx = {
    event: 'StopDiag', sid: p.sid || '', dir: p.dir || '', note: 'ask-flag',
    diag: `ask=1 qmark=${q.ends ? 1 : 0} via=${q.via || '-'} found=${q.found ? 1 : 0} reread=${reread} model=${q.model || '-'} tail="${q.tail}"`,
  };
  // Reuses titleLog's capped append; glyph/ring mirror what the fast path actually painted.
  titleLog(GLYPH.awaiting, p.title || '', true);
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

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

// Build the per-prompt injection: the REMINDER one-liner, plus BASELINE while no title file
// exists yet (first turn), plus COMMAND on a /slash-command turn. The full rulebook (RULES) is
// injected by SessionStart, not here. Wording lives in the .md so it tunes without code edits.
function buildDirective(data, file, cwd) {
  const prompt = typeof data.prompt === 'string' ? data.prompt : '';
  const m = prompt.match(/^\s*\/([A-Za-z0-9][\w:.-]*)/);
  const blocks = ['REMINDER'];
  if (!fileExists(file)) blocks.push('BASELINE');
  if (m) blocks.push('COMMAND');
  return buildBlocks(blocks, file, cwd, m ? m[1] : '');
}

// Extract the named blocks from terminal-title.directive.md, join them, substitute the tokens.
function buildBlocks(names, file, cwd, cmd) {
  let tpl = '';
  try {
    tpl = fs.readFileSync(path.join(__dirname, 'terminal-title.directive.md'), 'utf8');
  } catch (_) {
    return '';
  }
  const parts = names.map(n => extractBlock(tpl, n)).filter(Boolean);
  if (!parts.length) return '';
  return parts.join('\n')
    .split('{{TITLE_FILE}}').join(file)
    .split('{{ASK_FILE}}').join(file.replace(/\.txt$/, '.ask'))
    .split('{{FOLDER}}').join(folderName(cwd))
    .split('{{EMDASH}}').join(EMDASH)
    .split('{{CMD}}').join(cmd || '');
}

// Should THIS copy of the hook stand down? True only for the user-level copy (~/.claude/hooks)
// when the session's OWN project (ownerDir = CLAUDE_PROJECT_DIR, cwd fallback) ships a managed
// copy — that's the only case where the project copy is registered and will paint; the project
// copy wins so a session gets ONE directive and ONE title file. The event's live cwd must NOT be
// used here (mid-session cd into a copy-shipping repo would silence both copies — 2026-07-08).
// Parameterized (no ambient __dirname/homedir) for tests.
function shouldDefer(ownerDir, selfDir, selfFile, homeHooksDir) {
  try {
    if (path.resolve(selfDir) !== path.resolve(homeHooksDir)) return false; // we ARE the project copy
    const projectCopy = path.join(ownerDir, '.claude', 'hooks', 'terminal-title.js');
    return fs.existsSync(projectCopy) && path.resolve(projectCopy) !== path.resolve(selfFile);
  } catch (_) {
    return false;
  }
}

function extractBlock(tpl, name) {
  const re = new RegExp(
    `<!-- DIRECTIVE:${name} -->\\s*([\\s\\S]*?)\\s*<!-- /DIRECTIVE:${name} -->`
  );
  const m = tpl.match(re);
  return m ? m[1].trim() : '';
}

// Exported for tests (require()'d when require.main !== module). The hook itself never reads these.
module.exports = { inspectLastResponse, endsOnQuestion, normalize, GLYPH, shouldDefer, solicitsReply };
