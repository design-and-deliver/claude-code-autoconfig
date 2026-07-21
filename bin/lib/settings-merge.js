'use strict';

// ============================================================================
// Settings merge helpers (shared by the upgrade path and the plugin installer)
//
// Three pure functions that fold a settings fragment (hooks / env / permissions)
// into a user's .claude/settings.json:
//   - migrateLegacyHookCommands: rewrite legacy cwd-relative hook commands to the
//     ${CLAUDE_PROJECT_DIR:-.}-anchored form (must run BEFORE a merge, or the merge
//     doubles the hook — see the ordering guard in test/cli-install.test.js).
//   - mergeSettingsInto:  additively fold a fragment in (never overwrite user values);
//     optionally records the true delta it added into an accumulator (BH-1).
//   - unmergeSettingsFrom: strip back out only what was recorded as added (falling back to
//     value-equality for old ledgers with no recorded delta), never a user-owned entry.
//
// Extracted from bin/cli.js (Phase 3 seam 2). Unlike the plugin subsystem, these need
// NO cli.js module-scope helpers — they are pure (userSettings-in, userSettings-out) —
// so cli.js just requires them, and re-injects mergeSettingsInto / unmergeSettingsFrom
// into the plugin dispatch's `deps` object (plugins.js still calls them via `deps`).
//
// Hook dedup is by EXACT command string (trap 7): a reworded shipped hook command would
// be seen as new and ADDED alongside the old one — do not "normalize" command strings here.
// ============================================================================

// Rewrite legacy cwd-relative hook commands ("node .claude/hooks/X.js") to the
// ${CLAUDE_PROJECT_DIR:-.}-anchored form IN PLACE, mutating the given settings object.
// Two reasons, both from the 2026-07-08 stuck-title postmortem:
//   1. cwd-relative commands go MODULE_NOT_FOUND the moment a session cd's away from the
//      project root — every matching tool call then spews a red hook error until cwd returns.
//   2. mergeSettingsInto dedups by EXACT command string, so without this rewrite an upgrade
//      would ADD the anchored template entry alongside the user's old relative one -> the
//      hook runs twice per event.
// Any .claude/hooks/*.js relative command is rewritten — anchored resolution is identical at
// the project root and cd-proof everywhere else — while commands outside .claude/hooks are
// never touched.
function migrateLegacyHookCommands(userSettings) {
  if (!userSettings || !userSettings.hooks) return;
  const LEGACY = /^node \.claude\/hooks\/([\w.-]+\.js)$/;
  for (const matchers of Object.values(userSettings.hooks)) {
    if (!Array.isArray(matchers)) continue;
    for (const matcher of matchers) {
      for (const hook of matcher.hooks || []) {
        const m = typeof hook.command === 'string' && hook.command.match(LEGACY);
        if (m) hook.command = 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/' + m[1] + '"';
      }
    }
  }
}

// Additively fold a settings fragment (hooks / env / permissions) into an existing
// settings object, mutating and returning it.
//   - hooks: add hook commands that don't already exist (dedup by command string, per event)
//   - env:   add keys the user hasn't set (never overwrite an existing value)
//   - permissions.allow/deny: add missing rules (and migrate deprecated :* syntax)
//
// Optional `added` accumulator (BH-1): when the caller passes an object, this records the
// TRUE delta — exactly the keys / hook commands / permission rules THIS merge introduced.
// Because the merge is dedup-safe (it never adds a value the user already had), the delta is
// the only reliable record of what the fragment actually created; the plugin installer stores
// it in the ledger so `unmergeSettingsFrom` reverts ONLY what was added and never a user-owned
// entry a plugin happened to also declare. The `added` shape is
// `{ env:[key], hooks:{event:[command]}, permissions:{allow:[rule], deny:[rule]} }`, deduped as
// it fills so re-installs (which pass the prior delta back in) union cleanly. Callers that pass
// nothing (the upgrade path) record nothing and behave exactly as before.
function mergeSettingsInto(userSettings, fragment, added) {
  const recEnv = (key) => { if (added && !added.env.includes(key)) added.env.push(key); };
  const recHook = (event, command) => {
    if (!added || !command) return;
    if (!added.hooks[event]) added.hooks[event] = [];
    if (!added.hooks[event].includes(command)) added.hooks[event].push(command);
  };
  const recPerm = (key, rule) => { if (added && !added.permissions[key].includes(rule)) added.permissions[key].push(rule); };

  if (fragment.hooks) {
    if (!userSettings.hooks) userSettings.hooks = {};
    for (const [event, matchers] of Object.entries(fragment.hooks)) {
      if (!userSettings.hooks[event]) {
        userSettings.hooks[event] = matchers;
        for (const matcher of matchers) {
          for (const hook of matcher.hooks || []) recHook(event, hook.command);
        }
      } else {
        // Add any hook commands that don't already exist
        for (const matcher of matchers) {
          for (const hook of matcher.hooks || []) {
            const exists = userSettings.hooks[event].some(m =>
              (m.hooks || []).some(h => h.command === hook.command)
            );
            if (!exists) {
              const existingMatcher = userSettings.hooks[event].find(m => m.matcher === matcher.matcher);
              if (existingMatcher) {
                existingMatcher.hooks = existingMatcher.hooks || [];
                existingMatcher.hooks.push(hook);
                recHook(event, hook.command);
              } else {
                userSettings.hooks[event].push(matcher);
                // The whole matcher lands at once — record every command it carries so a
                // multi-hook matcher isn't under-recorded (the later hooks now read as "exists").
                for (const h of matcher.hooks || []) recHook(event, h.command);
              }
            }
          }
        }
      }
    }
  }

  if (fragment.env) {
    if (!userSettings.env) userSettings.env = {};
    for (const [key, value] of Object.entries(fragment.env)) {
      if (!(key in userSettings.env)) {
        userSettings.env[key] = value;
        recEnv(key);
      }
    }
  }

  if (fragment.permissions) {
    if (!userSettings.permissions) userSettings.permissions = {};
    for (const key of ['allow', 'deny']) {
      if (!fragment.permissions[key]) continue;
      if (!userSettings.permissions[key]) {
        userSettings.permissions[key] = fragment.permissions[key];
        for (const rule of fragment.permissions[key]) recPerm(key, rule);
      } else {
        // Migrate deprecated :* syntax to space-* in existing entries
        userSettings.permissions[key] = userSettings.permissions[key].map(rule =>
          rule.replace(/^(Bash\([^)]*):(\*\))$/, '$1 $2')
        );
        for (const rule of fragment.permissions[key]) {
          if (!userSettings.permissions[key].includes(rule)) {
            userSettings.permissions[key].push(rule);
            recPerm(key, rule);
          }
        }
      }
    }
  }

  return userSettings;
}

