<!-- @title Feedback to Discoveries Migration -->
<!-- @type migration -->
<!-- @description One-time migration of existing FEEDBACK.md content to CLAUDE.md Discoveries section -->
<!-- @files CLAUDE.md, .claude/feedback/FEEDBACK.md -->

# Migrate Existing Feedback to Discoveries

This is a one-time cleanup. The program has been updated to optimize CLAUDE.md and FEEDBACK.md:
- CLAUDE.md now has a `## Discoveries` section below the auto-generated markers where Claude appends learnings
- FEEDBACK.md has been tightened for human-authored corrections only

## Step 1: Read existing FEEDBACK.md

Read `.claude/feedback/FEEDBACK.md`. Extract all content below the header section (everything after the `---` that follows the intro text).

If the file only contains the default template with no custom entries, skip to Step 4 and output:

> No custom content found in FEEDBACK.md. Nothing to migrate.

## Step 2: Ensure Discoveries section exists in CLAUDE.md

Read `CLAUDE.md`. Look for `## Discoveries` below the end marker (`<!-- END AUTO-GENERATED`).

If it doesn't exist, append it below the end marker:

```markdown

## Discoveries
<!-- Claude: append project-specific learnings, gotchas, and context below. This section persists across /autoconfig runs. -->

```

## Step 3: Migrate content

Move all custom entries from FEEDBACK.md into the `## Discoveries` section in CLAUDE.md. Preserve the original formatting and section headers.

Then reset FEEDBACK.md to the clean template:

```markdown
<!-- @description Human-authored corrections and guidance for Claude. Reserved for team feedback only — Claude must not write here. This directory persists across /autoconfig runs. -->

# Team Feedback

**This file is for human-authored corrections and guidance only.**
Claude reads this file but must never write to it. When Claude discovers project context, gotchas, or learnings, it should append to the `## Discoveries` section in CLAUDE.md instead.

---

```

## Step 4: Report

Tell the user:

> Migrated {N} sections from FEEDBACK.md to CLAUDE.md Discoveries.
> FEEDBACK.md has been reset for human feedback only.
> If any migrated entries were actually team corrections, you can move them back to FEEDBACK.md.
