Get the latest screenshot(s) and display them.

Usage:
- `/gls` - Get and display the most recent screenshot
- `/gls-2` - Get and display the 2 most recent screenshots
- `/gls-3` - Get and display the 3 most recent screenshots
- `/gls-N` - Get and display the N most recent screenshots

## Step 1: Detect screenshot directory

Find the screenshot directory by checking these paths in order. Use the Bash tool with `ls -d` to test existence. Stop at the **first match**.

**macOS:**
1. Run `defaults read com.apple.screencapture location 2>/dev/null` — if it returns a path that exists, use it
2. `~/Desktop`
3. `~/Pictures/Screenshots`

**Windows (Git Bash / MSYS paths):**
1. `~/OneDrive/Pictures/Screenshots*` (glob — OneDrive creates numbered variants like `Screenshots 1`)
2. `~/Pictures/Screenshots`
3. `~/Desktop`

**Linux:**
1. Check `$XDG_PICTURES_DIR/Screenshots` if `XDG_PICTURES_DIR` is set
2. `~/Pictures/Screenshots`
3. `~/Pictures`
4. `~/Desktop`

Detect the OS using `uname -s` (Darwin = macOS, Linux = Linux, MINGW*/MSYS*/CYGWIN* = Windows).

If no candidate directory exists, tell the user: "Could not find a screenshot directory. Set one with `/gls /path/to/screenshots`."

If the user provides a path as an argument (e.g., `/gls /path/to/dir`), use that path directly and skip detection.

## Step 2: List screenshots

List all image files (*.png, *.jpg, *.jpeg, *.bmp, *.webp) in the detected directory, sorted by modification time (newest first). Use `ls -t` via Bash.

## Step 3: Select screenshots

- If command is `/gls`, get the 1 most recent screenshot
- If command is `/gls-N` (e.g., `/gls-2`), get the N most recent screenshots

## Step 4: Display

Use the Read tool to display each screenshot. Display in order from newest to oldest.

## Step 5: Wait

Wait for the user to tell you what to do with the screenshot(s). Do not make assumptions about what they want done.

Important:
- Always use the Read tool to display screenshots (not Bash cat/echo)
- Display screenshots in order from newest to oldest
- After displaying, wait for user instructions
