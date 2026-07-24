#!/usr/bin/env node
'use strict';

/**
 * Tests for .claude/scripts/gls-downscale.js (the /gls image-shrink helper).
 *
 * Behavioral: generates real PNGs with System.Drawing and drives the actual script.
 * Windows-only (the win32 branch is what these pin down); elsewhere it prints SKIPPED
 * and exits 0 — same pattern as live-twin-parity's CI skip.
 *
 * Regression pinned: the SKIP path read $img.Width AFTER Dispose(), which throws under
 * $ErrorActionPreference='Stop', so an already-small image reported "resize failed"
 * instead of "already ≤ ...px" (2026-07-24 review). Fail-open masked it — stdout was
 * right either way — so the assertion here is on the stderr note, the only observable
 * difference between the healthy SKIP branch and the crashed one.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

if (os.platform() !== 'win32') {
  console.log('SKIPPED gls-downscale tests (win32 System.Drawing branch; nothing to test on this OS)');
  process.exit(0);
}

const SCRIPT = path.join(__dirname, '..', '.claude', 'scripts', 'gls-downscale.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cca-gls-'));
const psq = s => s.replace(/'/g, "''");

function ps(script) {
  return spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', timeout: 30000 });
}

function makePng(name, w, h) {
  const file = path.join(tmp, name);
  const r = ps([
    "$ErrorActionPreference='Stop'",
    'Add-Type -AssemblyName System.Drawing',
    `$bmp=New-Object System.Drawing.Bitmap ${w},${h}`,
    `$bmp.Save('${psq(file)}',[System.Drawing.Imaging.ImageFormat]::Png)`,
    '$bmp.Dispose()',
  ].join('; '));
  if (r.status !== 0 || !fs.existsSync(file)) {
    throw new Error('fixture PNG failed: ' + ((r.stderr || r.stdout || '').trim() || 'unknown'));
  }
  return file;
}

function pngDims(file) {
  const r = ps([
    "$ErrorActionPreference='Stop'",
    'Add-Type -AssemblyName System.Drawing',
    `$i=[System.Drawing.Image]::FromFile('${psq(file)}')`,
    "Write-Output ($i.Width.ToString()+'x'+$i.Height)",
    '$i.Dispose()',
  ].join('; '));
  const m = /(\d+)x(\d+)/.exec(r.stdout || '');
  return m ? { w: +m[1], h: +m[2] } : null;
}

function runScript(input, maxEdge) {
  const args = [SCRIPT, input];
  if (maxEdge) args.push(String(maxEdge));
  return spawnSync('node', args,
    { encoding: 'utf8', timeout: 60000, env: { ...process.env, GLS_TMPDIR: tmp } });
}

console.log('============================================================');
console.log('GLS-DOWNSCALE TESTS');
console.log('============================================================');
console.log();

let smallPng, bigPng;
try {
  smallPng = makePng('small.png', 200, 120);
  bigPng = makePng('big.png', 2000, 1200);
} catch (err) {
  // Exotic environment without System.Drawing — the script itself fails open there too.
  console.log(`SKIPPED gls-downscale tests (cannot build PNG fixtures: ${err.message})`);
  process.exit(0);
}

test('already-small image passes through with the SKIP note (not "resize failed")', () => {
  const r = runScript(smallPng);
  assert(r.status === 0, `exit 0, got ${r.status}`);
  assert(r.stdout.trim() === smallPng, `stdout must be the original path, got: ${r.stdout.trim()}`);
  assert(/already ≤ 1280px/.test(r.stderr),
    `stderr must report the SKIP branch ("already ≤ 1280px"), got: ${r.stderr.trim()}`);
});

test('oversized image is resized to a new PNG under GLS_TMPDIR', () => {
  const r = runScript(bigPng);
  assert(r.status === 0, `exit 0, got ${r.status}`);
  const out = r.stdout.trim();
  assert(out !== bigPng && out.endsWith('.png'), `stdout must be the scaled path, got: ${out}`);
  assert(fs.existsSync(out), 'scaled file must exist on disk');
  const dims = pngDims(out);
  assert(dims && Math.max(dims.w, dims.h) <= 1280,
    `long edge must be ≤ 1280, got ${dims && `${dims.w}x${dims.h}`}`);
});

test('a custom maxEdge is honored', () => {
  const r = runScript(bigPng, 640);
  const out = r.stdout.trim();
  assert(fs.existsSync(out), 'scaled file must exist');
  const dims = pngDims(out);
  assert(dims && Math.max(dims.w, dims.h) <= 640,
    `long edge must be ≤ 640, got ${dims && `${dims.w}x${dims.h}`}`);
});

test('non-raster extension passes through untouched', () => {
  const gif = path.join(tmp, 'anim.gif');
  fs.writeFileSync(gif, 'GIF89a');
  const r = runScript(gif);
  assert(r.status === 0 && r.stdout.trim() === gif, 'gif must pass through unchanged');
});

test('missing input passes through with exit 0 (fail-open contract)', () => {
  const r = runScript(path.join(tmp, 'nope.png'));
  assert(r.status === 0, 'must exit 0 even on missing input');
  assert(/no readable input/.test(r.stderr), 'stderr explains the pass-through');
});

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }

console.log();
console.log('============================================================');
if (failed === 0) {
  console.log(`ALL TESTS PASSED (${passed} tests)`);
} else {
  console.log(`TESTS FAILED: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
