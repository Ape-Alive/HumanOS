/** 与 backend/signal-server 及 frontend/desktop/src/lib/signal/protocol.js 保持同步 */
export const MESSAGE_TYPES = {
  AGENT_REGISTER: 'agent:register',
  CONTROLLER_JOIN: 'controller:join',
  RELAY: 'relay',
  AGENT_REGISTERED: 'agent:registered',
  ROOM_READY: 'room:ready',
  RELAY_FORWARD: 'relay:forward',
  PEER_LEFT: 'peer:left',
  ERROR: 'error',
  /** 客户端 WebRTC 已连通，可关闭信令 WS，DO 将休眠 */
  SIGNALING_COMPLETE: 'signaling:complete',
  SIGNALING_CLOSED: 'signaling:closed',
};
