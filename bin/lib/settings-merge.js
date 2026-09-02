'use strict';

// ============================================================================
// Settings merge helpers (shared by the upgrade path and the plugin installer)
//
// Four public functions that fold a settings fragment (hooks / env / permissions)
// into a user's .claude/settings.json:
//   - migrateLegacyHookCommands: rewrite legacy cwd-relative hook commands to the
//     ${CLAUDE_PROJECT_DIR:-.}-anchored form (must run BEFORE a merge, or the merge
//     doubles the hook — see the ordering guard in test/cli-install.test.js).
//   - migrateRenamedToolMatchers: add `Agent` beside `Task` in CCA-managed hook matchers
//     (Claude Code renamed the subagent tool); also BEFORE the merge, for the same reason.
//   - migrateRetiredPermissionRules: strip permission rules CCA once shipped and has
//     withdrawn (the additive merge would otherwise preserve them forever), returning the
//     count removed so a caller can skip rewriting an unchanged file.
//   - mergeSettingsInto:  additively fold a fragment in (never overwrite user values);
//     optionally records the true delta it added into an accumulator (BH-1).
//   - unmergeSettingsFrom: strip back out only what was recorded as added (falling back to
//     value-equality for old ledgers with no recorded delta), never a user-owned entry.
//
// Each of the two is a three-line dispatcher over per-domain helpers — `mergeHooksInto` /
// `mergeEnvInto` / `mergePermissionsInto` and their `unmerge*` twins. The domains never
// interact, so the split is along the only real seam here; the delta accumulator is the one
// thing threaded through all three, as the `recorders()` no-op-or-record triple.
//
// Extracted from bin/cli.js (Phase 3 seam 2). Unlike the plugin subsystem, these need
// NO cli.js module-scope helpers — they are pure (userSettings-in, userSettings-out) —
// so cli.js just requires them, and re-injects mergeSettingsInto / unmergeSettingsFrom
// into the plugin dispatch's `deps` object (plugins.js still calls them via `deps`).
//
// Hook dedup is by EXACT command string (trap 7): a reworded shipped hook command would
// be seen as new and ADDED alongside the old one — do not "normalize" command strings here.
// ============================================================================

const PERMISSION_KEYS = ['allow', 'deny'];

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

// Claude Code renamed its subagent tool from `Task` to `Agent` (2.1.x). A hook matcher that
// still names only `Task` silently stops firing for subagent calls on current builds — no
// error, the title just stops repainting while a subagent runs. Rewrite CCA-managed matchers
// (ones carrying a .claude/hooks/ command) IN PLACE to name both: the matcher is a regex
// alternation, so older builds keep matching `Task` and newer ones match `Agent`. `Agent`
// is inserted right after `Task` so the result is byte-identical to the shipped template,
// letting mergeSettingsInto find the same-matcher entry instead of appending a second one.
// A matcher carrying only the user's own hooks is theirs and is never touched. Must run
// BEFORE the merge (see the ordering guard in test/cli-install.test.js).
function migrateRenamedToolMatchers(userSettings) {
  if (!userSettings || !userSettings.hooks) return;
  for (const matchers of Object.values(userSettings.hooks)) {
    if (!Array.isArray(matchers)) continue;
    for (const matcher of matchers) {
      if (carriesManagedHook(matcher)) matcher.matcher = withAgentBesideTask(matcher.matcher);
    }
  }
}

// The matcher string with `Agent` inserted right after `Task`; returned unchanged when the
// string names no `Task`, already names `Agent`, or is not a string at all.
function withAgentBesideTask(matcherString) {
  if (typeof matcherString !== 'string') return matcherString;
  const parts = matcherString.split('|');
  if (!parts.includes('Task') || parts.includes('Agent')) return matcherString;
  parts.splice(parts.indexOf('Task') + 1, 0, 'Agent');
  return parts.join('|');
}

