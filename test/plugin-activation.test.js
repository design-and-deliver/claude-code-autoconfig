#!/usr/bin/env node

/**
 * Tests for licensed delivery: `plugin activate <key>` + `plugin verify token-saver`.
 *
 * Behavioral: drives the REAL bin/lib/plugins.js activation path (materialize → pluginAdd →
 * config write → verify) against throwaway temp dirs, with only the network stubbed
 * (deps.fetch / deps.apiBase — the same seams cli.js's dispatch leaves open). Asserts on the
 * actual files / settings.json / cca.config.json / ledger produced, not on source text.
 *
 * Covers the substep-3.1 matrix: activation happy path (files land, settings merged, config
 * MERGED not clobbered), the 204 key-not-recognized path, re-activation idempotence (BH-1
 * re-install seeding), clean `plugin remove`, and verify's three-check matrix (all-green,
 * missing file, unmerged hooks, rejected key).
 *
 * Harness note: `test()` is sync — every await happens in the async main() BEFORE its
 * assertions run, so a rejected promise can never pass vacuously.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { test, assert, summary } = require('./_harness');
const {
  pluginActivate,
  pluginRemove,
  verifyTokenSaver,
  verifyCreateVid,
  readPluginsLedger
} = require('../bin/lib/plugins.js');
const { mergeSettingsInto, unmergeSettingsFrom } = require('../bin/lib/settings-merge.js');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Count how many hook entries in an event reference a given command
function countCommand(settings, event, command) {
  const matchers = (settings.hooks && settings.hooks[event]) || [];
  let n = 0;
  for (const m of matchers) for (const h of m.hooks || []) if (h.command === command) n++;
  return n;
}

console.log('============================================================');
console.log('PLUGIN ACTIVATION TESTS');
console.log('============================================================');
console.log();

// --- Fixtures ---------------------------------------------------------------

const GUARD_CMD = 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/token-guard.js"';
const GUARD_HOOK = { type: 'command', command: GUARD_CMD };
const HOOK_EVENTS = ['UserPromptSubmit', 'Stop', 'PreToolUse', 'PostToolUse'];

// Mirror of the real generated bundle's shape (proswitch-api token-saver-plugin/plugin.json),
// as the module-bundle endpoint serves it: files carry inline content, no "from".
function makeBundlePayload() {
  const hooks = {};
  for (const ev of HOOK_EVENTS) hooks[ev] = [{ matcher: '', hooks: [GUARD_HOOK] }];
  return {
    schemaVersion: 1,
    plugin: {
      name: 'token-saver',
      version: '1.0.0',
      description: 'test bundle',
      settings: { hooks },
      files: [
        { to: 'hooks/token-guard.js', content: '// token-guard body\n' },
        { to: 'commands/token-saver-rationale.md', content: '# rationale\n' }
      ]
    }
  };
}

const GOOD_KEY = 'cca_live_good';
const API_BASE = 'https://stub.test/api/cca';

// Stub fetch: 200 + bundle for GOOD_KEY, 204 otherwise. Records calls for URL assertions.
const fetchCalls = [];
async function stubFetch(url, opts) {
  const body = JSON.parse(opts.body);
  fetchCalls.push({ url, key: body.key });
  if (body.key === GOOD_KEY) {
    return { status: 200, json: async () => makeBundlePayload() };
  }
  return { status: 204, json: async () => { throw new Error('no body'); } };
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-activate-'));
const projectDir = path.join(tmpRoot, 'project');
const claudeDir = path.join(projectDir, '.claude');

const deps = {
  cwd: projectDir,
  isReservedName: () => false,
  mergeSettingsInto,
  unmergeSettingsFrom,
  fetch: stubFetch,
  apiBase: API_BASE
};

// A project that already ran autoconfig: its own Stop hook + env, and a cca.config.json
// with a pin and an existing tokenGuard key — the MERGE must preserve all of it (trap 1).
const OTHER_CMD = 'node .claude/hooks/other.js';
fs.mkdirSync(claudeDir, { recursive: true });
fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({
  env: { EXISTING_VAR: 'keep' },
  hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: OTHER_CMD }] }] }
}, null, 2));
fs.writeFileSync(path.join(claudeDir, 'cca.config.json'), JSON.stringify({
  pinVersion: '1.0.200',
  tokenGuard: { sessionWarnUSD: 5 }
}, null, 2));

async function main() {
  // --- 204 path first (project must stay untouched) -------------------------
  let badKeyError = null;
  try {
    await pluginActivate('cca_live_wrong', claudeDir, deps);
  } catch (e) {
    badKeyError = e;
  }

  test('204: unrecognized key throws the not-recognized error', () => {
    assert(badKeyError, 'expected pluginActivate to throw');
    assert(/key not recognized/.test(badKeyError.message), `got: ${badKeyError.message}`);
  });

  test('204: nothing was installed or written', () => {
    assert(!fs.existsSync(path.join(claudeDir, 'hooks', 'token-guard.js')), 'no files should land');
    assert(!readPluginsLedger(claudeDir)['token-saver'], 'no ledger entry should exist');
    const cfg = readJson(path.join(claudeDir, 'cca.config.json'));
    assert(!cfg.tokenGuard.verdictServiceKey, 'no key should be written');
  });

  // --- Happy path -----------------------------------------------------------
  await pluginActivate(GOOD_KEY, claudeDir, deps);

  test('activate: bundle files land under .claude/', () => {
    assert(fs.readFileSync(path.join(claudeDir, 'hooks', 'token-guard.js'), 'utf8') === '// token-guard body\n', 'token-guard.js content');
    assert(fs.existsSync(path.join(claudeDir, 'commands', 'token-saver-rationale.md')), 'token-saver-rationale.md exists');
  });

  test('activate: all four hook events merged into settings.json, user entries kept', () => {
    const settings = readJson(path.join(claudeDir, 'settings.json'));
    for (const ev of HOOK_EVENTS) {
      assert(countCommand(settings, ev, GUARD_CMD) === 1, `${ev} has the token-guard hook once`);
    }
    assert(countCommand(settings, 'Stop', OTHER_CMD) === 1, 'user Stop hook preserved');
    assert(settings.env.EXISTING_VAR === 'keep', 'user env preserved');
  });

  test('activate: cca.config.json MERGED — key nested under tokenGuard, other keys preserved', () => {
    const cfg = readJson(path.join(claudeDir, 'cca.config.json'));
    assert(cfg.tokenGuard.verdictServiceKey === GOOD_KEY, 'verdictServiceKey written');
    assert(cfg.tokenGuard.verdictService === API_BASE, 'verdictService written');
    assert(cfg.tokenGuard.sessionWarnUSD === 5, 'existing tokenGuard key preserved');
    assert(cfg.pinVersion === '1.0.200', 'existing top-level key preserved');
    assert(!cfg.verdictServiceKey, 'key must NOT sit at top level (dead key + retraction bug)');
  });

  test('activate: ledger entry recorded for token-saver', () => {
    const entry = readPluginsLedger(claudeDir)['token-saver'];
    assert(entry && entry.version === '1.0.0', 'ledger entry with version');
    assert(entry.files.length === 2, 'two files tracked');
  });

  test('activate: posts the key to <apiBase>/module-bundle', () => {
    assert(fetchCalls.some(c => c.url === API_BASE + '/module-bundle' && c.key === GOOD_KEY), 'fetch hit the stub base');
  });

  // --- Verify: all-green ----------------------------------------------------
  const allGreen = await verifyTokenSaver(claudeDir, deps);
  test('verify: all three checks pass on a fresh activation', () => {
    assert(allGreen === true, 'expected overall pass');
  });

  // --- Re-activation idempotence --------------------------------------------
  await pluginActivate(GOOD_KEY, claudeDir, deps);

  test('re-activate: hooks not duplicated in settings.json', () => {
    const settings = readJson(path.join(claudeDir, 'settings.json'));
    for (const ev of HOOK_EVENTS) {
      assert(countCommand(settings, ev, GUARD_CMD) === 1, `${ev} still has exactly one token-guard hook`);
    }
  });

  // --- Verify matrix: missing file ------------------------------------------
  fs.rmSync(path.join(claudeDir, 'hooks', 'token-guard.js'));
  const missingFile = await verifyTokenSaver(claudeDir, deps);
  test('verify: fails when a bundle file is missing', () => {
    assert(missingFile === false, 'expected fail on missing file');
  });
  await pluginActivate(GOOD_KEY, claudeDir, deps); // restore

  // --- Verify matrix: unmerged hooks ----------------------------------------
  const settingsPath = path.join(claudeDir, 'settings.json');
  const savedSettings = fs.readFileSync(settingsPath, 'utf8');
  const stripped = JSON.parse(savedSettings);
  delete stripped.hooks.UserPromptSubmit;
  fs.writeFileSync(settingsPath, JSON.stringify(stripped, null, 2));
  const unmergedHooks = await verifyTokenSaver(claudeDir, deps);
  test('verify: fails when a hook event is not merged', () => {
    assert(unmergedHooks === false, 'expected fail on unmerged UserPromptSubmit');
  });
  fs.writeFileSync(settingsPath, savedSettings); // restore

  // --- Verify matrix: rejected key ------------------------------------------
  const cfgPath = path.join(claudeDir, 'cca.config.json');
  const savedCfg = fs.readFileSync(cfgPath, 'utf8');
  const badCfg = JSON.parse(savedCfg);
  badCfg.tokenGuard.verdictServiceKey = 'cca_live_revoked';
  fs.writeFileSync(cfgPath, JSON.stringify(badCfg, null, 2));
  const rejectedKey = await verifyTokenSaver(claudeDir, deps);
  test('verify: fails when the licensing service rejects the key', () => {
    assert(rejectedKey === false, 'expected fail on rejected key');
  });
  fs.writeFileSync(cfgPath, savedCfg); // restore

  // --- Clean removal via the existing machinery ------------------------------
  pluginRemove('token-saver', claudeDir, deps);

  test('remove: files deleted, hooks reverted, user entries + license key kept', () => {
    assert(!fs.existsSync(path.join(claudeDir, 'hooks', 'token-guard.js')), 'token-guard.js removed');
    assert(!fs.existsSync(path.join(claudeDir, 'commands', 'token-saver-rationale.md')), 'rationale command removed');
    const settings = readJson(settingsPath);
    for (const ev of HOOK_EVENTS) {
      assert(countCommand(settings, ev, GUARD_CMD) === 0, `${ev} token-guard hook reverted`);
    }
    assert(countCommand(settings, 'Stop', OTHER_CMD) === 1, 'user Stop hook survives removal');
    assert(!readPluginsLedger(claudeDir)['token-saver'], 'ledger entry dropped');
    const cfg = readJson(cfgPath);
    assert(cfg.tokenGuard.verdictServiceKey === GOOD_KEY, 'license key deliberately kept in cca.config.json');
  });

  const afterRemove = await verifyTokenSaver(claudeDir, deps);
  test('verify: fails cleanly in a project with no activation', () => {
    assert(afterRemove === false, 'expected fail after removal');
  });

  // --- create-vid: activation is keyed by the bundle's name ------------------
  // A second project whose cca.config.json already holds token-saver keys: activating a
  // create-vid key must add createVid.* and leave tokenGuard.* byte-for-byte alone (trap 6).
  const VID_KEY = 'cca_live_vid_good';
  const vidProject = path.join(tmpRoot, 'vid-project');
  const vidClaude = path.join(vidProject, '.claude');
  fs.mkdirSync(vidClaude, { recursive: true });
  const vidCfgPath = path.join(vidClaude, 'cca.config.json');
  const TG_BEFORE = { verdictService: 'https://tg.test/api/cca', verdictServiceKey: 'cca_live_tg', sessionWarnUSD: 5 };
  fs.writeFileSync(vidCfgPath, JSON.stringify({ pinVersion: '1.0.200', tokenGuard: TG_BEFORE }, null, 2));

  function makeVidBundlePayload() {
    return {
      schemaVersion: 1,
      plugin: {
        name: 'create-vid',
        version: '1.0.0',
        description: 'test vid bundle',
        settings: null,
        files: [
          { to: 'commands/create-vid.md', content: '# create-vid\n' },
          { to: 'scripts/vid-client.js', content: '// vid client\n' },
          { to: 'templates/create-vid-player.html', content: '<title>__TITLE__</title>\n' }
        ]
      }
    };
  }

  // Routes by URL: module-bundle → the create-vid bundle for VID_KEY; vid/quota → 200 for
  // VID_KEY, 401 otherwise (the render service's typed error, unlike module-bundle's 204).
  const vidCalls = [];
  async function vidFetch(url, opts) {
    const body = JSON.parse(opts.body);
    vidCalls.push({ url, body });
    if (url.endsWith('/module-bundle')) {
      if (body.key === VID_KEY) return { status: 200, json: async () => makeVidBundlePayload() };
      return { status: 204, json: async () => { throw new Error('no body'); } };
    }
    if (url.endsWith('/vid/quota')) {
      if (body.license && body.license.key === VID_KEY) return { status: 200, json: async () => ({ used: 1, limit: 20, resetsAt: '2026-10-01T00:00:00.000Z' }) };
      return { status: 401, json: async () => ({ error: 'license' }) };
    }
    throw new Error('unexpected fetch ' + url);
  }
  const vidDeps = Object.assign({}, deps, { cwd: vidProject, fetch: vidFetch });

  await pluginActivate(VID_KEY, vidClaude, vidDeps);

  test('create-vid activate: the three bundle files land under .claude/', () => {
    assert(fs.readFileSync(path.join(vidClaude, 'commands', 'create-vid.md'), 'utf8') === '# create-vid\n', 'command');
    assert(fs.existsSync(path.join(vidClaude, 'scripts', 'vid-client.js')), 'client script');
    assert(fs.existsSync(path.join(vidClaude, 'templates', 'create-vid-player.html')), 'player template');
  });

  test('create-vid activate: cca.config.json gets createVid = { apiBase, key }; tokenGuard untouched; nothing top-level', () => {
    const cfg = readJson(vidCfgPath);
    assert(cfg.createVid && cfg.createVid.key === VID_KEY, 'createVid.key written');
    assert(cfg.createVid.apiBase === API_BASE, 'createVid.apiBase written');
    assert(JSON.stringify(cfg.tokenGuard) === JSON.stringify(TG_BEFORE), 'tokenGuard section untouched');
    assert(cfg.pinVersion === '1.0.200', 'existing top-level key preserved');
    assert(!cfg.verdictServiceKey && !cfg.key, 'no top-level key');
  });

  test('create-vid activate: no hooks merged (the bundle ships settings: null)', () => {
    assert(!fs.existsSync(path.join(vidClaude, 'settings.json')), 'settings.json not created');
  });

  test('create-vid activate: verification hit <apiBase>/vid/quota with the key', () => {
    assert(vidCalls.some(c => c.url === API_BASE + '/vid/quota' && c.body.license.key === VID_KEY), 'quota call made');
  });

  test('create-vid activate: ledger entry recorded under create-vid', () => {
    const entry = readPluginsLedger(vidClaude)['create-vid'];
    assert(entry && entry.version === '1.0.0' && entry.files.length === 3, 'ledger entry with three files');
  });

  const vidGreen = await verifyCreateVid(vidClaude, vidDeps);
  test('create-vid verify: passes on a fresh activation', () => {
    assert(vidGreen === true, 'expected overall pass');
  });

  const savedVidCfg = fs.readFileSync(vidCfgPath, 'utf8');
  const revoked = JSON.parse(savedVidCfg);
  revoked.createVid.key = 'cca_live_revoked';
  fs.writeFileSync(vidCfgPath, JSON.stringify(revoked, null, 2));
  const vidRejected = await verifyCreateVid(vidClaude, vidDeps);
  test('create-vid verify: fails when the render service rejects the key (401)', () => {
    assert(vidRejected === false, 'expected fail on rejected key');
  });
  fs.writeFileSync(vidCfgPath, savedVidCfg); // restore

  fs.rmSync(path.join(vidClaude, 'scripts', 'vid-client.js'));
  const vidMissing = await verifyCreateVid(vidClaude, vidDeps);
  test('create-vid verify: fails when a bundle file is missing', () => {
    assert(vidMissing === false, 'expected fail on missing file');
  });

  pluginRemove('create-vid', vidClaude, vidDeps);
  test('create-vid remove: files gone, createVid key kept, tokenGuard still untouched', () => {
    assert(!fs.existsSync(path.join(vidClaude, 'commands', 'create-vid.md')), 'command removed');
    assert(!fs.existsSync(path.join(vidClaude, 'templates', 'create-vid-player.html')), 'template removed');
    assert(!readPluginsLedger(vidClaude)['create-vid'], 'ledger entry dropped');
    const cfg = readJson(vidCfgPath);
    assert(cfg.createVid.key === VID_KEY, 'createVid key deliberately kept');
    assert(JSON.stringify(cfg.tokenGuard) === JSON.stringify(TG_BEFORE), 'tokenGuard still untouched');
  });

  // --- token-saver activation on top of a create-vid project leaves createVid alone ---
  await pluginActivate(GOOD_KEY, vidClaude, deps);
  test('token-saver activate after create-vid: createVid section preserved', () => {
    const cfg = readJson(vidCfgPath);
    assert(cfg.createVid.key === VID_KEY, 'createVid.key survives a token-saver activation');
    assert(cfg.tokenGuard.verdictServiceKey === GOOD_KEY, 'tokenGuard.verdictServiceKey updated');
    assert(cfg.tokenGuard.sessionWarnUSD === 5, 'other tokenGuard keys preserved');
  });

  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) { /* Windows file locks — temp dir, best effort */ }

  summary();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
