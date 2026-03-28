#!/usr/bin/env node

/**
 * sync-docs.js — Scans .claude/ and updates the interactive docs HTML.
 *
 * Updates three sections in autoconfig.docs.html:
 *   1. File tree (HTML divs)
 *   2. treeInfo (JS object — title, desc, trigger per key)
 *   3. fileContents (JS object — filename + content preview per key)
 *
 * Run: node .claude/scripts/sync-docs.js
 */

const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const claudeDir = path.join(cwd, '.claude');
const docsPath = path.join(claudeDir, 'docs', 'autoconfig.docs.html');

if (!fs.existsSync(docsPath)) {
  // No docs file — nothing to sync
  process.exit(0);
}

// Directories/files to skip entirely
const SKIP = new Set([
  'docs', 'plans', 'migration', 'retro', 'scripts',
  'settings.local.json'
]);

// Folders we scan for files
const SCAN_FOLDERS = ['commands', 'agents', 'hooks', 'feedback'];

// Structural keys that are not file-backed (always preserved, never generated)
const STRUCTURAL_KEYS = new Set([
  'memory-md', 'root', 'claude-md', 'claude-dir'
]);

// Hardcoded entries that have special handling
const STATIC_ENTRIES = {
  'settings': {
    file: 'settings.json',
    parent: 'claude-dir',
    icon: '⚙️',
    indent: 2
  },
  'mcp': {
    file: '.mcp.json',
    parent: 'claude-dir',
    icon: '🔌',
    indent: 2
  },
  'docs': {
    file: 'autoconfig.docs.html',
    parent: 'docs-folder',
    icon: '🌐',
    indent: 3,
    folder: {
      key: 'docs',
      name: 'docs',
      dataFolder: 'docs-folder',
      parent: 'claude-dir'
    }
  }
};

/**
 * Extract @description from a file's content.
 */
function extractDescription(content, ext) {
  if (ext === '.md') {
    const match = content.match(/<!--\s*@description\s+(.+?)\s*-->/);
    return match ? match[1] : null;
  }
  if (ext === '.js') {
    // Look for @description in JSDoc or comment block
    const match = content.match(/@description\s+(.+?)(?:\n|\*\/)/);
    return match ? match[1].replace(/\s*\*\s*$/, '').trim() : null;
  }
  return null;
}

/**
 * Extract structured Swagger-style metadata from command file content.
 * Parses @param, @response, @sideeffect, and @example comments.
 */
function extractSwaggerMeta(content) {
  const params = [];
  const responses = [];
  const examples = [];
  let sideeffect = null;

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const paramMatch = line.match(/<!--\s*@param\s+(.+?)\s*-->/);
    if (paramMatch) {
      const parts = paramMatch[1].split('|').map(s => s.trim());
      if (parts.length >= 4) {
        params.push({ name: parts[0], type: parts[1], required: parts[2], desc: parts[3] });
      }
    }
    const respMatch = line.match(/<!--\s*@response\s+(.+?)\s*-->/);
    if (respMatch) {
      const parts = respMatch[1].split('|').map(s => s.trim());
      if (parts.length >= 2) {
        responses.push({ status: parts[0], desc: parts[1] });
      }
    }
    const exMatch = line.match(/<!--\s*@example\s+(.+?)\s*-->/);
    if (exMatch) {
      const parts = exMatch[1].split('|').map(s => s.trim());
      if (parts.length >= 2) {
        examples.push({ usage: parts[0], desc: parts[1] });
      }
    }
    const seMatch = line.match(/<!--\s*@sideeffect\s+(.+?)\s*-->/);
    if (seMatch) {
      sideeffect = seMatch[1].trim();
    }
  }

  return { params, responses, examples, sideeffect };
}

/**
 * Build Swagger-style HTML from extracted metadata.
 */
