#!/usr/bin/env node
/**
 * Terminal Title — distributable plugin hook (installed to <project>/.claude/hooks/terminal-title.js).
 * ONE self-dispatching hook for five events (keyed on hook_event_name):
 *   UserPromptSubmit -> ⬤ working  + inject the per-prompt REMINDER one-liner (+BASELINE while no
 *                       title exists, +COMMAND on /slash turns) + clear any stale {sid}.ask flag
 *                       + spawn the --turn-watch cancel watchdog (a user interrupt fires NO hook,
 *                       so a detached per-turn child detects a dead turn via marker/screen-hint/CPU forensics
 *                       and repaints ✻ through title-painter.exe: AttachConsole+SetConsoleTitleW —
 *                       and flips ◐ early when a permission dialog opens, beating CC's ~6s notification)
 *   PostToolUse      -> ⬤ working  (refresh, so a mid-turn title flip shows live + clears a stale ◐)
 *   Notification     -> ◐ awaiting your approval (permission_prompt matcher) — or, invoked with
 *                       --idle-rescue (idle_prompt matcher), flip a tab left stuck by a user
 *                       interrupt back to ✻ idle (a cancel fires NO hook — Stop never runs);
 *                       gated on transcript-tail forensics (marker / stalled prompt / missing Stop)
 *   Stop             -> ✻ idle / done — OR ◐ awaiting (+ a 2nd BEL = gold tab) when the turn ended
 *                       on a question (last visible response text ends in '?', or a {sid}.ask flag;
 *                       flag turns hand the skipped grade to a detached --post-grade child that logs
 *                       a StopDiag line when CLAUDE_TITLE_DEBUG=1 — paint-first, diagnostics after)
 *                       + the /clear ADVISOR: each history line carries a context-size watermark
 *                       (tokens, read from the transcript's usage), and Stop surfaces a one-shot
 *                       systemMessage when the topics buried behind the current one outweigh 2× the
 *                       session's fixed overhead — the point where a /clear pays for itself in a
 *                       handful of turns (see clearAdvice; dormant unless the project-tier
 *                       token-guard.js is installed beside this hook)
 *   SessionStart     -> ✻ idle "Claude Code — New session" after a /clear (a /continue re-arms the
 *                       carry of the previous title); an existing/carried title on resume/compact/relaunch
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
 * ~512KB-capped, written to .titles/_debug.log — so it never ships a growing log. The handful of
 * those lines that name a BROKEN tab are also teed to .titles/_alarms.log (256KB-capped) so they
 * outlive the much faster debug rotation (see ALARM_RE); /audit-titles reads them.
 *
 * Requires `env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE = "1"` (set by .claude/settings.json's env block), or CC's own writer races.
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
        if (process.env.TITLE_ERR_DEBUG === '1') console.error(err);
        process.exit(0); // never break the turn on a title error — emit nothing
      }
    });
  }
}

// Per-event dispatcher: shared context up top, one onX handler per hook event below (3.4b split —
// handle() was CC 97 as a single function). The Stop guard stays HERE, not inside onStop, so an
// unknown event can never reach the Stop path.
async function handle(data) {
  const { event, sid, cwd, dir, file } = hookContext(data);
  logCtx = { event, sid, dir, note: '', transcript: data.transcript_path || '' };
  contractCanary(data, event, sid);
  if (event === 'UserPromptSubmit') return onUserPromptSubmit(data, dir, sid, file, cwd);
  if (event === 'PostToolUse') return onPostToolUse(dir, sid, file, cwd);
  if (event === 'SessionStart') return onSessionStart(data, dir, sid, file, cwd);
  if (event === 'Notification') return onNotification(data, dir, sid, file, cwd);
  // Only Stop may dispatch the Stop path. Claude Code grows hook events over time; an unknown
  // event falling through here would paint the tab ✻ idle mid-turn. Exit quietly instead.
  if (event !== 'Stop') process.exit(0);
  return onStop(data, dir, sid, file, cwd);
}

// Shared per-event context; exits 0 when this copy must stand down for a managed project copy.
function hookContext(data) {
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
  return { event, sid, cwd, dir, file };
}

// HARNESS-CONTRACT CANARY (debug-only surface): if Claude Code stops supplying a field the
// keying depends on, every fix above silently degrades to its fallback. Record the gap so the
// stale-glyph audit surfaces a platform change as one log line instead of the next mystery.
function contractCanary(data, event, sid) {
  const degraded = [];
  if (!process.env.CLAUDE_PROJECT_DIR) degraded.push('CLAUDE_PROJECT_DIR');
  if (!data.cwd) degraded.push('cwd');
  if (!sid) degraded.push('session_id');
  const needsTranscript = event === 'Stop'
    || (event === 'Notification' && process.argv[2] === '--idle-rescue');
  if (needsTranscript && !data.transcript_path) degraded.push('transcript_path');
  if (degraded.length) logCtx.contract = degraded.join(',');
}

// One-shot {sid}.ask consumption — reports whether the flag was present; deleted either way.
// Callers: UserPromptSubmit clears a stale flag, Stop's fast path honors it, the idle rescue
// honors it only on the no-stop path (see each call site).
function consumeAskFlag(dir, sid) {
  const askFile = path.join(dir, `${sid}.ask`);
  if (!fileExists(askFile)) return false;
  try { fs.unlinkSync(askFile); } catch (_) { /* ignore */ }
  return true;
}

// /continue re-arms the post-/clear title carry (see carriedTitle): the user is explicitly
// resuming the previous session's work, so its title becomes right again. One-way stamp,
// BEFORE the title resolves in the caller so the restored title paints on this very turn.
function armContinueCarry(dir, sid, prompt) {
  if (!/^\s*\/continue(?:\s|$)/.test(String(prompt || ''))) return;
  try { fs.writeFileSync(path.join(dir, `${sid}.continued`), '1'); } catch (_) { /* best-effort */ }
}

function onUserPromptSubmit(data, dir, sid, file, cwd) {
  // Ensure the state dir exists, but NOT the file — the model's Write tool refuses to overwrite a
  // file it hasn't read, so a pre-created empty file would make its first title write fail.
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* ignore */ }
  // Clear any stale {sid}.ask left by an interrupted prior turn (Stop never ran to consume it), so a
  // leftover flag can't paint a false ◐ on this turn's end. The flag must reflect ONLY this turn.
  consumeAskFlag(dir, sid);
  ensureStartedAt(dir, sid); // belt for sessions that predate the guard (no SessionStart stamp)
  armContinueCarry(dir, sid, data.prompt);
  const title = normalize(displayTitle(file, dir, sid, cwd));
  // Duplicate-session guard: is another tab already live on this exact work? (see dupeGuardResult)
  const guard = dupeGuardResult(dir, sid, title, cwd);
  if (guard && guard.block) {
    try { process.title = `${GLYPH.awaiting} ${title}`; } catch (_) { /* ignore */ }
    if (logCtx) { logCtx.note = 'dupe-block'; logCtx.diag = guard.diag; }
    emit({ decision: 'block', reason: guard.reason });
    return;
  }
  const out = setTitle(GLYPH.working, title);
  out.hookSpecificOutput = {
    hookEventName: 'UserPromptSubmit',
    additionalContext: buildDirective(data, file, cwd),
  };
  if (guard && guard.systemMessage) out.systemMessage = guard.systemMessage;
  // A user interrupt fires NO hook and CC's idle_prompt notification is not delivered after one
  // (verified 2026-07-11), so each turn gets a watchdog child that notices a dead turn itself.
  spawnTurnWatch(data, dir, sid, file, cwd);
  emit(out);
}

// Needle-drift canary: a PostToolUse is PROOF the turn is alive. If the watchdog read the
// screen as "dead" earlier in THIS turn (breadcrumb nonce == this turn's watch nonce), the
// probe needle no longer matches CC's bottom-bar hint — a false-dead that would re-open the
// thinking false-fire the moment CPU goes quiet. Flag the dir so dead reads demote to the
// blind 120s fallback (slow beats wrong); a future LIVE read retracts the flag. A nonce
// MISMATCH is just a real cancel's leftover breadcrumb — consumed without flagging.
function consumeProbeCanary(dir, sid) {
  try {
    const probeFile = path.join(dir, `${sid}.probe`);
    if (!fileExists(probeFile)) return;
    const probeNonce = fs.readFileSync(probeFile, 'utf8').split('|')[0];
    let curNonce = '';
    try { curNonce = fs.readFileSync(path.join(dir, `${sid}.watch`), 'utf8').trim(); } catch (_) { /* no watch */ }
    fs.unlinkSync(probeFile); // one-shot either way
    if (probeNonce && probeNonce === curNonce) {
      fs.writeFileSync(path.join(dir, 'needle-distrust'), `${new Date().toISOString()} sid=${sid}`);
      if (logCtx) { logCtx.note = 'needle-drift'; logCtx.diag = `dead-read on a live turn nonce=${probeNonce}`; }
    }
  } catch (_) { /* the canary is best-effort — never block the repaint */ }
}

function onPostToolUse(dir, sid, file, cwd) {
  // Only refresh once a real title exists; don't stamp the bare folder over what UPS showed.
  const raw = readTitle(file);
  if (!raw) process.exit(0);
  consumeProbeCanary(dir, sid);
  const title = normalize(raw);
  // Paint-time duplicate guard — catches collisions born mid-turn (see dupeGuardPaint).
  const guard = dupeGuardPaint(dir, sid, title, cwd);
  const out = setTitle(GLYPH.working, title);
  if (guard) {
    if (guard.systemMessage) out.systemMessage = guard.systemMessage;
    if (guard.additionalContext) {
      out.hookSpecificOutput = { hookEventName: 'PostToolUse', additionalContext: guard.additionalContext };
    }
    if (logCtx) { logCtx.note = (logCtx.note ? `${logCtx.note}+` : '') + 'dupe-paint'; logCtx.diag = guard.diag; }
  }
  emit(out);
}

function onSessionStart(data, dir, sid, file, cwd) {
  // Stamp the terminal lineage FIRST (see recordLineage): on a /clear or same-tab relaunch this
  // records the cleared sid as this session's "previous" — what bare /recover-context recovers,
  // and what carriedTitle() reads just below to carry the last title onto the tab.
  recordLineage(dir, sid, data.source || '');
  // Stamp this session's birth time (ordering token for the duplicate-session guard's kill mode).
  ensureStartedAt(dir, sid);
  // Fresh-session title: this session's own (preferred on resume/compact), else the previous
  // session's last title carried over on a same-tab relaunch (the first turn's BASELINE authoring
  // supersedes it), else the placeholder. A /clear-born session gets the PLACEHOLDER, not the
  // carry — the next prompt could be anything; /continue re-arms the carry (see carriedTitle).
  const title = normalize(readTitle(file) || carriedTitle(dir, sid) || 'Claude Code - New session');
  const out = setTitle(GLYPH.idle, title);
  // Inject the FULL rulebook here — once per session — instead of on every prompt. All sources
  // get it: startup/clear teach a fresh context, resume/compact re-teach a squeezed one.
  const rules = buildBlocks(['RULES'], file, cwd, '');
  if (rules) {
    out.hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext: rules };
  }
  emit(out);
}

function onNotification(data, dir, sid, file, cwd) {
  if (process.argv[2] === '--idle-rescue') return onIdleRescue(data, dir, sid, file, cwd);
  // A permission prompt is open. Single BEL only — CC already rings its own bell here (tab already gold).
  emit(setTitle(GLYPH.awaiting, normalize(displayTitle(file, dir, sid, cwd))));
}

