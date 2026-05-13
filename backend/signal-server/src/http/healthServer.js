'use strict';

/**
 * Minimal HTTP surface for health checks and load balancers.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
function handleRequest(req, res) {
  if (req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
}

module.exports = { handleRequest };
