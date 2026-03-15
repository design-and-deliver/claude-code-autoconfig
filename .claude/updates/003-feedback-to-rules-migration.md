<!-- @title Feedback to Rules Migration -->
<!-- @type feature -->
<!-- @description Scans FEEDBACK.md for entries that would be more reliably delivered as .claude/rules/ files -->
<!-- @files .claude/feedback/FEEDBACK.md, .claude/rules/ -->

# Migrate Rule-Eligible Feedback Entries

## Step 1: Read FEEDBACK.md

Read `.claude/feedback/FEEDBACK.md` in its entirety.

## Step 2: Evaluate entries

Review each entry/section in FEEDBACK.md and determine whether it is tied to specific file types, frameworks, directories, or patterns that could be scoped with a glob.

**Rule-eligible examples:**
- "When editing Python files, always check imports" → `*.py`
- "React components should use functional style" → `*.tsx`
- "SQL migrations must include rollback" → `*.sql`
- "API route handlers need auth middleware" → `src/api/**`
- "CadQuery boolean unions need clearance gaps" → `*.py`

**NOT rule-eligible (keep in FEEDBACK.md):**
- Debugging methodology (applies to all investigation)
- Communication/process guidance ("confirm before coding")
- Meta-config guidelines (update system, versioning)
- Anything that applies regardless of which files are open

## Step 3: Present candidates

If no entries qualify, output:

> No rule-eligible entries found in FEEDBACK.md. Everything looks good where it is.

Then stop.

If candidates are found, present them:

```
FEEDBACK.md contains entries that could be more reliably delivered as .claude/rules/ files.
Rules auto-inject when matching files are touched — more deterministic than FEEDBACK.md.

Candidates:

  1. "{entry summary}" → .claude/rules/{suggested-name}.md (glob: {pattern})
  2. "{entry summary}" → .claude/rules/{suggested-name}.md (glob: {pattern})

Would you like me to migrate these? [y/n]
```

Wait for the user to confirm.

## Step 4: Migrate (if confirmed)

For each confirmed candidate:

1. Create `.claude/rules/{name}.md` with this structure:
   ```markdown
   ---
   globs: {glob-pattern}
   ---

   {migrated content from FEEDBACK.md}
   ```

2. Remove the migrated entry from FEEDBACK.md

3. Report each migration:
   ```
   ✅ Migrated "{entry}" → .claude/rules/{name}.md (glob: {pattern})
   ```

If the user declines, do nothing — the entries stay in FEEDBACK.md.
