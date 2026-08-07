#!/usr/bin/env node
/**
 * run-plan.js — automate the /clear + /continue loop for a plan doc.
 *
 * Each iteration spawns a FRESH headless Claude session (`claude -p`) pointed at the
 * plan's next unchecked substep — a fresh session per substep is exactly what manual
 * /clear + /continue achieves, so context never accumulates across substeps.
 *
 * The plan doc must follow .claude/rules/plan-authoring.md:
 *   - substep headings:  ### ☐ N.N · <S|M|L> · ~<time> — <title>
 *   - a ## Ledger section the child appends to after each substep
 *
 * Usage:
 *   node scripts/run-plan.js --plan <path\to\plan.md> [options]
 *
 * Options:
 *   --cwd <dir>            repo the child sessions run in (default: walk up from plan to .git)
 *   --max <n>              max iterations this invocation (default 6)
 *   --permission-mode <m>  passed to claude -p (default acceptEdits)
 *   --dangerous            pass --dangerously-skip-permissions instead (unattended runs)
 *   --iter-timeout <min>   kill a hung iteration after N minutes (default 90)
 *   --dry-run              show what would run, spawn nothing
 *
 * Circuit breakers (stop without burning allocation):
 *   - substep count didn't decrease after an iteration  -> stop "no progress"
 *   - new Ledger tail contains "BLOCKED:"               -> stop and print it
 *   - iteration timeout                                  -> kill child, stop
 *   - plan has zero parseable ☐/☑ substeps              -> refuse to start
 *
 * Logs: ~/.claude/run-plan-logs/<plan-slug>/iter<N>-<ts>.log (full child output).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// ---------- args ----------
const argv = process.argv.slice(2);
function flag(name) { return argv.includes(name); }
function opt(name, dflt) { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; }

const planPath = path.resolve(opt('--plan', ''));
if (!planPath || !fs.existsSync(planPath)) {
  console.error('run-plan: --plan <path> is required and must exist.');
  process.exit(1);
}
const maxIter = parseInt(opt('--max', '6'), 10);
const permissionMode = opt('--permission-mode', 'acceptEdits');
const dangerous = flag('--dangerous');
const dryRun = flag('--dry-run');
const iterTimeoutMs = parseFloat(opt('--iter-timeout', '90')) * 60 * 1000;

function findRepoRoot(from) {
  let dir = path.dirname(from);
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.dirname(from); // no .git anywhere: run beside the plan
    dir = parent;
  }
}
const cwd = path.resolve(opt('--cwd', findRepoRoot(planPath)));

// ---------- plan parsing ----------
const UNCHECKED = /^###\s*☐/gm;
const CHECKED = /^###\s*[☑☒✅]/gm;
function readPlan() {
  const text = fs.readFileSync(planPath, 'utf8');
  const unchecked = (text.match(UNCHECKED) || []).length;
  const checked = (text.match(CHECKED) || []).length;
  const ledgerIdx = text.search(/^##\s+Ledger/m);
  const ledger = ledgerIdx >= 0 ? text.slice(ledgerIdx) : '';
  return { text, unchecked, checked, ledger };
}

const first = readPlan();
if (first.unchecked + first.checked === 0) {
  console.error('run-plan: no "### ☐ / ### ☑" substep headings found — plan does not follow');
  console.error('the plan-authoring grammar, so progress cannot be tracked. Refusing to start.');
  process.exit(1);
}
if (!first.ledger) {
  console.error('run-plan: WARNING — plan has no "## Ledger" section; BLOCKED detection is off.');
}
if (first.unchecked === 0) {
  console.log('run-plan: all substeps already checked. Nothing to do.');
  process.exit(0);
}

// ---------- child prompt ----------
function childPrompt() {
  return [
    `You are executing ONE substep of the plan at: ${planPath}`,
    ``,
    `Per that plan's "how to execute" header, read ONLY these slices of the plan — never the whole file:`,
    `1. the ⛔ standing-trap section at the top,`,
    `2. the FIRST unchecked substep heading (a line starting "### ☐") and its body,`,
    `3. the tail of the ## Ledger section.`,
    ``,
    `Then execute that one substep start to finish: its Read list, its work, and its Verify`,
    `commands (actually run them). When it verifies green:`,
    `- commit as the substep specifies (skip commits only if the plan/Ledger says the plan is untracked),`,
    `- append a short Ledger entry (date — step — outcome + commit hash, deviations, pointers),`,
    `- tick the substep's checkbox by editing its heading "### ☐" -> "### ☑",`,
    `- then, if the plan doc itself is tracked in git, make a SECOND small commit of just the plan`,
    `  doc ("plan: tick <N.N> + ledger") so the working tree ends clean. If the plan is untracked,`,
    `  the Ledger entry itself is the durable record — leave it uncommitted.`,
    ``,
    `If you cannot complete or verify it, append a Ledger entry beginning "BLOCKED:" explaining`,
    `why, do NOT tick the checkbox, and stop.`,
    ``,
    `This runner serializes sessions one at a time in this checkout, so do not use EnterWorktree.`,
    `Do exactly one substep, then stop — the runner spawns a fresh session for the next one.`,
  ].join('\n');
}

// ---------- logging ----------
const slug = path.basename(planPath).replace(/\.md$/i, '').replace(/[^\w-]+/g, '-');
const logDir = path.join(os.homedir(), '.claude', 'run-plan-logs', slug);
fs.mkdirSync(logDir, { recursive: true });

// ---------- one iteration ----------
function runIteration(n) {
  return new Promise((resolve) => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(logDir, `iter${n}-${ts}.log`);
    const log = fs.createWriteStream(logPath);
    const args = ['-p', '--output-format', 'text'];
    if (dangerous) args.push('--dangerously-skip-permissions');
    else args.push('--permission-mode', permissionMode);

    console.log(`\n=== iteration ${n} — spawning fresh session (log: ${logPath}) ===`);
    const child = spawn('claude', args, { cwd, shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.write(childPrompt());
    child.stdin.end();

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.error(`run-plan: iteration ${n} exceeded ${iterTimeoutMs / 60000} min — killing it.`);
      child.kill('SIGTERM');
    }, iterTimeoutMs);

    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (d) => { process.stdout.write(d); log.write(d); });
    }
    child.on('close', (code) => {
      clearTimeout(timer);
      log.end();
      resolve({ code, timedOut, logPath });
    });
  });
}

// ---------- main loop ----------
(async () => {
  console.log(`run-plan: plan=${planPath}`);
  console.log(`run-plan: cwd=${cwd}  substeps: ${first.checked} done / ${first.unchecked} remaining`);
  console.log(`run-plan: max ${maxIter} iteration(s), ${dangerous ? 'DANGEROUS (no permission prompts)' : `permission-mode=${permissionMode}`}`);
  if (dryRun) {
    console.log('\n--- dry run: child prompt would be ---\n');
    console.log(childPrompt());
    process.exit(0);
  }

  let before = first;
  for (let n = 1; n <= maxIter; n++) {
    const { timedOut } = await runIteration(n);
    if (timedOut) { console.error('run-plan: stopped on timeout.'); process.exit(2); }

    const after = readPlan();
    const newLedger = after.ledger.slice(before.ledger.length ? before.ledger.length - 1 : 0);
    if (/BLOCKED:/.test(newLedger)) {
      console.error('\nrun-plan: child reported BLOCKED — stopping. Ledger tail:');
      console.error(newLedger.trim().split('\n').slice(-8).join('\n'));
      process.exit(3);
    }
    if (after.unchecked >= before.unchecked) {
      console.error(`\nrun-plan: no progress (still ${after.unchecked} unchecked) — stopping so tokens aren't burned in a loop.`);
      process.exit(4);
    }
    console.log(`\nrun-plan: progress — ${after.checked} done / ${after.unchecked} remaining.`);
    if (after.unchecked === 0) { console.log('run-plan: plan complete. 🎉'); process.exit(0); }
    before = after;
  }
  console.log(`run-plan: hit --max ${maxIter} with substeps remaining — rerun to continue.`);
})();
