// permission-optin.js — keeps CCA's recommended allowlist OUT of settings.json until the user
// opts in.
//
// Why: Claude Code's first-run trust dialog lists every `permissions.allow` rule a project's
// settings.json pre-approves ("⚠ This folder pre-approves 43 tool permissions ..."). Writing
// the allowlist before `claude` launches made that warning the first thing a new user saw.
// So the installer ships deny rules, hooks and env only, stages the allowlist beside
// settings.json, and /autoconfig offers it as an opt-in after the folder is trusted.
//
// The choice is recorded as `recommendedPermissions: true|false` in .claude/cca.config.json.
// With no recorded choice, an existing allow list holding any shipped rule counts as opted in
// — that is every project an older CCA configured, and upgrades must keep feeding them.

const fs = require('fs');
const path = require('path');

const STAGED_FILE = 'recommended-permissions.json';

function readJsonOr(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function hasShippedAllowRule(settings, shippedAllow) {
  const allow = (settings && settings.permissions && settings.permissions.allow) || [];
  return allow.some(rule => shippedAllow.includes(rule));
}

// true when the shipped allowlist belongs in this project's settings.json.
function isOptedIn(claudeDir, userSettings, shippedAllow) {
  const config = readJsonOr(path.join(claudeDir, 'cca.config.json'), {});
  if (typeof config.recommendedPermissions === 'boolean') return config.recommendedPermissions;
  return hasShippedAllowRule(userSettings, shippedAllow);
}

// A deep copy of the template with `permissions.allow` removed.
function withoutAllow(settings) {
  const copy = JSON.parse(JSON.stringify(settings));
  if (copy.permissions) delete copy.permissions.allow;
  return copy;
}

// Writes the allowlist where /autoconfig can offer it. Rewritten every install so it tracks
// the shipped template.
function stageAllowlist(claudeDir, shippedAllow) {
  const staged = { allow: shippedAllow };
  fs.writeFileSync(path.join(claudeDir, STAGED_FILE), JSON.stringify(staged, null, 2) + '\n');
}

// An unparseable settings.json still counts as existing: the installer's merge reports it and
// leaves it alone, so it must not fall into the fresh-copy path.
function readExisting(settingsDest) {
  if (!fs.existsSync(settingsDest)) return null;
  return readJsonOr(settingsDest, {});
}

// Stages the allowlist and returns the template the installer should write or merge: the full
// template when the user opted in, the template minus `permissions.allow` otherwise.
function prepareShippedSettings(claudeDir, settingsSrc, settingsDest) {
  const shipped = JSON.parse(fs.readFileSync(settingsSrc, 'utf8'));
  const shippedAllow = (shipped.permissions && shipped.permissions.allow) || [];
  const existing = readExisting(settingsDest);
  stageAllowlist(claudeDir, shippedAllow);
  const pkgSettings = isOptedIn(claudeDir, existing, shippedAllow) ? shipped : withoutAllow(shipped);
  return { pkgSettings, hasExisting: existing !== null };
}

module.exports = { STAGED_FILE, isOptedIn, withoutAllow, stageAllowlist, prepareShippedSettings };