// --idle-rescue (idle_prompt matcher): a user interrupt fires NO hook — Stop never runs — and a
// thinking-phase cancel writes NOTHING to the transcript either (verified 2026-07-11: Esc during
// "Percolating" left the file untouched; the "[Request interrupted…]" marker only shows up for
// tool-use cancels). So the rescue triangulates from what IS observable once CC reports the REPL
// idle: the newest transcript entry, its age, and the last-painted glyph (rescueVerdict holds the
// tail→verdict map). ◐ question tabs are never downgraded, and a LIVE permission dialog is
// indistinguishable from a canceled one, so awaiting|Notification is only ever rescued by a
// marker. Declines log note=int-decline when CLAUDE_TITLE_DEBUG=1.
async function onIdleRescue(data, dir, sid, file, cwd) {
  const glyphFile = path.join(dir, `${sid}.glyph`);
  const painted = readTitle(glyphFile).split('|');
  const lastGlyph = painted[0];
  const decline = (why) => {
    if (logCtx) { logCtx.note = 'int-decline'; logCtx.diag = why; }
    titleLog(GLYPH[lastGlyph] || GLYPH.idle, normalize(displayTitle(file, dir, sid, cwd)), false);
    process.exit(0);
  };
  if (lastGlyph === 'idle') decline('already-idle');
  if (lastGlyph === 'awaiting' && painted[1] !== 'Notification') decline('question-tab');
  const verdict = await rescueVerdict(data.transcript_path, lastGlyph, glyphFile);
  if (verdict.decline) decline(verdict.decline);
  // Confirmed: the turn ended without a Stop. An unconsumed {sid}.ask on the no-stop path is a
  // KILLED Stop's question turn — honor it with ◐ + ring; on a confirmed cancel it's a leftover —
  // clear it either way so it can't paint a false ◐ on the NEXT turn's Stop.
  const hadAsk = consumeAskFlag(dir, sid);
  const honorAsk = verdict.via === 'no-stop' && hadAsk;
  if (logCtx) { logCtx.note = 'int-rescue'; logCtx.diag = `via=${verdict.via} ask=${honorAsk ? 1 : 0}`; }
  emit(setTitle(honorAsk ? GLYPH.awaiting : GLYPH.idle, normalize(displayTitle(file, dir, sid, cwd)), honorAsk));
}

// The rescue's tail→verdict map — {via} when the turn provably ended without a Stop, {decline: why}
// when it must be left alone:
//   marker tail → canceled, definitely → paint ✻
//   bare-prompt tail, ≥2.2s old, transcript unmoved, glyph ⬤ → the turn died with the cancel
//     (a live turn would have flushed something; a just-submitted one is younger) → paint ✻
//   assistant tail + glyph still ⬤ after a 1.6s grace → mid-response cancel or a KILLED Stop
//     (the grace lets a racing Stop hook paint first — that's what keeps the ~0ms
//     messageIdleNotifThresholdMs safe)
//   anything else → decline WITHOUT emitting.
async function rescueVerdict(transcriptPath, lastGlyph, glyphFile) {
  let tail = classifyTail(transcriptPath);
  // ~200ms JSONL append lag (same flush race the Stop grade guards)
  for (let i = 0; tail.kind === 'none' && i < 3; i++) {
    await delay(150);
    tail = classifyTail(transcriptPath);
  }
  if (tail.kind === 'marker') return { via: 'marker' };
  if (lastGlyph !== 'working') return { decline: `kind=${tail.kind} glyph=${lastGlyph || '-'}` };
  if (tail.kind === 'prompt') return rescueStalledPrompt(transcriptPath, tail);
  if (tail.kind === 'assistant') {
    await delay(1600); // grace: let a racing Stop hook finish its own paint
    if (readTitle(glyphFile).split('|')[0] !== 'working') return { decline: 'stop-painted' };
    return { via: 'no-stop' };
  }
  return { decline: 'no-transcript' };
}

async function rescueStalledPrompt(transcriptPath, tail) {
  const age = tail.ts ? Date.now() - Date.parse(tail.ts) : NaN;
  if (!(age > 0)) return { decline: 'prompt-unaged' }; // no/garbled timestamp — can't prove the stall
  if (age < 2200) await delay(2200 - age);
  const again = classifyTail(transcriptPath);
  if (again.kind !== 'prompt' || again.size !== tail.size) return { decline: 'turn-progressed' };
  return { via: 'stalled-prompt' };
}

// Stop: idle, UNLESS the turn ended on a question the user must answer — then awaiting + a 2nd BEL
// so VS Code paints the (otherwise bell-less) tab gold. "Ended on a question" = last visible
// assistant text ends in '?' (transcript heuristic) OR an explicit {sid}.ask flag (consumed here).
async function onStop(data, dir, sid, file, cwd) {
  // FAILSAFE PRE-PAINT — flip to ✻ idle SYNCHRONOUSLY now, before the async grade below. That grade
  // reads/re-reads the transcript to dodge the flush race and can either throw (caught → exit 0, emits
  // nothing) or be killed on a huge, slow-to-flush final message — either way it would otherwise leave
  // the tab stuck on the last ⬤. process.title (SetConsoleTitleW) takes effect immediately and persists
  // after exit, so the tab is correct even if we die below. Idle is the default Stop outcome; the grade
  // only ever UPGRADES it to ◐ awaiting (worst case: a <1s ✻ flash before ◐ on a question turn, and the
  // {sid}.ask flag already backstops that case).
  try { process.title = `${GLYPH.idle} ${normalize(displayTitle(file, dir, sid, cwd))}`; } catch (_) { /* ignore */ }

  // FAST PATH — the {sid}.ask flag is the race-proof "ended on a question" signal, written to disk BEFORE
  // Stop fires. When present, paint ◐ awaiting and emit() IMMEDIATELY, skipping the transcript grade below.
  // This is the stuck-⬤ fix: emit() (the terminalSequence CC applies on clean exit) is the ONLY paint VS
  // Code honors, and the async grade can be KILLED on a huge / slow-to-flush transcript before it reaches
  // emit() — which froze the tab on the last ⬤ working. Reaching emit() synchronously here closes that
  // window for every flagged question turn (the common case). SetConsoleTitleW above is a Win-terminal-only
  // bonus; VS Code never saw it, which is why the failsafe alone didn't rescue the tab.
  if (consumeAskFlag(dir, sid)) return onStopAskFlag(data, dir, sid, file, cwd);
  const graded = await gradeStopTranscript(data.transcript_path);
  emitStopVerdict(graded, dir, sid, file, cwd, data.transcript_path);
}

function onStopAskFlag(data, dir, sid, file, cwd) {
  const deferred = spawnDeferredGrade(data, dir, sid, file, cwd);
  if (logCtx) {
    logCtx.note = 'ask-flag';
    logCtx.diag = `ask=1 fast-path (${deferred ? 'grade deferred to StopDiag' : 'grade skipped'})`;
  }
  const out = setTitle(GLYPH.awaiting, normalize(displayTitle(file, dir, sid, cwd)), true);
  // Advisor AFTER the paint (setTitle may append this turn's history line) and bounded (one
  // tiny ledger read + one 64KB tail read) — it can never re-open the kill window this fast
  // path exists to close.
  const advice = clearAdvice(dir, sid, data.transcript_path);
  if (advice) out.systemMessage = advice;
  emit(out);
}

// No flag → default idle, but the turn may have ended on '?' without one. Grade the transcript, guarding
// the flush race: the final assistant text can land in the JSONL a beat AFTER Stop fires (~200ms append
// lag). `suspectRace` (freshest on-disk assistant block is text-less, or none found) means the real final
// message is still flushing → re-read a few times before grading. Each pass reads only the transcript
// TAIL, so the loop stays fast on a multi-MB transcript and always reaches emit().
async function gradeStopTranscript(transcriptPath) {
  let q = inspectLastResponse(transcriptPath);
  let reread = 0;
  while (!q.ends && (q.suspectRace || !q.found) && reread < 7) {
    await delay(120);
    reread++;
    q = inspectLastResponse(transcriptPath);
    if (q.ends || (q.found && !q.suspectRace)) break;
  }
  return { q, reread };
}

function emitStopVerdict(graded, dir, sid, file, cwd, transcriptPath) {
  const { q, reread } = graded;
  // LEXICAL RESCUE — no '?' on the final line, but its closing sentence is a formulaic offer
  // ("Say the word and I'll…", "Want me to…"): the phrasing directive slipped. Paint ◐ anyway so
  // the user still gets the awaiting signal; via=lex marks it a prose DEFECT for the miss-audit,
  // not a working-as-intended path.
  const lex = !q.ends && q.solicits === true;
  const pending = q.ends || lex;
  if (logCtx) {
    logCtx.note = pending ? (lex ? 'lex' : 'q-mark') : 'idle';
    logCtx.diag = stopDiag(q, lex, reread);
  }
  const glyph = pending ? GLYPH.awaiting : GLYPH.idle;
  const out = setTitle(glyph, normalize(displayTitle(file, dir, sid, cwd)), pending);
  const advice = clearAdvice(dir, sid, transcriptPath);
  if (advice) out.systemMessage = advice;
  emit(out);
}

function stopDiag(q, lex, reread) {
  return `ask=0 qmark=${q.ends ? 1 : 0} via=${lex ? 'lex' : (q.via || '-')} found=${q.found ? 1 : 0} reread=${reread} model=${q.model || '-'} tail="${q.tail}"`;
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
    // Durable per-session title timeline ({sid}.history.jsonl) — merged by the
    // /terminal-title-history reader, so a session's context outline survives after _debug.log
    // (debug-gated AND size-rotated) ages out. Append-on-change only: the file stays a handful of
    // lines, one per context shift. Best-effort like the glyph file.
    try {
      const hf = path.join(logCtx.dir, `${logCtx.sid}.history.jsonl`);
      let last = '', lastTs = '';
      try {
        const lines = fs.readFileSync(hf, 'utf8').trim().split('\n');
        const prev = JSON.parse(lines[lines.length - 1]);
        last = prev.title || '';
        lastTs = prev.ts || '';
      } catch (_) { /* no history yet */ }
      // Context-size WATERMARK. Sampled on EVERY paint into the marks ledger (see recordMark) —
      // title shifts alone are far too rare to floor the /clear advisor, because the directive
      // rightly tells the model a title is "a compass, not a log: change it rarely". Measured
      // 2026-07-29: only 63 of 199 histories ever reached the 2 watermarks clearAdvice required,
      // so it fired on ~5% of sessions. The history entry keeps its own optional `tokens` field
      // for the readers that already parse it.
      const tokens = readContextTokens(logCtx.transcript || '');
      recordMark(logCtx.dir, logCtx.sid, tokens);
      // Per-topic WRITE watermark, the other half of the /clear advisor's evidence (see
      // recordWrites). Attributed to `lastTs` — the newest history entry BEFORE this paint's own
      // append — because that is the topic that was current WHILE the work happened. A paint that
      // shifts the title is reporting on a turn that ran under the OLD title, so stamping the new
      // one would credit a topic that has not done anything yet.
      if (lastTs) recordWrites(logCtx.dir, logCtx.sid, lastTs, readTailWrites(logCtx.transcript || ''));
      if (title !== last) {
        // Optional field (absent when the transcript has no flushed usage yet, e.g. the very
        // first UPS paint); history readers must tolerate both shapes.
        const entry = { ts: new Date().toISOString(), title };
        if (tokens > 0) entry.tokens = tokens;
        fs.appendFileSync(hf, `${JSON.stringify(entry)}\n`);
      }
    } catch (_) { /* history must never block a paint */ }
  }
  let seq = `${ESC}]0;${text}${BEL}`;
  if (ring) seq += BEL;
  titleLog(glyph, title, ring);
  return { terminalSequence: seq };
}

