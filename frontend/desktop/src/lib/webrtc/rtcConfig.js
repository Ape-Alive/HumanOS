/** PRD: STUN 默认 + 后续 TURN 扩展 */
export function getRtcConfiguration() {
  return {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    iceCandidatePoolSize: 0,
  };
}