function buildSwaggerHtml(meta) {
  const parts = [];

  // Parameters table
  if (meta.params.length > 0) {
    let table = '<div style="margin-top: 12px;"><strong>Parameters</strong>';
    table += '<table style="width: 100%; margin-top: 6px; border-collapse: collapse; font-size: 0.9em; text-align: left;">';
    table += '<tr style="text-align: left; border-bottom: 1px solid var(--border);"><th style="padding: 4px 8px 4px 0;">Name</th><th style="padding: 4px 8px 4px 0;">Type</th><th style="padding: 4px 8px 4px 0;">Required</th><th style="padding: 4px 8px 4px 0;">Description</th></tr>';
    for (const p of meta.params) {
      table += `<tr style="border-bottom: 1px solid var(--border);">`;
      table += `<td style="padding: 4px 8px 4px 0; vertical-align: top; white-space: nowrap;"><code>${p.name}</code></td>`;
      table += `<td style="padding: 4px 8px 4px 0; vertical-align: top;"><code>${p.type}</code></td>`;
      table += `<td style="padding: 4px 8px 4px 0; vertical-align: top;">${p.required}</td>`;
      table += `<td style="padding: 4px 8px 4px 0; vertical-align: top;">${p.desc}</td>`;
      table += `</tr>`;
    }
    table += '</table></div>';
    parts.push(table);
  } else {
    parts.push('<div style="margin-top: 12px;"><strong>Parameters</strong><div style="margin-top: 4px; opacity: 0.6;">None</div></div>');
  }

  // Responses table
  if (meta.responses.length > 0) {
    let table = '<div style="margin-top: 12px;"><strong>Responses</strong>';
    table += '<table style="width: 100%; margin-top: 6px; border-collapse: collapse; font-size: 0.9em; text-align: left;">';
    table += '<tr style="text-align: left; border-bottom: 1px solid var(--border);"><th style="padding: 4px 8px 4px 0;">Status</th><th style="padding: 4px 8px 4px 0;">Description</th></tr>';
    for (const r of meta.responses) {
      table += `<tr style="border-bottom: 1px solid var(--border);">`;
      table += `<td style="padding: 4px 8px 4px 0; vertical-align: top; white-space: nowrap;"><code>${r.status}</code></td>`;
      table += `<td style="padding: 4px 8px 4px 0; vertical-align: top;">${r.desc}</td>`;
      table += `</tr>`;
    }
    table += '</table></div>';
    parts.push(table);
  }

  // Side effects
  if (meta.sideeffect) {
    parts.push(`<div style="margin-top: 12px;"><strong>Side Effects</strong><div style="margin-top: 4px; font-size: 0.9em;">${meta.sideeffect}</div></div>`);
  }

  // Examples
  if (meta.examples.length > 0) {
    let html = '<div style="margin-top: 12px;"><strong>Examples</strong><div style="margin-top: 6px; background: var(--bg-elevated); border-radius: 6px; padding: 8px 12px; font-family: monospace; font-size: 0.85em;">';
    for (const ex of meta.examples) {
      html += `<div><code>${ex.usage}</code> <span style="opacity: 0.6;">— ${ex.desc}</span></div>`;
    }
    html += '</div></div>';
    parts.push(html);
  }

  return parts.length > 0 ? parts.join('') : null;
}

/**
 * Extract @trigger from a JS file's JSDoc.
 */
function extractTrigger(content) {
  const match = content.match(/@trigger\s+(.+?)(?:\n|\*\/)/);
  return match ? match[1].replace(/\s*\*\s*$/, '').trim() : null;
}

/**
 * Derive a unique key for a file.
 */
function deriveKey(folder, filename) {
  const stem = filename.replace(/\.[^.]+$/, '');
  if (folder === 'commands') return stem;
  if (folder === 'hooks') return stem + '-hook';
  if (folder === 'agents') return stem + '-agent';
  if (folder === 'feedback') return 'feedback-' + stem.toLowerCase();
  if (folder === 'updates') return 'update-' + stem;
  return stem;
}

/**
 * Derive trigger text for a file.
 */
function deriveTrigger(folder, filename, content) {
  if (folder === 'commands') {
    const stem = filename.replace(/\.md$/, '');
    return '/' + stem;
  }
  if (folder === 'hooks') {
    const trigger = extractTrigger(content);
    return trigger || 'PostToolUse hook';
  }
  if (folder === 'agents') return 'Background agent';
  return null;
}

/**
 * Generate a content preview (first ~30 meaningful lines).
 */
function generatePreview(content, ext) {
  const lines = content.split(/\r?\n/);
  // Skip metadata comments at the top
  let start = 0;
  while (start < lines.length && /^<!--/.test(lines[start].trim())) {
    // Find the closing -->
    while (start < lines.length && !lines[start].includes('-->')) start++;
    start++;
  }
  // Skip leading blank lines
  while (start < lines.length && lines[start].trim() === '') start++;

  const preview = lines.slice(start, start + 30).join('\n').trim();
  return preview || content.slice(0, 500).trim();
}

