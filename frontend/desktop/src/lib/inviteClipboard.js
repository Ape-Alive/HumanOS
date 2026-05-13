/** 规范化信令 WebSocket URL（补全 /ws 路径） */
export function normalizeSignalUrl(u) {
  if (!u || typeof u !== 'string') return '';
  const s = u.trim();
  if (!s.startsWith('ws://') && !s.startsWith('wss://')) return '';
  try {
    const url = new URL(s);
    if (!url.pathname || url.pathname === '/') url.pathname = '/ws';
    return url.toString();
  } catch {
    const base = s.split(/(?=#)/)[0].replace(/\/$/, '');
    if (/\/ws$/i.test(base)) return base;
    return `${base}/ws`;
  }
}

/**
 * @param {string} signalUrl
 * @param {string} codeDisplay 已格式化的控制码（含空格）
 */
export function formatInviteBlock(signalUrl, codeDisplay) {
  return `HumanOS\n信令地址: ${signalUrl}\n控制码: ${codeDisplay}\n`;
}

/**
 * 从剪贴板文本解析信令地址与控制码（支持本应用导出格式、JSON、纯 URL+数字）
 * @param {string} text
 * @returns {{ signalUrl?: string, codeRaw?: string }}
 */
export function parseInviteClipboard(text) {
  const raw = String(text || '').trim();
  if (!raw) return {};

  let signalUrl;
  let codeRaw;

  try {
    const j = JSON.parse(raw);
    if (j && typeof j === 'object') {
      if (typeof j.signalUrl === 'string') signalUrl = normalizeSignalUrl(j.signalUrl);
      if (typeof j.code === 'string') codeRaw = String(j.code).replace(/\D/g, '').slice(0, 8);
    }
  } catch {
    /* 非 JSON */
  }

  const sigLabel = raw.match(/信令地址:\s*(\S+)/i);
  if (sigLabel) signalUrl = normalizeSignalUrl(sigLabel[1]);

  if (!signalUrl) {
    const sigAlt = raw.match(/(?:signal|signalUrl)\s*[:：]\s*(\S+)/i);
    if (sigAlt) signalUrl = normalizeSignalUrl(sigAlt[1]);
  }

  if (!signalUrl) {
    const m = raw.match(/(wss?:\/\/[^\s]+)/);
    if (m) signalUrl = normalizeSignalUrl(m[1]);
  }

  const codeLabel = raw.match(/控制码:\s*([\d\s]+)/i);
  if (codeLabel) codeRaw = codeLabel[1].replace(/\D/g, '').slice(0, 8);

  if (!codeRaw) {
    const codeAlt = raw.match(/(?:^|\n)\s*code\s*[:：]\s*([\d\s]+)/im);
    if (codeAlt) codeRaw = codeAlt[1].replace(/\D/g, '').slice(0, 8);
  }

  if (!codeRaw) {
    const lines = raw.split(/\r?\n/).map((l) => l.trim());
    const digitLine = lines.find((l) => /^\d[\d\s]*$/.test(l) && l.replace(/\D/g, '').length >= 4);
    if (digitLine) codeRaw = digitLine.replace(/\D/g, '').slice(0, 8);
  }

  if (!codeRaw) {
    const d = raw.replace(/\D/g, '');
    const hasWs = /wss?:\/\//i.test(raw);
    /** 含 ws URL 时避免把 IP/端口里的数字误当成控制码 */
    if (!hasWs && d.length >= 8) codeRaw = d.slice(0, 8);
    else if (!hasWs && d.length >= 4) codeRaw = d;
  }

  if (signalUrl) signalUrl = normalizeSignalUrl(signalUrl);
  return {
    signalUrl: signalUrl || undefined,
    codeRaw: codeRaw || undefined,
  };
}
