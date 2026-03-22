<!-- @description Validates your claude-code-autoconfig installation against the latest published version. -->
<!-- @version 1 -->
Validate the current claude-code-autoconfig installation. Reports what's correct, what's outdated, and what's missing. **Does not modify anything.**

Usage:
- `/validate-cca-install` — run a full validation check

## Step 1: Fetch the latest package metadata

Query the npm registry for the latest published version and its file manifest:

```bash
python3 -c "
import json, urllib.request
url = 'https://registry.npmjs.org/claude-code-autoconfig/latest'
data = json.loads(urllib.request.urlopen(url, timeout=10).read())
print(json.dumps({'version': data.get('version', 'unknown')}))
"
```

Store the latest version as `$LATEST_VERSION`.

## Step 2: Download and extract the latest package to a temp directory

```bash
TMPDIR=$(mktemp -d)
npm pack claude-code-autoconfig@latest --pack-destination "$TMPDIR" 2>/dev/null
tar -xzf "$TMPDIR"/*.tgz -C "$TMPDIR"
echo "$TMPDIR/package"
```

Store the extracted path as `$PKG_DIR`. This gives us the ground truth for what files and versions should be installed.

## Step 3: Validate installed files

Run this Python script. Substitute `$PKG_DIR` with the temp package path and `$PROJECT_DIR` with the current working directory.

