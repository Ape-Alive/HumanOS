'use strict';

const { spawn } = require('child_process');
const os = require('os');

const MAX_OUTPUT = 12000;
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * @param {string} s
 */
function clipOutput(s) {
  const t = String(s || '');
  if (t.length <= MAX_OUTPUT) return t;
  return `${t.slice(0, MAX_OUTPUT)}\n…(truncated)`;
}

/**
 * 仅允许启动类/受控命令，防止任意 shell 执行。
 * @param {string} command
 * @param {string} platform
 */
function validateShellCommand(command, platform) {
  const cmd = String(command || '').trim();
  if (!cmd || cmd.length > 2000) return { ok: false, error: 'empty-or-too-long' };
  const plat = platform === 'win32' ? 'win32' : 'darwin';

  if (plat === 'darwin') {
    if (/^open\s+-a\s+["'][^"']+["']\s*$/i.test(cmd)) return { ok: true };
    if (/^open\s+-a\s+[\w\s./\u4e00-\u9fff-]+\s*$/i.test(cmd)) return { ok: true };
    return { ok: false, error: 'command-not-allowed-darwin' };
  }

  if (/^cmd(\.exe)?\s+\/c\s+start\s+/i.test(cmd)) return { ok: true };
  if (/^start\s+(\/b\s+)?(""|''|[\w.-]+)/i.test(cmd)) return { ok: true };
  return { ok: false, error: 'command-not-allowed-win32' };
}

/**
 * @param {{ command: string, timeoutMs?: number, platform?: string }} p
 * @returns {Promise<{ ok: boolean, exitCode: number, stdout: string, stderr: string, error?: string }>}
 */
function execShellCommand(p) {
  const platform = p.platform === 'win32' ? 'win32' : process.platform === 'win32' ? 'win32' : 'darwin';
  const command = String(p.command || '').trim();
  const timeoutMs = Math.min(60000, Math.max(1000, Math.floor(Number(p.timeoutMs) || DEFAULT_TIMEOUT_MS)));

  const v = validateShellCommand(command, platform);
  if (!v.ok) {
    return Promise.resolve({ ok: false, exitCode: -1, stdout: '', stderr: '', error: v.error });
  }

  return new Promise((resolve) => {
    const isWin = platform === 'win32';
    const child = isWin
      ? spawn('cmd.exe', ['/d', '/s', '/c', command.replace(/^cmd(\.exe)?\s+\/c\s+/i, '')], {
          windowsHide: true,
          env: process.env,
        })
      : spawn('/bin/sh', ['-c', command], { env: process.env });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        exitCode: -1,
        stdout: clipOutput(stdout),
        stderr: clipOutput(stderr),
        error: 'timeout',
      });
    }, timeoutMs);

    child.stdout?.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr?.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      finish({
        ok: false,
        exitCode: -1,
        stdout: clipOutput(stdout),
        stderr: clipOutput(stderr),
        error: String(e?.message || e),
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const exitCode = typeof code === 'number' ? code : -1;
      finish({
        ok: exitCode === 0,
        exitCode,
        stdout: clipOutput(stdout),
        stderr: clipOutput(stderr),
        error: exitCode === 0 ? undefined : `exit-${exitCode}`,
      });
    });
  });
}

module.exports = { execShellCommand, validateShellCommand };
