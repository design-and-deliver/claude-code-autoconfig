# Update files — numbering rules

Updates are `NNN-*.md` instruction files consumed by `/autoconfig-update`. Installs record
applied updates by their **three-digit ID** in the `@applied` block of
`autoconfig-update.md`, which makes numbers append-only forever:

- **Never reuse a number — even a deleted one.** An install whose `@applied` block already
  lists `NNN` treats any new `NNN-*` file as already applied and silently skips it.
- **Retired: `002`** (`002-recover-context.md`, deleted in d81665c once `/recover-context`
  shipped as a real command). The gap is intentional — do not fill it.
- **Next available number: `005`.** Bump this line when you take it.

Only create an update file when Claude must EXECUTE instructions (migrations, MEMORY.md
writes, config edits). Plain file drops (new/changed commands, hooks, agents) ship via the
CLI's `copyDir` automatically — see "Update System Guidelines" in CLAUDE.md.
