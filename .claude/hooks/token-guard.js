#!/usr/bin/env node
// Compatibility shim — the engine moved to token-saver.js (TokenSaver rename, 2026-09).
// Kept one release so settings entries and commands that still name token-guard.js keep
// working. Remove per docs/token-saver-rename-plan.md → Deferred. Do not add code here.
const engine = require('./token-saver.js');
if (require.main === module) engine.main();
module.exports = engine;
