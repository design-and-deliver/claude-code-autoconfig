<!-- @description Check for uncommitted work exceeding thresholds and recommend a commit. -->
<!-- @version 1 -->
<!-- @response success | Reports commit status; recommends /commit-and-push when a threshold is exceeded. -->
<!-- @example /check-commit | Check whether uncommitted work has piled up -->

# Commit Reminder Rules

Check if there are uncommitted changes that should be committed, based on these thresholds:

**Thresholds:**
- **>5 uncommitted files** OR
- **>500 lines changed** OR
- **Changes older than 24 hours** (check last commit time)

**Actions:**
1. Run `git status --short` to see uncommitted files
2. Run `git diff --stat` to see lines changed
3. Run `git log -1 --format="%cr"` to see when last commit was made
4. Count modified/new files and total lines changed
5. If any threshold is exceeded:
   - Show the stats clearly
   - Strongly recommend running `/commit-and-push`
   - Explain which threshold(s) were exceeded

**When to check (proactively):**
- At the start of each session
- After completing major tasks
- Before starting new work

**Note:** This command can be run manually anytime to check commit status, or Claude should run it proactively based on the triggers above. The automated companion is the Stop-hook reminder in `.claude/settings.json`, which fires on its own at higher thresholds (>10 files / >1000 lines) and stays quiet while any session is mid-commit (see `.claude/hooks/mark-commit-active.js`).
