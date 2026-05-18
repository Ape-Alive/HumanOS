/**
 * DataChannel：控制端请求被控端执行 shell（基础设施，供 launch_app 兜底及后续能力扩展）。
 * @typedef {{ type: 'shell_exec', id: string, command: string, timeoutMs?: number }} ShellExecRequest
 * @typedef {{ type: 'shell_result', id: string, ok: boolean, exitCode?: number, stdout?: string, stderr?: string, error?: string }} ShellExecResult
 * @typedef {{ type: 'agent_hello', platform: string }} AgentHello
 */

/** @param {unknown} data */
export function parseShellResult(data) {
  if (typeof data !== 'string') return null;
  try {
    const o = JSON.parse(data);
    if (!o || o.type !== 'shell_result' || typeof o.id !== 'string') return null;
    return o;
  } catch {
    return null;
  }
}

/** @param {unknown} data */
export function parseAgentHello(data) {
  if (typeof data !== 'string') return null;
  try {
    const o = JSON.parse(data);
    if (!o || o.type !== 'agent_hello' || typeof o.platform !== 'string') return null;
    return o;
  } catch {
    return null;
  }
}

/**
 * @param {ShellExecRequest} msg
 */
export function stringifyShellExec(msg) {
  return JSON.stringify(msg);
}

/**
 * @param {ShellExecResult} msg
 */
export function stringifyShellResult(msg) {
  return JSON.stringify(msg);
}

/**
 * @param {string} platform
 */
export function stringifyAgentHello(platform) {
  return JSON.stringify({ type: 'agent_hello', platform: String(platform || '') });
}

export function stringifyPlatformRequest() {
  return JSON.stringify({ type: 'platform_request' });
}

/** @param {unknown} data */
export function parsePlatformRequest(data) {
  if (typeof data !== 'string') return false;
  try {
    const o = JSON.parse(data);
    return !!(o && o.type === 'platform_request');
  } catch {
    return false;
  }
}