// True when at least one hook under this matcher is a CCA-managed .claude/hooks/ command.
function carriesManagedHook(matcher) {
  return (matcher.hooks || []).some(h => typeof h.command === 'string' && /\.claude\/hooks\//.test(h.command));
}

// Permission rules CCA once shipped and has since withdrawn. Two families:
//   - Write(./**): Claude Code (v2.1.x) no longer matches Write(path) rules at all — only
//     Edit(path) rules gate file-editing tools — and prints a startup warning for each one
//     it finds. Edit(./**) (still shipped) already covers every file-editing tool.
//   - Write(./nul) / Edit(./nul): shipped briefly, removed in 15a24fc because they block
//     Windows bash `> nul` redirections; the same Write() warning now flags the first.
// The merge below is additive-only, so an upgraded project keeps these forever — and prints
// the warnings at the top of every new session — unless they are scrubbed here. Exact
// literals only: a user's own Write(...) rules are theirs, warning or not.
const RETIRED_PERMISSION_RULES = {
  allow: ['Write(./**)'],
  deny: ['Write(./nul)', 'Edit(./nul)']
};

// Strip the retired rules IN PLACE, mutating the given settings object, and RETURN THE COUNT
// removed. Two callers, both in bin/cli.js: the settings.json upgrade path (alongside
// migrateLegacyHookCommands — fresh installs copy the package file, which no longer contains
// them), and the settings.local.json scrub, which uses the count to skip rewriting a file it
// did not change. Zero is the common case, so it must be cheap and exact.
function migrateRetiredPermissionRules(userSettings) {
  if (!userSettings || !userSettings.permissions) return 0;
  let removed = 0;
  for (const key of PERMISSION_KEYS) {
    const rules = userSettings.permissions[key];
    if (!Array.isArray(rules)) continue;
    const kept = rules.filter(r => !RETIRED_PERMISSION_RULES[key].includes(r));
    removed += rules.length - kept.length;
    userSettings.permissions[key] = kept;
  }
  return removed;
}

// The BH-1 delta accumulator, as three recording callbacks — or three no-ops when the caller
// passed nothing (the upgrade path), so the merge helpers never branch on `added` themselves.
// The accumulator's shape (`{ env, hooks, permissions }`) is seeded by the caller
// (bin/lib/plugins.js seedAddedDelta); only `hooks[event]` is created lazily here.
function recorders(added) {
  if (!added) return { env() {}, hook() {}, perm() {} };
  return {
    env: (key) => {
      if (!added.env.includes(key)) added.env.push(key);
    },
    hook: (event, command) => {
      if (!command) return;
      if (!added.hooks[event]) added.hooks[event] = [];
      if (!added.hooks[event].includes(command)) added.hooks[event].push(command);
    },
    perm: (key, rule) => {
      if (!added.permissions[key].includes(rule)) added.permissions[key].push(rule);
    }
  };
}

// The hooks of one fragment matcher that nothing already runs for this event. Dedup is per
// COMMAND but the insert unit is a matcher, so a new matcher must land carrying ONLY these
// (BH-4) — pushing the fragment's whole matcher would re-add a command the user already runs
// under another matcher, and it would fire twice. `eventMatchers` is the live target array,
// so matchers inserted earlier in this same pass are already accounted for.
function freshHooksOf(matcher, eventMatchers) {
  const fresh = [];
  for (const hook of matcher.hooks || []) {
    const exists = eventMatchers.some(m => (m.hooks || []).some(h => h.command === hook.command))
      || fresh.some(h => h.command === hook.command);
    if (!exists) fresh.push(hook);
  }
  return fresh;
}

// Fold one fragment matcher into an event's existing matcher list: extend the same-matcher
// entry if there is one, else append a new matcher carrying only the fresh hooks.
function addMatcherHooks(eventMatchers, event, matcher, rec) {
  const fresh = freshHooksOf(matcher, eventMatchers);
  if (fresh.length === 0) return;
  const existing = eventMatchers.find(m => m.matcher === matcher.matcher);
  if (existing) {
    existing.hooks = existing.hooks || [];
    for (const hook of fresh) existing.hooks.push(hook);
  } else {
    eventMatchers.push({ ...matcher, hooks: fresh });
  }
  for (const hook of fresh) rec.hook(event, hook.command);
}

// hooks: add hook commands that don't already exist (dedup by command string, per event).
function mergeHooksInto(userSettings, fragmentHooks, rec) {
  if (!userSettings.hooks) userSettings.hooks = {};
  for (const [event, matchers] of Object.entries(fragmentHooks)) {
    if (!userSettings.hooks[event]) {
      userSettings.hooks[event] = matchers;
      for (const matcher of matchers) {
        for (const hook of matcher.hooks || []) rec.hook(event, hook.command);
      }
      continue;
    }
    for (const matcher of matchers) addMatcherHooks(userSettings.hooks[event], event, matcher, rec);
  }
}

// env: add keys the user hasn't set (never overwrite an existing value).
function mergeEnvInto(userSettings, fragmentEnv, rec) {
  if (!userSettings.env) userSettings.env = {};
  for (const [key, value] of Object.entries(fragmentEnv)) {
    if (key in userSettings.env) continue;
    userSettings.env[key] = value;
    rec.env(key);
  }
}

// permissions.allow/deny: add missing rules (and migrate deprecated :* syntax in place).
function mergePermissionsInto(userSettings, fragmentPermissions, rec) {
  if (!userSettings.permissions) userSettings.permissions = {};
  for (const key of PERMISSION_KEYS) {
    const rules = fragmentPermissions[key];
    if (!rules) continue;
    if (!userSettings.permissions[key]) {
      userSettings.permissions[key] = rules;
      for (const rule of rules) rec.perm(key, rule);
      continue;
    }
    userSettings.permissions[key] = userSettings.permissions[key].map(rule =>
      rule.replace(/^(Bash\([^)]*):(\*\))$/, '$1 $2')
    );
    for (const rule of rules) {
      if (userSettings.permissions[key].includes(rule)) continue;
      userSettings.permissions[key].push(rule);
      rec.perm(key, rule);
    }
  }
}

