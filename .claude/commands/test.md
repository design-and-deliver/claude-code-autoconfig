<!-- @description Runs your test suite. Auto-detects Jest, Vitest, Pytest, Go, RSpec, or falls back to npm test. -->
<!-- @version 1 -->
<!-- @param scope | string | optional | File, directory, or pattern to limit test run. Runs full suite if omitted. -->
<!-- @response success | Test suite passes. -->
<!-- @response failure | Test suite fails with non-zero exit code. -->
<!-- @sideeffect Executes detected test runner command -->
<!-- @example /test | Run full test suite -->
<!-- @example /test src/auth | Run tests in src/auth directory -->
<!-- @example /test --coverage | Run tests with coverage report -->

# Run Tests

Run tests for this project.

**Scope:** $ARGUMENTS

If no scope provided, run the full test suite. Otherwise run tests matching the scope (file, directory, or pattern).

Detect the test command from project config (package.json scripts, pytest, go test, etc.) and execute it.