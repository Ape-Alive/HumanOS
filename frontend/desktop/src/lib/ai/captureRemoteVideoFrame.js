/**
 * 从远程投屏 <video> 截取当前帧为 JPEG（用于 Vision）。
 * @param {HTMLVideoElement} video
 * @param {{ maxWidth?: number, quality?: number }} [opts]
 * @returns {{ mime: string, base64: string, width: number, height: number, videoWidth: number, videoHeight: number }}
 */
export function captureVideoFrameAsJpeg(video, opts) {
  const maxW = Math.max(320, Math.min(1920, Number(opts?.maxWidth) || 1280));
  const quality = Math.max(0.5, Math.min(0.92, Number(opts?.quality) || 0.72));
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) {
    throw new Error('远程画面尚未就绪（videoWidth/videoHeight 为 0）');
  }
  const scale = Math.min(1, maxW / vw);
  const cw = Math.max(1, Math.round(vw * scale));
  const ch = Math.max(1, Math.round(vh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d 不可用');
  ctx.drawImage(video, 0, 0, cw, ch);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const i = dataUrl.indexOf(',');
  const base64 = i >= 0 ? dataUrl.slice(i + 1) : '';
  if (!base64) throw new Error('截图编码失败');
  return {
    mime: 'image/jpeg',
    base64,
    width: cw,
    height: ch,
    videoWidth: vw,
    videoHeight: vh,
  };
}