// The two diagnostics that mean a tab is ACTUALLY broken rather than merely interesting:
// PID-COLLISION (the watchdog bound to a sibling tab's process) and verify=STRANDED (the deadline
// expired with ⬤ still painted). Both fire at most once per watchdog lifecycle, so they are rare —
// and rare is exactly what _debug.log loses: it fills its 512KB in ~70min on a busy project, so an
// alarm that fires overnight has rotated away before anyone greps it. Tee them to their own log,
// which rotates ~1000 alarms deep instead, so /audit-titles no longer races that rotation.
// Both producers (claimPid, deadlineDiag's verify read-back) sit behind CLAUDE_TITLE_DEBUG=1
// themselves — deliberately, since neither is behavior — so alarms only accrue while forensics
// are on, and the tee inherits that gate rather than fighting it. Ungating them would ship a
// per-turn ledger write and a per-deadline exe spawn to every install for a field only an
// investigation ever reads.
const ALARM_RE = /PID-COLLISION|verify=STRANDED/;

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
    if (ALARM_RE.test(line)) appendCapped(path.join(logCtx.dir, '_alarms.log'), line, 256 * 1024);
    appendCapped(path.join(logCtx.dir, '_debug.log'), line, 512 * 1024);
  } catch (_) { /* logging must never throw */ }
}

// Append with a single size-capped rotation, so no log here can grow without bound.
function appendCapped(file, line, max) {
  try { if (fs.statSync(file).size > max) fs.renameSync(file, `${file}.1`); } catch (_) { /* none yet */ }
  fs.appendFileSync(file, line);
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

// ---- /clear advisor ------------------------------------------------------------------------
// The watermarked title history is a per-use-case cost ledger: each history line's `tokens` is
// the context size the session carried when that topic began, so the latest entry's watermark is
// exactly the candidate-dead history buried behind the current topic. clearAdvice applies the
// cache break-even rule to that ledger; readContextTokens supplies the measurements.

// Bounded 64KB tail of a transcript, shared by the two probes below (same shape as classifyTail, so
// it stays fast on a multi-MB file). Everything either probe wants — the newest usage block, the
// turns' tool calls — lives at the end. The window's first line is usually a partial record; both
// callers parse line-by-line and drop what fails, so it costs nothing to leave in. '' = no data.
function readTranscriptTail(transcriptPath) {
  if (!transcriptPath) return '';
  try {
    const TAIL_BYTES = 64 * 1024;
    const size = fs.statSync(transcriptPath).size;
    const fd = fs.openSync(transcriptPath, 'r');
    try {
      const len = Math.min(TAIL_BYTES, size);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return '';
  }
}

// Current context size — input + cache_read + cache_creation of the NEWEST main-loop assistant
// message, from the bounded tail above. Sidechain (subagent) entries are skipped: their usage is
// not the main loop's context. Returns 0 for "no data" (missing/unflushed transcript) — callers
// must treat 0 as unknown, never stamp or advise on it.
function readContextTokens(transcriptPath) {
  const content = readTranscriptTail(transcriptPath);
  if (!content) return 0;
  const lines = content.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch (_) { continue; } // includes the tail window's partial first line
    if (!obj || obj.type !== 'assistant' || obj.isSidechain) continue;
    const u = obj.message && obj.message.usage;
    if (!u) continue;
    const total = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    if (total > 0) return total;
  }
  return 0;
}

// Files the tail's turns actually WROTE — the raw material of the /clear advisor's done-ness gate.
// The tool NAME is the whole signal: these four are the only things the model does that leave
// something on disk to re-read later, and everything else it did is recoverable only from the
// conversation. Sidechain entries count here even though readContextTokens skips them — a
// subagent's write lands on disk exactly like the main loop's, and the reason to skip sidechains
// (their usage is not the main loop's context) says nothing about files.
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// The file a single content block targets, or '' for anything that isn't a write tool. Both path
// keys are read because NotebookEdit names its target `notebook_path` while the other three use
// `file_path`.
function writeToolPath(b) {
  if (!b || b.type !== 'tool_use' || !WRITE_TOOLS.has(b.name)) return '';
  const p = b.input && (b.input.file_path || b.input.notebook_path);
  return typeof p === 'string' ? p : '';
}
// The write-tool paths one transcript line names, in order. A non-JSON line (which includes the
// tail window's partial first line) or a turn with no tool_use blocks yields nothing.
function writePathsOfLine(line) {
  const t = line.trim();
  if (!t) return [];
  let obj;
  try { obj = JSON.parse(t); } catch (_) { return []; }
  const blocks = obj && obj.message && obj.message.content;
  if (!Array.isArray(blocks)) return [];
  const out = [];
  for (const b of blocks) {
    const p = writeToolPath(b);
    if (p) out.push(p);
  }
  return out;
}
function readTailWrites(transcriptPath) {
  const content = readTranscriptTail(transcriptPath);
  if (!content) return [];
  const out = [];
  const seen = new Set();
  for (const line of content.split('\n')) {
    for (const p of writePathsOfLine(line)) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

// Per-paint context WATERMARK ledger ({sid}.marks.json) — O(1) and never grows: { fixed, latest, n }.
// clearAdvice's F (the session's irreducible overhead: system prompt, CLAUDE.md, rules, memory)
// needs an EARLY sample to be right, but title shifts are deliberately rare, so deriving F from
// them alone starved the advisory. Sampling every paint decouples measuring the floor from how
// often the user's work happens to change topic.
// A SHRINK re-bases the whole record: auto-compact replaced the context, so earlier watermarks
// describe a context that no longer exists — the same rule the history window already applied.
const MARK_SHRINK = 0.6; // latest below 60% of the prior sample = compaction, not ordinary drift
// The marks record as it sits on disk, or null when there is none yet / it is unreadable.
function readMarkFile(mf) {
  try { return JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (_) { return null; } // first mark of the session
}
function writeMarkFile(mf, m) {
  try { fs.writeFileSync(mf, JSON.stringify(m)); } catch (_) { /* best-effort, like the glyph file */ }
}
// No usable record, or a shrink deep enough to mean the context was replaced rather than drifting.
function needsRebase(m, tokens) {
  return !m || !(m.fixed > 0) || tokens < m.latest * MARK_SHRINK;
}
// A shrink re-bases the CONTEXT watermarks; it says nothing about files already on disk, so the
// write ledger rides across the re-base deliberately.
function rebaseMark(m, tokens) {
  const fresh = { fixed: tokens, latest: tokens, n: 0 };
  const carried = m && m.writes;
  if (carried) fresh.writes = carried;
  return fresh;
}
function recordMark(dir, sid, tokens) {
  if (!(tokens > 0)) return null; // 0 = unknown (unflushed transcript); never stamp on a guess
  const mf = path.join(dir, `${sid}.marks.json`);
  let m = readMarkFile(mf);
  if (needsRebase(m, tokens)) m = rebaseMark(m, tokens);
  m.fixed = Math.min(m.fixed, tokens);
  m.latest = tokens;
  m.n = (m.n || 0) + 1;
  writeMarkFile(mf, m);
  return m;
}
// Usable only with 2+ samples — one paint cannot separate the fixed floor from the live context.
function readMarks(dir, sid) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, `${sid}.marks.json`), 'utf8'));
    return m && m.fixed > 0 && m.n >= 2 ? m : null;
  } catch (_) { return null; }
}

// Per-topic WRITE ledger, kept beside the watermarks in {sid}.marks.json as an optional `writes`
// map keyed by the topic's history ts. Paints happen every turn and the tail window always covers
// the turn just finished, so nothing is missed; the same write re-seen on later paints is deduped
// by path. Bounded twice over — paths per topic, then topics — because "a handful per session" is
// the expectation, not a guarantee, and this file is read on every paint.
// ADDITIVE: the key is created the first time this runs, so its ABSENCE means the ledger predates
// this code (clearAdvice reads that as "unknown"), while an empty list is a measured zero.
const WRITES_PER_TOPIC = 25;
const WRITE_TOPICS = 40;
// The topic map and this topic's list, plus whether either had to be conjured — a map or a list
// that did not exist is itself a change worth persisting, independent of any path being added.
function topicSlot(m, topicTs) {
  const w = (m.writes && typeof m.writes === 'object') ? m.writes : {};
  const had = Array.isArray(w[topicTs]);
  return { w, cur: had ? w[topicTs] : [], fresh: !m.writes || !had }; // first run, or this topic's first entry
}
// Append the paints's new paths to the topic's list, capped. True when anything was added.
function appendTopicPaths(cur, paths) {
  let added = false;
  for (const p of paths || []) {
    if (cur.length >= WRITES_PER_TOPIC) break; // enough to answer "did this topic produce anything"
    if (cur.indexOf(p) !== -1) continue;
    cur.push(p);
    added = true;
  }
  return added;
}
// Drop the oldest topics past the cap. True when anything was evicted.
function evictOldTopics(w) {
  const keys = Object.keys(w);
  if (keys.length <= WRITE_TOPICS) return false;
  keys.sort(); // history ts is ISO-8601, so lexical order is chronological — drop the oldest
  for (const k of keys.slice(0, keys.length - WRITE_TOPICS)) delete w[k];
  return true;
}
function recordWrites(dir, sid, topicTs, paths) {
  if (!topicTs) return null; // nothing to attribute it to — the session's first paint
  const mf = path.join(dir, `${sid}.marks.json`);
  let m = readMarkFile(mf); // null = no marks yet
  if (!m || typeof m !== 'object') m = {};
  const { w, cur, fresh } = topicSlot(m, topicTs);
  let changed = fresh;
  if (appendTopicPaths(cur, paths)) changed = true;
  // ⛔ UNCONDITIONAL, even when `cur` is []. clearAdvice's done-ness gate reads an ABSENT key as
  // "never observed" (unknown → decline to gate) and an empty array as a MEASURED ZERO (→ gate).
  // Making this conditional on cur.length looks like a null-object cleanup and silently un-gates
  // the advisory; `terminal-title-clear-advice.test.cjs:252` pins the contract from the test side.
  w[topicTs] = cur;
  if (evictOldTopics(w)) changed = true;
  m.writes = w;
  if (!changed) return m; // steady state: most paints see nothing new, so don't rewrite the file
  writeMarkFile(mf, m);
  return m;
}

// The write ledger as clearAdvice needs it: null when the file has no `writes` key AT ALL (nothing
// has recorded one yet), which is a different fact from an empty map. readMarks cannot serve this —
// it withholds the record below 2 samples, and done-ness has nothing to do with the sample count.
function readWriteLedger(dir, sid) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, `${sid}.marks.json`), 'utf8'));
    return m && m.writes && typeof m.writes === 'object' ? m.writes : null;
  } catch (_) { return null; }
}

