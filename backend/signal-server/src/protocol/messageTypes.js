'use strict';

/** WebSocket JSON message `type` values (client ↔ server). */
module.exports = {
  // client → server
  AGENT_REGISTER: 'agent:register',
  CONTROLLER_JOIN: 'controller:join',
  RELAY: 'relay',

  // server → client
  AGENT_REGISTERED: 'agent:registered',
  ROOM_READY: 'room:ready',
  RELAY_FORWARD: 'relay:forward',
  PEER_LEFT: 'peer:left',
  ERROR: 'error',
  SIGNALING_COMPLETE: 'signaling:complete',
  SIGNALING_CLOSED: 'signaling:closed',
};
