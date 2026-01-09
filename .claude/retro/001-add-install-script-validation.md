# Add install script validation

## Problem
The install scripts (install.sh and install.ps1) don't validate that the target directory is a git repo or check for existing .claude/ folders before copying files. This could lead to unexpected overwrites or confusion when installing into non-project directories.

## Acceptance Criteria
- [ ] Check if target is a git repository
- [ ] Warn if .claude/ already exists
- [ ] Prompt for confirmation before overwriting

## Approach
Add pre-flight checks at the start of both install scripts

## Priority
Medium

## Effort
S

## Files
- install.sh
- install.ps1