// Should the user be advised to /clear? Break-even rule over the ledger: with F = the session's
// fixed overhead (≈ the smallest watermark in the window) and dead = the current topic's starting
// watermark − F (everything buried behind it), cache reads bill dead at 0.1× every turn while a
// post-/clear re-write of F costs 1.25–2× once — so at dead ≥ 2×F a /clear pays for itself within
// a handful of turns, faster as dead grows. Advise at that point, at most ONCE per topic
// ({sid}.advice pins the advised entry's ts; the next qualifying title shift re-arms it).
// HONEST-NUMBERS CONTRACT: every figure in the line is measured from the ledger/transcript —
// too few watermarks or an unreadable transcript means NO advisory, never an estimated one.
// The window re-bases after any watermark SHRINK (auto-compact replaced the context; earlier
// watermarks describe a context that no longer exists). Relevance is the one thing the math
// cannot see, so the wording stays conditional ("if they're done") and the user decides.
function clearAdvice(dir, sid, transcriptPath) {
  try {
    // Install gate: the advisory belongs to the cost-control tooling family and ships dormant —
    // it speaks only where the project-tier token-guard.js sits beside the hooks dir (the same
    // discriminator statusline-cost.js keys on; user installs never receive that file). The
    // ledger/watermark writes elsewhere in this hook stay unconditional either way — R6 drift
    // and /migrate-new-session read them regardless of whether the advisory may speak.
    if (!fs.existsSync(path.join(dir, '..', 'token-guard.js'))) return '';
    const ADVICE_FLOOR = 40000; // below this much dead history a /clear isn't worth a nudge in any repo
    const hf = path.join(dir, `${sid}.history.jsonl`);
    const all = fs.readFileSync(hf, 'utf8').trim().split('\n')
      .map(l => { try { return JSON.parse(l); } catch (_) { return null; } })
      .filter(e => e && e.ts);
    if (!all.length) return '';
    const entries = all.filter(e => e.tokens > 0);
    // Re-base the topic window on a watermark shrink (auto-compact), as before.
    let start = 0;
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].tokens < entries[i - 1].tokens) start = i;
    }
    const win = entries.slice(start);
    // F comes from the per-paint marks ledger when it has one (i.e. every session since this
    // shipped), and falls back to the old title-shift watermarks for sessions that predate it —
    // which is also why the 2-entry minimum survives only on that fallback path.
    const marks = readMarks(dir, sid);
    let fixed;
    if (marks) {
      fixed = win.length ? Math.min(marks.fixed, Math.min.apply(null, win.map(e => e.tokens))) : marks.fixed;
    } else {
      if (win.length < 2) return '';
      fixed = Math.min.apply(null, win.map(e => e.tokens));
    }
    const current = readContextTokens(transcriptPath) || (marks && marks.latest) ||
      (win.length ? win[win.length - 1].tokens : 0);
    if (!(current > 0) || !(fixed > 0)) return '';
    // RELEVANCE JOIN on title structure. A title is `{scope} — {use-case}[ — {sub-function}]`, so
    // the shared LEADING segments between the current title and an earlier one grade how much of
    // that earlier context is still load-bearing (measured over 309 real shifts, 2026-07-29):
    //   0 shared   different scope; all of it is dead ................... 59%
    //   1 shared   same scope, new goal; the goal's context is dead ..... 38%
    //   2+ shared  same scope AND goal, only the sub-function moved ->LIVE  3%
    // The 2+ case is rare but it is the expensive one to get wrong: advising a /clear mid-goal
    // discards context the NEXT sub-step still needs. Depth is NOT a magnitude signal — topic cost
    // does not track segment count (3-segment topics measured slightly pricier, not cheaper) — it
    // is the join key that says WHICH context is dead, which is the half the math cannot see.
    const segsOf = t => String(t || '').split(EMDASH).map(s => s.trim()).filter(Boolean);
    const sharedLead = (a, b) => {
      let i = 0;
      while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++;
      return i;
    };
    const curSegs = segsOf(all[all.length - 1].title);
    // Walk back over the unbroken run sharing scope+goal with the current title: that run is the
    // LIVE goal, and only what sits BEFORE it is what a /clear would actually shed.
    let liveIdx = all.length - 1;
    while (liveIdx > 0 && sharedLead(segsOf(all[liveIdx - 1].title), curSegs) >= 2) liveIdx--;
    const topics = liveIdx; // entries strictly before the live run — the genuinely dead ones
    // Prefer the watermark from the moment the live goal began: the live goal's own context is not
    // dead, so `current` would overstate the shed. Fall back to `current` when it carries no mark.
    const deadFrom = topics > 0 && all[liveIdx].tokens > 0 ? all[liveIdx].tokens : current;
    const dead = deadFrom - fixed;
    if (dead < 2 * fixed || dead < ADVICE_FLOOR) return '';
    // DONE-NESS GATE. Size says the context is expensive; it cannot say the topic is FINISHED. What
    // can is whether the topic externalised its decisions into files — once they are on disk the
    // conversation that produced them is recoverable by re-reading them, which is exactly the claim
    // "if they're done" is making. A dead topic that wrote nothing is discussion-only, and its
    // context is the only copy.
    // SURVIVING files, not edit events: written-then-deleted leaves nothing to re-read, so it must
    // not buy a "you're done". (Written-then-reverted-in-place still counts — detecting that would
    // mean hashing every write on every paint, and the honest limit is cheaper than a wrong claim.)
    // A null ledger is a session that predates this code: unknown, so decline to gate rather than
    // invent a verdict — HONEST-NUMBERS CONTRACT. An empty list is a measured zero and does gate.
    const ledger = readWriteLedger(dir, sid);
    if (ledger) {
      // With no dead topic the advisory proposes shedding this topic's OWN earlier turns, so the
      // whole window is what has to have produced something.
      const shed = topics > 0 ? all.slice(0, liveIdx) : all;
      // The same absence-vs-zero rule applies PER TOPIC: a shed topic with no key was never
      // observed by the ledger (it predates the ledger's creation — recordWrites keys only the
      // topic current at paint time), so its writes are unknown, not zero. Gate only when the
      // ledger actually watched at least part of the shed window.
      const observed = shed.some(e => Array.isArray(ledger[e.ts]));
      const survives = p => { try { return fs.existsSync(p); } catch (_) { return false; } };
      if (observed && !shed.some(e => (ledger[e.ts] || []).some(survives))) return '';
    }
    // Once per topic: pin the CURRENT topic's ts (newest history entry, watermarked or not), so
    // the next title shift re-arms it. A session that never re-titles is advised exactly once.
    const topicTs = all[all.length - 1].ts;
    const adviceFile = path.join(dir, `${sid}.advice`);
    if (readTitle(adviceFile) === topicTs) return ''; // already advised for this topic
    const pct = Math.min(99, Math.round((dead / current) * 100));
    try { fs.writeFileSync(adviceFile, topicTs); } catch (_) { /* best-effort one-shot */ }
    const k = n => `${Math.round(n / 1000)}k`;
    // Single-topic sessions are now reachable (they were the starved case), and there the
    // "earlier topics" framing would be a lie — the dead weight is this topic's own history.
    const what = topics === 0
      ? `earlier work still ride in context ${EMDASH} if that's behind you`
      : `${topics} earlier topic${topics === 1 ? '' : 's'} still ride in context `
        + `${EMDASH} if ${topics === 1 ? "it's" : "they're"} done`;
    // "Hey ${EMDASH}" prefix is the house style for every guard line we author (token-guard's asks
    // open the same way) — it marks the line as OURS rather than Claude Code's own output.
    // The /continue tail is not optional politeness: `topics` counts only the entries BEFORE the
    // live run, so the live goal is still IN FLIGHT whenever this fires — a bare /clear sheds the
    // dead topics AND the task the user is mid-way through. /continue is the resume path (the same
    // one carriedTitle re-arms on, above), and it stays a parenthetical so the ~pct% reads as
    // /clear's alone: /continue's recovery read is a cost, and it is already inside the 1.25–2×
    // one-time re-write of F that ADVICE_FLOOR's payback math budgets for.
    return `\u{1F4A1} Hey ${EMDASH} ~${k(dead)} tokens of ${what}, /clear cuts per-turn input cost ~${pct}%`
      + ` (/continue picks this task back up)`;
  } catch (_) {
    return ''; // no ledger — never advise on guesses
  }
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
      title: normalize(displayTitle(file, dir, sid, cwd)),
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