```bash
python3 -c "
import json, os, re, sys

pkg_dir = '$PKG_DIR'
project_dir = '$PROJECT_DIR'
claude_dir = os.path.join(project_dir, '.claude')

def parse_version(content):
    m = re.search(r'<!-- @version (\d+) -->', content)
    return int(m.group(1)) if m else 0

def parse_description(content):
    m = re.search(r'<!-- @description (.+?) -->', content)
    return m.group(1).strip() if m else ''

issues = []
info = []

# --- 1. Check expected directories ---
expected_dirs = ['commands', 'agents', 'docs', 'feedback', 'hooks', 'scripts']
for d in expected_dirs:
    local = os.path.join(claude_dir, d)
    if not os.path.isdir(local):
        issues.append(f'MISSING DIR: .claude/{d}/ does not exist')
    else:
        info.append(f'OK: .claude/{d}/ exists')

# --- 2. Check command files and versions ---
dev_only = ['publish.md']
pkg_cmds_dir = os.path.join(pkg_dir, '.claude', 'commands')
local_cmds_dir = os.path.join(claude_dir, 'commands')

if os.path.isdir(pkg_cmds_dir) and os.path.isdir(local_cmds_dir):
    pkg_cmds = set(f for f in os.listdir(pkg_cmds_dir) if f.endswith('.md') and f not in dev_only)
    local_cmds = set(f for f in os.listdir(local_cmds_dir) if f.endswith('.md') and f not in dev_only)

    # Missing commands
    for f in sorted(pkg_cmds - local_cmds):
        issues.append(f'MISSING CMD: .claude/commands/{f} not installed')

    # Extra commands (user-added, just note them)
    for f in sorted(local_cmds - pkg_cmds):
        if f not in dev_only:
            info.append(f'EXTRA CMD: .claude/commands/{f} (user-added, not in package)')

    # Version comparison for shared commands
    for f in sorted(pkg_cmds & local_cmds):
        pkg_content = open(os.path.join(pkg_cmds_dir, f), encoding='utf-8').read()
        local_content = open(os.path.join(local_cmds_dir, f), encoding='utf-8').read()
        pkg_v = parse_version(pkg_content)
        local_v = parse_version(local_content)
        if local_v < pkg_v:
            issues.append(f'OUTDATED CMD: /{f.replace(\".md\",\"\")} is v{local_v}, latest is v{pkg_v}')
        elif local_v > pkg_v:
            info.append(f'AHEAD CMD: /{f.replace(\".md\",\"\")} is v{local_v}, package has v{pkg_v} (local is newer)')
        else:
            info.append(f'OK CMD: /{f.replace(\".md\",\"\")} v{local_v}')

# --- 3. Check agent files ---
pkg_agents_dir = os.path.join(pkg_dir, '.claude', 'agents')
local_agents_dir = os.path.join(claude_dir, 'agents')
if os.path.isdir(pkg_agents_dir) and os.path.isdir(local_agents_dir):
    pkg_agents = set(os.listdir(pkg_agents_dir))
    local_agents = set(os.listdir(local_agents_dir))
    for f in sorted(pkg_agents - local_agents):
        issues.append(f'MISSING AGENT: .claude/agents/{f} not installed')
    for f in sorted(pkg_agents & local_agents):
        info.append(f'OK AGENT: .claude/agents/{f}')

# --- 4. Check docs ---
pkg_docs_dir = os.path.join(pkg_dir, '.claude', 'docs')
local_docs_dir = os.path.join(claude_dir, 'docs')
if os.path.isdir(pkg_docs_dir):
    for f in os.listdir(pkg_docs_dir):
        if f.endswith('.html'):
            if os.path.isdir(local_docs_dir) and f in os.listdir(local_docs_dir):
                info.append(f'OK DOC: .claude/docs/{f}')
            else:
                issues.append(f'MISSING DOC: .claude/docs/{f} not installed')

# --- 5. Check settings.json ---
settings_path = os.path.join(claude_dir, 'settings.json')
if os.path.isfile(settings_path):
    try:
        settings = json.loads(open(settings_path, encoding='utf-8').read())
        if 'permissions' in settings:
            info.append('OK: settings.json exists with permissions')
        else:
            issues.append('SETTINGS: settings.json exists but has no permissions block')
    except json.JSONDecodeError:
        issues.append('SETTINGS: settings.json exists but is invalid JSON')
else:
    issues.append('MISSING: .claude/settings.json not found')

# --- 6. Check CLAUDE.md ---
claude_md = os.path.join(project_dir, 'CLAUDE.md')
if os.path.isfile(claude_md):
    content = open(claude_md, encoding='utf-8').read()
    if 'AUTO-GENERATED BY /autoconfig' in content:
        info.append('OK: CLAUDE.md exists with autoconfig marker')
    else:
        info.append('NOTE: CLAUDE.md exists but missing autoconfig marker (may be manually written)')
else:
    issues.append('MISSING: CLAUDE.md not found (run /autoconfig to generate)')

# --- 7. Check hooks reference integrity ---
if os.path.isfile(settings_path):
    try:
        settings = json.loads(open(settings_path, encoding='utf-8').read())
        hooks = settings.get('hooks', {})
        for event, matchers in hooks.items():
            if isinstance(matchers, list):
                for matcher in matchers:
                    cmd = matcher.get('command', '')
                    # Extract file paths from hook commands
                    for token in cmd.split():
                        if token.endswith('.js') and '.claude/' in token:
                            hook_path = token.replace('.claude/', '')
                            full_path = os.path.join(claude_dir, hook_path)
                            if os.path.isfile(full_path):
                                info.append(f'OK HOOK: {token} exists')
                            else:
                                issues.append(f'BROKEN HOOK: {token} referenced in settings.json but file not found')
    except:
        pass

# --- Output ---
print(json.dumps({'issues': issues, 'info': info}, indent=2))
"
```

## Step 4: Clean up temp directory

```bash
rm -rf "$TMPDIR"
```

## Step 5: Display the report

Format the results as a clear report. Use this structure:

If there are **no issues**:

> **Install validated — all checks passed.**
>
> - Latest version: {version}
> - {count} commands, {count} agents, {count} hooks — all current
>
> Your installation is up to date.

If there are **issues**:

> **Validation found {N} issue(s):**
>
> {list each issue with a brief explanation}
>
> **To fix:** run `npx claude-code-autoconfig@latest` (or `--force` for a clean reinstall).

Always list the OK items in a collapsed/brief summary (don't enumerate every OK item unless the user asks). Focus attention on the issues.

## Step 6: Stop

Do NOT take any action to fix issues. The user decides what to do next.
