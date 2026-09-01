#!/usr/bin/env node

// auto-guard-set — deterministic backend for /enable-auto-mode and /disable-auto-mode.
//
//   node auto-guard-set.js                     → print each category's current setting
//   node auto-guard-set.js <category> <value>  → set "ask" | "deny" | "off", or "default"
//                                                to drop the override and restore the
//                                                category's built-in action
//
// Merges into .claude/cca.config.json, preserving every other key. Unlike the hook it
// backs, this is user-invoked: errors are loud and exit 1.

'use strict';

const fs = require('fs');
const path = require('path');

const { CATEGORIES } = require(path.join(__dirname, '..', 'hooks', 'auto-guard.js'));

const VALUES = new Set(['ask', 'deny', 'off']);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function readConfig(configPath) {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return fail('auto-guard is not set up here (no readable .claude/cca.config.json). Run /autoconfig first.');
  }
}

function effective(cat, overrides) {
  const o = overrides[cat.name];
  return VALUES.has(o) ? o : cat.action;
}

function printStatus(guard, overrides) {
  const state = guard.enabled === true ? 'on' : 'OFF (autoGuard.enabled is not true — run /autoconfig)';
  console.log(`auto-guard: ${state}`);
  for (const cat of CATEGORIES) {
    const marker = VALUES.has(overrides[cat.name]) ? '' : ' (default)';
    console.log(`  ${cat.name}: ${effective(cat, overrides)}${marker}`);
  }
  console.log('/enable-auto-mode <category> to stop its prompts; /disable-auto-mode <category> to restore the default.');
}

function confirmation(name, now, restored) {
  if (restored) return `auto-guard: ${name} → ${now} (default restored).`;
  const outcome = {
    off: `no longer forces a prompt — your other permission rules still apply. Revert with /disable-auto-mode ${name}.`,
    ask: `asks before running. Stop the prompts with /enable-auto-mode ${name}.`,
    deny: `is always blocked. Revert with /disable-auto-mode ${name}.`,
  };
  return `auto-guard: ${name} → ${now}. This category ${outcome[now]}`;
}

function resolveTarget(name, value) {
  const cat = CATEGORIES.find(c => c.name === name);
  if (!cat) fail(`unknown category "${name}". Valid: ${CATEGORIES.map(c => c.name).join(', ')}.`);
  if (value !== 'default' && !VALUES.has(value)) fail(`invalid value "${value ?? ''}". Valid: ask, deny, off, default.`);
  return cat;
}

function main() {
  const projectRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const configPath = path.join(projectRoot, '.claude', 'cca.config.json');
  const config = readConfig(configPath);
  const guard = config.autoGuard ?? {};
  const overrides = { ...(guard.categories ?? {}) };

  const [name, value] = process.argv.slice(2);
  if (!name) {
    printStatus(guard, overrides);
    return;
  }

  const cat = resolveTarget(name, value);

  if (value === 'default') delete overrides[cat.name];
  else overrides[cat.name] = value;
  config.autoGuard = { ...guard, categories: overrides };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  console.log(confirmation(cat.name, effective(cat, overrides), value === 'default'));
  if (guard.enabled !== true) {
    console.log('note: autoGuard.enabled is not true — the guard is inert until /autoconfig turns it on.');
  }
}

main();
