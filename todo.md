# claude-code-autoconfig — TODO

## Make settings.json deny list deterministic

**Problem:** The `/autoconfig` command describes deny patterns in prose, leaving the LLM to assemble them. Different models/runs produce inconsistent results — e.g., adding `Edit(./.env)` rules not in the spec, which then blocks `.env` file creation unnecessarily.

**Proposed fix:** Ship a canonical base `settings.json` in the bootstrap step (`npx claude-code-autoconfig --bootstrap`) with the exact deny list baked in. The `/autoconfig` command would then only merge project-specific additions (like `Bash(npm run test:*)`) rather than generating the full deny list from instructions.

**Why it matters:** `Edit(./.env)` denies are redundant (Read deny already protects secrets) but broke the ability to create `.env` template files — a safe operation. Users shouldn't get different security postures depending on which model runs autoconfig.
