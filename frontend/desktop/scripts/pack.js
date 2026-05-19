'use strict';

/**
 * HumanOS 桌面端打包入口
 *
 * 用法（在 frontend/desktop 目录或通过 npm -w @humanos/desktop）:
 *   node scripts/pack.js              # 当前系统
 *   node scripts/pack.js mac          # macOS (dmg + zip)
 *   node scripts/pack.js mac:arm64
 *   node scripts/pack.js mac:x64
 *   node scripts/pack.js win          # Windows (nsis + portable)
 *   node scripts/pack.js win:x64
 *   node scripts/pack.js linux        # Linux (AppImage + deb)
 *   node scripts/pack.js linux:x64
 *   node scripts/pack.js linux:arm64
 *   node scripts/pack.js all          # 一次构建 mac + win + linux（需本机具备对应工具链）
 *   node scripts/pack.js dir          # 仅解包目录，便于调试
 *
 * 跨平台说明:
 * - macOS 安装包建议在 macOS 上执行 pack:mac
 * - Windows 安装包建议在 Windows 上执行 pack:win（macOS 上可尝试，需 wine 等）
 * - Linux 安装包建议在 Linux 上执行 pack:linux（macOS 上可配合 Docker）
 */

const { spawnSync } = require('child_process');
const path = require('path');

const desktopRoot = path.join(__dirname, '..');

/** @param {NodeJS.ProcessEnv} base */
function packEnv(base) {
  const env = {
    ...base,
    CI: process.env.HUMANOS_PACK_ALLOW_CI === '1' ? base.CI : '',
  };
  const mirror = process.env.HUMANOS_ELECTRON_MIRROR;
  if (mirror) {
    env.ELECTRON_MIRROR = mirror.endsWith('/') ? mirror : `${mirror}/`;
  } else if (process.env.HUMANOS_CN_MIRROR === '1' || process.env.HUMANOS_CN_MIRROR === 'true') {
    env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
    env.ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/';
  }
  if (process.env.HUMANOS_PACK_DEBUG === '1') {
    env.DEBUG = env.DEBUG ? `${env.DEBUG},electron-builder` : 'electron-builder';
  }
  return env;
}

function isCrossPlatformPreset(name) {
  return /^(win|linux)/.test(name) || name === 'all';
}

/** @type {Record<string, string[]>} */
const PRESETS = {
  current: [],
  dir: ['--dir'],
  mac: ['--mac'],
  'mac:arm64': ['--mac', '--arm64'],
  'mac:x64': ['--mac', '--x64'],
  win: ['--win'],
  'win:x64': ['--win', '--x64'],
  'win:arm64': ['--win', '--arm64'],
  linux: ['--linux'],
  'linux:x64': ['--linux', '--x64'],
  'linux:arm64': ['--linux', '--arm64'],
  all: ['--mac', '--win', '--linux'],
};

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: desktopRoot,
    env: packEnv(process.env),
    ...opts,
  });
  if (r.status !== 0) {
    process.exit(r.status == null ? 1 : r.status);
  }
}

function npmRun(script) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  run(npmCmd, ['run', script]);
}

const preset = (process.argv[2] || 'current').toLowerCase();
const extraArgs = process.argv.slice(3);
const builderArgs = PRESETS[preset];

if (!builderArgs) {
  console.error(`[pack] 未知预设: ${preset}`);
  console.error(`[pack] 可选: ${Object.keys(PRESETS).join(', ')}`);
  process.exit(1);
}

console.log(`[pack] preset=${preset} → electron-builder ${builderArgs.join(' ')}`);
if (isCrossPlatformPreset(preset)) {
  console.log(
    '[pack] 提示: 首次打 Windows/Linux 包需下载约 100MB+ Electron 运行时，' +
      '终端可能长时间无新输出，请勿 Ctrl+C 中断（中断会导致 zip 损坏）。',
  );
  if (!process.env.HUMANOS_ELECTRON_MIRROR && process.env.HUMANOS_CN_MIRROR !== '1') {
    console.log(
      '[pack] 国内网络较慢时可加: HUMANOS_CN_MIRROR=1 npm run pack:desktop:win:x64',
    );
  }
}
npmRun('icons');
npmRun('build');

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
run(npxCmd, ['electron-builder', ...builderArgs, ...extraArgs]);

console.log(`[pack] 完成。产物目录: ${path.join(desktopRoot, 'release')}`);
