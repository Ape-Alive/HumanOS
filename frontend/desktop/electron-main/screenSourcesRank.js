'use strict';

/**
 * 对 desktopCapturer 的 screen 源排序：主屏优先，再按物理显示器面积，再按名称启发式，最后兜底。
 * @param {import('electron').DesktopCapturerSource[]} sources
 * @param {import('electron').Display[]} displays
 * @param {string} primaryId screen.getPrimaryDisplay().id 的字符串形式
 * @returns {import('electron').DesktopCapturerSource[]}
 */
function rankDesktopScreenSources(sources, displays, primaryId) {
  if (!sources?.length) return [];

  /** @param {import('electron').DesktopCapturerSource} s */
  const badName = (s) =>
    /\b(obs|virtual\s*cam|vcam|v_cam|ndi\s*webcam|ndi\s*video|zoom\s*meeting|facetime|face\s*time|droidcam|epoccam|iriun|manycam|continuity|sidecar|手机画面|iphone|虚拟摄像|虚拟相机|webcam|摄像头)\b/i.test(
      String(s.name || '')
    );

  /** @param {import('electron').DesktopCapturerSource} s */
  const displayIdStr = (s) => (s.display_id == null ? '' : String(s.display_id));

  const displayIdSet = new Set(displays.map((d) => String(d.id)));
  const good = sources.filter((s) => !badName(s));
  const use = good.length ? good : sources;

  const area = (idStr) => {
    const d = displays.find((x) => String(x.id) === idStr);
    const w = d?.bounds?.width ?? d?.size?.width ?? 0;
    const h = d?.bounds?.height ?? d?.size?.height ?? 0;
    return (w || 0) * (h || 0);
  };

  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {import('electron').DesktopCapturerSource[]} */
  const out = [];

  /** @param {import('electron').DesktopCapturerSource | undefined} s */
  const take = (s) => {
    if (!s || seen.has(s.id)) return;
    seen.add(s.id);
    out.push(s);
  };

  if (primaryId) {
    take(use.find((s) => displayIdStr(s) && displayIdStr(s) === primaryId));
  }

  const known = use.filter((s) => {
    const id = displayIdStr(s);
    return id && displayIdSet.has(id);
  });
  known.sort((a, b) => area(displayIdStr(b)) - area(displayIdStr(a)));
  if (primaryId) {
    take(known.find((s) => displayIdStr(s) === primaryId));
  }
  for (const k of known) take(k);

  for (const s of use.filter((x) =>
    /entire|整个|full\s*screen|screen\s*\d|display\s*\d|built-?in|retina|主显示器|全屏|desktop\s*\d|内建|內建/i.test(
      String(x.name || '')
    )
  )) {
    take(s);
  }

  for (const s of use) take(s);

  return out;
}

module.exports = { rankDesktopScreenSources };
