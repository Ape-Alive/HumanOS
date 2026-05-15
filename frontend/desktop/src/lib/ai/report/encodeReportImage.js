/**
 * 将截图 JPEG/PNG base64 转为 WebP data URL，减小报告 Markdown/PDF 体积。
 * 若环境不支持 `canvas.toDataURL('image/webp')`，则回退为缩放后的 JPEG。
 *
 * @param {string} base64 不含 data: 前缀的 base64
 * @param {string} [mime] 如 image/jpeg
 * @param {{ maxWidth?: number, webpQuality?: number, jpegQuality?: number }} [opts]
 * @returns {Promise<{ dataUrl: string, mime: string }>}
 */
export async function toReportWebpDataUrl(base64, mime = 'image/jpeg', opts = {}) {
  const raw = String(base64 || '').replace(/\s/g, '');
  if (!raw) return { dataUrl: '', mime: 'image/jpeg' };

  const maxW = Math.max(480, Math.min(2560, Number(opts.maxWidth) || 1600));
  const webpQ = Math.max(0.5, Math.min(0.95, Number(opts.webpQuality) || 0.82));
  const jpegQ = Math.max(0.55, Math.min(0.95, Number(opts.jpegQuality) || 0.85));

  const srcMime = /^image\//i.test(mime) ? mime : 'image/jpeg';
  const src = `data:${srcMime};base64,${raw}`;

  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return { dataUrl: src, mime: srcMime };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        let tw = img.naturalWidth || img.width;
        let th = img.naturalHeight || img.height;
        if (!(tw > 0) || !(th > 0)) {
          resolve({ dataUrl: src, mime: srcMime });
          return;
        }
        if (tw > maxW) {
          th = Math.max(1, Math.round((th * maxW) / tw));
          tw = maxW;
        }
        const canvas = document.createElement('canvas');
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ dataUrl: src, mime: srcMime });
          return;
        }
        ctx.drawImage(img, 0, 0, tw, th);
        let out = canvas.toDataURL('image/webp', webpQ);
        if (typeof out === 'string' && out.startsWith('data:image/webp')) {
          resolve({ dataUrl: out, mime: 'image/webp' });
          return;
        }
        out = canvas.toDataURL('image/jpeg', jpegQ);
        resolve({ dataUrl: out, mime: 'image/jpeg' });
      } catch {
        resolve({ dataUrl: src, mime: srcMime });
      }
    };
    img.onerror = () => resolve({ dataUrl: src, mime: srcMime });
    img.src = src;
  });
}
