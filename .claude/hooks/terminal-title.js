#!/usr/bin/env node
/**
 * Terminal Title — distributable plugin hook (installed to <project>/.claude/hooks/terminal-title.js).
 * ONE self-dispatching hook for five events (keyed on hook_event_name):
 *   UserPromptSubmit -> ⬤ working  + inject the per-prompt REMINDER one-liner (+BASELINE while no
 *                       title exists, +COMMAND on /slash turns) + clear any stale {sid}.ask flag
 *                       + spawn the --turn-watch cancel watchdog (a user interrupt fires NO hook,
 *                       so a detached per-turn child detects a dead turn via marker/screen-hint/CPU forensics
 *                       and repaints ✻ through title-painter.exe: AttachConsole+SetConsoleTitleW)
 *   PostToolUse      -> ⬤ working  (refresh, so a mid-turn title flip shows live + clears a stale ◐)
 *   Notification     -> ◐ awaiting your approval (permission_prompt matcher) — or, invoked with
 *                       --idle-rescue (idle_prompt matcher), flip a tab left stuck by a user
 *                       interrupt back to ✻ idle (a cancel fires NO hook — Stop never runs);
 *                       gated on transcript-tail forensics (marker / stalled prompt / missing Stop)
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
 * Title files live at <root>/.claude/hooks/.titles/<session_id>.txt, where <root> is chosen at RUNTIME:
 * the project root for a project copy, or ~/.claude for the user-level copy (so this ONE file serves
 * both tiers with no source fork). The model authors the file; the directive injected each prompt tells
 * it the path + format. Optional forensic log (one line
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
  } else if (process.argv[2] === '--turn-watch') {
    // Detached child mode: per-turn cancel watchdog (see turnWatch). Same argv/TDZ shape as
    // --post-grade. Detached is MANDATORY (a non-detached node child dies with its parent on
    // Windows); the console this forfeits is reattached at paint time by title-painter.exe.
    setImmediate(() => turnWatch(process.argv[3]).then(() => process.exit(0), () => process.exit(0)));
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
  // cwd: a mid-session `cd` into a copy-shipping repo (e.g. the CCA source repo) must not silence
  // this copy — that repo's settings aren't loaded, so its copy never runs and nobody would paint.
  const ownerDir = process.env.CLAUDE_PROJECT_DIR || cwd;
  const homeHooksDir = path.join(os.homedir(), '.claude', 'hooks');
  if (shouldDefer(ownerDir, __dirname, __filename, homeHooksDir)) {
    process.exit(0);
  }
  // Title-dir root — ONE file, both tiers, chosen at RUNTIME (no source fork between the shipped twin
  // and the live user-level hook). The user-level copy (this file living in ~/.claude/hooks) keeps its
  // title state in ~/.claude so it never scatters .titles dirs into the many projects it's only a
  // FALLBACK for; the project copy anchors to the session's project root (CLAUDE_PROJECT_DIR, cwd
  // fallback on older Claude Code) so a mid-session `cd` can't scatter state. The tier signal is the
  // SAME "am I the user-level copy?" test shouldDefer uses (canonPath so an aliased HOME still matches).
  const isUserLevel = canonPath(__dirname) === canonPath(homeHooksDir);
  const dir = path.join(isUserLevel ? os.homedir() : ownerDir, '.claude', 'hooks', '.titles');
  const file = path.join(dir, `${sid}.txt`);
  logCtx = { event, sid, dir, note: '' };

  // HARNESS-CONTRACT CANARY (debug-only surface): if Claude Code stops supplying a field the
  // keying depends on, every fix above silently degrades to its fallback. Record the gap so the
  // stale-glyph audit surfaces a platform change as one log line instead of the next mystery.
  const degraded = [];
  if (!process.env.CLAUDE_PROJECT_DIR) degraded.push('CLAUDE_PROJECT_DIR');
  if (!data.cwd) degraded.push('cwd');
  if (!sid) degraded.push('session_id');
  const needsTranscript = event === 'Stop'
    || (event === 'Notification' && process.argv[2] === '--idle-rescue');
  if (needsTranscript && !data.transcript_path) degraded.push('transcript_path');
  if (degraded.length) logCtx.contract = degraded.join(',');

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
    // A user interrupt fires NO hook and CC's idle_prompt notification is not delivered after one
    // (verified 2026-07-11), so each turn gets a watchdog child that notices a dead turn itself.
    spawnTurnWatch(data, dir, sid, file, cwd);
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
    // --idle-rescue (idle_prompt matcher): a user interrupt fires NO hook — Stop never runs — and a
    // thinking-phase cancel writes NOTHING to the transcript either (verified 2026-07-11: Esc during
    // "Percolating" left the file untouched; the "[Request interrupted…]" marker only shows up for
    // tool-use cancels). So the rescue triangulates from what IS observable once CC reports the REPL
    // idle: the newest transcript entry, its age, and the last-painted glyph.
    //   marker tail → canceled, definitely → paint ✻
    //   bare-prompt tail, ≥2.2s old, transcript unmoved, glyph ⬤ → the turn died with the cancel
    //     (a live turn would have flushed something; a just-submitted one is younger) → paint ✻
    //   assistant tail + glyph still ⬤ after a 1.6s grace → mid-response cancel or a KILLED Stop
    //     (the grace lets a racing Stop hook paint first — that's what keeps the ~0ms
    //     messageIdleNotifThresholdMs safe); honors an unconsumed {sid}.ask with ◐
    //   anything else → decline WITHOUT emitting. ◐ question tabs are never downgraded, and a LIVE
    //     permission dialog is indistinguishable from a canceled one, so awaiting|Notification is
    //     only ever rescued by a marker. Declines log note=int-decline when CLAUDE_TITLE_DEBUG=1.
    if (process.argv[2] === '--idle-rescue') {
      const glyphFile = path.join(dir, `${sid}.glyph`);
      const painted = readTitle(glyphFile).split('|');
      const lastGlyph = painted[0];
      const decline = (why) => {
        if (logCtx) { logCtx.note = 'int-decline'; logCtx.diag = why; }
        titleLog(GLYPH[lastGlyph] || GLYPH.idle, normalize(readTitle(file) || folderName(cwd)), false);
        process.exit(0);
      };
      if (lastGlyph === 'idle') decline('already-idle');
      if (lastGlyph === 'awaiting' && painted[1] !== 'Notification') decline('question-tab');
      let tail = classifyTail(data.transcript_path);
      // ~200ms JSONL append lag (same flush race the Stop grade guards)
      for (let i = 0; tail.kind === 'none' && i < 3; i++) {
        await delay(150);
        tail = classifyTail(data.transcript_path);
      }
      let via = '';
      if (tail.kind === 'marker') {
        via = 'marker';
      } else if (lastGlyph !== 'working') {
        decline(`kind=${tail.kind} glyph=${lastGlyph || '-'}`);
      } else if (tail.kind === 'prompt') {
        const age = tail.ts ? Date.now() - Date.parse(tail.ts) : NaN;
        if (!(age > 0)) decline('prompt-unaged'); // no/garbled timestamp — can't prove the stall
        if (age < 2200) await delay(2200 - age);
        const again = classifyTail(data.transcript_path);
        if (again.kind !== 'prompt' || again.size !== tail.size) decline('turn-progressed');
        via = 'stalled-prompt';
      } else if (tail.kind === 'assistant') {
        await delay(1600); // grace: let a racing Stop hook finish its own paint
        if (readTitle(glyphFile).split('|')[0] !== 'working') decline('stop-painted');
        via = 'no-stop';
      } else {
        decline('no-transcript');
      }
      // Confirmed: the turn ended without a Stop. An unconsumed {sid}.ask on the no-stop path is a
      // KILLED Stop's question turn — honor it with ◐ + ring; on a confirmed cancel it's a leftover —
      // clear it either way so it can't paint a false ◐ on the NEXT turn's Stop.
      const askFlag = path.join(dir, `${sid}.ask`);
      const honorAsk = via === 'no-stop' && fileExists(askFlag);
      if (fileExists(askFlag)) { try { fs.unlinkSync(askFlag); } catch (_) { /* ignore */ } }
      if (logCtx) { logCtx.note = 'int-rescue'; logCtx.diag = `via=${via} ask=${honorAsk ? 1 : 0}`; }
      emit(setTitle(honorAsk ? GLYPH.awaiting : GLYPH.idle, normalize(readTitle(file) || folderName(cwd)), honorAsk));
      return;
    }
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
  // window for every flagged question turn (the common case). SetConsoleTitleW above is a Win-terminal-only
  // bonus; VS Code never saw it, which is why the failsafe alone didn't rescue the tab.
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
  // Persist the last-painted glyph ({sid}.glyph, "name|event") — read by the --idle-rescue path to
  // spot a ⬤ stranded by a user interrupt. Best-effort: the dir may not exist before the first
  // UserPromptSubmit of a brand-new install; a failed write only costs that turn's rescue.
  if (logCtx && logCtx.sid && logCtx.dir) {
    const name = glyph === GLYPH.working ? 'working' : glyph === GLYPH.awaiting ? 'awaiting' : 'idle';
    try { fs.writeFileSync(path.join(logCtx.dir, `${logCtx.sid}.glyph`), `${name}|${logCtx.event}`); } catch (_) { /* ignore */ }
  }
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
    const contract = logCtx.contract ? `  contract=degraded(${logCtx.contract})` : '';
    const line = `${new Date().toISOString()}  ${logCtx.event.padEnd(16)} `
      + `${name.padEnd(8)} ring=${ring ? 1 : 0} note=${(logCtx.note || '-').padEnd(8)} `
      + `sid=${logCtx.sid} | ${title}${diag}${contract}\n`;
    const f = path.join(logCtx.dir, '_debug.log');
    try { if (fs.statSync(f).size > 512 * 1024) fs.renameSync(f, `${f}.1`); } catch (_) { /* none yet */ }
    fs.appendFileSync(f, line);
  } catch (_) { /* logging must never throw */ }
}

