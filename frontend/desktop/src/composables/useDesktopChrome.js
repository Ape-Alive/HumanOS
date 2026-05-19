import { ref, onMounted, onBeforeUnmount } from 'vue';

/**
 * Windows 无边框窗口：自定义标题栏与窗口控制。
 */
export function useDesktopChrome() {
  const showCustomTitleBar = ref(false);
  const maximized = ref(false);

  /** @type {(() => void) | null} */
  let offMaximized = null;

  async function refreshMaximized() {
    try {
      const r = await window.humanos?.windowChrome?.isMaximized?.();
      maximized.value = !!r?.maximized;
    } catch {
      /* ignore */
    }
  }

  function minimize() {
    void window.humanos?.windowChrome?.minimize?.();
  }

  function toggleMaximize() {
    void window.humanos?.windowChrome?.maximize?.().then(() => refreshMaximized());
  }

  function close() {
    void window.humanos?.windowChrome?.close?.();
  }

  onMounted(async () => {
    try {
      const frameless = await window.humanos?.windowChrome?.isFrameless?.();
      showCustomTitleBar.value = !!frameless;
      if (!frameless) return;
      await refreshMaximized();
      offMaximized = window.humanos?.windowChrome?.onMaximizedChange?.((v) => {
        maximized.value = !!v;
      }) ?? null;
    } catch {
      showCustomTitleBar.value = false;
    }
  });

  onBeforeUnmount(() => {
    offMaximized?.();
    offMaximized = null;
  });

  return {
    showCustomTitleBar,
    maximized,
    minimize,
    toggleMaximize,
    close,
  };
}
