'use strict';

const { session, desktopCapturer, screen } = require('electron');
const { rankDesktopScreenSources } = require('./screenSourcesRank.js');

/**
 * 拦截渲染进程的 getDisplayMedia，由主进程用 desktopCapturer 选定真实显示器并授权，
 * 避免在 ROOM_READY 等非用户手势场景下系统选取器不弹出 / 立即失败，导致被控端无法出画。
 * @see https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler
 */
function installHumanosDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    void request;
    desktopCapturer
      .getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      })
      .then((sources) => {
        if (!sources.length) {
          console.warn('[HumanOS] getDisplayMedia: desktopCapturer 未返回任何 screen 源（请检查 macOS「屏幕录制」权限）');
          callback({});
          return;
        }
        let primaryId = '';
        try {
          primaryId = String(screen.getPrimaryDisplay().id);
        } catch {
          /* ignore */
        }
        const ranked = rankDesktopScreenSources(sources, screen.getAllDisplays(), primaryId);
        const pick = ranked[0] || sources[0];
        console.log('[HumanOS] getDisplayMedia → 自动授予屏幕源:', pick?.name || pick?.id);
        callback({ video: pick });
      })
      .catch((e) => {
        console.warn('[HumanOS] getDisplayMedia handler 异常:', e);
        callback({});
      });
  });
}

module.exports = { installHumanosDisplayMediaHandler };
