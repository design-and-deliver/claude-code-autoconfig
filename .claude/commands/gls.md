<!-- @description Get the latest screenshot(s) and display them. -->
<!-- @version 4 -->
<!-- @param count | integer | optional | Number of screenshots to display. Use /gls-N syntax. Default: 1. Min: 1. -->
<!-- @param path | string | optional | Screenshot directory path. Saved for future use. Auto-detected if omitted. -->
<!-- @response success | Displays requested screenshot(s) from newest to oldest. -->
<!-- @response no-screenshots | Directory exists but contains no image files. -->
<!-- @response no-directory | Unable to detect screenshot directory — prompts for path. -->
<!-- @sideeffect Saves detected screenshot path to .claude/cca.config.json on first run -->
<!-- @example /gls | Display the most recent screenshot -->
<!-- @example /gls-3 | Display the 3 most recent screenshots -->
<!-- @example /gls /path/to/dir | Use a specific screenshot directory -->
Get the latest screenshot(s) and display them.

Usage:
- `/gls` - Get and display the most recent screenshot
- `/gls-2` - Get and display the 2 most recent screenshots
- `/gls-3` - Get and display the 3 most recent screenshots
- `/gls-N` - Get and display the N most recent screenshots
- `/gls /path/to/dir` - Use a specific directory and save it

## Step 1: Check for saved path

Read `.claude/cca.config.json` in the project root. If it exists and contains a `gls.screenshotDir` value, use that path and skip to Step 3.

If the file doesn't exist or the key is missing, continue to Step 2.

## Step 2: Detect screenshot directory

If the user provides a path as an argument (e.g., `/gls /path/to/dir`), use that path and skip to Step 2b.

Otherwise, detect the OS and find the screenshot directory. Run this **single Bash command** which finds all candidate directories and reports the newest screenshot in each:

```bash
OS=$(uname -s); echo "OS=$OS"; for d in \
  "$HOME/OneDrive/Pictures/Screenshots"* \
  "$HOME/Pictures/Screenshots" \
  "$HOME/Desktop" \
  "$HOME/Pictures" \
  "$HOME/Videos/Captures"; do \
  [ -d "$d" ] || continue; \
  newest=$(ls -t "$d/" 2>/dev/null | grep -iE '\.(png|jpg|jpeg|bmp|webp|gif)$' | head -1); \
  if [ -n "$newest" ]; then \
    echo "HAS_IMAGES: $d | newest: $newest"; \
  else \
    echo "EMPTY: $d"; \
  fi; \
done; \
[ "$OS" = "Darwin" ] && defaults read com.apple.screencapture location 2>/dev/null && echo "(macos-custom)"; \
[ "$OS" = "Linux" ] && [ -n "$XDG_PICTURES_DIR" ] && [ -d "$XDG_PICTURES_DIR/Screenshots" ] && echo "EXISTS: $XDG_PICTURES_DIR/Screenshots"
```

Pick the screenshot directory using these rules:

1. **macOS only**: If `(macos-custom)` appears in the output, prefer that path.
2. Among all `HAS_IMAGES` directories, pick the one whose newest screenshot has the **most recent modification time** (the file paths are shown after `newest:`— compare them).
3. If no directories have images, fall back to the first `EMPTY` directory (screenshots will land there eventually).
4. If there are no candidate directories at all, detection has failed.

### If detection fails

Ask the user:

> Unable to detect your screenshot directory. Please enter your screenshot path to continue:

Wait for the user to respond with a path, then use that path.

### Step 2b: Normalize and save the path

**Windows path fix:** If the path starts with a MSYS/Git Bash prefix like `/c/` or `/d/`, convert it to a Windows-style path (e.g., `/c/Users/jane/...` → `C:/Users/jane/...`). Run this to normalize:

```bash
DIR="/c/Users/jane/Pictures/Screenshots"  # substitute actual detected path
echo "$DIR" | sed 's|^/\([a-zA-Z]\)/|\U\1:/|'
```

Use the normalized path for all subsequent steps.

**Save to config:** Write (or update) `.claude/cca.config.json` in the project root with the normalized path. If the file already exists, merge the `gls` key — don't overwrite other keys. Example:

```json
{
  "gls": {
    "screenshotDir": "C:/Users/jane/Pictures/Screenshots"
  }
}
```

This ensures detection only happens once per project, and the saved path is local (gitignored).

## Step 3: List screenshots

Run this command (substitute the resolved directory for `$DIR`):

```bash
ls -t "$DIR/" 2>/dev/null | grep -iE '\.(png|jpg|jpeg|bmp|webp|gif)$' | head -20
```

Note: This lists filenames only (not full paths). Prepend `$DIR/` when constructing full paths for the Read tool.

IMPORTANT: Always use `ls -t` for listing screenshots — never use `find`. The `ls` command is pre-approved in permissions; `find` on external directories will prompt the user every time.

If no images are found, tell the user the directory exists but contains no screenshots. Suggest taking a screenshot first or specifying a different directory with `/gls /path/to/dir`.

## Step 4: Select screenshots

- `/gls` → 1 most recent
- `/gls-N` (e.g., `/gls-2`) → N most recent

## Step 5: Display

Use the **Read tool** to display each screenshot file. Display in order from newest to oldest.

IMPORTANT: Always use the Read tool — never use Bash cat/echo to display images.

## Step 6: Wait

Wait for the user to tell you what to do with the screenshot(s). Do not make assumptions about what they want.
