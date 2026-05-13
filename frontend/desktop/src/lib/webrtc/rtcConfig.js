/** STUN；私网直连依赖 Chromium「IP 处理策略」（见 electron-main：force-webrtc-ip-handling-policy） */
export function getRtcConfiguration() {
  return {
    iceServers: [
      {
        urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
      },
    ],
    iceCandidatePoolSize: 0,
  };
}
