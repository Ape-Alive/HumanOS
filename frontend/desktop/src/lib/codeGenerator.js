/** @returns {string} 8-digit string without spaces */
export function generateControlCodeRaw() {
  const n = Math.floor(10000000 + Math.random() * 90000000);
  return String(n);
}

/** @param {string} raw */
export function formatControlCodeDisplay(raw) {
  const d = String(raw || '').replace(/\D/g, '').slice(0, 8);
  if (d.length <= 4) return d;
  return `${d.slice(0, 4)} ${d.slice(4)}`;
}
