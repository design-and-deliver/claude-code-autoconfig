<!-- @description Manages and installs updates to Claude Code configuration. -->

<!-- @applied
-->

# Autoconfig Update

Check for and install pending updates to your Claude Code configuration.

**Style guideline**: Work silently through Steps 1-3. Do not narrate internal steps, implementation details, or progress messages (e.g., "Let me check...", "The @applied block is empty..."). The first output the user sees should be the formatted summary in Step 4 (or the "up to date" message).

## Step 1: Pull Latest Updates

Run this command via Bash to pull new update files from the latest package:

```bash
npx claude-code-autoconfig@latest --pull-updates
```

This copies any new update `.md` files into `.claude/updates/` and refreshes this command file (preserving the `@applied` block above).

After the command completes, check `.claude/updates/` directory. If it doesn't exist or is empty, output:

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

Filter out any updates whose ID appears in the applied list. If no pending updates remain, output:

```
All updates are already installed. You're up to date.
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

For each pending update (in ID order), display a box:

```
╔══════════════════════════════════════════════════════════╗
║  UPDATE {n} of {total}                          ⬡ {type} ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  {title}                                                 ║
║                                                          ║
║  {description — wrap to fit within box borders}          ║
║                                                          ║
║  Files:  {comma-separated list of files touched}         ║
║                                                          ║
╠══════════════════════════════════════════════════════════╣
║  [y] Install    [s] Skip    [a] Install all remaining    ║
╚══════════════════════════════════════════════════════════╝
```

**Box rendering rules:**
- Box width: 58 visible characters (including border chars)
- Use Unicode box-drawing characters: `╔ ═ ╗ ║ ╠ ╣ ╚ ╝`
- Pad content lines with spaces so right `║` aligns at column 58
- Wrap description text to fit within the borders (54 chars of content)
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
Run /sync-claude-md to apply these changes to your current project's CLAUDE.md.
```
