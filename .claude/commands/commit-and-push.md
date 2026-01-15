<!-- @description Runs tests, then stages all changes, generates a conventional commit message, commits, and pushes. -->

# Commit and Push

Run tests, stage all changes, create a commit with a good message, and push to the current branch.

## Steps

1. Run the project's test suite (e.g., `npm test`)
2. **If tests fail, stop here.** Do not commit or push failing code.
3. Stage all changes (`git add -A`)
4. Generate a conventional commit message based on the diff
5. Commit the changes
6. Push to the current branch

## Commit Message Format

Use conventional commits: `type(scope): description`

Types: feat, fix, docs, style, refactor, test, chore

Keep the subject line under 50 chars. Add body if the change needs explanation.