'use strict';

/**
 * 从 build/icon.svg 生成 electron-builder 与各平台所需位图。
 * 优先使用 rsvg-convert（librsvg）；macOS 上可额外生成 icon.icns。
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const desktopRoot = path.join(__dirname, '..');
const buildDir = path.join(desktopRoot, 'build');
const svgPath = path.join(buildDir, 'icon.svg');
const pngPath = path.join(buildDir, 'icon.png');
const iconsDir = path.join(buildDir, 'icons');

/** @type {{ size: number, name: string }[]} */
const LINUX_SIZES = [
  { size: 16, name: '16x16.png' },
  { size: 32, name: '32x32.png' },
  { size: 48, name: '48x48.png' },
  { size: 64, name: '64x64.png' },
  { size: 128, name: '128x128.png' },
  { size: 256, name: '256x256.png' },
  { size: 512, name: '512x512.png' },
];

/** macOS iconset 命名 */
const MAC_ICONSET = [
  { size: 16, name: 'icon_16x16.png' },
  { size: 32, name: 'icon_16x16@2x.png' },
  { size: 32, name: 'icon_32x32.png' },
  { size: 64, name: 'icon_32x32@2x.png' },
  { size: 128, name: 'icon_128x128.png' },
  { size: 256, name: 'icon_128x128@2x.png' },
  { size: 256, name: 'icon_256x256.png' },
  { size: 512, name: 'icon_256x256@2x.png' },
  { size: 512, name: 'icon_512x512.png' },
  { size: 1024, name: 'icon_512x512@2x.png' },
];

function findRsvgConvert() {
  const candidates = ['rsvg-convert', '/opt/homebrew/bin/rsvg-convert', '/usr/local/bin/rsvg-convert'];
  for (const cmd of candidates) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return cmd;
  }
  return null;
}

/**
 * @param {string} rsvg
 * @param {number} size
 * @param {string} out
 */
function renderPng(rsvg, size, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync(rsvg, ['-w', String(size), '-h', String(size), svgPath, '-o', out], {
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    throw new Error(`rsvg-convert failed for ${out}`);
  }
}

function generateMacIcns(rsvg) {
  if (process.platform !== 'darwin') return;
  const iconsetDir = path.join(buildDir, 'icon.iconset');
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  fs.mkdirSync(iconsetDir, { recursive: true });
  for (const { size, name } of MAC_ICONSET) {
    renderPng(rsvg, size, path.join(iconsetDir, name));
  }
  const icnsPath = path.join(buildDir, 'icon.icns');
  const r = spawnSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath], { stdio: 'inherit' });
  if (r.status === 0) {
    console.log('[icons] wrote', icnsPath);
  } else {
    console.warn('[icons] iconutil failed; electron-builder 将回退使用 icon.png');
  }
  fs.rmSync(iconsetDir, { recursive: true, force: true });
}

function main() {
  if (!fs.existsSync(svgPath)) {
    console.error('[icons] missing', svgPath);
    process.exit(1);
  }

  const rsvg = findRsvgConvert();
  if (!rsvg) {
    console.error(
      '[icons] 未找到 rsvg-convert。请安装 librsvg 后重试：\n' +
        '  macOS: brew install librsvg\n' +
        '  Ubuntu: sudo apt install librsvg2-bin',
    );
    if (fs.existsSync(pngPath)) {
      console.warn('[icons] 保留现有 build/icon.png');
      process.exit(0);
    }
    process.exit(1);
  }

  console.log('[icons] using', rsvg);
  renderPng(rsvg, 1024, pngPath);
  console.log('[icons] wrote', pngPath);

  fs.mkdirSync(iconsDir, { recursive: true });
  for (const { size, name } of LINUX_SIZES) {
    renderPng(rsvg, size, path.join(iconsDir, name));
  }
  console.log('[icons] wrote linux icons →', iconsDir);

  generateMacIcns(rsvg);
  console.log('[icons] done');
}

main();
