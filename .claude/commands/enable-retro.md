<!-- @description (Experimental) Enable Claude to log tech debt it encounters into .claude/retro. -->

# Enable Retro

Enable the experimental Retro feature, which lets Claude log tech debt and improvement opportunities as structured story files.

## What This Does

1. Creates `.claude/retro/` directory with a README
2. Creates `.claude/agents/create-retro-item.md` agent
3. Adds Retro instructions to CLAUDE.md

## Step 1: Create Retro Directory

Create `.claude/retro/README.md` with:

```markdown
# Retro Items

Tech debt and improvement opportunities identified during development.

Each item is a structured story file with:
- Problem description
- Acceptance criteria
- Suggested approach
- Priority & effort sizing
- Files involved

## Working with Retro Items

- "Fix retro #001" — Work on a specific item
- "What's in the retro backlog?" — List pending items
- Items are numbered sequentially (001, 002, etc.)
```

## Step 2: Create Retro Agent

Create `.claude/agents/create-retro-item.md` with the standard retro item agent that:
- Scans for highest existing ID
- Creates numbered story files (001-title.md, 002-title.md)
- Uses structured format: Problem, Acceptance Criteria, Approach, Priority, Effort, Files

## Step 3: Update CLAUDE.md

Add the following section to CLAUDE.md (before Team Feedback if present):

```markdown
## Retro
After completing tasks, if you encountered friction, tech debt, or improvement opportunities worth revisiting, use the create-retro-item agent to log it in `.claude/retro/`. Use your judgment on what's worth capturing — not everything needs a retro item.
```

## Step 4: Confirm

Output: "Retro enabled. Claude will now log tech debt to .claude/retro/ when appropriate."