// Inverse of mergeSettingsInto: strip a fragment's contributions back out, leaving the
// user's own entries untouched.
//
// When `added` (the delta recorded at merge time — BH-1) is supplied, remove EXACTLY what the
// plugin added and nothing else: a key / hook / permission the user set themselves that the
// plugin merely also declared was never added, so it isn't in `added` and survives. When
// `added` is ABSENT — an old ledger written before this field existed, or a two-arg caller —
// fall back to the historical value-equality behavior (remove any entry equal to the
// fragment's) so pre-fix installs still clean up their contributions exactly as they did
// before. This fallback is the documented additive-migration choice (trap 1): a missing
// `added` means "behave as the old code did," not "remove nothing" — old plugins stay
// removable; only NEW installs gain the precise, user-config-safe revert.
function unmergeSettingsFrom(userSettings, fragment, added) {
  const precise = added && typeof added === 'object';

  if (userSettings.hooks) {
    // Build, per event, the set of hook commands to strip.
    const strip = {};
    if (precise) {
      for (const [event, cmds] of Object.entries(added.hooks || {})) strip[event] = new Set(cmds);
    } else if (fragment.hooks) {
      for (const [event, matchers] of Object.entries(fragment.hooks)) {
        const commands = new Set();
        for (const matcher of matchers) {
          for (const hook of matcher.hooks || []) {
            if (hook.command) commands.add(hook.command);
          }
        }
        strip[event] = commands;
      }
    }
    for (const [event, commands] of Object.entries(strip)) {
      if (!userSettings.hooks[event]) continue;
      userSettings.hooks[event] = userSettings.hooks[event]
        .map(m => {
          if (m.hooks) m.hooks = m.hooks.filter(h => !commands.has(h.command));
          return m;
        })
        .filter(m => (m.hooks || []).length > 0);
      if (userSettings.hooks[event].length === 0) delete userSettings.hooks[event];
    }
    if (Object.keys(userSettings.hooks).length === 0) delete userSettings.hooks;
  }

  if (userSettings.env) {
    let keys = [];
    if (precise) keys = added.env || [];
    else if (fragment.env) keys = Object.keys(fragment.env).filter(k => userSettings.env[k] === fragment.env[k]);
    for (const key of keys) delete userSettings.env[key];
    if (Object.keys(userSettings.env).length === 0) delete userSettings.env;
  }

  if (userSettings.permissions) {
    for (const key of ['allow', 'deny']) {
      if (!userSettings.permissions[key]) continue;
      let remove;
      if (precise) remove = new Set((added.permissions && added.permissions[key]) || []);
      else if (fragment.permissions && fragment.permissions[key]) remove = new Set(fragment.permissions[key]);
      else continue;
      userSettings.permissions[key] = userSettings.permissions[key].filter(r => !remove.has(r));
    }
  }

  return userSettings;
}

module.exports = {
  migrateLegacyHookCommands,
  mergeSettingsInto,
  unmergeSettingsFrom
};