// Additively fold a settings fragment (hooks / env / permissions) into an existing
// settings object, mutating and returning it.
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
  const rec = recorders(added);
  if (fragment.hooks) mergeHooksInto(userSettings, fragment.hooks, rec);
  if (fragment.env) mergeEnvInto(userSettings, fragment.env, rec);
  if (fragment.permissions) mergePermissionsInto(userSettings, fragment.permissions, rec);
  return userSettings;
}

// The recorded delta, re-shaped per event as command sets.
function recordedHookCommands(addedHooks) {
  const strip = {};
  for (const [event, commands] of Object.entries(addedHooks || {})) strip[event] = new Set(commands);
  return strip;
}

// Every hook command the fragment declares, per event — the old-ledger fallback.
function fragmentHookCommands(fragmentHooks) {
  const strip = {};
  for (const [event, matchers] of Object.entries(fragmentHooks || {})) {
    const commands = new Set();
    for (const matcher of matchers) {
      for (const hook of matcher.hooks || []) {
        if (hook.command) commands.add(hook.command);
      }
    }
    strip[event] = commands;
  }
  return strip;
}

// Per event, the set of hook commands to strip. With a recorded delta (`added`) that set IS
// the delta; without one (an old ledger) it falls back to every command the fragment declares.
function hookCommandsToStrip(fragment, added) {
  return added ? recordedHookCommands(added.hooks) : fragmentHookCommands(fragment.hooks);
}

// Drop the stripped commands, then prune whatever that empties: a matcher with no hooks left,
// an event with no matchers left, and finally the `hooks` key itself.
function unmergeHooksFrom(userSettings, strip) {
  if (!userSettings.hooks) return;
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

// env twin: the recorded keys, else (old ledger) the fragment's keys whose value still matches.
function unmergeEnvFrom(userSettings, fragment, added) {
  if (!userSettings.env) return;
  let keys = [];
  if (added) keys = added.env || [];
  else if (fragment.env) {
    keys = Object.keys(fragment.env).filter(k => userSettings.env[k] === fragment.env[k]);
  }
  for (const key of keys) delete userSettings.env[key];
  if (Object.keys(userSettings.env).length === 0) delete userSettings.env;
}

// permissions twin: the recorded rules, else (old ledger) every rule the fragment declares.
// A key the fragment never mentioned is left alone entirely.
function unmergePermissionsFrom(userSettings, fragment, added) {
  if (!userSettings.permissions) return;
  for (const key of PERMISSION_KEYS) {
    if (!userSettings.permissions[key]) continue;
    let remove;
    if (added) remove = new Set((added.permissions && added.permissions[key]) || []);
    else if (fragment.permissions && fragment.permissions[key]) remove = new Set(fragment.permissions[key]);
    else continue;
    userSettings.permissions[key] = userSettings.permissions[key].filter(r => !remove.has(r));
  }
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
  const precise = added && typeof added === 'object' ? added : null;
  unmergeHooksFrom(userSettings, hookCommandsToStrip(fragment, precise));
  unmergeEnvFrom(userSettings, fragment, precise);
  unmergePermissionsFrom(userSettings, fragment, precise);
  return userSettings;
}

module.exports = {
  migrateLegacyHookCommands,
  migrateRenamedToolMatchers,
  migrateRetiredPermissionRules,
  mergeSettingsInto,
  unmergeSettingsFrom
};
