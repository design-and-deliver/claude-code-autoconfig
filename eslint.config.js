// Minimal lint floor for the claude-code-autoconfig maintainer repo (NOT shipped to users —
// not in package.json `files`). Three rules only, by design (see docs/weak-model-maintainability-plan.md
// substep 2.6): catch the undefined-identifier typos that this codebase's silent-by-design hooks
// would otherwise swallow forever, plus dead bindings and stray empty blocks.
//
// `_`-prefixed names are the house convention for "intentionally unused" (123+ `catch (_)` sites);
// the ignore patterns below make that opt-out explicit so a NON-`_` unused binding still fails.
const globals = require('globals');

module.exports = [
  {
    // Out of lint scope: the `.claude/hooks/tests/` suites are `node --test` .cjs files and
    // fixtures (one fixture is an intentional top-level fragment that does not parse as a module).
    ignores: ['.claude/hooks/tests/**'],
  },
  {
    files: [
      'bin/**/*.js',
      'scripts/**/*.js',
      'test/**/*.js',
      '.claude/hooks/*.js',
      '.claude/scripts/**/*.js',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
];