// Terminal lineage — an explicit "which session ran in THIS terminal before me" registry
// (config over convention: /recover-context's auto mode reads it instead of guessing by
// transcript mtime). The terminal's identity is anchored to the process that LAUNCHED
// claude — the tab's shell — which outlives both /clear (same claude process) and a claude
// exit+relaunch in the same tab. Found by walking the process ancestry: scanning from the
// TOP of the chain down, the first claude/node entry is the claude process itself (anything
// below it is hook plumbing — node self, cmd /c wrappers); its parent is the anchor.
// Windows pays one ~1s PowerShell spawn — SessionStart-only, never on a turn. Fail-safe
// like the rest of the family: any miss records nothing and /recover-context falls back to
// its newest-other-transcript heuristic.
function ancestryChain(fromPid) {
  const cp = require('child_process');
  try {
    if (process.platform === 'win32') {
      const script =
        `$id=${fromPid}; for($i=0; $i -lt 10 -and $id; $i++){` +
        `$p=Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue;` +
        `if(-not $p){break}; Write-Output "$($p.ProcessId)|$($p.CreationDate.ToFileTimeUtc())|$($p.Name)";` +
        `$id=$p.ParentProcessId}`;
      const r = cp.spawnSync('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { encoding: 'utf8', timeout: 4000, windowsHide: true });
      return String(r.stdout || '').trim().split('\n').map(l => {
        const [pid, created, ...name] = l.trim().split('|');
        return { pid: Number(pid), created: created || '', name: name.join('|') };
      }).filter(e => e.pid);
    }
    // POSIX: one cheap ps per hop. lstart (not etimes) so the value is byte-stable across
    // reads — the tid must reproduce identically on every SessionStart in the same terminal.
    const chain = [];
    let pid = fromPid;
    for (let i = 0; i < 10 && pid && pid > 1; i++) {
      const r = cp.spawnSync('ps', ['-p', String(pid), '-o', 'ppid=,lstart=,comm='],
        { encoding: 'utf8', timeout: 2000 });
      const m = String(r.stdout || '').trim().match(/^\s*(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/);
      if (!m) break;
      chain.push({ pid, created: String(Date.parse(m[2]) || m[2]), name: m[3] });
      pid = Number(m[1]);
    }
    return chain;
  } catch (_) { return []; }
}

function recordLineage(dir, sid, source) {
  try {
    if (!sid) return;
    const tdir = path.join(dir, 'terminals');
    fs.mkdirSync(tdir, { recursive: true });
    // The ancestry walk costs ~3s on Windows (PowerShell spin-up), so its result is cached
    // keyed by SESSION ID — a compact/resume re-fire of SessionStart (same sid) hits; a
    // /clear (new sid) re-walks once, the accepted pre-cache cost. The key was originally
    // CLAUDE_CODE_SSE_PORT, assumed unique per claude process — falsified 2026-07-21: the
    // port is per VS Code WINDOW (every tab inherits the same value), so a stale entry
    // relabeled a brand-new terminal as a same-tab rotation and the old tab's title leaked
    // onto it. sids are per-session UUIDs and cannot collide across tabs. Residual
    // (accepted): --resume in a DIFFERENT terminal hits the original terminal's tid; the
    // occupant check below makes that a no-op unless the terminal was since re-occupied,
    // and the worst case is a wrong "previous session" suggestion, never a cross-tab carry.
    const cacheFile = path.join(tdir, '.anchor-cache.json');
    let tid = null;
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (c.key === sid && c.tid) tid = c.tid;
    } catch (_) { /* no cache yet */ }
    if (!tid) {
      const chain = ancestryChain(process.pid);
      let anchor = null;
      for (let i = chain.length - 1; i >= 0; i--) {
        if (/^(claude|node)/i.test(chain[i].name || '')) { anchor = chain[i + 1] || null; break; }
      }
      if (!anchor) return;
      tid = `${anchor.pid}-${String(anchor.created).replace(/[^0-9]/g, '')}`;
      try { fs.writeFileSync(cacheFile, JSON.stringify({ key: sid, tid })); } catch (_) { /* best-effort */ }
    }
    const tf = path.join(tdir, `${tid}.json`);
    let occupant = null;
    try { occupant = JSON.parse(fs.readFileSync(tf, 'utf8')); } catch (_) { /* fresh terminal */ }
    if (occupant && occupant.sid && occupant.sid !== sid) {
      // Rotation observed (a /clear, or a relaunch in the same tab): the outgoing occupant
      // becomes the incoming session's "previous" — keyed by the NEW sid so /recover-context
      // finds it via its own CLAUDE_CODE_SESSION_ID, no process-walking on the read side.
      fs.writeFileSync(path.join(dir, `${sid}.lineage.json`), JSON.stringify({
        prevSid: occupant.sid, tid, source: source || '', ts: new Date().toISOString(),
      }, null, 2));
    }
    fs.writeFileSync(tf, JSON.stringify({ tid, sid, updatedAt: Date.now() }, null, 2));
    for (const f of fs.readdirSync(tdir)) {
      try {
        const fp = path.join(tdir, f);
        if (Date.now() - fs.statSync(fp).mtimeMs > 30 * 86400000) fs.unlinkSync(fp);
      } catch (_) { /* prune is best-effort */ }
    }
  } catch (_) { /* lineage is a convenience — never break SessionStart */ }
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
  '      string dialog = a.Length >= 5 ? a[4] : "esc to cancel";',
  '      string res = "attach-fail";',
  '      FreeConsole();',
  '      if (AttachConsole(uint.Parse(a[0]))) {',
  '        IntPtr h = CreateFileW("CONOUT$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);',
  '        CSBI bi;',
  '        if (h == new IntPtr(-1) || !GetConsoleScreenBufferInfo(h, out bi)) { res = "read-fail"; }',
  '        else {',
  '          res = "dead";',
  '          short zone = (short)(bi.win.B - 7 > bi.win.T ? bi.win.B - 7 : bi.win.T);',
  '          for (short y = bi.win.T; y <= bi.win.B && res != "live"; y++) {',
  '            var buf = new char[bi.size.X]; uint rd; COORD c; c.X = 0; c.Y = y;',
  '            if (!ReadConsoleOutputCharacterW(h, buf, (uint)bi.size.X, c, out rd)) continue;',
  '            string row = new string(buf, 0, (int)rd);',
  '            if (row.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) res = "live";',
  '            else if (y >= zone && dialog.Length > 0 && row.IndexOf(dialog, StringComparison.OrdinalIgnoreCase) >= 0) res = "dialog";',
  '          }',
  '        }',
  '      }',
  '      File.WriteAllText(a[2], res, new UTF8Encoding(false));',
  '      return (res == "live" || res == "dead" || res == "dialog") ? 0 : 5;',
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
// v5 = --live screen-buffer probe (reads the visible console rows for the "esc to interrupt" hint);
// v6 = --live also scans the BOTTOM 8 rows for the dialog hint ("esc to cancel") → "dialog", so an
// open permission dialog is its own state instead of a false "dead" (the 2026-07-15 wifi-app bug).
function painterPath(dir) { return path.join(dir, 'title-painter-v6.exe'); }

// Kick off the one-time compile (async — the watchdog calls this at startup so the exe is warm
// long before any rescue). Returns immediately; readiness = the exe existing.
function ensurePainter(dir) {
  try {
    const exe = painterPath(dir);
    if (fileExists(exe)) return;
    // Best-effort sweep of superseded painter generations (an in-flight old watchdog that loses
    // its exe mid-probe just degrades to a blind read — the safe direction).
    for (const stale of ['title-painter-v5.exe', 'title-painter-v5.cs']) {
      try { fs.unlinkSync(path.join(dir, stale)); } catch (_) { /* absent or locked — fine */ }
    }
    const src = path.join(dir, 'title-painter-v6.cs');
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
//   'live'   → liveness needle on screen (turn alive — NEVER rescue)
//   'dialog' → liveness needle absent, but the BOTTOM rows show the dialog hint ("esc to cancel"):
//              a permission dialog / question card is open — the turn is alive, parked on the user.
//              The dialog REPLACES the bottom-bar hint, so without this state it reads as a false
//              "dead" (live-traced 2026-07-15 in wifi-app: false ✻ rescue + a wrongly-set
//              needle-distrust flag from a first-tool-call permission prompt).
//   'dead'   → attached, neither needle found (REPL idle — cancel evidence)
//   null     → can't tell (painter missing / attach or read failed) — treat as NO evidence.
// Both needles are HARNESS CONTRACTS with CC's UI text, drift-guarded by the round-9 canary.
// CLAUDE_TITLE_TEST_LIVE ('1'|'0'|'dialog'|anything else) forces the result so tests can drive the
// real watchdog loop deterministically; CLAUDE_TITLE_LIVE_NEEDLE / CLAUDE_TITLE_DIALOG_NEEDLE
// override the needles if CC renames its hints.
function probeLive(dir, sid, pid) {
  const forced = process.env.CLAUDE_TITLE_TEST_LIVE;
  if (forced === '1') return 'live';
  if (forced === '0') return 'dead';
  if (forced === 'dialog') return 'dialog';
  if (forced) return null;
  const exe = painterPath(dir);
  if (!fileExists(exe)) return null;
  const out = path.join(dir, `${sid}.live`);
  try { fs.unlinkSync(out); } catch (_) { /* ignore */ }
  try {
    const args = [String(pid), '--live', out,
      process.env.CLAUDE_TITLE_LIVE_NEEDLE || 'esc to interrupt',
      process.env.CLAUDE_TITLE_DIALOG_NEEDLE || 'esc to cancel'];
    require('child_process').spawnSync(exe, args, { windowsHide: true, timeout: 5000 });
    const v = fs.readFileSync(out, 'utf8').trim();
    try { fs.unlinkSync(out); } catch (_) { /* ignore */ }
    return v === 'live' || v === 'dead' || v === 'dialog' ? v : null;
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

// Read <pid>'s console title back via painter --get (AttachConsole + GetConsoleTitle → the file).
// A DEBUG-ONLY self-check: after a paint, comparing this to what we intended tells a stale VS Code
// tab (console title correct → the host/ConPTY ignored it) apart from a title that never got set at
// all. Returns the trimmed title on status 0, or null on any failure / painter absent — no
// PowerShell fallback (kept minimal; null is a fine "couldn't read"). Wrapped so it can never throw
// into the watchdog. Only ever called from the one-shot concluded exit under CLAUDE_TITLE_DEBUG=1.
function readConsoleTitle(dir, pid) {
  try {
    const exe = painterPath(dir);
    if (!fileExists(exe)) return null;
    const out = path.join(dir, `${pid}.titlecheck`);
    try { fs.unlinkSync(out); } catch (_) { /* ignore */ }
    const r = require('child_process').spawnSync(exe, [String(pid), '--get', out],
      { windowsHide: true, timeout: 5000 });
    if (!r || r.status !== 0) return null;
    const title = fs.readFileSync(out, 'utf8').trim();
    try { fs.unlinkSync(out); } catch (_) { /* ignore */ }
    return title;
  } catch (_) {
    return null;
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
//   - probe 'dialog' (bottom rows show "esc to cancel"): a permission dialog / question card is
//     open — the turn is alive, parked on the user. Flip ◐ immediately (beats CC's ~6s
//     permission_prompt notification) and record awaiting|Notification; never dead evidence.
//   - Only a prompt tail is ever RESCUE-judged by screen/CPU: an assistant/tool_use tail with a
//     quiet screen is also what a long silent Bash tool looks like — never rescue those without a
//     marker. Assistant tails DO get a gentle ~2s dialog-only scan (mid-turn permission dialogs),
//     whose dead/blind reads carry no evidence.
// Stand-down: glyph concluded (✻ / ◐-from-Stop), nonce superseded, session gone, or a 30min
// deadline — ROLLED while ◐ awaiting|Notification: a dialog parked on the user is not a runaway
// turn, and the watchdog must outlive it to read the cancel marker if the user Esc's it hours
// later (2026-07-22: a stuck ◐ — the Esc landed ~65min in, ~35min after watch-exit deadline).
//
// Decomposed 2026-07-29 (clean-code plan 3.6): turnWatch is the loop shell; each poll runs
// watchPoll → watchTailPhase → dispatchProbeVerdict → one handler per probe verdict. Handlers
// return a verdict string — 'exit' ends the watchdog, anything else polls again. The loop's
// mutable state (streaks, lastSize, probe pacing, deadline) lives on the shared watch context `w`.

const CPU_MS = 300;   // sample window: idle claude ~0% (single-scheduler-tick spike ≤ ~5.2% at
const CPU_THRESH = 6.0; // 300ms — still < 6%); active 9–19% → 6% separates (LIVE-measured 2026-07-12).
const GRACE_MS = 150;   // 300ms window ×2 samples is the floor; smaller windows lose tick headroom.
const FALLBACK_AGE_MS = 120 * 1000; // probe-blind: no CPU-only rescue before this (thinking runs minutes)

// The per-watch context: payload fields + sidecar paths + the loop's mutable state, shared by
// every handler below. watchLog is the lifecycle trail (CLAUDE_TITLE_DEBUG=1): start line, ~5s
// heartbeats, and an exit reason — so a watchdog that dies in the real CC context is
// distinguishable from one that is alive but silently ineligible (that ambiguity cost a full
// live-test round on 2026-07-12).
function makeWatchContext(p) {
  const { sid, dir, file, cwd, nonce, transcript, ppid } = p;
  logCtx = { event: 'TurnWatch', sid, dir, note: '', transcript: transcript || '' };
  // Test seam (CLAUDE_TITLE_TEST_DEADLINE_MS): the 30min stand-down is untestable at real scale.
  const DEADLINE_MS = Number(process.env.CLAUDE_TITLE_TEST_DEADLINE_MS) || 30 * 60 * 1000;
  return {
    sid, dir, file, cwd, nonce, transcript, ppid,
    glyphFile: path.join(dir, `${sid}.glyph`),
    watchFile: path.join(dir, `${sid}.watch`),
    // The session's REAL claude.exe pid. The hook's own parent is a SHORT-LIVED claude.exe shim —
    // live trail 2026-07-12 showed parent-gone at the first poll, three turns straight — so ppid is
    // only a log breadcrumb. The true session process is found by CONSOLE IDENTITY: painter --find
    // attaches each claude.exe candidate and matches its console title against our own title file.
    // Tests inject sessionPid directly (their fake parents own no matching console).
    sessionPid: Number(p.sessionPid) || 0,
    DEADLINE_MS,
    deadline: 0,
    lastSize: -1,
    quietStreak: 0,
    deadStreak: 0,
    lastProbe: 0,
    polls: 0,
    watchLog: (note, diag) => {
      if (!logCtx) return;
      logCtx.note = note;
      logCtx.diag = diag;
      titleLog(GLYPH.working, normalize(displayTitle(file, dir, sid, cwd)), false);
    },
  };
}

function logWatchStart(w) {
  w.watchLog('watch-start', `ppid=${w.ppid} session=${w.sessionPid || 'resolve'}`
    + ` term=${process.env.TERM_PROGRAM || '-'}/${process.env.TERM_PROGRAM_VERSION || '-'}`
    + ` ${cohortDiag(w)}`);
}

// Where this tab sits among the project's LIVE tabs. The reported symptom is ordinal — "the
// session I opened FIRST in a project sticks on ⬤, the later ones don't" — and rank is the only
// field that can confirm or kill that. rank=1 means no live sibling started earlier; cohort is how
// many tabs (including this one) are open on the project right now. Live = a {sid}.glyph touched
// inside the dupe window, the same liveness test activeTwins uses.
function cohortDiag(w) {
  try {
    const now = Date.now();
    const mine = readStartedAt(w.dir, w.sid) || now;
    const starts = liveSiblingStarts(w.dir, w.sid, now);
    return `cohort=${starts.length + 1} rank=${starts.filter((t) => t < mine).length + 1}`;
  } catch (_) {
    return 'cohort=? rank=?';
  }
}

// When each of the project's OTHER live tabs started. A tab that never recorded a start falls back
// to its glyph mtime, so it still counts toward the cohort rather than vanishing from it.
function liveSiblingStarts(dir, sid, now) {
  const starts = [];
  for (const f of fs.readdirSync(dir)) {
    const other = f.endsWith('.glyph') ? f.slice(0, -'.glyph'.length) : '';
    if (!other || other === sid) continue;
    const seen = glyphSeenAt(path.join(dir, f));
    if (!seen || now - seen > DUPE_WINDOW_MS) continue; // stale glyph → that tab is closed
    starts.push(readStartedAt(dir, other) || seen);
  }
  return starts;
}

function glyphSeenAt(file) {
  try { return fs.statSync(file).mtimeMs; } catch (_) { return 0; }
}

// Concluded = the Stop/Notification path painted: ✻, or ◐ NOT from a dialog-flip
// (awaiting|Notification is the watchdog's own dialog paint — that one rolls the deadline
// instead, see watchPoll).
function watchConcluded(painted) {
  return painted[0] === 'idle' || (painted[0] === 'awaiting' && painted[1] !== 'Notification');
}

// Concluded ~150ms after the Stop paint — sessionPid is resolved and the painter is warm, so
// this is the ideal one-shot moment to READ THE CONSOLE TITLE BACK and record whether the
// console actually carries what we intended. MISMATCH → the paint reached the console but the
// host (VS Code/ConPTY) is showing a stale tab; unread → couldn't read (painter absent / not
// debug). Debug-gated because it costs one extra --get spawn; only here, never in the hot poll.
function concludedDiag(w, painted) {
  let diag = `concluded glyph=${painted.join('|')}`;
  if (process.env.CLAUDE_TITLE_DEBUG === '1') {
    const intended = `${GLYPH[painted[0]]} ${normalize(displayTitle(w.file, w.dir, w.sid, w.cwd))}`;
    const actual = w.sessionPid ? readConsoleTitle(w.dir, w.sessionPid) : null;
    const verdict = actual == null ? 'unread' : (actual === intended ? 'MATCH' : 'MISMATCH');
    diag += actual == null ? ' verify=unread'
      : ` verify=${verdict} intended="${intended}" actual="${actual}"`;
  }
  return diag;
}

// Resolve-then-verify the session pid: 'continue' while the painter is still compiling or no
// console matches (retry next poll), 'exit' when the session process is gone, 'ok' to proceed.
function ensureWatchSession(w) {
  if (!w.sessionPid) {
    const d = {};
    w.sessionPid = resolveSessionPid(w.dir, w.sid, w.file, w.cwd, d);
    if (w.sessionPid) {
      w.watchLog('watch', `session resolved pid=${w.sessionPid} ${resolveDiag(d)}${claimPid(w, w.sessionPid, d)}`);
    } else if (w.polls % 10 === 0) {
      w.watchLog('watch', `session unresolved (${d.why || 'painter compiling / no console match'}) ${resolveDiag(d)}`);
    }
    if (!w.sessionPid) return 'continue';
  }
  try { process.kill(w.sessionPid, 0); } catch (_) { w.watchLog('watch-exit', `session-gone pid=${w.sessionPid}`); return 'exit'; }
  return 'ok';
}

// Eligibility: glyph still ⬤ AND a bare-prompt tail old enough to call stalled ('eligible' —
// the only mode that is ever RESCUE-judged by screen/CPU). NOTE: a turn's FIRST tool call opens
// its permission dialog while the tail still reads 'prompt' — that case IS eligible, which is
// why an open dialog must be its own probe state ('dialog') and never dead evidence (the
// 2026-07-15 wifi-app bug: false ✻ rescue + a wrongly-set needle-distrust flag).
// 'dialog-scan': a permission dialog / question card can also open MID-turn (assistant tail).
// Probe those phases too, at a gentler pace, but use the result ONLY to flip ◐ or note
// liveness — an assistant tail with a quiet screen is also what a long silent Bash tool looks
// like, and those stay marker-only rescue territory.
function classifyProbeEligibility(painted, tail, age) {
  if (painted[0] !== 'working' || !(age > 2500)) return 'ineligible';
  if (tail.kind === 'prompt') return 'eligible';
  if (tail.kind === 'assistant') return 'dialog-scan';
  return 'ineligible';
}

// Ineligible poll: stays cheap (a fast Bash tool never pays for a probe), and rescue evidence
// never survives an ineligible beat.
function handleIneligible(w, tail, painted, age) {
  w.quietStreak = 0;
  w.deadStreak = 0;
  if (w.polls % 12 === 0) w.watchLog('watch', `ineligible kind=${tail.kind} glyph=${painted[0] || '-'}`
    + ` age=${Number.isFinite(age) ? Math.round(age / 1000) + 's' : '-'} pid=${w.sessionPid || 0}`);
  return 'continue';
}

// probeLive + the needle-drift demotion: a PostToolUse once PROVED a dead read on a live turn
// (CC renamed the bottom-bar hint) — dead reads can't be trusted while the distrust flag is up,
// so demote to blind: the 120s CPU fallback still rescues real cancels, slowly. Retracted the
// moment any probe reads live again (see handleLiveTurn).
function probeWithDistrust(w) {
  let live = probeLive(w.dir, w.sid, w.sessionPid);
  if (live === 'dead' && fileExists(path.join(w.dir, 'needle-distrust'))) {
    if (w.polls % 40 === 0) w.watchLog('watch', 'probe-distrusted (needle drift flagged) — dead treated as blind');
    live = null;
  }
  return live;
}

// A dialog is open: the turn is ALIVE, parked on the user's approval/answer. Flip ◐ NOW
// instead of waiting ~6s for CC's permission_prompt notification. The glyph records
// awaiting|Notification — byte-identical to the real notification's paint — so the
// concluded check and idle-rescue treat both flips by one rule; the next poll then sees
// glyph≠working → ineligible, so this paints at most once per dialog. No breadcrumb, no
// distrust: a hidden liveness hint is the dialog's doing, not needle drift.
function handleDialogFlip(w) {
  w.quietStreak = 0;
  w.deadStreak = 0;
  const dt = normalize(displayTitle(w.file, w.dir, w.sid, w.cwd));
  const paint = paintViaConsole(w.dir, w.sessionPid, `${GLYPH.awaiting} ${dt}`);
  try { fs.writeFileSync(w.glyphFile, 'awaiting|Notification'); } catch (_) { /* best-effort */ }
  if (logCtx) { logCtx.note = 'dialog-flip'; logCtx.diag = `via=esc-to-cancel ${paint}`; }
  titleLog(GLYPH.awaiting, dt, false);
  return 'continue';
}

// The bottom bar says the turn is running (thinking/streaming). Positive liveness beats any
// amount of CPU quiet — this is the 2026-07-15 thinking-false-fire fix. A live read also
// proves the needle still matches CC's UI — retract any drift flag, and drop this turn's
// dead-read breadcrumb (it was a fluke, not drift; don't let a later PostToolUse read it as
// proof).
function handleLiveTurn(w, age) {
  w.quietStreak = 0;
  w.deadStreak = 0;
  try { fs.unlinkSync(path.join(w.dir, 'needle-distrust')); } catch (_) { /* not flagged */ }
  try { fs.unlinkSync(path.join(w.dir, `${w.sid}.probe`)); } catch (_) { /* none */ }
  if (w.polls % 24 === 0) w.watchLog('watch', `live-turn age=${Math.round(age / 1000)}s`);
  return 'continue';
}

// Grace beat + double-check + rescue — the shared tail of both stall verdicts (dead screen and
// quiet CPU; was duplicated verbatim before 3.6). If the turn actually just concluded, its Stop
// hook paints during the grace beat: the glyph leaves 'working', the tail stops being a bare
// prompt, or the transcript moved — any of those vetoes the rescue. Returns true when it
// rescued (the watchdog must exit); false = false alarm, the caller resets its streak.
async function confirmStallAndRescue(via, w) {
  await delay(GRACE_MS); // grace: if the turn just concluded, let its Stop hook paint first
  const g2 = readTitle(w.glyphFile).split('|')[0];
  const t2 = classifyTail(w.transcript);
  if (g2 === 'working' && t2.kind === 'prompt' && t2.size === w.lastSize) {
    rescueFromWatch(via, w.dir, w.sid, w.file, w.cwd, w.sessionPid);
    return true;
  }
  return false;
}

// Dead screen read on an ELIGIBLE (bare-prompt) tail. First: breadcrumb for the needle-drift
// canary — if a PostToolUse fires later in THIS turn (same nonce), the turn was provably alive
// during this dead read → the needle is wrong. NOT cleaned in turnWatch's finally block — it
// must outlive the watchdog to reach that PostToolUse; consumption is one-shot there (a
// superseding turn's mismatched nonce reads as inert). Then: two independent screen reads
// ≥500ms apart + CPU not busy (rename-belt: if CC ever drops the hint text, a busy client
// still blocks the rescue) + the confirmStallAndRescue grace beat.
async function handleDeadStreak(w, age) {
  try { fs.writeFileSync(path.join(w.dir, `${w.sid}.probe`), `${w.nonce}|${Date.now()}`); } catch (_) { /* best-effort */ }
  w.deadStreak++;
  if (w.deadStreak < 2) return 'continue'; // two independent screen reads ≥500ms apart
  const cpu = sampleCpu(w.dir, w.sid, w.sessionPid, CPU_MS); // rename-belt: busy client = alive
  w.watchLog('watch', `no-esc-hint streak=${w.deadStreak} cpu=${cpu === null ? 'null' : cpu.toFixed(1)}`
    + ` age=${Math.round(age / 1000)}s`);
  if (cpu !== null && cpu >= CPU_THRESH) { w.deadStreak = 0; return 'continue'; }
  if (await confirmStallAndRescue(`no-esc-hint cpu=${cpu === null ? '-' : cpu.toFixed(1)}`, w)) return 'exit';
  w.deadStreak = 0;
  return 'continue';
}

// Blind probe, young tail: quiet CPU alone cannot tell thinking from cancelled, so no CPU-only
// rescue before FALLBACK_AGE_MS — long past any plausible thinking phase; a slow rescue beats
// a wrong one.
function handleProbeBlind(w, age) {
  w.quietStreak = 0;
  if (w.polls % 40 === 0) w.watchLog('watch', `probe-null age=${Math.round(age / 1000)}s`
    + ` (CPU fallback at ${FALLBACK_AGE_MS / 1000}s)`);
  return 'continue';
}

// Quiet = sampled below CPU_THRESH with an unmoved transcript (and a baseline to compare to).
function cpuLooksQuiet(cpu, grew, hadBaseline) {
  return cpu !== null && cpu < CPU_THRESH && !grew && hadBaseline;
}

// Blind probe, old tail: the degraded CPU-quiet heuristic (the pre-probe watchdog), gated
// behind FALLBACK_AGE_MS by dispatchProbeVerdict.
async function handleCpuQuiet(w, age, grew, hadBaseline) {
  const cpu = sampleCpu(w.dir, w.sid, w.sessionPid, CPU_MS); // blocks ~CPU_MS
  w.quietStreak = cpuLooksQuiet(cpu, grew, hadBaseline) ? w.quietStreak + 1 : 0;
  if (w.polls % 6 === 0 || w.quietStreak > 0) {
    w.watchLog('watch', `cpu=${cpu === null ? 'null' : cpu.toFixed(1)} streak=${w.quietStreak}`
      + ` age=${Math.round(age / 1000)}s`);
  }
  if (w.quietStreak < 2) return 'continue';
  if (await confirmStallAndRescue(`stalled-prompt cpu=${(cpu || 0).toFixed(1)}`, w)) return 'exit';
  w.quietStreak = 0;
  return 'continue';
}

// One handler per probe verdict. Order matters: 'dialog' and 'live' are positive liveness in
// EITHER mode; after those, a dialog-scan poll is done (dead/blind reads carry NO rescue
// evidence there — a long silent Bash tool reads exactly the same: no breadcrumb, no streaks,
// no CPU fallback, marker-only territory); only an eligible poll goes on to the dead-streak /
// CPU-fallback arms.
async function dispatchProbeVerdict(w, live, mode, age, grew, hadBaseline) {
  if (live === 'dialog') return handleDialogFlip(w);
  if (live === 'live') return handleLiveTurn(w, age);
  if (mode === 'dialog-scan') {
    if (w.polls % 40 === 0) w.watchLog('watch', `dialog-scan ${live === 'dead' ? 'no-dialog' : 'blind'}`
      + ` age=${Math.round(age / 1000)}s`);
    return 'continue';
  }
  if (live === 'dead') return handleDeadStreak(w, age);
  if (age < FALLBACK_AGE_MS) return handleProbeBlind(w, age);
  return handleCpuQuiet(w, age, grew, hadBaseline);
}

// The tail phase of one poll: classify the transcript tail, rescue instantly on a marker
// (tool-phase cancel — the marker flushes at cancel time, no CPU evidence needed), otherwise
// gate the screen probes by eligibility and pace before dispatching on the probe verdict.
async function watchTailPhase(w, painted) {
  const tail = classifyTail(w.transcript);
  const grew = tail.size !== w.lastSize;
  const hadBaseline = w.lastSize !== -1;
  w.lastSize = tail.size;
  if (tail.kind === 'marker') {
    rescueFromWatch('marker', w.dir, w.sid, w.file, w.cwd, w.sessionPid);
    return 'exit';
  }
  const age = tail.ts ? Date.now() - Date.parse(tail.ts) : NaN;
  const mode = classifyProbeEligibility(painted, tail, age);
  if (mode === 'ineligible') return handleIneligible(w, tail, painted, age);
  if (mode === 'dialog-scan') { w.quietStreak = 0; w.deadStreak = 0; } // rescue evidence never spans phases
  if (Date.now() - w.lastProbe < (mode === 'eligible' ? 500 : 2000)) return 'continue'; // pace the screen probes
  w.lastProbe = Date.now();
  return dispatchProbeVerdict(w, probeWithDistrust(w), mode, age, grew, hadBaseline);
}

// One poll beat: stand-down checks first (nonce superseded / glyph concluded / session gone),
// then the ◐ awaiting|Notification deadline roll (a dialog parked on the user is not a runaway
// turn — 2026-07-22: an AskUserQuestion sat open past 30min, the watchdog deadlined, and the
// Esc an hour later flushed a marker no watcher was left alive to read; the ◐ stayed stuck
// until the next prompt repainted it), then the tail phase.
async function watchPoll(w) {
  if (readTitle(w.watchFile) !== w.nonce) { w.watchLog('watch-exit', 'superseded'); return 'exit'; }
  const painted = readTitle(w.glyphFile).split('|');
  if (watchConcluded(painted)) { w.watchLog('watch-exit', concludedDiag(w, painted)); return 'exit'; }
  if (painted[0] === 'awaiting' && painted[1] === 'Notification') w.deadline = Date.now() + w.DEADLINE_MS;
  const session = ensureWatchSession(w);
  if (session !== 'ok') return session;
  return watchTailPhase(w, painted);
}

async function turnWatch(payloadJson) {
  let p;
  try { p = JSON.parse(payloadJson); } catch (_) { return; }
  const w = makeWatchContext(p);
  ensurePainter(w.dir); // warm the console-paint/find/cpu helper while the turn runs
  logWatchStart(w);
  w.deadline = Date.now() + w.DEADLINE_MS;
  try {
    while (Date.now() < w.deadline) {
      await delay(150);
      w.polls++;
      if (await watchPoll(w) === 'exit') return;
    }
    w.watchLog('watch-exit', deadlineDiag(w));
  } finally {
    try { fs.unlinkSync(path.join(w.dir, `${w.sid}.cpu`)); } catch (_) { /* usually already gone */ }
    try { fs.unlinkSync(path.join(w.dir, `${w.sid}.live`)); } catch (_) { /* ignore */ }
  }
}

// The deadline exit is the one that STRANDS a tab: the watchdog stands down after 30min with the
// glyph possibly still ⬤, and nothing is left to repaint it (a cancel fires no hook, so Stop never
// runs). The old line said just 'deadline', which is the least informative thing it could say at
// the exact moment the bug happens. Record the whole scene instead — poll count, the console we
// were bound to, the glyph and transcript tail we gave up on, and a read-back of what that console
// ACTUALLY shows, so verify=STRANDED names the failure outright.
function deadlineDiag(w) {
  let diag = `deadline polls=${w.polls} pid=${w.sessionPid || 0} glyph=${readTitle(w.glyphFile) || '-'}`;
  try {
    const tail = classifyTail(w.transcript);
    const age = tail.ts ? Math.round((Date.now() - Date.parse(tail.ts)) / 1000) : NaN;
    diag += ` tail=${tail.kind} tailAge=${Number.isFinite(age) ? `${age}s` : '-'}`;
  } catch (_) {
    diag += ' tail=?';
  }
  return diag + verifyDiag(w);
}

// Read back what the console we were bound to ACTUALLY shows, so verify=STRANDED names the failure
// outright instead of leaving it to be inferred from a bare 'deadline'. Debug-gated with the rest of
// the forensics: it spawns the painter, which no install should pay for per deadline.
function verifyDiag(w) {
  if (process.env.CLAUDE_TITLE_DEBUG !== '1' || !w.sessionPid) return '';
  const actual = readConsoleTitle(w.dir, w.sessionPid);
  if (actual == null) return ' verify=unread';
  return ` verify=${actual.startsWith(GLYPH.working) ? 'STRANDED' : 'ok'} actual="${actual}"`;
}

// Watchdog paint: the watchdog is detached (console-less — its own process.title is a no-op), so
// the visible flip runs through paintViaConsole → title-painter.exe → AttachConsole(claude pid) +
// SetConsoleTitleW → ConPTY → the VS Code tab. setTitle still records {sid}.glyph + the log line.
// A cancel's leftover {sid}.ask is stale — clear it so it can't paint a false ◐ on the NEXT Stop.
function rescueFromWatch(via, dir, sid, file, cwd, ppid) {
  const askFlag = path.join(dir, `${sid}.ask`);
  if (fileExists(askFlag)) { try { fs.unlinkSync(askFlag); } catch (_) { /* ignore */ } }
  const title = normalize(displayTitle(file, dir, sid, cwd));
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
// `diag` is an optional out-param the caller fills a log line from (see resolveDiag): the needle
// actually matched, how many claude.exe candidates it was scanned against, and the FULL match set
// — not just the winner. Ambiguity here is invisible in the return value but decisive for a
// mis-bound watchdog, so it has to leave the function some other way.
function resolveSessionPid(dir, sid, file, cwd, diag) {
  const d = diag || {};
  try {
    const exe = painterPath(dir);
    if (!fileExists(exe)) return noPid(d, 'painter-absent');
    const pids = claudePids();
    d.cands = pids.length;
    if (!pids.length) return noPid(d, 'no-claude-procs');
    d.needle = normalize(displayTitle(file, dir, sid, cwd));
    d.placeholder = isPlaceholderTitle(d.needle, cwd);
    d.matched = findConsoles(exe, dir, sid, d.needle, pids);
    if (!d.matched.length) d.why = 'no-console-match';
    return d.matched[0] || 0;
  } catch (err) {
    return noPid(d, `threw:${errCode(err)}`);
  }
}

// Every failure path routes through here, so `why` is never silently absent from the log line while
// the caller still sees the plain 0 it branches on.
function noPid(d, why) {
  d.why = why;
  return 0;
}

function errCode(err) {
  return (err && err.code) || 'error';
}

// Every claude.exe on the box — the candidate set the console scan runs against.
function claudePids() {
  const rows = require('child_process')
    .execSync('tasklist /FO CSV /NH /FI "IMAGENAME eq claude.exe"', { windowsHide: true }).toString();
  return rows.split('\n')
    .map(l => (l.match(/^"[^"]+","(\d+)"/) || [])[1])
    .filter(Boolean);
}

// Ask the painter which of `pids` owns a console whose title CONTAINS the needle. Returns EVERY
// match rather than just the winner — ambiguity is what mis-binds a watchdog, so it has to be visible.
function findConsoles(exe, dir, sid, needle, pids) {
  const needleFile = path.join(dir, `${sid}.needle`);
  const outFile = path.join(dir, `${sid}.found`);
  fs.writeFileSync(needleFile, needle);
  unlinkQuiet(outFile);
  require('child_process').spawnSync(exe, ['0', '--find', outFile, needleFile].concat(pids),
    { windowsHide: true, timeout: 8000 });
  const found = readTitle(outFile).split(/\s+/).map(Number).filter(Boolean);
  unlinkQuiet(needleFile);
  unlinkQuiet(outFile);
  return found;
}

function unlinkQuiet(file) {
  try { fs.unlinkSync(file); } catch (_) { /* absent already — fine */ }
}

function resolveDiag(d) {
  return `cands=${d.cands == null ? '-' : d.cands} matched=[${(d.matched || []).join(' ')}]`
    + ` placeholder=${d.placeholder ? 1 : 0} needle="${d.needle || ''}"`;
}

// A claim is "live" for as long as a watchdog could still be holding it (one full deadline).
const PID_CLAIM_WINDOW_MS = 30 * 60 * 1000;

// PID LEDGER + collision alarm. resolveSessionPid binds this watchdog to a console by a CONTAINS
// scan of the console title, first hit wins — so a newborn tab, whose needle is still the bare
// folder placeholder ("Workforce-oregon"), matches every already-titled tab in the same repo
// ("Workforce-oregon — Ship the thing") before it matches itself. A watchdog that binds to the
// wrong console then probes SOMEONE ELSE'S screen for liveness and repaints SOMEONE ELSE'S tab for
// the rest of the turn — which is exactly the shape of "the tab I opened first sticks on ⬤ while
// the later ones behave". Recording the (sid → pid) claim is what makes that provable from the log
// alone instead of by re-running the scenario. Debug-gated: the ledger is diagnostics, not
// behavior, and nothing reads it back to make a decision.
function claimPid(w, pid, d) {
  if (process.env.CLAUDE_TITLE_DEBUG !== '1') return '';
  try {
    const now = Date.now();
    writeClaim(w.dir, w.sid, { pid, sid: w.sid, needle: d.needle || '', ts: now });
    const clash = collidingClaims(w.dir, w.sid, pid, now);
    const ambiguous = (d.matched || []).length > 1;
    if (!clash.length && !ambiguous) return '';
    return `  PID-COLLISION pid=${pid} alsoClaimedBy=[${clash.join(' ')}]`
      + ` ambiguousMatch=${ambiguous ? 1 : 0}`;
  } catch (_) {
    return '';
  }
}

function writeClaim(dir, sid, rec) {
  fs.writeFileSync(path.join(dir, `${sid}.pid`), JSON.stringify(rec));
}

// The other sids whose still-live claim names the SAME pid — two watchdogs bound to one console.
// Each is labelled sid@age so the log says which tab got there first.
function collidingClaims(dir, sid, pid, now) {
  const clash = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.pid') || f === `${sid}.pid`) continue;
    const rec = readClaim(path.join(dir, f));
    if (!rec || rec.pid !== pid || now - (rec.ts || 0) > PID_CLAIM_WINDOW_MS) continue;
    clash.push(claimLabel(rec, f, now));
  }
  return clash;
}

function claimLabel(rec, file, now) {
  return `${String(rec.sid || file).slice(0, 8)}@${Math.round((now - rec.ts) / 1000)}s`;
}

function readClaim(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
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

// The last title the PREVIOUS session in THIS terminal showed. SessionStart's recordLineage stamps
// {sid}.lineage.json with prevSid on a /clear or same-tab relaunch; that session's persisted title
// file ({prevSid}.txt) still holds its final title (title files aren't pruned). Returns '' when there
// is no predecessor (a brand-new terminal) or its file is gone. A /clear-born session does NOT carry:
// a /clear is a deliberate reset and the next prompt could be anything, so the tab shows the
// new-session placeholder — until the user runs /continue, whose UserPromptSubmit stamps
// {sid}.continued and re-arms the carry (the predecessor's title IS what's being resumed). Relaunch
// and resume keep the unconditional carry: nothing was reset, the tab is still that work. All inputs
// (lineage, flag, prev title) live on disk and only move forward, so every paint AND the byte-identical
// console-match needle (resolveSessionPid) agree at any instant.
function carriedTitle(dir, sid) {
  try {
    if (!sid) return '';
    const lin = JSON.parse(fs.readFileSync(path.join(dir, `${sid}.lineage.json`), 'utf8'));
    if (!lin || !lin.prevSid) return '';
    if ((lin.source || '') === 'clear' && !fileExists(path.join(dir, `${sid}.continued`))) return '';
    return readTitle(path.join(dir, `${lin.prevSid}.txt`));
  } catch (_) { return ''; }
}

// The title to paint/needle before this session has authored its own: its own file, else the title
// carried over from the previous session in this terminal (above), else the folder name. Centralized
// so every resolution site — paints, debug logs, and the console-match needle — stays in agreement;
// once the session authors a title readTitle(file) short-circuits and carriedTitle is never read.
function displayTitle(file, dir, sid, cwd) {
  return readTitle(file) || carriedTitle(dir, sid) || folderName(cwd);
}

// ─── Duplicate-session guard ─────────────────────────────────────────────────────────────────
// Two terminals grinding on the SAME task clobber each other's edits (observed 2026-07-20: two tabs
// both on "Journal open-to-all — …guest-journaling server (Phase A)"). On every UserPromptSubmit —
// the moment a session is actively working — scan sibling sessions for a LIVE one carrying a
// near-identical title. Liveness = a fresh {sid}.glyph: setTitle rewrites it on every paint, so its
// mtime is the per-turn heartbeat, and a closed tab's glyph simply ages out of the window. Lineage
// predecessors — the sids this TAB used to be before a /clear ({sid}.lineage.json chain) — are
// excluded: the new session CARRIES the old title until it authors its own (displayTitle →
// carriedTitle; after a /continue re-arm or a same-tab relaunch), so it would otherwise collide
// with its own ghost,
// whose glyph is still inside the window (observed 2026-07-21: false "Bug-hunt" twin). Modes
// (env CLAUDE_TITLE_DUPE): 'off' disables; 'warn' (DEFAULT) surfaces a one-shot systemMessage and
// lets the turn proceed; 'kill' stands the NEWER session down (blocks its prompt with a reason).
// We BLOCK, never taskkill, on purpose: a session's claude.exe pid can only be resolved by console
// title (resolveSessionPid), which is ambiguous EXACTLY when two tabs share a title — a hard kill
// could take out the wrong tab (the standing review finding #1). Blocking loses no work and
// self-releases the instant the other tab goes stale. Set the mode persistently via settings.json
// "env": { "CLAUDE_TITLE_DUPE": "kill" }.
const DUPE_WINDOW_MS = 180000; // a sibling counts as "live" if it painted within 3 min

function dupeMode() {
  const m = (process.env.CLAUDE_TITLE_DUPE || 'warn').toLowerCase();
  return (m === 'off' || m === 'kill' || m === 'warn') ? m : 'warn';
}

// A newborn tab shows its folder name / the new-session placeholder until the model authors a real
// title; two such tabs in one repo are NOT duplicate work, so they must never collide.
function isPlaceholderTitle(title, cwd) {
  const t = (title || '').trim().toLowerCase();
  if (!t) return true;
  if (t === 'claude code' || t === 'claude code - new session') return true;
  return t === folderName(cwd).toLowerCase();
}

// Break a title into a comparison key: glyph stripped, lowercased, split on the em-dash separator.
function collideKey(title) {
  const bare = normalize(title || '')
    .replace(/^[^\p{L}\p{N}]+/u, '') // drop any leading state glyph + space
    .toLowerCase().trim();
  const segs = bare.split(` ${EMDASH} `).map(s => s.trim()).filter(Boolean);
  const words = bare.split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1);
  return { full: bare, scope: segs[0] || '', rest: segs.slice(1).join(' '), words };
}

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

// True when two titles are plausibly the SAME work: identical, OR same scope with an overlapping
// use-case, OR high whole-title word overlap. Tuned so "…— Guest-journaling server (Phase A)" and
// "…— Build guest-journaling server (Phase A)" collide, while two distinct use-cases under one
// scope ("…— Fix X" vs "…— Fix Y") do not.
function titlesCollide(a, b) {
  const ka = collideKey(a), kb = collideKey(b);
  if (!ka.full || !kb.full) return false;
  if (ka.full === kb.full) return true;
  const wordsOf = s => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (ka.scope && ka.scope === kb.scope
      && jaccard(wordsOf(ka.rest), wordsOf(kb.rest)) >= 0.5) return true;
  return jaccard(ka.words, kb.words) >= 0.7;
}

function readStartedAt(dir, sid) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, `${sid}.session.json`), 'utf8')).startedAt || 0; }
  catch (_) { return 0; }
}

// Record this session's birth time ONCE — the ordering token that lets kill-mode stand down the
// NEWER tab. Write-if-absent so a compact/resume SessionStart (same sid) or a first UPS on a
// session that predates this feature never overwrites the earliest known start. Best-effort: a
// missing file just yields startedAt 0 (sorts oldest), degrading toward warn, never toward a
// wrongful block.
function ensureStartedAt(dir, sid) {
  try {
    if (!sid) return;
    const f = path.join(dir, `${sid}.session.json`);
    if (!fileExists(f)) fs.writeFileSync(f, JSON.stringify({ startedAt: Date.now() }));
  } catch (_) { /* best-effort */ }
}

// The sids this session used to BE: walk the prevSid links in {sid}.lineage.json (bounded — rapid
// /clears can stack several ghosts inside the liveness window). A predecessor lived in THIS
// terminal by construction, so it can never be a concurrent duplicate tab.
function lineageAncestors(dir, sid, maxHops) {
  const out = new Set();
  let cur = sid;
  for (let i = 0; i < (maxHops || 5) && cur; i++) {
    let prev = '';
    try { prev = (JSON.parse(fs.readFileSync(path.join(dir, `${cur}.lineage.json`), 'utf8')) || {}).prevSid || ''; }
    catch (_) { break; }
    if (!prev || prev === sid || out.has(prev)) break;
    out.add(prev);
    cur = prev;
  }
  return out;
}

// Sibling sessions that are LIVE (fresh {sid}.glyph) AND carry a colliding title. The cheap glyph
// stat is checked FIRST so stale sessions (the vast majority of accumulated .txt files) are skipped
// before their title is even read. Own lineage ancestors are never twins (see the header note).
function activeTwins(dir, sid, myTitle, windowMs) {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir); } catch (_) { return out; }
  const ghosts = lineageAncestors(dir, sid);
  const now = Date.now();
  for (const f of files) {
    if (!f.endsWith('.txt')) continue;
    const other = f.slice(0, -4);
    if (!other || other === sid) continue;
    if (ghosts.has(other)) continue; // my own pre-/clear ghost, not another tab
    let lastSeen = 0;
    try { lastSeen = fs.statSync(path.join(dir, `${other}.glyph`)).mtimeMs; } catch (_) { continue; }
    if (now - lastSeen > windowMs) continue; // stale glyph → treat the tab as closed
    const otherTitle = readTitle(path.join(dir, f));
    if (!otherTitle || !titlesCollide(myTitle, otherTitle)) continue;
    out.push({ sid: other, title: normalize(otherTitle), lastSeen, startedAt: readStartedAt(dir, other) || lastSeen });
  }
  return out;
}

function agoStr(ms) {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  return s < 90 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

// Decide what the guard does for THIS UserPromptSubmit. Returns null (proceed normally),
// { systemMessage, diag } (warn — one-shot per twin), or { block:true, reason, diag } (kill mode,
// and this session is the newer one). Never throws: a guard failure must not break the turn.
function dupeGuardResult(dir, sid, title, cwd) {
  try {
    const mode = dupeMode();
    if (mode === 'off') return null;
    if (isPlaceholderTitle(title, cwd)) return null;
    const windowMs = Number(process.env.CLAUDE_TITLE_DUPE_WINDOW_MS) || DUPE_WINDOW_MS;
    const twins = activeTwins(dir, sid, title, windowMs);
    if (!twins.length) return null;
    const list = twins.map(t => `“${t.title}” (active ${agoStr(t.lastSeen)})`).join(', ');
    const myStart = readStartedAt(dir, sid) || Date.now();
    const iAmNewer = twins.some(t => t.startedAt && t.startedAt < myStart);
    if (mode === 'kill' && iAmNewer) {
      return {
        block: true,
        reason: `⛔ Duplicate-session guard: another tab is already working on ${list}. `
          + `This newer tab is standing down so the two don't clobber each other's edits. `
          + `Close it, or set CLAUDE_TITLE_DUPE=warn (or off) to override.`,
        diag: `mode=kill block twins=${twins.length}`,
      };
    }
    // warn (mode=warn, or kill-mode but this is the OLDER tab): one systemMessage per new twin.
    const warnedFile = path.join(dir, `${sid}.dupe.json`);
    let warned = [];
    try { warned = JSON.parse(fs.readFileSync(warnedFile, 'utf8')).sids || []; } catch (_) { /* none yet */ }
    const fresh = twins.filter(t => !warned.includes(t.sid));
    if (!fresh.length) return null;
    try { fs.writeFileSync(warnedFile, JSON.stringify({ sids: twins.map(t => t.sid) })); } catch (_) { /* ignore */ }
    return {
      systemMessage: `⚠️ Possible duplicate session: ${list} ${twins.length > 1 ? 'are' : 'is'} `
        + `active in another tab with a near-identical title. Two sessions on one task can clobber `
        + `each other's edits — consider closing one.`,
      diag: `mode=${mode} warn twins=${twins.length}`,
    };
  } catch (_) { return null; }
}

// Paint-time guard (PostToolUse): a collision BORN MID-TURN — a /continue adopting another tab's
// work, or the model authoring a twin title between prompts — never meets the UserPromptSubmit
// check (observed 2026-07-21: two tabs ground the same token-guard file for 20+ min with zero
// warnings; the hijacker's only prompt wore the exempt placeholder title). Runs the twin scan
// only when the painted title CHANGES ({sid}.dupe.json.lastTitle stamps the last checked one),
// so the steady-state per-tool-call cost is one small JSON read. A running turn can't be
// blocked, so kill mode degrades to an urgent model-visible stand-down directive here — the
// hard block still lands on the next UserPromptSubmit.
function dupeGuardPaint(dir, sid, title, cwd) {
  try {
    if (dupeMode() === 'off') return null;
    const f = path.join(dir, `${sid}.dupe.json`);
    let st = {};
    try { st = JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch (_) { /* none yet */ }
    if (st.lastTitle === title) return null;
    const res = dupeGuardResult(dir, sid, title, cwd);
    // dupeGuardResult may have rewritten the warned-sids list — re-read and merge, don't clobber.
    let sids = [];
    try { sids = JSON.parse(fs.readFileSync(f, 'utf8')).sids || []; } catch (_) { /* keep [] */ }
    try { fs.writeFileSync(f, JSON.stringify({ sids, lastTitle: title })); } catch (_) { /* best-effort */ }
    if (!res) return null;
    const ctx = res.block
      ? `${res.reason} You are the newer duplicate: STOP working now — tell the user another tab `
        + `already owns this work, make no further edits, and end the turn.`
      : `${res.systemMessage} You are one of the duplicate sessions: surface this to the user in `
        + `your next message and avoid editing shared files until they choose a tab.`;
    return { systemMessage: res.systemMessage || res.reason, additionalContext: ctx, diag: `${res.diag || ''} paint` };
  } catch (_) { return null; }
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
module.exports = { inspectLastResponse, endsOnQuestion, normalize, GLYPH, shouldDefer, solicitsReply, readContextTokens, readTailWrites, recordMark, readMarks, recordWrites, readWriteLedger, clearAdvice, ancestryChain, recordLineage, carriedTitle, displayTitle, titlesCollide, isPlaceholderTitle, activeTwins, dupeGuardResult, dupeGuardPaint, ALARM_RE, appendCapped };
