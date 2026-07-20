'use strict';

// ============================================================================
// Settings merge helpers (shared by the upgrade path and the plugin installer)
//
// Three pure functions that fold a settings fragment (hooks / env / permissions)
// into a user's .claude/settings.json:
//   - migrateLegacyHookCommands: rewrite legacy cwd-relative hook commands to the
//     ${CLAUDE_PROJECT_DIR:-.}-anchored form (must run BEFORE a merge, or the merge
//     doubles the hook — see the ordering guard in test/cli-install.test.js).
//   - mergeSettingsInto:  additively fold a fragment in (never overwrite user values).
//   - unmergeSettingsFrom: strip only what a fragment added back out (dedup-safe).
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
function mergeSettingsInto(userSettings, fragment) {
  if (fragment.hooks) {
    if (!userSettings.hooks) userSettings.hooks = {};
    for (const [event, matchers] of Object.entries(fragment.hooks)) {
      if (!userSettings.hooks[event]) {
        userSettings.hooks[event] = matchers;
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
              } else {
                userSettings.hooks[event].push(matcher);
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
      if (!(key in userSettings.env)) userSettings.env[key] = value;
    }
  }

  if (fragment.permissions) {
    if (!userSettings.permissions) userSettings.permissions = {};
    for (const key of ['allow', 'deny']) {
      if (!fragment.permissions[key]) continue;
      if (!userSettings.permissions[key]) {
        userSettings.permissions[key] = fragment.permissions[key];
      } else {
        // Migrate deprecated :* syntax to space-* in existing entries
        userSettings.permissions[key] = userSettings.permissions[key].map(rule =>
          rule.replace(/^(Bash\([^)]*):(\*\))$/, '$1 $2')
        );
        for (const rule of fragment.permissions[key]) {
          if (!userSettings.permissions[key].includes(rule)) {
            userSettings.permissions[key].push(rule);
          }
        }
      }
    }
  }

  return userSettings;
}

// Inverse of mergeSettingsInto: strip a fragment's contributions back out. Only removes
// what the fragment added (dedup-safe), leaving the user's own entries untouched.
function unmergeSettingsFrom(userSettings, fragment) {
  if (fragment.hooks && userSettings.hooks) {
    for (const [event, matchers] of Object.entries(fragment.hooks)) {
      if (!userSettings.hooks[event]) continue;
      const commands = new Set();
      for (const matcher of matchers) {
        for (const hook of matcher.hooks || []) {
          if (hook.command) commands.add(hook.command);
        }
      }
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

  if (fragment.env && userSettings.env) {
    for (const [key, value] of Object.entries(fragment.env)) {
      if (userSettings.env[key] === value) delete userSettings.env[key];
    }
    if (Object.keys(userSettings.env).length === 0) delete userSettings.env;
  }

  if (fragment.permissions && userSettings.permissions) {
    for (const key of ['allow', 'deny']) {
      if (!fragment.permissions[key] || !userSettings.permissions[key]) continue;
      const remove = new Set(fragment.permissions[key]);
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
