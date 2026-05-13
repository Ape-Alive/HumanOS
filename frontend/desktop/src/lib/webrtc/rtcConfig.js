/** 默认 STUN（仅做 NAT 反射，不转发媒体）；跨复杂网络需配置 TURN（见主进程 HUMANOS_ICE_SERVERS） */
const DEFAULT_ICE_SERVERS = /** @type {RTCIceServer[]} */ ([
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
    ],
  },
]);

/** @returns {RTCConfiguration} */
export function getRtcConfiguration() {
  return {
    iceServers: [...DEFAULT_ICE_SERVERS],
    iceCandidatePoolSize: 10,
  };
}

/**
 * 合并主进程环境变量中的额外 ICE（通常为 TURN），供 Electron 下跨网段 / 非对称 NAT 使用。
 * @returns {Promise<RTCConfiguration>}
 */
export async function resolveRtcConfiguration() {
  const base = getRtcConfiguration();
  /** @type {RTCIceServer[]} */
  let extra = [];
  try {
    if (typeof window !== 'undefined' && window.humanos?.getRtcIceServers) {
      const r = await window.humanos.getRtcIceServers();
      if (Array.isArray(r)) extra = /** @type {RTCIceServer[]} */ (r);
    }
  } catch {
    /* ignore */
  }
  return {
    iceServers: [...base.iceServers, ...extra],
    iceCandidatePoolSize: 10,
  };
}
