/** STUN；局域网直连需双方拿到真实 host IP（Electron 主进程已关闭 mDNS 隐藏本地 IP） */
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