/**
 * Escape a string for use inside a JS template literal.
 */
function escapeTemplateLiteral(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

/**
 * Scan .claude/ and collect file entries.
 */
function scanFiles() {
  const entries = [];

  for (const folder of SCAN_FOLDERS) {
    const folderPath = path.join(claudeDir, folder);
    if (!fs.existsSync(folderPath)) continue;

    const files = fs.readdirSync(folderPath).filter(f => {
      const stat = fs.statSync(path.join(folderPath, f));
      return stat.isFile();
    }).sort();

    for (const file of files) {
      const ext = path.extname(file);
      const filePath = path.join(folderPath, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const key = deriveKey(folder, file);
      const desc = extractDescription(content, ext) || `${file} in ${folder}/`;
      const trigger = deriveTrigger(folder, file, content);
      const preview = generatePreview(content, ext);
      const swagger = (folder === 'commands') ? extractSwaggerMeta(content) : null;
      const swaggerHtml = swagger ? buildSwaggerHtml(swagger) : null;

      entries.push({ key, folder, file, desc, trigger, preview, swaggerHtml });
    }
  }

  // Check for rules/ directory
  const rulesPath = path.join(claudeDir, 'rules');
  if (fs.existsSync(rulesPath)) {
    entries.push({
      key: 'rules',
      folder: null,
      file: null,
      desc: 'Path-scoped context that loads when Claude works on matching files.',
      trigger: null,
      preview: null,
      isEmptyFolder: true,
      emptyMessage: 'Add .md files here to define rules for specific paths in your codebase.'
    });
  }

  return entries;
}

/**
 * Generate the tree HTML for file-backed entries.
 */
function generateTreeHtml(entries) {
  const lines = [];
  const folders = new Map(); // folder name -> entries

  // Group entries by folder
  for (const entry of entries) {
    if (entry.isEmptyFolder) continue;
    if (!folders.has(entry.folder)) folders.set(entry.folder, []);
    folders.get(entry.folder).push(entry);
  }

  // Emit folder groups in a consistent order
  const folderOrder = ['commands', 'agents', 'feedback', 'hooks'];
  for (const folderName of folderOrder) {
    const folderEntries = folders.get(folderName);
    if (!folderEntries || folderEntries.length === 0) continue;

    // Folder row
    lines.push(`                            <div class="tree-item indent-2 folder-row hidden collapsed" data-info="${folderName}" data-folder="${folderName}" data-parent="claude-dir">`);
    lines.push(`                                <span class="tree-chevron">›</span>`);
    lines.push(`                                <span class="tree-folder-icon">📁</span>`);
    lines.push(`                                <span class="folder">${folderName}</span>`);
    lines.push(`                            </div>`);

    // File rows
    for (const entry of folderEntries) {
      lines.push(`                            <div class="tree-item indent-3 hidden" data-info="${entry.key}" data-parent="${folderName}">`);
      lines.push(`                                <span class="tree-spacer"></span>`);
      lines.push(`                                <span class="tree-file-icon">📄</span>`);
      lines.push(`                                <span class="file">${entry.file}</span>`);
      lines.push(`                            </div>`);
    }
  }

  // Docs folder (static)
  lines.push(`                            <div class="tree-item indent-2 folder-row hidden collapsed" data-info="docs" data-folder="docs-folder" data-parent="claude-dir">`);
  lines.push(`                                <span class="tree-chevron">›</span>`);
  lines.push(`                                <span class="tree-folder-icon">📁</span>`);
  lines.push(`                                <span class="folder">docs</span>`);
  lines.push(`                            </div>`);
  lines.push(`                            <div class="tree-item indent-3 hidden" data-info="docs" data-parent="docs-folder">`);
  lines.push(`                                <span class="tree-spacer"></span>`);
  lines.push(`                                <span class="tree-file-icon">🌐</span>`);
  lines.push(`                                <span class="file">autoconfig.docs.html</span>`);
  lines.push(`                            </div>`);

  // Rules folder
  const hasRules = entries.some(e => e.key === 'rules');
  if (hasRules) {
    lines.push(`                            <div class="tree-item indent-2 hidden" data-info="rules" data-parent="claude-dir">`);
    lines.push(`                                <span class="tree-spacer"></span>`);
    lines.push(`                                <span class="tree-folder-icon">📁</span>`);
    lines.push(`                                <span class="folder">rules</span>`);
    lines.push(`                            </div>`);
  }

  // .mcp.json
  if (fs.existsSync(path.join(claudeDir, '.mcp.json'))) {
    lines.push(`                            <div class="tree-item indent-2 hidden" data-info="mcp" data-parent="claude-dir">`);
    lines.push(`                                <span class="tree-spacer"></span>`);
    lines.push(`                                <span class="tree-file-icon">🔌</span>`);
    lines.push(`                                <span class="file">.mcp.json</span>`);
    lines.push(`                            </div>`);
  }

  // settings.json
  if (fs.existsSync(path.join(claudeDir, 'settings.json'))) {
    lines.push(`                            <div class="tree-item indent-2 hidden" data-info="settings" data-parent="claude-dir">`);
    lines.push(`                                <span class="tree-spacer"></span>`);
    lines.push(`                                <span class="tree-file-icon">⚙️</span>`);
    lines.push(`                                <span class="file">settings.json</span>`);
    lines.push(`                            </div>`);
  }

  return lines.join('\n');
}

/**
 * Generate treeInfo JS entries for file-backed items.
 */
function generateTreeInfo(entries) {
  const lines = [];

  for (const entry of entries) {
    if (entry.isEmptyFolder) {
      lines.push(`            '${entry.key}': {`);
      lines.push(`                title: '${entry.key}/',`);
      lines.push(`                desc: '${entry.desc.replace(/'/g, "\\'")}'`);
      lines.push(`            },`);
      continue;
    }

    // Folder-level info card
    // (we emit these once per folder)
  }

  // Emit folder info cards
  const folderDescs = {
    'commands': 'On-demand workflows you trigger with <code>/name</code>. Each .md file becomes a <a href="https://docs.anthropic.com/en/docs/claude-code/slash-commands" target="_blank" style="color: var(--accent-cyan);">slash command</a>.',
    'agents': 'Reusable agent definitions that Claude can invoke for specialized tasks.',
    'feedback': 'Team-maintained corrections and guidance for Claude. Add notes here when Claude does something wrong — it learns for next time. This directory persists across <code>/autoconfig</code> runs.',
    'hooks': 'Executable hook scripts that trigger on Claude Code events like PostToolUse.'
  };

  const seenFolders = new Set();
  for (const entry of entries) {
    if (entry.isEmptyFolder) continue;
    if (!seenFolders.has(entry.folder)) {
      seenFolders.add(entry.folder);
      const desc = folderDescs[entry.folder] || `Files in ${entry.folder}/`;
      lines.push(`            '${entry.folder}': {`);
      lines.push(`                title: '${entry.folder}/',`);
      lines.push(`                desc: '${desc.replace(/'/g, "\\'")}'`);
      lines.push(`            },`);
    }
  }

  // Emit file info cards
  for (const entry of entries) {
    if (entry.isEmptyFolder) continue;

    let fullDesc = entry.desc;
    if (entry.swaggerHtml) {
      fullDesc += entry.swaggerHtml;
    }
    const escapedDesc = fullDesc.replace(/'/g, "\\'");
    lines.push(`            '${entry.key}': {`);
    lines.push(`                title: '${entry.file}',`);
    lines.push(`                desc: '${escapedDesc}'${entry.trigger ? ',' : ''}`);
    if (entry.trigger) {
      lines.push(`                trigger: '${entry.trigger.replace(/'/g, "\\'")}'`);
    }
    lines.push(`            },`);
  }

  // Static entries: docs, rules, mcp, settings
  lines.push(`            'docs': {`);
  lines.push(`                title: 'docs/autoconfig.docs.html',`);
  lines.push(`                desc: 'This interactive docs. Open it anytime to review what each file does.',`);
  lines.push(`                trigger: '/show-docs'`);
  lines.push(`            },`);

  if (entries.some(e => e.key === 'rules')) {
    lines.push(`            'rules': {`);
    lines.push(`                title: 'rules/',`);
    lines.push(`                desc: 'Path-scoped context that loads when Claude works on matching files. Optimized rules are based on your project\\'s needs, patterns and practices.<br><br><div style="background: var(--bg-elevated); border: 1px solid var(--accent-cyan); border-radius: 8px; padding: 16px; margin-top: 8px;"><strong style="color: var(--accent-orange);">Want optimized rules for your project?</strong><br>Reach out: <a href="mailto:info@adac1001.com" style="color: var(--accent-cyan);">info@adac1001.com</a></div>'`);
    lines.push(`            },`);
  }

  if (fs.existsSync(path.join(claudeDir, '.mcp.json'))) {
    lines.push(`            'mcp': {`);
    lines.push(`                title: '.mcp.json',`);
    lines.push(`                desc: 'MCP (Model Context Protocol) server configuration. Add your MCP servers here.'`);
    lines.push(`            },`);
  }

  if (fs.existsSync(path.join(claudeDir, 'settings.json'))) {
    lines.push(`            'settings': {`);
    lines.push(`                title: 'settings.json',`);
    lines.push(`                desc: 'Permissions and security settings. Controls what Claude can auto-approve (allow) and what is always blocked (deny).'`);
    lines.push(`            }`);
  }

  return lines.join('\n');
}

/**
 * Generate fileContents JS entries.
 */
function generateFileContents(entries) {
  const lines = [];

  for (const entry of entries) {
    if (entry.isEmptyFolder) {
      lines.push(`            '${entry.key}': {`);
      lines.push(`                filename: '${entry.key}/',`);
      lines.push(`                content: null,`);
      lines.push(`                empty: true,`);
      lines.push(`                emptyMessage: '${entry.emptyMessage.replace(/'/g, "\\'")}'`);
      lines.push(`            },`);
      continue;
    }

    const escaped = escapeTemplateLiteral(entry.preview);
    lines.push(`            '${entry.key}': {`);
    lines.push(`                filename: '${entry.file}',`);
    lines.push('                content: `' + escaped + '`');
    lines.push(`            },`);
  }

  // Folder-level preview entries for hooks
  lines.push(`            'hooks': {`);
  lines.push(`                filename: 'hooks/',`);
  lines.push(`                content: null,`);
  lines.push(`                empty: true,`);
  lines.push(`                emptyMessage: 'Contains executable hook scripts that trigger on Claude Code events.'`);
  lines.push(`            },`);

  // Static entries
  lines.push(`            'docs': {`);
  lines.push(`                filename: 'autoconfig.docs.html',`);
  lines.push(`                content: null,`);
  lines.push(`                empty: true,`);
  lines.push(`                emptyMessage: "You\\\'re looking at it! 👀"`);
  lines.push(`            },`);

  if (entries.some(e => e.key === 'rules')) {
    lines.push(`            'rules': {`);
    lines.push(`                filename: 'rules/',`);
    lines.push(`                content: null,`);
    lines.push(`                empty: true,`);
    lines.push(`                emptyMessage: 'This directory is empty.\\nAdd .md files here to define rules for specific paths in your codebase.'`);
    lines.push(`            },`);
  }

  // settings.json — read actual content
  const settingsPath = path.join(claudeDir, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    const content = fs.readFileSync(settingsPath, 'utf8').trim();
    lines.push(`            'settings': {`);
    lines.push(`                filename: 'settings.json',`);
    lines.push('                content: `' + escapeTemplateLiteral(content) + '`');
    lines.push(`            },`);
  }

  // .mcp.json — read actual content
  const mcpPath = path.join(claudeDir, '.mcp.json');
  if (fs.existsSync(mcpPath)) {
    const content = fs.readFileSync(mcpPath, 'utf8').trim();
    lines.push(`            'mcp': {`);
    lines.push(`                filename: '.mcp.json',`);
    lines.push('                content: `' + escapeTemplateLiteral(content) + '`');
    lines.push(`            }`);
  }

  return lines.join('\n');
}

// =============================================================================
// Main
// =============================================================================

const entries = scanFiles();
let html = fs.readFileSync(docsPath, 'utf8');

// 1. Replace the file tree (between claude-dir folder row and settings.json closing div)
//    We find the marker after the claude-dir folder and replace up to the settings div
const treeStartMarker = '<span class="folder">.claude</span>';
const treeStartIdx = html.indexOf(treeStartMarker);
if (treeStartIdx === -1) {
  console.error('Could not find .claude folder marker in docs HTML');
  process.exit(1);
}
// Find the closing </div> of the claude-dir folder row
const claudeDirClose = html.indexOf('</div>', treeStartIdx);
const treeContentStart = claudeDirClose + '</div>'.length;

// Find the end of the tree: look for the closing of tree-side/tree-content after settings.json
const treeEndMarker = '</div>\n                        </div>\n                        <div class="info-side">';
const treeEndIdx = html.indexOf(treeEndMarker, treeContentStart);
if (treeEndIdx === -1) {
  console.error('Could not find tree end marker in docs HTML');
  process.exit(1);
}

const newTreeHtml = generateTreeHtml(entries);
html = html.slice(0, treeContentStart) + '\n' + newTreeHtml + '\n                            ' + html.slice(treeEndIdx);

// 2. Replace treeInfo (between structural entries and closing })
//    We keep memory-md, root, claude-md, claude-dir and replace everything after
const treeInfoStartMarker = "// Tree panel info data";
let treeInfoIdx = html.indexOf(treeInfoStartMarker);
if (treeInfoIdx === -1) {
  // Try alternate marker
  treeInfoIdx = html.indexOf("const treeInfo = {");
}
if (treeInfoIdx === -1) {
  console.error('Could not find treeInfo in docs HTML');
  process.exit(1);
}

// Find the claude-dir entry end (last structural entry)
const claudeDirInfoMarker = "'claude-dir': {";
const claudeDirInfoIdx = html.indexOf(claudeDirInfoMarker, treeInfoIdx);
if (claudeDirInfoIdx === -1) {
  console.error('Could not find claude-dir info entry');
  process.exit(1);
}
// Find the closing }, of the claude-dir entry
let braceDepth = 0;
let i = claudeDirInfoIdx;
while (i < html.length) {
  if (html[i] === '{') braceDepth++;
  if (html[i] === '}') {
    braceDepth--;
    if (braceDepth === 0) break;
  }
  i++;
}
// Skip past the closing },
const afterClaudeDir = i + 1;
// Skip whitespace/comma
let treeInfoInsertPoint = afterClaudeDir;
while (treeInfoInsertPoint < html.length && /[\s,]/.test(html[treeInfoInsertPoint])) {
  treeInfoInsertPoint++;
}

// Find the closing }; of treeInfo
const treeInfoEnd = html.indexOf('};', treeInfoInsertPoint);
if (treeInfoEnd === -1) {
  console.error('Could not find treeInfo closing');
  process.exit(1);
}

const newTreeInfo = generateTreeInfo(entries);
html = html.slice(0, treeInfoInsertPoint) + newTreeInfo + '\n        ' + html.slice(treeInfoEnd);

// 3. Replace fileContents
//    Keep memory-md and claude-md (structural), replace the rest
const fileContentsMarker = "const fileContents = {";
const fcIdx = html.indexOf(fileContentsMarker);
if (fcIdx === -1) {
  console.error('Could not find fileContents in docs HTML');
  process.exit(1);
}

// Find claude-md entry end (last structural fileContents entry)
const claudeMdFcMarker = "'claude-md': {";
const claudeMdFcIdx = html.indexOf(claudeMdFcMarker, fcIdx);
if (claudeMdFcIdx === -1) {
  console.error('Could not find claude-md fileContents entry');
  process.exit(1);
}
braceDepth = 0;
i = claudeMdFcIdx;
while (i < html.length) {
  if (html[i] === '{') braceDepth++;
  if (html[i] === '}') {
    braceDepth--;
    if (braceDepth === 0) break;
  }
  i++;
}
const afterClaudeMdFc = i + 1;
let fcInsertPoint = afterClaudeMdFc;
while (fcInsertPoint < html.length && /[\s,]/.test(html[fcInsertPoint])) {
  fcInsertPoint++;
}

const fcEnd = html.indexOf('};', fcInsertPoint);
if (fcEnd === -1) {
  console.error('Could not find fileContents closing');
  process.exit(1);
}

const newFileContents = generateFileContents(entries);
html = html.slice(0, fcInsertPoint) + newFileContents + '\n        ' + html.slice(fcEnd);

fs.writeFileSync(docsPath, html);

const fileCount = entries.filter(e => !e.isEmptyFolder).length;
console.log(`Synced ${fileCount} files to docs.`);
