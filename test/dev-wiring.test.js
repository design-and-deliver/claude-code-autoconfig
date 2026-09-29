#!/usr/bin/env node
'use strict';

/**
 * Dev-box wiring guard (worktree-hardening plan 1.1).
 *
 * worktree-gate.js and `worktree.baseRef: "head"` are wired in the gitignored
 * .claude/settings.local.json — never the tracked settings.json, which ships to every user. A
 * gitignored file has no history and no review, so a matcher edit or a settings rewrite can drop
 * the gate silently, and a hook that isn't wired fails the same way a working one stays quiet.
 * This suite is the only thing that notices. It skips where the file doesn't exist (CI, a fresh
 * clone), so it guards the dev box and nothing else.
 */

const fs = require('fs');
const path = require('path');

const { test, assert, summary } = require('./_harness');

const FILE = path.join(__dirname, '..', '.claude', 'settings.local.json');
const REL = '.claude/settings.local.json';
const GATE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

if (!fs.existsSync(FILE)) {
  console.log('skip: no settings.local.json');
  process.exit(0);
}

const settings = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const preToolUse = settings.hooks?.PreToolUse ?? [];
const gateEntry = preToolUse.find(e => (e.hooks ?? []).some(h => /worktree-gate\.js/.test(h.command ?? '')));

test('a PreToolUse entry runs worktree-gate.js', () => {
  assert(gateEntry, `${REL}: no PreToolUse hook runs worktree-gate.js`);
});

test('the gate matcher covers every file-mutating tool', () => {
  const matched = new Set((gateEntry?.matcher ?? '').split('|'));
  const missing = GATE_TOOLS.filter(t => !matched.has(t));
  assert(!missing.length, `${REL}: worktree-gate matcher is missing ${missing.join(', ')}`);
});

test('worktree.baseRef is "head"', () => {
  const baseRef = settings.worktree?.baseRef;
  assert(baseRef === 'head', `${REL}: worktree.baseRef is ${JSON.stringify(baseRef)}, expected "head"`);
});

summary();
