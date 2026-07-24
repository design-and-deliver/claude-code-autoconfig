#!/usr/bin/env node
// gls-downscale.js — shrink a screenshot below Claude's ~1568px image cap BEFORE the Read tool
// ingests it, so /gls spends fewer image tokens. Claude bills images by pixel AREA (~(w×h)/750)
// after downscaling to ≤1568px long edge, so nudging a shot to a smaller long edge (default 1280)
// cuts real image tokens ~30% — compression/byte-size does nothing, only resolution moves the bill.
//
// Shells out to the resizer already installed on each OS — no npm deps:
//   macOS   → sips              (built in)
//   Windows → System.Drawing    (built into .NET / every Windows box)
//   Linux   → ImageMagick       (magick/convert, if present)
//
// Robust by design: on ANY problem — tool missing, decode error, image already small, bad args —
// it prints the ORIGINAL path and exits 0, so /gls never breaks; it just forgoes the saving.
// Contract: the single line on stdout is the path the caller should Read. Diagnostics go to stderr.
//
// Usage: node gls-downscale.js "<input-image>" [maxEdge=1280]

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const input = process.argv[2];
const maxEdge = parseInt(process.argv[3], 10) || 1280;

function done(p, note) {
  if (note) process.stderr.write('gls-downscale: ' + note + '\n');
  process.stdout.write(p || '');
  process.exit(0);
}

if (!input || !fs.existsSync(input)) done(input, 'no readable input; passing through');

const ext = path.extname(input).toLowerCase();
// Only raster formats the model would resize anyway, and that every OS tool here decodes.
// Leave svg/pdf/gif/webp untouched (System.Drawing can't decode webp; vectors don't rasterize here).
if (!/\.(png|jpe?g|bmp)$/.test(ext)) done(input, ext + ' not resizable here; passing through');

const outDir = process.env.GLS_TMPDIR || os.tmpdir();
const outPath = path.join(outDir, 'gls-scaled-' + path.basename(input, ext) + '.png');
const platform = os.platform();

function run(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 25000 });
    return r.status === 0 ? (r.stdout || '') : null;
  } catch (_) { return null; }
}

function emit(ok, w, h) {
  done(ok && fs.existsSync(outPath) ? outPath : input,
    ok ? `${w}x${h} → ≤${maxEdge}px` : 'resize failed; passing through');
}

try {
  if (platform === 'darwin') {
    const dims = run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', input]);
    if (dims == null) done(input, 'sips unavailable; passing through');
    const w = +((/pixelWidth: (\d+)/.exec(dims) || [])[1]);
    const h = +((/pixelHeight: (\d+)/.exec(dims) || [])[1]);
    if (!w || !h || Math.max(w, h) <= maxEdge) done(input, `${w}x${h} already ≤ ${maxEdge}px; passing through`);
    emit(run('sips', ['-Z', String(maxEdge), '-s', 'format', 'png', input, '--out', outPath]) != null, w, h);

  } else if (platform === 'win32') {
    // System.Drawing is present on every Windows box (no install). Shrink-only guard lives inside.
    const q = s => s.replace(/'/g, "''");
    const ps = [
      "$ErrorActionPreference='Stop'",
      'Add-Type -AssemblyName System.Drawing',
      `$img=[System.Drawing.Image]::FromFile('${q(input)}')`,
      '$m=[Math]::Max($img.Width,$img.Height)',
      `if($m -le ${maxEdge}){$img.Dispose();Write-Output ('SKIP '+$m);exit 0}`,
      `$s=${maxEdge}/$m; $nw=[int]($img.Width*$s); $nh=[int]($img.Height*$s)`,
      '$bmp=New-Object System.Drawing.Bitmap $nw,$nh',
      '$g=[System.Drawing.Graphics]::FromImage($bmp)',
      '$g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
      '$g.DrawImage($img,0,0,$nw,$nh)',
      `$bmp.Save('${q(outPath)}',[System.Drawing.Imaging.ImageFormat]::Png)`,
      '$g.Dispose();$bmp.Dispose();$img.Dispose()',
      "Write-Output ('OK '+$nw+'x'+$nh)",
    ].join('; ');
    const out = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    if (out == null) done(input, 'System.Drawing resize failed; passing through');
    if (/SKIP/.test(out)) done(input, `already ≤ ${maxEdge}px; passing through`);
    emit(/OK/.test(out), (out.match(/OK (\d+)x/) || [])[1], (out.match(/x(\d+)/) || [])[1]);

  } else {
    // Linux/other: ImageMagick if present. The trailing '>' means shrink-only, never enlarge.
    const bin = run('magick', ['-version']) != null ? 'magick'
              : (run('convert', ['-version']) != null ? 'convert' : null);
    if (!bin) done(input, 'ImageMagick not found; passing through');
    emit(run(bin, [input, '-resize', `${maxEdge}x${maxEdge}>`, outPath]) != null, '', '');
  }
} catch (e) {
  done(input, (e && e.message) + '; passing through');
}
