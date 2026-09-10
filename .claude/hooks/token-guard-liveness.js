#!/usr/bin/env node
// Compatibility shim — the engine moved to token-saver-liveness.js (TokenSaver rename, 2026-09).
// Kept one release so settings entries and commands that still name token-guard-liveness.js keep
// working. Remove per docs/token-saver-rename-plan.md → Deferred. Do not add code here.
const engine = require('./token-saver-liveness.js');
if (require.main === module) engine.main();
module.exports = engine;
