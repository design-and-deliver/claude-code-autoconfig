Get the latest screenshot(s) from the Screenshots folder and display them.

Usage:
- `/gls` - Get and display the most recent screenshot
- `/gls-2` - Get and display the 2 most recent screenshots
- `/gls-3` - Get and display the 3 most recent screenshots
- `/gls-N` - Get and display the N most recent screenshots

Screenshot directory: `C:\Users\andre\OneDrive\Pictures\Screenshots 1`

Workflow:
1. List all files in the screenshots directory sorted by modification time (newest first)
2. If command is `/gls`, get the most recent screenshot (1 file)
3. If command is `/gls-N` (e.g., `/gls-2`), get the N most recent screenshots
4. Use the Read tool to display each screenshot
5. Wait for the user to tell you what to do with the screenshot(s)

Important:
- Always use the Read tool to display screenshots (not Bash cat/echo)
- Display screenshots in order from newest to oldest
- After displaying, wait for user instructions - don't make assumptions about what they want done with the screenshots