function fileExists(file) {
  try { return fs.existsSync(file); } catch (_) { return false; }
}

// Classify the newest transcript entry so the --idle-rescue path can tell a dead turn from a live
// one. Walks a 64KB tail back to the first user/assistant line:
//   marker    — user text starting "[Request interrupted" (CC's cancel marker; flushed for tool-use
//               cancels, but a thinking-phase cancel writes NOTHING — verified 2026-07-11 by mtime)
//   prompt    — a real user prompt (ts = its timestamp): either a just-submitted turn or a
//               thinking-phase cancel; the caller disambiguates by age + growth
//   assistant — assistant output (incl. tool_use) or a tool_result carrier: a finished/racing turn,
//               a mid-response cancel, or a killed Stop; the caller disambiguates via the glyph
//   none      — unreadable/empty (also: transcript_path missing)
// `size` rides along for the caller's growth check. Any error → none (the rescue declines on doubt).
function classifyTail(transcriptPath) {
  const none = { kind: 'none', ts: '', size: 0 };
  if (!transcriptPath) return none;
  let content, size;
  try {
    const TAIL_BYTES = 64 * 1024;
    size = fs.statSync(transcriptPath).size;
    const fd = fs.openSync(transcriptPath, 'r');
    try {
      const len = Math.min(TAIL_BYTES, size);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      content = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return none;
  }
  const lines = content.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch (_) { continue; } // includes the tail window's partial first line
    if (!obj || !obj.message || (obj.type !== 'user' && obj.type !== 'assistant')) continue;
    if (obj.type === 'assistant') return { kind: 'assistant', ts: obj.timestamp || '', size };
    const c = obj.message.content;
    const text = typeof c === 'string' ? c
      : Array.isArray(c)
        ? c.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n')
        : '';
    if (text.trimStart().startsWith('[Request interrupted')) return { kind: 'marker', ts: obj.timestamp || '', size };
    if (isRealUserPrompt(obj)) return { kind: 'prompt', ts: obj.timestamp || '', size };
    return { kind: 'assistant', ts: obj.timestamp || '', size }; // tool_result carrier — mid-turn shape
  }
  return none;
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
// in its temporal dead zone at that point (same TDZ trap as background.ts's listener helpers).
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
  // Harvested 2026-07-08 from real _debug.log flag-turn tails — the historical "flag masked the
  // prose violation" shapes. All are unambiguous waiting-on-you closers:
  /^tell me\b/i,
  /\byour call\b/i,
  /\bready when you are\b/i,
  /\bstanding by\b/i,
  /\bon your go\b/i,
  /\bwhenever you say\b/i,
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

// Spawn the per-turn cancel watchdog (--turn-watch child). MUST be detached: on Windows a
// non-detached node child sits in a kill-on-close job object and CANNOT outlive its parent — the
// hook exits milliseconds later and the watchdog died before its first line ran (verified
// 2026-07-12 with a probe child; same reason --post-grade detaches). Detaching costs the console,
// so the watchdog cannot SetConsoleTitleW directly — it paints through the title-painter helper
// (AttachConsole + SetConsoleTitleW; see ensurePainter). {sid}.watch carries a nonce: the NEXT
// turn's UPS overwrites it, telling a stale watchdog to stand down.
function spawnTurnWatch(data, dir, sid, file, cwd) {
  try {
    if (!data.transcript_path) return false;
    const nonce = `${process.pid}-${Date.now()}`;
    fs.writeFileSync(path.join(dir, `${sid}.watch`), nonce);
    const payload = JSON.stringify({
      sid, dir, file, cwd, nonce,
      transcript: data.transcript_path,
      ppid: process.ppid || 0,
    });
    require('child_process')
      .spawn(process.execPath, [__filename, '--turn-watch', payload],
        { detached: true, stdio: 'ignore' })
      .unref();
    return true;
  } catch (_) {
    return false;
  }
}

// The watchdog's paint arm. A detached process has no console, so SetConsoleTitleW needs a
// reattach: title-painter.exe (15 lines of C#, lazy-compiled ONCE into the .titles dir by the
// in-box .NET Framework csc) does FreeConsole → AttachConsole(<claude pid>) → SetConsoleTitleW,
// which ConPTY forwards to the VS Code tab exactly like the UPS fast-flip. `--get <file>` reads
// the title back for self-tests. Falls back to a one-shot PowerShell Add-Type when csc is absent.
const PAINTER_CS = [
  'using System; using System.IO; using System.Diagnostics; using System.Globalization; using System.Runtime.InteropServices; using System.Text;',
  'class P {',
  '  [DllImport("kernel32.dll")] static extern bool FreeConsole();',
  '  [DllImport("kernel32.dll")] static extern bool AttachConsole(uint pid);',
  '  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool SetConsoleTitle(string t);',
  '  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern uint GetConsoleTitle(StringBuilder sb, uint n);',
  '  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFileW(string n, uint ac, uint sh, IntPtr sa, uint d, uint f, IntPtr t);',
  '  [DllImport("kernel32.dll")] static extern bool GetConsoleScreenBufferInfo(IntPtr h, out CSBI i);',
  '  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool ReadConsoleOutputCharacterW(IntPtr h, [Out] char[] b, uint n, COORD c, out uint r);',
  '  struct COORD { public short X, Y; }',
  '  struct SMALL_RECT { public short L, T, R, B; }',
  '  struct CSBI { public COORD size; public COORD pos; public ushort attr; public SMALL_RECT win; public COORD max; }',
  '  static int Main(string[] a) {',
  '    if (a.Length < 2) return 2;',
  '    if (a[1] == "--cpu" && a.Length >= 4) {',
  '      try {',
  '        var pr = Process.GetProcessById(int.Parse(a[0]));',
  '        int ms = int.Parse(a[3]);',
  '        var c0 = pr.TotalProcessorTime;',
  '        System.Threading.Thread.Sleep(ms);',
  '        pr.Refresh();',
  '        double pct = (pr.TotalProcessorTime - c0).TotalMilliseconds / ms * 100.0;',
  '        File.WriteAllText(a[2], pct.ToString("0.00", CultureInfo.InvariantCulture), new UTF8Encoding(false));',
  '        return 0;',
  '      } catch { try { File.WriteAllText(a[2], "-1", new UTF8Encoding(false)); } catch {} return 6; }',
  '    }',
  '    if (a.Length >= 4 && a[1] == "--find") {',
  '      string needle = File.ReadAllText(a[3], Encoding.UTF8).Trim();',
  '      var hits = new System.Collections.Generic.List<string>();',
  '      for (int i = 4; i < a.Length; i++) {',
  '        FreeConsole();',
  '        uint pid; if (!uint.TryParse(a[i], out pid)) continue;',
  '        if (!AttachConsole(pid)) continue;',
  '        var t = new StringBuilder(2048); GetConsoleTitle(t, 2048);',
  '        if (needle.Length > 0 && t.ToString().IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) hits.Add(a[i]);',
  '      }',
  '      FreeConsole();',
  '      File.WriteAllText(a[2], string.Join(" ", hits.ToArray()), new UTF8Encoding(false));',
  '      return 0;',
  '    }',
  '    if (a.Length >= 3 && a[1] == "--live") {',
  '      string needle = a.Length >= 4 ? a[3] : "esc to interrupt";',
  '      string res = "attach-fail";',
  '      FreeConsole();',
  '      if (AttachConsole(uint.Parse(a[0]))) {',
  '        IntPtr h = CreateFileW("CONOUT$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);',
  '        CSBI bi;',
  '        if (h == new IntPtr(-1) || !GetConsoleScreenBufferInfo(h, out bi)) { res = "read-fail"; }',
  '        else {',
  '          res = "dead";',
  '          for (short y = bi.win.T; y <= bi.win.B && res == "dead"; y++) {',
  '            var buf = new char[bi.size.X]; uint rd; COORD c; c.X = 0; c.Y = y;',
  '            if (!ReadConsoleOutputCharacterW(h, buf, (uint)bi.size.X, c, out rd)) continue;',
  '            if (new string(buf, 0, (int)rd).IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) res = "live";',
  '          }',
  '        }',
  '      }',
  '      File.WriteAllText(a[2], res, new UTF8Encoding(false));',
  '      return (res == "live" || res == "dead") ? 0 : 5;',
  '    }',
  '    FreeConsole();',
  '    if (!AttachConsole(uint.Parse(a[0]))) return 3;',
  '    if (a.Length >= 3 && a[1] == "--get") {',
  '      var sb = new StringBuilder(2048); GetConsoleTitle(sb, 2048);',
  '      File.WriteAllText(a[2], sb.ToString(), new UTF8Encoding(false)); return 0;',
  '    }',
  '    return SetConsoleTitle(a[1]) ? 0 : 4;',
  '  }',
  '}',
].join('\n');

// Version in the name = source shape; a PAINTER_CS change MUST bump it so stale exes recompile
// (ensurePainter early-returns when the exe exists). v3 = case-insensitive --find; v4 = --cpu mode;
// v5 = --live screen-buffer probe (reads the visible console rows for the "esc to interrupt" hint).
function painterPath(dir) { return path.join(dir, 'title-painter-v5.exe'); }

// Kick off the one-time compile (async — the watchdog calls this at startup so the exe is warm
// long before any rescue). Returns immediately; readiness = the exe existing.
function ensurePainter(dir) {
  try {
    const exe = painterPath(dir);
    if (fileExists(exe)) return;
    const src = path.join(dir, 'title-painter-v5.cs');
    fs.writeFileSync(src, PAINTER_CS);
    const roots = [
      path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
      path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
    ];
    const csc = roots.find(fileExists);
    if (!csc) return; // PS fallback will carry the paint
    require('child_process')
      .spawn(csc, ['/nologo', '/target:exe', `/out:${exe}`, src], { stdio: 'ignore', windowsHide: true })
      .unref();
  } catch (_) { /* fallback covers it */ }
}

// On-demand CPU% of <pid> over a <ms> window, via painter --cpu (a TotalProcessorTime delta = % of
// one core, same units as the old typeperf reading). Returns null on any failure (painter missing /
// pid gone / parse). Blocks ~ms + spawn — the watchdog is a dedicated child, so that's fine.
function sampleCpu(dir, sid, pid, ms) {
  const exe = painterPath(dir);
  if (!fileExists(exe)) return null;
  const out = path.join(dir, `${sid}.cpu`);
  try { fs.unlinkSync(out); } catch (_) { /* ignore */ }
  try {
    require('child_process').spawnSync(exe, [String(pid), '--cpu', out, String(ms)],
      { windowsHide: true, timeout: ms + 4000 });
    const v = parseFloat(fs.readFileSync(out, 'utf8'));
    try { fs.unlinkSync(out); } catch (_) { /* ignore */ }
    return Number.isFinite(v) && v >= 0 ? v : null;
  } catch (_) {
    return null;
  }
}

// Screen-buffer liveness probe — the discriminator CPU can't provide. A LIVE turn renders
// "esc to interrupt" in CC's bottom status bar; an idle REPL doesn't (verified 2026-07-15 against
// live + idle sessions — a thinking turn parks the client at ~0% CPU and otherwise looks exactly
// like a cancel). painter --live attaches to <pid>'s console, reads the visible rows, and reports:
//   true  → needle on screen (turn alive — NEVER rescue)
//   false → attached, needle absent (REPL idle — cancel evidence)
//   null  → can't tell (painter missing / attach or read failed) — treat as NO evidence.
// CLAUDE_TITLE_TEST_LIVE ('1'|'0'|anything else) forces the result so tests can drive the real
// watchdog loop deterministically; CLAUDE_TITLE_LIVE_NEEDLE overrides the needle if CC renames it.
function probeLive(dir, sid, pid) {
  const forced = process.env.CLAUDE_TITLE_TEST_LIVE;
  if (forced === '1') return true;
  if (forced === '0') return false;
  if (forced) return null;
  const exe = painterPath(dir);
  if (!fileExists(exe)) return null;
  const out = path.join(dir, `${sid}.live`);
  try { fs.unlinkSync(out); } catch (_) { /* ignore */ }
  try {
    const args = [String(pid), '--live', out];
    if (process.env.CLAUDE_TITLE_LIVE_NEEDLE) args.push(process.env.CLAUDE_TITLE_LIVE_NEEDLE);
    require('child_process').spawnSync(exe, args, { windowsHide: true, timeout: 5000 });
    const v = fs.readFileSync(out, 'utf8').trim();
    try { fs.unlinkSync(out); } catch (_) { /* ignore */ }
    return v === 'live' ? true : v === 'dead' ? false : null;
  } catch (_) {
    return null;
  }
}

// Paint <text> onto the console owned by <ppid>. Returns a short result tag for the debug diag.
function paintViaConsole(dir, ppid, text) {
  const cp = require('child_process');
  const exe = painterPath(dir);
  if (fileExists(exe)) {
    try {
      const r = cp.spawnSync(exe, [String(ppid), text], { windowsHide: true, timeout: 5000 });
      return `painter=${r.status}`;
    } catch (_) { /* fall through */ }
  }
  // Fallback: no compiled painter → drive the same AttachConsole+SetConsoleTitleW from a one-shot
  // PowerShell. Passed base64 via -EncodedCommand to sidestep the nested Node→PS quote-escaping that
  // silently broke the old inline -Command form (the DllImport quotes never survived). The C# rides
  // a PS single-quoted (multi-line) literal so its double-quotes are taken verbatim; the script
  // exits 0 only when BOTH AttachConsole and SetConsoleTitle succeed, so ps-paint reports the real
  // result instead of a false 0.
  try {
    const safe = String(text).replace(/'/g, "''");
    const script = [
      "Add-Type -Namespace K -Name W -MemberDefinition '",
      '[DllImport("kernel32.dll")] public static extern bool FreeConsole();',
      '[DllImport("kernel32.dll")] public static extern bool AttachConsole(uint p);',
      '[DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern bool SetConsoleTitle(string t);',
      "'",
      '[K.W]::FreeConsole() | Out-Null',
      `$ok = [K.W]::AttachConsole(${Number(ppid)}) -and [K.W]::SetConsoleTitle('${safe}')`,
      'exit ([int](-not $ok))',
    ].join('\n');
    const b64 = Buffer.from(script, 'utf16le').toString('base64');
    const r = cp.spawnSync('powershell', ['-NoProfile', '-EncodedCommand', b64], { windowsHide: true, timeout: 15000 });
    return `ps-paint=${r.status}`;
  } catch (_) {
    return 'paint=failed';
  }
}

// The watchdog itself. A canceled turn is invisible to hooks AND (for a thinking-phase cancel)
// leaves the transcript untouched, so the watchdog triangulates liveness from the OUTSIDE:
//   - marker tail ("[Request interrupted…]", flushed on tool-phase cancels) → rescue instantly.
//   - bare-prompt tail (thinking phase): the SCREEN, not CPU. Server-side thinking parks the client
//     at ~0% CPU with an unmoved transcript — byte-identical to a cancel from here — which made the
//     old CPU-quiet heuristic false-fire ~6s into EVERY long-thinking turn (found 2026-07-15 under
//     alwaysThinking+xhigh; the 2026-07-12 "active 9–19%" measurement was streaming, not thinking).
//     The discriminator that works: a live turn renders "esc to interrupt" in CC's bottom bar; an
//     idle REPL doesn't (live-verified 2026-07-15). probeLive reads the visible console buffer:
//     needle present → never rescue; absent ×2 (≥500ms apart) + CPU not busy (rename-belt: if CC
//     ever drops the hint text, a busy client still blocks the rescue) + glyph/tail unmoved after a
//     grace beat → the turn died → rescue (~4s, as fast as before).
//   - probe blind (no painter / attach denied) → degrade to the old CPU-quiet heuristic, but only
//     past FALLBACK_AGE_MS — long past any plausible thinking phase; a slow rescue beats a wrong one.
//   - Only a prompt tail is ever screen/CPU-judged: an assistant/tool_use tail with a quiet screen
//     is also what a long silent Bash tool or an open AskUserQuestion dialog looks like — never
//     rescue those without a marker.
// Stand-down: glyph concluded (✻ / ◐-from-Stop), nonce superseded, session gone, or a 30min deadline.
async function turnWatch(payloadJson) {
  let p;
  try { p = JSON.parse(payloadJson); } catch (_) { return; }
  const { sid, dir, file, cwd, nonce, transcript, ppid } = p;
  logCtx = { event: 'TurnWatch', sid, dir, note: '' };
  const glyphFile = path.join(dir, `${sid}.glyph`);
  const watchFile = path.join(dir, `${sid}.watch`);

  ensurePainter(dir); // warm the console-paint/find/cpu helper while the turn runs

  // The session's REAL claude.exe pid. The hook's own parent is a SHORT-LIVED claude.exe shim —
  // live trail 2026-07-12 showed parent-gone at the first poll, three turns straight — so ppid is
  // only a log breadcrumb. The true session process is found by CONSOLE IDENTITY: painter --find
  // attaches each claude.exe candidate and matches its console title against our own title file.
  // Tests inject sessionPid directly (their fake parents own no matching console).
  let sessionPid = Number(p.sessionPid) || 0;

  // Lifecycle trail (CLAUDE_TITLE_DEBUG=1): start line, ~5s heartbeats, and an exit reason — so a
  // watchdog that dies in the real CC context is distinguishable from one that is alive but
  // silently ineligible (that ambiguity cost a full live-test round on 2026-07-12).
  const watchLog = (note, diag) => {
    if (!logCtx) return;
    logCtx.note = note;
    logCtx.diag = diag;
    titleLog(GLYPH.working, normalize(readTitle(file) || folderName(cwd)), false);
  };
  watchLog('watch-start', `ppid=${ppid} session=${sessionPid || 'resolve'}`);

  const CPU_MS = 300;   // sample window: idle claude ~0% (single-scheduler-tick spike ≤ ~5.2% at
  const CPU_THRESH = 6.0; // 300ms — still < 6%); active 9–19% → 6% separates (LIVE-measured 2026-07-12).
  const GRACE_MS = 150;   // 300ms window ×2 samples is the floor; smaller windows lose tick headroom.
  const FALLBACK_AGE_MS = 120 * 1000; // probe-blind: no CPU-only rescue before this (thinking runs minutes)
  const started = Date.now();
  let lastSize = -1;
  let quietStreak = 0;
  let deadStreak = 0;
  let lastProbe = 0;
  let polls = 0;
  try {
    while (Date.now() - started < 30 * 60 * 1000) {
      await delay(150);
      polls++;
      if (readTitle(watchFile) !== nonce) { watchLog('watch-exit', 'superseded'); return; }
      const painted = readTitle(glyphFile).split('|');
      if (painted[0] === 'idle' || (painted[0] === 'awaiting' && painted[1] !== 'Notification')) {
        watchLog('watch-exit', `concluded glyph=${painted.join('|')}`);
        return;
      }
      if (!sessionPid) {
        sessionPid = resolveSessionPid(dir, sid, file, cwd);
        if (sessionPid) watchLog('watch', `session resolved pid=${sessionPid}`);
        else if (polls % 10 === 0) watchLog('watch', 'session unresolved (painter compiling / no console match)');
        if (!sessionPid) continue;
      }
      try { process.kill(sessionPid, 0); } catch (_) { watchLog('watch-exit', `session-gone pid=${sessionPid}`); return; }

      const tail = classifyTail(transcript);
      const grew = tail.size !== lastSize;
      const hadBaseline = lastSize !== -1;
      lastSize = tail.size;

      // Tool-phase cancel: the marker flushes at cancel time — no CPU evidence needed.
      if (tail.kind === 'marker') {
        rescueFromWatch('marker', dir, sid, file, cwd, sessionPid);
        return;
      }

      const age = tail.ts ? Date.now() - Date.parse(tail.ts) : NaN;
      // Eligibility: glyph still ⬤ AND a bare-prompt tail old enough to call stalled. Only probe
      // when eligible, and at most every ~500ms — an ineligible poll stays cheap (a fast Bash-tool /
      // permission dialog never pays for it).
      const eligible = painted[0] === 'working' && tail.kind === 'prompt' && age > 2500;
      if (!eligible) {
        quietStreak = 0;
        deadStreak = 0;
        if (polls % 12 === 0) watchLog('watch', `ineligible kind=${tail.kind} glyph=${painted[0] || '-'}`
          + ` age=${Number.isFinite(age) ? Math.round(age / 1000) + 's' : '-'}`);
        continue;
      }
      if (Date.now() - lastProbe < 500) continue; // pace the screen probes (~2/s max)
      lastProbe = Date.now();
      const live = probeLive(dir, sid, sessionPid);
      if (live === true) {
        // The bottom bar says the turn is running (thinking/streaming). Positive liveness beats any
        // amount of CPU quiet — this is the 2026-07-15 thinking-false-fire fix.
        quietStreak = 0;
        deadStreak = 0;
        if (polls % 24 === 0) watchLog('watch', `live-turn age=${Math.round(age / 1000)}s`);
        continue;
      }
      if (live === false) {
        deadStreak++;
        if (deadStreak < 2) continue; // two independent screen reads ≥500ms apart
        const cpu = sampleCpu(dir, sid, sessionPid, CPU_MS); // rename-belt: busy client = alive
        watchLog('watch', `no-esc-hint streak=${deadStreak} cpu=${cpu === null ? 'null' : cpu.toFixed(1)}`
          + ` age=${Math.round(age / 1000)}s`);
        if (cpu !== null && cpu >= CPU_THRESH) { deadStreak = 0; continue; }
        await delay(GRACE_MS); // grace: if the turn just concluded, let its Stop hook paint first
        const g2 = readTitle(glyphFile).split('|')[0];
        const t2 = classifyTail(transcript);
        if (g2 === 'working' && t2.kind === 'prompt' && t2.size === lastSize) {
          rescueFromWatch(`no-esc-hint cpu=${cpu === null ? '-' : cpu.toFixed(1)}`, dir, sid, file, cwd, sessionPid);
          return;
        }
        deadStreak = 0;
        continue;
      }
      // live === null — the probe is blind (painter missing / attach denied). Degrade to the CPU-quiet
      // heuristic, but ONLY past FALLBACK_AGE_MS: quiet CPU alone cannot tell thinking from cancelled.
      if (age < FALLBACK_AGE_MS) {
        quietStreak = 0;
        if (polls % 40 === 0) watchLog('watch', `probe-null age=${Math.round(age / 1000)}s`
          + ` (CPU fallback at ${FALLBACK_AGE_MS / 1000}s)`);
        continue;
      }
      const cpu = sampleCpu(dir, sid, sessionPid, CPU_MS); // blocks ~CPU_MS
      quietStreak = (cpu !== null && cpu < CPU_THRESH && !grew && hadBaseline) ? quietStreak + 1 : 0;
      if (polls % 6 === 0 || quietStreak > 0) {
        watchLog('watch', `cpu=${cpu === null ? 'null' : cpu.toFixed(1)} streak=${quietStreak}`
          + ` age=${Math.round(age / 1000)}s`);
      }
      if (quietStreak >= 2) {
        await delay(GRACE_MS); // grace: if the turn just concluded, let its Stop hook paint first
        const g2 = readTitle(glyphFile).split('|')[0];
        const t2 = classifyTail(transcript);
        if (g2 === 'working' && t2.kind === 'prompt' && t2.size === lastSize) {
          rescueFromWatch(`stalled-prompt cpu=${(cpu || 0).toFixed(1)}`, dir, sid, file, cwd, sessionPid);
          return;
        }
        quietStreak = 0;
      }
    }
    watchLog('watch-exit', 'deadline');
  } finally {
    try { fs.unlinkSync(path.join(dir, `${sid}.cpu`)); } catch (_) { /* usually already gone */ }
    try { fs.unlinkSync(path.join(dir, `${sid}.live`)); } catch (_) { /* ignore */ }
  }
}

// Watchdog paint: the watchdog is detached (console-less — its own process.title is a no-op), so
// the visible flip runs through paintViaConsole → title-painter.exe → AttachConsole(claude pid) +
// SetConsoleTitleW → ConPTY → the VS Code tab. setTitle still records {sid}.glyph + the log line.
// A cancel's leftover {sid}.ask is stale — clear it so it can't paint a false ◐ on the NEXT Stop.
function rescueFromWatch(via, dir, sid, file, cwd, ppid) {
  const askFlag = path.join(dir, `${sid}.ask`);
  if (fileExists(askFlag)) { try { fs.unlinkSync(askFlag); } catch (_) { /* ignore */ } }
  const title = normalize(readTitle(file) || folderName(cwd));
  const paint = paintViaConsole(dir, ppid, `${GLYPH.idle} ${title}`);
  if (logCtx) { logCtx.note = 'int-rescue'; logCtx.diag = `via=${via} ${paint}`; }
  setTitle(GLYPH.idle, title);
}

// Find the session's claude.exe by console identity: painter --find attaches each claude.exe
// candidate (from tasklist) and reports the ones whose console title CONTAINS our needle. The
// needle is the NORMALIZED title — byte-identical to what setTitle paints (the raw title FILE is
// lowercase/hyphen; the console shows the capitalized/em-dashed form), so it appears verbatim after
// the glyph prefix. Match is case-insensitive as a further belt. First hit wins; ambiguity is
// possible only when two tabs carry the identical title. Returns 0 while the painter is still
// compiling or nothing matches — the caller retries each poll.
function resolveSessionPid(dir, sid, file, cwd) {
  try {
    const exe = painterPath(dir);
    if (!fileExists(exe)) return 0;
    const cp = require('child_process');
    const rows = cp.execSync('tasklist /FO CSV /NH /FI "IMAGENAME eq claude.exe"', { windowsHide: true }).toString();
    const pids = rows.split('\n')
      .map(l => (l.match(/^"[^"]+","(\d+)"/) || [])[1])
      .filter(Boolean);
    if (!pids.length) return 0;
    const needleFile = path.join(dir, `${sid}.needle`);
    const outFile = path.join(dir, `${sid}.found`);
    fs.writeFileSync(needleFile, normalize(readTitle(file) || folderName(cwd)));
    try { fs.unlinkSync(outFile); } catch (_) { /* ignore */ }
    cp.spawnSync(exe, ['0', '--find', outFile, needleFile].concat(pids), { windowsHide: true, timeout: 8000 });
    const found = readTitle(outFile).split(/\s+/).map(Number).filter(Boolean);
    try { fs.unlinkSync(needleFile); } catch (_) { /* ignore */ }
    try { fs.unlinkSync(outFile); } catch (_) { /* ignore */ }
    return found[0] || 0;
  } catch (_) {
    return 0;
  }
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

// Canonicalize a path for identity comparison — resolve symlinks/junctions AND (on Windows) 8.3
// short names + on-disk casing, so a realpath-resolved __dirname compares equal to an env-derived
// os.homedir() that points at the SAME dir through a symlink (macOS /var -> /private/var), a
// junction, or a short/mis-cased path (the CI-only stand-down miss — 2026-07-13). Falls back to
// path.resolve when the path isn't on disk yet (realpath throws ENOENT) — matches prior behavior
// for the not-yet-created fixture paths the unit tests pass in.
function canonPath(p) {
  try {
    return fs.realpathSync.native(p);
  } catch (_) {
    return path.resolve(p);
  }
}

// Should THIS copy of the hook stand down? True only for the user-level copy (~/.claude/hooks)
// when the session's OWN project (ownerDir = CLAUDE_PROJECT_DIR, cwd fallback) ships a managed
// copy — that's the only case where the project copy is registered and will paint; the project
// copy wins so a session gets ONE directive and ONE title file. The event's live cwd must NOT be
// used here (mid-session cd into a copy-shipping repo would silence both copies — 2026-07-08).
// Parameterized (no ambient __dirname/homedir) for tests.
function shouldDefer(ownerDir, selfDir, selfFile, homeHooksDir) {
  try {
    if (canonPath(selfDir) !== canonPath(homeHooksDir)) return false; // we ARE the project copy
    const projectCopy = path.join(ownerDir, '.claude', 'hooks', 'terminal-title.js');
    return fs.existsSync(projectCopy) && canonPath(projectCopy) !== canonPath(selfFile);
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
// Contract: terminal-title.test.js, golden-endings.test.js, and arcade-beeps.js (lazy-requires
// inspectLastResponse) depend on these names — renaming one silently degrades the beeps hook.
module.exports = { inspectLastResponse, endsOnQuestion, normalize, GLYPH, shouldDefer, solicitsReply };
