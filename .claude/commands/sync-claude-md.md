<!-- @description Re-analyzes your project and updates CLAUDE.md to reflect current state. -->

# Sync CLAUDE.md

Re-analyze the project and update CLAUDE.md to reflect current state.

Run this when your project has changed significantly:
- Added a major framework or dependency
- Changed npm scripts or build commands
- Restructured the project
- Switched databases or services

## Step 1: Re-analyze the Project

Scan for current project indicators:

**Package/Config Files:**
- `package.json` → dependencies, scripts
- `requirements.txt` / `pyproject.toml` → Python deps
- `Cargo.toml`, `go.mod`, `Gemfile`, etc.

**Framework Indicators:**
- Config files (next.config.*, vite.config.*, etc.)
- Directory structure (app/, src/, etc.)

**Infrastructure:**
- Docker, Terraform, CI/CD configs

## Step 2: Update CLAUDE.md

Compare detected state with current CLAUDE.md and update:

1. **Project name** — if changed
2. **Tech stack** — new frameworks, languages, databases
3. **Commands** — new/changed npm scripts, build commands
4. **Conventions** — if project structure changed

**Always preserve:**
- The `## Retro` section pointer
- The `## Team Feedback` section pointer
- Any custom sections the user added

## Step 3: Confirm Changes

Show the user what changed in CLAUDE.md before finishing.

## Guidelines

- **Be conservative**: Only update sections that actually changed
- **Preserve custom content**: Don't overwrite user-added sections
- **Keep it tight**: CLAUDE.md should stay concise
