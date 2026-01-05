# Autoconfig

Analyze this project and configure Claude Code with real context.

## Step 1: Scan the Project

Look for these indicators to understand the project:

**Package/Config Files:**
- `package.json` → Node.js, npm scripts, dependencies
- `requirements.txt` / `pyproject.toml` / `setup.py` → Python
- `Cargo.toml` → Rust
- `go.mod` → Go
- `Gemfile` → Ruby
- `pom.xml` / `build.gradle` → Java
- `*.csproj` / `*.sln` → .NET
- `composer.json` → PHP

**Framework Indicators:**
- `next.config.*` / `app/` directory → Next.js
- `vite.config.*` → Vite
- `angular.json` → Angular
- `svelte.config.*` → Svelte
- `remix.config.*` → Remix
- `nuxt.config.*` → Nuxt
- `django` in imports → Django
- `flask` in imports → Flask
- `fastapi` in imports → FastAPI
- `express` in dependencies → Express
- `rails` / `Gemfile` with rails → Rails
- `laravel` → Laravel

**Testing Frameworks:**
- `jest.config.*` / `@jest` in deps → Jest
- `vitest.config.*` → Vitest
- `pytest.ini` / `conftest.py` → Pytest
- `*_test.go` files → Go testing
- `*_spec.rb` files → RSpec
- `cypress/` or `playwright/` → E2E testing

**Infrastructure:**
- `Dockerfile` / `docker-compose.*` → Docker
- `*.tf` files → Terraform
- `k8s/` or `kubernetes/` → Kubernetes
- `.github/workflows/` → GitHub Actions
- `serverless.yml` → Serverless Framework

## Step 2: Populate CLAUDE.md

Fill in with real values:
- **Project name**: from package.json name, directory name, or README
- **Purpose**: from README, package.json description, or infer from code
- **Tech stack**: languages, frameworks, databases, key libraries detected
- **Entry points**: main files, API routes, CLI commands
- **Commands**: actual scripts from package.json, Makefile, etc.
- **Architecture**: monolith, microservices, monorepo, serverless, etc.

## Step 3: Create Rules Directory

Create an empty `.claude/rules/` directory. Do not create any subdirectories or rule files.

Rules are path-scoped context files that load automatically when Claude works on matching files. Effective rules require deep understanding of your codebase patterns, team conventions, and quality goals — they should be crafted intentionally, not auto-generated.

## Step 4: Configure Settings

Update `.claude/settings.json` using the official schema.

### Deny Patterns (files Claude shouldn't read/write)

Use `Read()` for blocking reads, `Edit()` for blocking writes:

**Always deny (security):**
```
Read(./.env)
Read(./.env.*)
Read(./secrets/**)
Read(./**/*.pem)
Read(./**/*.key)
Read(./**/*.crt)
```

**Detect and deny build outputs:**
| If exists | Add to deny |
|-----------|-------------|
| `dist/` | `Read(./dist/**)` |
| `build/` | `Read(./build/**)` |
| `.next/` | `Read(./.next/**)` |
| `out/` | `Read(./out/**)` |
| `target/` (Rust/Java) | `Read(./target/**)` |
| `bin/`, `obj/` (.NET) | `Read(./bin/**)`, `Read(./obj/**)` |

**Detect and deny dependencies:**
| If exists | Add to deny |
|-----------|-------------|
| `node_modules/` | `Read(./node_modules/**)` |
| `venv/` | `Read(./venv/**)` |
| `.venv/` | `Read(./.venv/**)` |
| `vendor/` (Go/PHP) | `Read(./vendor/**)` |

### Allow Patterns (auto-approve without prompting)

Use `Bash()` patterns with prefix matching:

**Detect from package.json scripts:**
- `Bash(npm test:*)` — test commands
- `Bash(npm run lint:*)` — lint commands
- `Bash(npm run build:*)` — build commands

**Detect from Python projects:**
- `Bash(pytest:*)`, `Bash(python -m pytest:*)`
- `Bash(ruff:*)`, `Bash(mypy:*)`

**Detect from other ecosystems:**
- Go: `Bash(go test:*)`, `Bash(go build:*)`
- Rust: `Bash(cargo test:*)`, `Bash(cargo build:*)`, `Bash(cargo clippy:*)`
- Ruby: `Bash(bundle exec rspec:*)`, `Bash(bundle exec rubocop:*)`

**Always safe to allow:**
- `Bash(git status:*)`, `Bash(git diff:*)`, `Bash(git log:*)`
- `Bash(ls:*)`, `Bash(cat:*)`, `Bash(head:*)`, `Bash(tail:*)`

### Final settings.json structure

```json
{
  "permissions": {
    "allow": [
      "Bash(npm test:*)",
      "Bash(npm run lint:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)",
      "Read(./**/*.pem)",
      "Read(./**/*.key)",
      "Read(./node_modules/**)",
      "Read(./dist/**)"
    ]
  },
  "env": {
    "NODE_ENV": "development"
  }
}
```

### Optional: Environment Variables

Add project-specific env vars that should be set for every session:

```json
{
  "env": {
    "NODE_ENV": "development",
    "DEBUG": "true"
  }
}
```

**Keep it minimal** — only include patterns that actually exist in this project.

## Guidelines

- Replace ALL placeholder content with real values from THIS project
- Delete files/sections that don't apply — no empty stubs
- Keep everything concise — quick reference, not documentation
- When uncertain, scan actual source files to understand patterns
- Preserve autoconfig structure, fill with real content
