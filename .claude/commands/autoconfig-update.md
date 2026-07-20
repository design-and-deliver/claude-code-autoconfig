<!-- @description Manages and installs updates to Claude Code configuration. -->
<!-- @version 6 -->
<!-- @response updates-available | Displays list of pending updates with install/review options. -->
<!-- @response up-to-date | All updates are already installed. -->
<!-- @sideeffect Pulls latest update files from npm, executes update instructions, tracks applied updates -->
<!-- @example /autoconfig-update | Check for and install configuration updates -->

<!-- @applied
-->

# Autoconfig Update

Check for and install pending updates to your Claude Code configuration.

**Style guideline**: Work silently through Steps 0-3. Do not narrate internal steps, implementation details, or progress messages (e.g., "Let me check...", "The @applied block is empty..."). The first output the user sees should be the What's New list from Step 0 and/or the formatted summary in Step 4 (or the "up to date" message).

## Step 0: What's New (installer handoff)

Read `.claude/.autoconfig-whats-new.json`. If it doesn't exist, skip silently to Step 1.

If it exists, it was written by the installer during a version upgrade and holds `{ from, to, segments }`, where each segment is `{ kind, text }`. Render it as the what's-new list, mapping kinds to lines:

| kind | render as |
|------|-----------|
| `heading` | `⬆️  {text}` (the text is self-contained, e.g. "What's new since your last update (v1.0.186):") |
| `group` | blank line, then `**{text}:**` |
| `item` | `✅ {text}` |
| `more` | `…{text}` |
| `latest` | `✅ {text}` |

