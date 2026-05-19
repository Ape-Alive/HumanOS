'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..', '..');
const src = path.join(repoRoot, 'backend', 'signal-server', 'src');
const dest = path.join(__dirname, '..', 'resources', 'signal-server', 'src');

if (!fs.existsSync(src)) {
  console.error('[copy-signal-server] missing', src);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log('[copy-signal-server] copied to', dest);
