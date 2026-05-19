import { Room } from './room.do.js';
import { safeCode } from './roomLogic.js';

export { Room };

export default {
  /**
   * @param {Request} request
   * @param {{ ROOM: DurableObjectNamespace }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health' || url.pathname === '/healthz') {
      return new Response('ok', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    const roomMatch = url.pathname.match(/^\/room\/([^/]+)\/(agent|controller)\/?$/i);
    if (roomMatch) {
      const code = safeCode(roomMatch[1]);
      const role = roomMatch[2].toLowerCase();
      if (!code) {
        return new Response('invalid control code', { status: 400 });
      }

      const id = env.ROOM.idFromName(code);
      const stub = env.ROOM.get(id);
      const headers = new Headers(request.headers);
      headers.set('X-Room-Code', code);
      headers.set('X-Room-Role', role);

      return stub.fetch(
        new Request(request.url, {
          method: request.method,
          headers,
        }),
      );
    }

    if (url.pathname === '/ws' || url.pathname === '/ws/') {
      return new Response(
        'use WebSocket path /room/{code}/agent or /room/{code}/controller (example: /room/842931/agent)',
        { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
      );
    }

    return new Response('not found', { status: 404 });
  },
};
