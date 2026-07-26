#!/usr/bin/env node
/**
 * Sync the terminal-title.js fleet from the CCA canonical.
 *
 * The hook is ONE runtime-branched file (see the terminal-title.js header) with CCA's copy as the
 * single source of truth. Every other copy — the live user-level ~/.claude hook and each adopting
 * project — is a byte-derived artifact of it. This keeps them that way WITHOUT an npm publish (the
 * published tarball can lag git main, e.g. while path B is gated): it copies the canonical over targets.
 *
 *   node scripts/sync-terminal-title.js           # CHECK: report drift, exit 1 if any (pre-commit / CI friendly)
 *   node scripts/sync-terminal-title.js --write   # WRITE: copy the canonical over every drifted target
 *
 * SINCE 2026-07-25 this is a thin front-end over scripts/sync-hook-fleet.js, which does the same
 * job for the whole canonical hooks manifest (terminal-title + token-guard). The behaviour and CLI
 * here are unchanged — the many plan/audit docs that name this script stay correct — but the fleet
 * logic now lives in exactly ONE place. Keeping a second copy of it would have been the very
 * failure mode this pair of scripts exists to prevent.
 */
const { syncFleet, report } = require('./sync-hook-fleet.js');

const TERMINAL_TITLE_FILES = ['terminal-title.js', 'terminal-title.directive.md'];

const write = process.argv.includes('--write');
report(syncFleet({ write, files: TERMINAL_TITLE_FILES }), write);
