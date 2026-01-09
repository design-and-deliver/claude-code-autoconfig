<!-- @description Creates a formatted retro item when tech debt or improvements are spotted. -->

# Create Retro Item Agent

Create a fully-scoped story file in `.claude/retro/` when tech debt or improvement opportunities are identified.

## When to Trigger

Call this agent when you notice:
- Tech debt that should be addressed later
- Code that works but could be improved
- Missing tests, documentation, or error handling
- Architectural improvements worth tracking

## Input

Provide these details when calling:
- **title**: Short descriptive name (used for filename)
- **problem**: What's wrong or what friction was encountered
- **criteria**: Specific, testable acceptance criteria
- **approach**: How to fix it
- **priority**: Critical | High | Medium | Low
- **effort**: S | M | L | XL
- **files**: List of files involved

## Behavior

1. Scan `.claude/retro/` for existing files to find the highest ID number
2. Increment to get the next ID (zero-padded to 3 digits: 001, 002, etc.)
3. Generate filename: `[ID]-kebab-case-title.md` (e.g., `001-add-input-validation.md`)
4. Create story file in `.claude/retro/` using this format:

```markdown
# [Title]

## Problem
[Problem description]

## Acceptance Criteria
- [ ] [Criteria 1]
- [ ] [Criteria 2]

## Approach
[How to fix]

## Priority
[Priority level]

## Effort
[Effort size]

## Files
- [file1]
- [file2]
```

5. Confirm creation with ID and filename (e.g., "Created retro #001: 001-add-input-validation.md")

## Guidelines

- **Be concise**: Keep descriptions actionable, not verbose
- **Be specific**: Include actual file paths and line numbers when relevant
- **Don't duplicate**: Check if similar item already exists first
- **Don't block**: Create the item and continue with the main task
