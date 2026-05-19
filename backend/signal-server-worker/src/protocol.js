/** @readonly */
export const T = {
  AGENT_REGISTER: 'agent:register',
  CONTROLLER_JOIN: 'controller:join',
  RELAY: 'relay',
  AGENT_REGISTERED: 'agent:registered',
  ROOM_READY: 'room:ready',
  RELAY_FORWARD: 'relay:forward',
  PEER_LEFT: 'peer:left',
  ERROR: 'error',
  /** 客户端 P2P 已连通，可释放信令 */
  CLIENT_P2P_READY: 'client:p2p-ready',
  /** 服务端通知双方关闭信令 WebSocket */
  SIGNAL_DONE: 'signal:done',
};