Then **delete `.claude/.autoconfig-whats-new.json`** (it's one-shot — a later run must not repeat the list), and continue to Step 0b.

## Step 0b: Status Beeps Opt-in (asked once)

The status beeps are opt-in, and upgraded projects have never been asked. Offer them **once**:

1. **Skip silently** if any of these hold:
   - `.claude/sounds/status-beeps.enabled` or `.claude/sounds/arcade-beeps.enabled` exists (already on), or
   - `.claude/cca.config.json` has `"statusBeepsPrompted": true` (already asked), or
   - the run is headless / the question can't be answered.
2. Otherwise ask with the AskUserQuestion tool:
   - Question: "Turn on Waiting/Done status beeps for Claude Code?"
   - Options: "Yes, enable beeps" / "No thanks"
3. On **yes**: create the flag by writing an empty file with the Write tool: `.claude/sounds/status-beeps.enabled`
4. On **yes or no** (not on skip): merge `"statusBeepsPrompted": true` into `.claude/cca.config.json` with the Write tool, preserving any existing keys — this is what prevents re-asking on every future update.

Either way the choice stays reversible with `/enable-status-beeps` / `/disable-status-beeps`. Continue to Step 0c.

## Step 0c: Auto Permission Mode Opt-in (asked once)

Auto permission mode is a **user-level** opt-in — Claude Code ignores `permissions.defaultMode: "auto"` in project `.claude/settings.json` (a repository cannot grant itself auto mode), so it only works from `~/.claude/settings.json`; never write it into project settings. Upgraded projects have never been asked. Offer it **once**:

1. **Skip silently** if any of these hold:
   - `~/.claude/settings.json` already has any `permissions.defaultMode` value (the user already chose a mode), or
   - `.claude/cca.config.json` has `"autoModePrompted": true` (already asked), or
   - the run is headless / the question can't be answered.
2. Otherwise ask with the AskUserQuestion tool:
   - Question: "Enable auto permission mode?"
   - Options:
     - "Yes, enable auto mode (recommended)" — description: "Claude runs routine commands without approval prompts, and still asks before destructive or external actions. Applies to all your projects (writes ~/.claude/settings.json)."
     - "No thanks"
3. On **yes**: Read `~/.claude/settings.json` (treat a missing file as `{}`), add `"defaultMode": "auto"` under `permissions` while preserving every existing key, and Write it back. Then tell the user: "Auto mode is on for new sessions in all projects. Revert anytime: Shift+Tab in a session, or delete `permissions.defaultMode` from `~/.claude/settings.json`. (If your plan or model doesn't support auto mode, Claude Code ignores the setting.)"
4. On **yes or no** (not on skip): merge `"autoModePrompted": true` into `.claude/cca.config.json` with the Write tool, preserving any existing keys — this is what prevents re-asking on every future update.

Continue to Step 0d.

## Step 0d: Auto-Guard Opt-in (asked once)

The auto-guard hook (`.claude/hooks/auto-guard.js`, registered in settings by the installer) is inert until `autoGuard.enabled` is true in `.claude/cca.config.json`. Upgraded projects have never been asked. Offer it **once**:

1. **Skip silently** if any of these hold:
   - `.claude/cca.config.json` already has an `autoGuard` key (already configured), or
   - `.claude/cca.config.json` has `"autoGuardPrompted": true` (already asked), or
   - the run is headless / the question can't be answered.
2. Otherwise ask with the AskUserQuestion tool:
   - Question: "Add guard rails for risky commands?"
   - Options:
     - "Yes, add guard rails (recommended)" — description: "Claude always asks before pushes, new package installs, credential-file reads, and destructive git commands — and always blocks downloads piped into a shell — even when other settings would auto-approve them. Tune or disable per category in .claude/cca.config.json."
     - "No thanks"
3. On **yes**: merge `"autoGuard": { "enabled": true }` into `.claude/cca.config.json` with the Write tool, preserving any existing keys. Then tell the user: "Guard rails are on. Categories: credentials, installs, publish, destructiveGit (ask) and pipeToShell (deny) — set any of them to \"ask\", \"deny\", or \"off\" under autoGuard.categories in .claude/cca.config.json."
4. On **yes or no** (not on skip): merge `"autoGuardPrompted": true` into `.claude/cca.config.json`, preserving any existing keys — this is what prevents re-asking on every future update.

Continue to Step 1.

## Step 1: Pull Latest Updates

Run this command via Bash to pull new update files from the latest package:

```bash
npx claude-code-autoconfig@latest --pull-updates
```

This copies any new update `.md` files into `.claude/updates/` and refreshes this command file (preserving the `@applied` block above).

After the command completes, check `.claude/updates/` directory. If it doesn't exist or is empty, output one of:

- If Step 0 displayed a what's-new list:

```
✅ Everything above is installed and ready. No further action needed.
```

- Otherwise:

```
No new updates available. You're up to date.
```

Then stop — do not continue to further steps.

## Step 2: Parse Update Files

Read all `.md` files in `.claude/updates/` matching the pattern `NNN-*.md` (e.g., `001-debug-methodology.md`).

For each file, extract metadata from the HTML comment headers at the top:

| Header | Pattern | Required |
|--------|---------|----------|
| `@title` | `<!-- @title (.+?) -->` | Yes |
| `@type` | `<!-- @type (.+?) -->` | Yes |
| `@description` | `<!-- @description (.+?) -->` | Yes |
| `@files` | `<!-- @files (.+?) -->` | Yes |

Extract the numeric ID from the filename prefix (e.g., `001` from `001-debug-methodology.md`).

Skip any files that are malformed (missing required headers) with a warning.

## Step 3: Filter Already Applied

Parse the `<!-- @applied -->` block in THIS file (`.claude/commands/autoconfig-update.md`) to get the list of already-applied update IDs. Extract the three-digit ID from the start of each line.

Filter out any updates whose ID appears in the applied list. If no pending updates remain, output (prefixed by "Everything above is installed and ready." if Step 0 displayed a what's-new list):

```
✅ All configuration updates are applied. Your commands, docs, and settings were refreshed by the installer.
```

Then stop.

## Step 4: Display Summary

**Important**: Do NOT narrate your internal steps (e.g., "The @applied block is empty" or "Let me check..."). Go straight to the formatted output below. The user doesn't need to see implementation details.

Output the pending updates using this exact format. Use `═` horizontal dividers only (no vertical borders — they render poorly in Claude Code). Render the dividers and header in **yellow** (ANSI `\x1b[33m`) to visually match the CLI's yellow "READY TO UPDATE" box and distinguish this from regular Claude output:

```
════════════════════════════════════════════
  Updates available ({count})
════════════════════════════════════════════

  001 ─ Debug Methodology
  002 ─ Some other feature

════════════════════════════════════════════
  [1] Install all    [2] Review each
════════════════════════════════════════════
```

Replace `{count}` with the number of pending updates. List each update with its ID and title. Wait for the user to respond with 1 or 2.

## Step 5a: Install All (User picked 1)

For each pending update (in ID order):
1. Read the update `.md` file body (everything below the metadata comments)
2. Follow the instructions in the body to apply the update
3. After successful application, append to the `@applied` block in THIS file:
   ```
   {id} - {title}
   ```

After all updates are applied, go to Step 6.

## Step 5b: Review Each (User picked 2)

For each pending update (in ID order), display using horizontal dividers only (no vertical borders — they render poorly in Claude Code):

```
════════════════════════════════════════════
  UPDATE {n} of {total}              {type}
════════════════════════════════════════════

  {title}

  {description}

  Files:  {comma-separated list of files touched}

════════════════════════════════════════════
  [y] Install    [s] Skip    [a] Install all remaining
════════════════════════════════════════════
```

**Rendering rules:**
- Use `═` horizontal dividers only — no `║ ╔ ╗ ╠ ╣ ╚ ╝` vertical/corner characters
- Content lines are free-flowing (no padding or alignment needed)
- `{n}` is the position in the pending list (1, 2, 3...), `{total}` is count of pending

**User actions:**
- `y` → Apply this update (follow body instructions), append to `@applied`, show next
- `s` → Skip this update (do NOT add to `@applied` — it will appear again next run)
- `a` → Apply this update AND all remaining updates without further prompts

After all updates are reviewed, go to Step 6.

## Step 6: Summary and Cleanup

Show a summary of what happened:

```
✅ Installed: 001, 003
⏭️  Skipped:  002

Run /autoconfig-update again anytime to install skipped updates.
```

If all were installed:
```
✅ All updates installed.
```

Then delete the `.claude/updates/` directory (it's ephemeral — updates are tracked in the @applied block above).

If the user installed any updates that modified `.claude/commands/autoconfig.md`, suggest:

```
Run /autoconfig to apply these changes to your current project.
```
