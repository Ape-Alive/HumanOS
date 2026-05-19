'use strict';

/**
 * 清理损坏或不完整的 Electron / electron-builder 下载缓存。
 * 若打包时出现 zip: not a valid zip file，先运行本脚本再重试。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const home = os.homedir();
/** @type {string[]} */
const cacheDirs = [
  path.join(home, 'Library', 'Caches', 'electron'),
  path.join(home, '.cache', 'electron'),
  path.join(home, 'Library', 'Caches', 'electron-builder'),
  path.join(home, '.cache', 'electron-builder'),
];

const version = process.argv[2] || '33.4.11';
const platform = process.argv[3] || '';

/** @type {RegExp} */
let pattern;
if (platform) {
  pattern = new RegExp(`electron-v${version.replace(/\./g, '\\.')}-${platform}`, 'i');
} else {
  pattern = new RegExp(`electron-v${version.replace(/\./g, '\\.')}`, 'i');
}

let removed = 0;

for (const dir of cacheDirs) {
  if (!fs.existsSync(dir)) continue;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (!pattern.test(ent.name)) continue;
    try {
      if (ent.isDirectory()) {
        fs.rmSync(full, { recursive: true, force: true });
      } else {
        fs.unlinkSync(full);
      }
      console.log('[clean-electron-cache] removed', full);
      removed += 1;
    } catch (e) {
      console.warn('[clean-electron-cache] failed', full, e?.message || e);
    }
  }
}

if (!removed) {
  console.log('[clean-electron-cache] 未找到匹配缓存（可能已清空或路径不同）');
} else {
  console.log(`[clean-electron-cache] 共删除 ${removed} 项，请重新执行打包命令`);
}
