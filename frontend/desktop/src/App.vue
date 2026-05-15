<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, shallowRef } from 'vue';
import {
  Monitor,
  Settings,
  Play,
  Square,
  History,
  Zap,
  User,
  ShieldCheck,
  ExternalLink,
  FileText,
  Eye,
  ChevronRight,
  Command,
  Activity,
  LogOut,
  ChevronLeft,
  Search,
  CheckCircle2,
  AlertCircle,
  Copy,
  Plus,
  RefreshCw,
  Share2,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-vue-next';
import { useRemoteSession } from '@/composables/useRemoteSession.js';
import { createAiAgentRunner } from '@/composables/useAiAgentOrchestrator.js';
import {
  loadAiControlStore,
  saveAiControlStore,
  getActiveProfile,
  makeAiProfileId,
  AI_CONTROL_DEFAULTS,
  GEMINI_API_DEFAULT_BASE,
} from '@/lib/config/aiControlSettings.js';

const aiPanelOpen = ref(true);
const aiStatus = ref(/** @type {'idle'|'planning'|'executing'|'success'|'error'} */ ('idle'));
const aiTaskGoal = ref('');
const lastReportMarkdown = ref('');
/** @type {import('vue').ShallowRef<ReturnType<typeof createAiAgentRunner> | null>} */
const aiAgentRunner = shallowRef(null);
const logs = ref(/** @type {{ time: string, text: string }[]} */ ([]));

function addLog(msg) {
  logs.value = [{ time: new Date().toLocaleTimeString(), text: msg }, ...logs.value];
}

/** 多套 AI 配置 + 当前选用 id（localStorage） */
const aiStore = ref(loadAiControlStore());
const activeAiProfile = computed(() => getActiveProfile(aiStore.value));
const aiHasApiKey = computed(() => (activeAiProfile.value?.apiKey || '').length > 0);

const aiSettingsOpen = ref(false);
/** @type {import('vue').Ref<{ id: string, name: string, provider: 'openai-compatible'|'gemini', apiBaseUrl: string, model: string, maxRounds: number, apiKeyDraft: string, clearKey: boolean, _keySnap: string }[]>} */
const aiModalRows = ref([]);
const aiModalEditId = ref('');
const aiModalActiveId = ref('');

function hydrateAiModalFromStore() {
  const s = loadAiControlStore();
  aiModalActiveId.value = s.activeProfileId;
  aiModalEditId.value = s.activeProfileId;
  aiModalRows.value = s.profiles.map((p) => ({
    id: p.id,
    name: p.name,
    provider: p.provider === 'gemini' ? 'gemini' : 'openai-compatible',
    apiBaseUrl: p.apiBaseUrl,
    model: p.model,
    maxRounds: p.maxRounds,
    apiKeyDraft: '',
    clearKey: false,
    _keySnap: p.apiKey,
  }));
}

function openAiSettings() {
  hydrateAiModalFromStore();
  aiSettingsOpen.value = true;
}

function closeAiSettings() {
  aiSettingsOpen.value = false;
}

function addAiModalProfile() {
  const id = makeAiProfileId();
  const n = aiModalRows.value.length + 1;
  aiModalRows.value = [
    ...aiModalRows.value,
    {
      id,
      name: `配置 ${n}`,
      provider: 'openai-compatible',
      apiBaseUrl: AI_CONTROL_DEFAULTS.apiBaseUrl,
      model: AI_CONTROL_DEFAULTS.model,
      maxRounds: AI_CONTROL_DEFAULTS.maxRounds,
      apiKeyDraft: '',
      clearKey: false,
      _keySnap: '',
    },
  ];
  aiModalEditId.value = id;
}

function removeAiModalProfile() {
  if (aiModalRows.value.length <= 1) return;
  const rem = aiModalEditId.value;
  const next = aiModalRows.value.filter((r) => r.id !== rem);
  aiModalRows.value = next;
  if (aiModalActiveId.value === rem) aiModalActiveId.value = next[0].id;
  aiModalEditId.value = next[0].id;
}

function requestClearApiKeyForRow(row) {
  row.clearKey = true;
  row.apiKeyDraft = '';
}

function saveAiSettingsFromModal() {
  const profiles = aiModalRows.value.map((r) => {
    let apiKey = r._keySnap;
    if (r.apiKeyDraft.trim()) apiKey = r.apiKeyDraft.trim();
    else if (r.clearKey) apiKey = '';
    const isGem = r.provider === 'gemini';
    const apiBaseUrl =
      r.apiBaseUrl.trim() || (isGem ? GEMINI_API_DEFAULT_BASE : AI_CONTROL_DEFAULTS.apiBaseUrl);
    const model =
      r.model.trim() || (isGem ? 'gemini-2.0-flash' : AI_CONTROL_DEFAULTS.model);
    return {
      id: r.id,
      name: r.name.trim() || '未命名',
      provider: isGem ? 'gemini' : 'openai-compatible',
      apiBaseUrl,
      apiKey,
      model,
      maxRounds: Math.min(100, Math.max(1, Math.floor(Number(r.maxRounds)) || 10)),
    };
  });
  let activeProfileId = aiModalActiveId.value;
  if (!profiles.some((p) => p.id === activeProfileId)) activeProfileId = profiles[0].id;
  saveAiControlStore({ activeProfileId, profiles });
  aiStore.value = loadAiControlStore();
  aiSettingsOpen.value = false;
  addLog('AI: 已保存多套能力配置');
}

/** Copilot 中切换当前使用的配置（立即写入 localStorage） */
function setSessionAiProfile(profileId) {
  const s = loadAiControlStore();
  if (!s.profiles.some((p) => p.id === profileId)) return;
  saveAiControlStore({ ...s, activeProfileId: profileId });
  aiStore.value = loadAiControlStore();
}

const copilotProfileId = computed({
  get: () => aiStore.value.activeProfileId,
  set: (id) => {
    if (typeof id === 'string' && id) setSessionAiProfile(id);
  },
});

const aiTaskRunning = computed(() => aiStatus.value === 'planning' || aiStatus.value === 'executing');

/** 控制端侧栏：可安全发起视觉任务的前置条件 */
const aiCopilotBlockedReason = computed(() => {
  if (mode.value !== 'session') return '请先进入远程会话';
  if (webrtcPcState.value !== 'connected') return '等待 WebRTC 连接为 connected';
  if (!remoteVideoHasTrack.value) return '等待远程视频画面';
  if (!remoteControlReady.value) return '等待控制通道 DataChannel 打开';
  return '';
});

const aiCopilotCanStart = computed(() => !aiCopilotBlockedReason.value);

const rs = useRemoteSession({ addLog });

const {
  mode,
  controlCodeDisplay,
  isAgentRunning,
  controllerCodeDisplay,
  signalServerConnected,
  sessionBannerCode,
  webrtcPcState,
  controllerDialInProgress,
  remoteVideoRef,
  remoteVideoHasTrack,
  remoteControlReady,
  videoStatsLine,
  signalWsUrl,
  inviteHint,
  agentSignalLocal,
  agentLocalSignalDisplay,
  refreshInviteHint,
  toggleAgentService,
  connectController,
  enterSessionFromRecent,
  goSelect: rsGoSelect,
  goAgent: rsGoAgent,
  goController: rsGoController,
  onControllerInput,
  onControllerPaste,
  copyCode,
  copyAgentInvite,
  onRemotePointerDown,
  onRemotePointerMove,
  onRemotePointerUp,
  onRemoteWheel,
  onRemoteKeyDown,
  onRemoteKeyUp,
  onRemoteCompositionEnd,
  requestRemoteSwitchCapture,
  recentControllerDevices,
} = rs;

function resetAiUi() {
  aiPanelOpen.value = true;
  aiStatus.value = 'idle';
  logs.value = [];
  lastReportMarkdown.value = '';
}

function goSelect() {
  aiSettingsOpen.value = false;
  aiAgentRunner.value?.cancel();
  rsGoSelect();
  resetAiUi();
}

function goAgent() {
  rsGoAgent();
  aiPanelOpen.value = true;
  aiStatus.value = 'idle';
  logs.value = [];
  addLog('[System] Ready to signal…');
  addLog('[System] Waiting for command');
  void refreshDisplaySpec();
}

/** 主屏分辨率（Electron 主进程） */
const primaryDisplaySpec = ref(
  /** @type {{ width: number; height: number; scaleFactor: number } | null} */ (null)
);
let agentLoadPollId = 0;

async function refreshDisplaySpec() {
  try {
    if (typeof window !== 'undefined' && window.humanos?.getPrimaryDisplaySpec) {
      primaryDisplaySpec.value = await window.humanos.getPrimaryDisplaySpec();
    }
  } catch {
    primaryDisplaySpec.value = null;
  }
}

const displaySpecLine = computed(() => {
  const s = primaryDisplaySpec.value;
  if (!s?.width) return '检测中…';
  const pxW = Math.round(s.width * (s.scaleFactor || 1));
  const pxH = Math.round(s.height * (s.scaleFactor || 1));
  return `${pxW}×${pxH} @ ~60FPS`;
});

const AGENT_CAPTURE_STORAGE_KEY = 'humanos_agent_screen_capture';

/** @type {import('vue').Ref<'primary'|'all_try'|'source'>} */
const agentShareMode = ref('primary');
const agentShareSourceId = ref('');
/** @type {import('vue').Ref<Record<string, unknown> | null>} */
const agentPreflight = ref(null);
const agentPreflightLoading = ref(false);

function loadAgentSharePrefs() {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(AGENT_CAPTURE_STORAGE_KEY);
    if (!raw) return;
    const j = JSON.parse(raw);
    if (j.mode === 'primary' || j.mode === 'all_try' || j.mode === 'source') agentShareMode.value = j.mode;
    if (typeof j.sourceId === 'string') agentShareSourceId.value = j.sourceId;
  } catch {
    /* ignore */
  }
}

function persistAgentSharePrefs() {
  try {
    const o = {
      mode: agentShareMode.value,
      sourceId: agentShareMode.value === 'source' ? agentShareSourceId.value : '',
    };
    localStorage.setItem(AGENT_CAPTURE_STORAGE_KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}

async function runAgentCapturePreflight() {
  agentPreflightLoading.value = true;
  try {
    const hp = typeof window !== 'undefined' ? window.humanos?.getScreenCapturePreflight : null;
    if (typeof hp !== 'function') {
      agentPreflight.value = { ok: false, noApi: true, hasSources: true, shouldBlockStart: false };
      return;
    }
    agentPreflight.value = await hp();
    const list = /** @type {{ id: string, name: string }[]} */ (
      Array.isArray(agentPreflight.value?.sources) ? agentPreflight.value.sources : []
    );
    if (list.length && !agentShareSourceId.value) {
      agentShareSourceId.value = list[0].id;
    }
  } catch (e) {
    agentPreflight.value = {
      ok: false,
      hasSources: false,
      shouldBlockStart: true,
      error: String(/** @type {{ message?: string }} */ (e)?.message || e),
    };
  } finally {
    agentPreflightLoading.value = false;
  }
}

const agentPreflightSummary = computed(() => {
  const pf = agentPreflight.value;
  if (!pf) return '尚未检测。启动前请先点击「检测屏幕采集权限」或启动时将自动检测。';
  if (pf.noApi) return '当前环境无法检测（缺少 Electron preload），将直接尝试启动。';
  const st = String(pf.screenAccessStatus || 'unknown');
  const srcN = Array.isArray(pf.sources) ? pf.sources.length : 0;
  const stZh =
    st === 'granted'
      ? '已授权'
      : st === 'denied'
        ? '已拒绝'
        : st === 'not-determined'
          ? '未决定（首次可能弹系统授权）'
          : st === 'restricted'
            ? '受限制'
            : st;
  return `系统屏幕权限：${stZh}；可枚举显示器：${srcN} 个。`;
});

async function onAgentToggleServiceClick() {
  if (isAgentRunning.value) {
    await toggleAgentService();
    return;
  }
  await runAgentCapturePreflight();
  const pf = agentPreflight.value;
  if (pf && pf.noApi !== true && pf.shouldBlockStart) {
    if (pf.denied) {
      addLog(
        '受控端: 系统已拒绝「屏幕录制」权限。请在 macOS「系统设置 → 隐私与安全性 → 屏幕录制」中勾选本应用（Electron），完全退出后重开。',
      );
    } else {
      addLog(
        '受控端: 未检测到可用显示器采集源。请先在「系统设置 → 隐私与安全性 → 屏幕录制」中允许本应用，再点「检测屏幕采集权限」确认有显示器后再启动。',
      );
    }
    return;
  }
  if (agentShareMode.value === 'source' && !agentShareSourceId.value) {
    addLog('受控端: 请在「指定显示器」下选择一个显示器，或先执行「检测屏幕采集权限」加载列表。');
    return;
  }
  persistAgentSharePrefs();
  await toggleAgentService();
}

const agentLogLines = computed(() => [...logs.value].reverse().slice(-80));

const systemLoadLabel = ref('NORMAL');
const systemLoadTone = ref(/** @type {'ok'|'warn'|'bad'} */ ('ok'));

function updateSystemLoad() {
  if (mode.value !== 'agent') return;
  const mem = typeof performance !== 'undefined' && performance.memory;
  if (mem && mem.jsHeapSizeLimit > 0) {
    const ratio = mem.usedJSHeapSize / mem.jsHeapSizeLimit;
    if (ratio > 0.94) {
      systemLoadLabel.value = 'HIGH';
      systemLoadTone.value = 'bad';
      return;
    }
    if (ratio > 0.82) {
      systemLoadLabel.value = 'ELEVATED';
      systemLoadTone.value = 'warn';
      return;
    }
  }
  systemLoadLabel.value = 'NORMAL';
  systemLoadTone.value = 'ok';
}

const agentWaitStatus = computed(() => {
  if (!isAgentRunning.value) return '等待启动…';
  if (!signalServerConnected.value) return '正在连接信令…';
  if (webrtcPcState.value === 'connected') return '控制端已接入';
  if (['failed', 'disconnected', 'closed'].includes(String(webrtcPcState.value)))
    return '会话已中断';
  return '等待控制端连接…';
});

const agentWaitDotClass = computed(() => {
  if (!isAgentRunning.value) return 'bg-slate-600';
  if (!signalServerConnected.value) return 'bg-amber-500 animate-pulse';
  if (webrtcPcState.value === 'connected') return 'bg-emerald-500';
  if (['failed', 'disconnected', 'closed'].includes(String(webrtcPcState.value))) return 'bg-red-500';
  return 'bg-sky-500 animate-pulse';
});

watch(
  () => mode.value,
  (m, prev) => {
    if (prev === 'session' && m !== 'session') {
      aiAgentRunner.value?.cancel();
    }
    if (agentLoadPollId) {
      clearInterval(agentLoadPollId);
      agentLoadPollId = 0;
    }
    if (m === 'agent') {
      updateSystemLoad();
      agentLoadPollId = window.setInterval(updateSystemLoad, 5000);
      void refreshDisplaySpec();
      loadAgentSharePrefs();
    }
  }
);

/** 远程投屏区域（全屏 API 挂载节点） */
const remoteStageRootRef = ref(/** @type {HTMLElement | null} */ (null));
const remoteStageFs = ref(false);

function syncRemoteStageFs() {
  const el = remoteStageRootRef.value;
  const v = remoteVideoRef.value;
  remoteStageFs.value =
    !!el &&
    (document.fullscreenElement === el ||
      document.fullscreenElement === v ||
      // Safari 旧版
      /** @type {{ webkitFullscreenElement?: Element | null }} */ (document).webkitFullscreenElement === el ||
      /** @type {{ webkitFullscreenElement?: Element | null }} */ (document).webkitFullscreenElement === v);
}

function onDocFullscreenChange() {
  syncRemoteStageFs();
}

onMounted(() => {
  aiStore.value = loadAiControlStore();
  document.addEventListener('fullscreenchange', onDocFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onDocFullscreenChange);
  aiAgentRunner.value = createAiAgentRunner({
    addLog,
    getProfile: () => activeAiProfile.value,
    getVideoEl: () => remoteVideoRef.value,
    sendControl: (cmd) => rs.sendRemoteControl(cmd),
    isControlReady: () => rs.isRemoteControlReady(),
    getSessionOk: () => mode.value === 'session',
    onStatus: (s) => {
      aiStatus.value = s;
    },
    onReportReady: (markdown) => {
      lastReportMarkdown.value = markdown;
    },
  });
});

async function toggleRemoteFullscreen() {
  const stage = remoteStageRootRef.value;
  const video = remoteVideoRef.value;
  const fsEl =
    document.fullscreenElement ||
    /** @type {{ webkitFullscreenElement?: Element | null }} */ (document).webkitFullscreenElement;
  try {
    if (fsEl && (fsEl === stage || fsEl === video)) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else
        /** @type {{ webkitExitFullscreen?: () => Promise<void> }} */ (document).webkitExitFullscreen?.();
      return;
    }
    if (!document.fullscreenEnabled && !/** @type {{ webkitFullscreenEnabled?: boolean }} */ (document).webkitFullscreenEnabled) {
      addLog('全屏: 当前环境未开启全屏能力，请更新应用或检查 Electron 权限配置');
      return;
    }
    if (stage?.requestFullscreen) {
      await stage.requestFullscreen({ navigationUI: 'hide' });
      return;
    }
    if (video?.requestFullscreen) {
      await video.requestFullscreen({ navigationUI: 'hide' });
      return;
    }
    addLog('全屏: 未找到可全屏的投屏节点');
  } catch (e) {
    const msg = String(/** @type {{ message?: string }} */ (e)?.message || e);
    addLog(`全屏失败: ${msg}（Electron 需在主进程允许 fullscreen 权限）`);
    try {
      const v = video;
      if (v && /** @type {{ webkitRequestFullscreen?: () => void }} */ (v).webkitRequestFullscreen) {
        /** @type {{ webkitRequestFullscreen?: () => void }} */ (v).webkitRequestFullscreen();
      }
    } catch {
      /* ignore */
    }
  }
}

onBeforeUnmount(() => {
  aiAgentRunner.value?.cancel();
  if (agentLoadPollId) clearInterval(agentLoadPollId);
  document.removeEventListener('fullscreenchange', onDocFullscreenChange);
  document.removeEventListener('webkitfullscreenchange', onDocFullscreenChange);
});

function goController() {
  aiAgentRunner.value?.cancel();
  rsGoController();
  resetAiUi();
}

function disconnectSession() {
  aiAgentRunner.value?.cancel();
  rs.disconnectSession();
  resetAiUi();
}

async function runAiTask() {
  if (!aiHasApiKey.value) {
    addLog('AI: 当前所选配置未填写 API Key，请在左侧齿轮中编辑并保存');
    return;
  }
  if (mode.value !== 'session') {
    addLog('AI: 请先进入「远程会话」并连接成功后再开始任务');
    return;
  }
  if (!aiCopilotCanStart.value) {
    addLog(`AI: 暂不可开始 — ${aiCopilotBlockedReason.value || '请稍候'}`);
    return;
  }
  if (aiStatus.value === 'planning' || aiStatus.value === 'executing') {
    addLog('AI: 已有任务在运行，请先停止或等待结束');
    return;
  }
  const runner = aiAgentRunner.value;
  if (!runner) {
    addLog('AI: 编排器未初始化');
    return;
  }
  lastReportMarkdown.value = '';
  const p = activeAiProfile.value;
  addLog(
    `AI: 使用配置 [${p.name}] ${p.provider === 'gemini' ? 'Gemini' : 'OpenAI 兼容'} ${p.model} @ ${String(p.apiBaseUrl || '').replace(/\/$/, '')}`,
  );
  await runner.run(aiTaskGoal.value);
}

function cancelAiTask() {
  aiAgentRunner.value?.cancel();
}

const aiReportExportOpen = ref(false);

function openAiReportExportModal() {
  if (!lastReportMarkdown.value) {
    addLog('报告: 暂无可导出内容');
    return;
  }
  aiReportExportOpen.value = true;
}

function closeAiReportExportModal() {
  aiReportExportOpen.value = false;
}

/** @param {'markdown'|'word'|'pdf'|'preview-pdf'} format */
async function runAiReportExport(format) {
  const md = lastReportMarkdown.value;
  if (!md || typeof window === 'undefined' || !window.humanos?.exportTestReport) {
    addLog('报告: 无可导出内容或不在 Electron 环境');
    closeAiReportExportModal();
    return;
  }
  try {
    const r = await window.humanos.exportTestReport({
      format,
      content: md,
      defaultFilename: `humanos-ai-report-${Date.now()}`,
    });
    if (r?.canceled) addLog('报告: 已取消');
    else if (r?.ok && r.path) {
      if (r.preview) addLog(`报告: 已生成临时 PDF 并在系统查看器中打开\n${r.path}`);
      else addLog(`报告已保存: ${r.path}`);
    } else addLog(`报告导出失败: ${r?.error || 'unknown'}`);
  } catch (e) {
    addLog(`报告导出异常: ${String(/** @type {{message?:string}} */ (e)?.message || e)}`);
  } finally {
    closeAiReportExportModal();
  }
}

</script>

<template>
  <!-- 模式选择 -->
  <div
    v-if="mode === 'select'"
    class="flex min-h-full flex-col items-center justify-center bg-slate-950 p-6 font-sans text-white"
  >
    <div class="grid w-full max-w-4xl grid-cols-1 gap-8 md:grid-cols-2">
      <div class="col-span-full mb-8 text-center">
        <h1 class="mb-2 flex items-center justify-center gap-3 text-4xl font-bold tracking-tight">
          <div class="rounded-xl bg-blue-600 p-2 shadow-[0_0_20px_rgba(37,99,235,0.4)]">
            <Monitor :size="32" />
          </div>
          AI Remote Desktop
        </h1>
        <p class="text-lg text-slate-400">WebRTC P2P 高性能远程桌面系统</p>
      </div>

      <button
        type="button"
        class="group relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 p-8 text-left transition-all hover:border-blue-500/50"
        @click="goAgent"
      >
        <div
          class="absolute right-0 top-0 p-8 opacity-10 transition-all group-hover:scale-110 group-hover:opacity-20"
        >
          <ShieldCheck :size="120" />
        </div>
        <div class="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600/10 text-blue-500">
          <ShieldCheck :size="28" />
        </div>
        <h2 class="mb-3 text-2xl font-semibold">我要被控 (Agent)</h2>
        <p class="mb-6 leading-relaxed text-slate-400">
          生成唯一的控制码，允许信任的人员或 AI 自动化脚本远程访问您的桌面。
        </p>
        <div class="flex items-center font-medium text-blue-500 transition-all group-hover:gap-2">
          开始设置
          <ChevronRight :size="18" />
        </div>
      </button>

      <button
        type="button"
        class="group relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 p-8 text-left transition-all hover:border-indigo-500/50"
        @click="goController"
      >
        <div
          class="absolute right-0 top-0 p-8 opacity-10 transition-all group-hover:scale-110 group-hover:opacity-20"
        >
          <Command :size="120" />
        </div>
        <div class="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600/10 text-indigo-500">
          <Command :size="28" />
        </div>
        <h2 class="mb-3 text-2xl font-semibold">控制远程 (Controller)</h2>
        <p class="mb-6 leading-relaxed text-slate-400">
          输入对端控制码，建立 WebRTC 极速连接。支持手动操作与 AI 视觉自动化。
        </p>
        <div class="flex items-center font-medium text-indigo-500 transition-all group-hover:gap-2">
          进入控制台
          <ChevronRight :size="18" />
        </div>
      </button>
    </div>
  </div>

  <!-- 被控端：左侧菜单 + 远程受控终端（图一布局） -->
  <div
    v-else-if="mode === 'agent'"
    class="flex min-h-full overflow-hidden bg-[#070b14] font-sans text-slate-100"
  >
    <div
      class="flex w-16 shrink-0 flex-col items-center gap-8 border-r border-slate-800 bg-slate-900 py-6"
    >
      <button
        type="button"
        class="text-slate-500 transition-colors hover:text-white"
        title="返回"
        @click="goSelect"
      >
        <ChevronLeft :size="24" />
      </button>
      <div class="rounded-lg bg-blue-500/10 p-2 text-blue-500" title="被控端">
        <Monitor :size="24" />
      </div>
      <div class="cursor-pointer text-slate-500 hover:text-white" title="最近（预留）">
        <History :size="24" />
      </div>
    </div>

    <div class="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div class="w-full min-w-0 px-3 pb-8 pt-6 sm:px-4">
        <div
          class="grid w-full min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(240px,30vw)_minmax(0,1fr)] lg:items-start lg:gap-5"
        >
        <!-- 左栏：状态 / IP / 日志 -->
        <aside class="space-y-4 lg:sticky lg:top-8 lg:self-start">
          <div
            class="flex h-[80vh] max-h-[80vh] flex-col rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/95 to-slate-950/95 px-4 py-5 shadow-xl shadow-black/40 sm:px-5"
          >
            <div class="mb-5 shrink-0 flex items-center gap-2.5">
              <div class="rounded-xl bg-blue-600/20 p-2 text-blue-400">
                <ShieldCheck :size="22" />
              </div>
              <h2 class="text-base font-bold tracking-tight text-white">远程受控终端</h2>
            </div>

            <div class="mb-5 shrink-0 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5">
              <div class="flex items-center gap-2 text-xs text-slate-400">
                <Activity :size="16" class="text-slate-500" />
                <span>系统负载</span>
              </div>
              <span
                class="rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide"
                :class="
                  systemLoadTone === 'ok'
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : systemLoadTone === 'warn'
                      ? 'bg-amber-500/15 text-amber-400'
                      : 'bg-rose-500/15 text-rose-400'
                "
                >{{ systemLoadLabel }}</span
              >
            </div>

            <div class="mb-5 shrink-0">
              <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                局域网 IP
              </div>
              <div class="mt-1 font-mono text-sm text-white">
                {{ inviteHint.lanIpv4 || '—' }}
              </div>
            </div>

            <div class="flex min-h-0 flex-1 flex-col">
              <div class="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                实时日志
              </div>
              <div
                class="mt-2 min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-800/80 bg-black/50 p-2 font-mono text-[10px] leading-relaxed text-slate-300"
              >
                <div v-for="(row, idx) in agentLogLines" :key="idx" class="whitespace-pre-wrap break-all">
                  <span class="text-slate-500">[{{ row.time }}]</span> {{ row.text }}
                </div>
                <div v-if="!agentLogLines.length" class="text-slate-600">暂无日志</div>
              </div>
            </div>

            <div class="mt-4 shrink-0 flex items-start gap-2 border-t border-slate-800/80 pt-4">
              <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full" :class="agentWaitDotClass" />
              <div>
                <div class="text-sm font-medium text-slate-200">{{ agentWaitStatus }}</div>
                <p class="mt-1 text-[11px] leading-relaxed text-slate-500">
                  启动受控服务后，其他端可通过控制码安全接入您的屏幕。
                </p>
              </div>
            </div>
          </div>
        </aside>

        <!-- 主区 -->
        <div class="space-y-5">
          <div
            class="rounded-2xl border border-slate-800/90 bg-slate-900/40 p-6 shadow-lg shadow-black/20"
          >
            <label class="text-[11px] font-bold uppercase tracking-widest text-slate-500"
              >信令服务器地址</label
            >
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                class="rounded-lg px-4 py-2 text-xs font-semibold transition-colors"
                :class="
                  agentSignalLocal
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                    : 'border border-slate-700 bg-slate-950 text-slate-400 hover:text-white'
                "
                @click="agentSignalLocal = true"
              >
                本地模式
              </button>
              <button
                type="button"
                class="rounded-lg px-4 py-2 text-xs font-semibold transition-colors"
                :class="
                  !agentSignalLocal
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                    : 'border border-slate-700 bg-slate-950 text-slate-400 hover:text-white'
                "
                @click="agentSignalLocal = false"
              >
                中继模式
              </button>
            </div>

            <div class="relative mt-4">
              <template v-if="agentSignalLocal">
                <input
                  readonly
                  type="text"
                  :value="agentLocalSignalDisplay"
                  class="w-full rounded-xl border border-slate-700 bg-slate-950/80 py-3 pl-4 pr-12 font-mono text-sm text-slate-200"
                />
                <button
                  type="button"
                  class="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white"
                  title="重新检测本机地址"
                  @click="refreshInviteHint()"
                >
                  <RefreshCw :size="16" />
                </button>
              </template>
              <template v-else>
                <input
                  v-model="signalWsUrl"
                  type="text"
                  spellcheck="false"
                  class="w-full rounded-xl border border-slate-700 bg-slate-950/80 py-3 pl-4 pr-12 font-mono text-sm text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                  placeholder="ws://服务器IP:8787/ws"
                />
                <button
                  type="button"
                  class="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white"
                  title="刷新显示（中继地址以输入为准）"
                  @click="refreshInviteHint()"
                >
                  <RefreshCw :size="16" />
                </button>
              </template>
            </div>
            <p v-if="agentSignalLocal && inviteHint.lanIpv4" class="mt-2 text-xs text-slate-500">
              本机局域网 IPv4：<span class="font-mono text-slate-300">{{ inviteHint.lanIpv4 }}</span>
            </p>
            <p v-else-if="!agentSignalLocal" class="mt-2 text-xs text-slate-500">
              中继模式：填写运行信令服务机器的 <span class="font-mono text-slate-400">ws://…/ws</span> 地址。
            </p>
            <p v-else class="mt-2 text-xs text-slate-500">
              未枚举到局域网 IP 时请确认已联网；可点右侧刷新或使用「中继模式」。
            </p>
          </div>

          <div
            class="relative overflow-hidden rounded-2xl border border-slate-800/90 bg-gradient-to-br from-slate-900/90 to-slate-950 p-8 shadow-inner"
          >
            <div class="text-[11px] font-bold uppercase tracking-widest text-slate-500">本机验证码</div>
            <div class="mt-4 flex items-center justify-between gap-4">
              <span class="font-mono text-4xl font-bold tracking-[0.2em] text-white sm:text-5xl">{{
                controlCodeDisplay
              }}</span>
              <button
                type="button"
                class="shrink-0 rounded-xl border border-slate-700 p-3 text-slate-400 transition-colors hover:border-blue-500/50 hover:bg-blue-500/10 hover:text-blue-400"
                title="复制验证码"
                @click="copyCode"
              >
                <Copy :size="22" />
              </button>
            </div>
            <p class="mt-4 text-xs text-slate-500">
              验证码在停止并再次启动受控服务后会更新；运行期间保持不变。
            </p>
          </div>

          <button
            type="button"
            class="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-500/25 bg-blue-500/10 py-3.5 text-sm font-semibold text-blue-300 transition-colors hover:bg-blue-500/20"
            @click="copyAgentInvite"
          >
            <Share2 :size="18" />
            复制完整连接信息
          </button>

          <div
            v-if="!isAgentRunning"
            class="space-y-3 rounded-2xl border border-slate-800/90 bg-slate-900/50 p-4"
          >
            <div class="text-[11px] font-bold uppercase tracking-wider text-slate-500">屏幕共享范围</div>
            <p class="text-xs leading-relaxed text-slate-500">
              启动前会检测系统是否允许采集显示器。多屏时可只共享主屏、指定一块屏，或在全部候选显示器上依次尝试（不裁剪窗口内区域；选显示器即共享该屏全画面）。
            </p>
            <button
              type="button"
              class="w-full rounded-xl border border-slate-600 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              :disabled="agentPreflightLoading"
              @click="runAgentCapturePreflight"
            >
              {{ agentPreflightLoading ? '检测中…' : '检测屏幕采集权限' }}
            </button>
            <p class="text-xs leading-relaxed text-slate-400">{{ agentPreflightSummary }}</p>
            <div class="space-y-2 text-sm text-slate-200">
              <label class="flex cursor-pointer items-start gap-2">
                <input v-model="agentShareMode" type="radio" value="primary" class="mt-1" />
                <span>仅主显示器（推荐，自动选排序第一的桌面源）</span>
              </label>
              <label class="flex cursor-pointer items-start gap-2">
                <input v-model="agentShareMode" type="radio" value="all_try" class="mt-1" />
                <span>全部显示器依次尝试（多屏时自动换源直到成功）</span>
              </label>
              <label class="flex cursor-pointer items-start gap-2">
                <input v-model="agentShareMode" type="radio" value="source" class="mt-1" />
                <span>指定显示器</span>
              </label>
            </div>
            <div v-if="agentShareMode === 'source'" class="pt-1">
              <select
                v-model="agentShareSourceId"
                class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="" disabled>请先检测权限以加载列表</option>
                <option v-for="s in agentPreflight?.sources || []" :key="s.id" :value="s.id">
                  {{ s.name || s.id }}
                </option>
              </select>
            </div>
          </div>

          <button
            type="button"
            class="flex w-full items-center justify-center gap-3 rounded-2xl py-4 text-lg font-bold shadow-lg transition-all"
            :class="
              isAgentRunning
                ? 'border border-rose-500/40 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20'
                : 'bg-blue-600 text-white shadow-blue-600/25 hover:bg-blue-500'
            "
            @click="onAgentToggleServiceClick"
          >
            <template v-if="isAgentRunning">
              <Square :size="22" fill="currentColor" />
              停止受控服务
            </template>
            <template v-else>
              <Play :size="22" fill="currentColor" />
              启动受控服务
            </template>
          </button>
          <p class="text-center text-xs leading-relaxed text-slate-500">
            请先在本机或局域网内启动信令服务（如仓库根目录
            <code class="rounded bg-slate-800 px-1 py-0.5 font-mono text-[10px] text-slate-400"
              >npm run dev:signal</code
            >），再启动受控服务。连接后屏幕将共享给控制端。
          </p>

          <div class="grid gap-4 sm:grid-cols-2">
            <div
              class="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/50 px-4 py-4"
            >
              <div class="rounded-lg bg-slate-800 p-2 text-slate-300">
                <Monitor :size="20" />
              </div>
              <div>
                <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500">显示设置</div>
                <div class="mt-0.5 text-sm font-semibold text-slate-200">{{ displaySpecLine }}</div>
              </div>
            </div>
            <div
              class="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/50 px-4 py-4"
            >
              <div class="rounded-lg bg-slate-800 p-2 text-slate-300">
                <Settings :size="20" />
              </div>
              <div>
                <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500">安全级别</div>
                <div class="mt-0.5 text-sm font-semibold text-emerald-400/90">AES-256 E2EE ENABLED</div>
              </div>
            </div>
          </div>

          <div
            class="flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-slate-800/80 pt-5 text-xs text-slate-500"
          >
            <div class="flex items-center gap-2">
              <span
                class="h-2 w-2 rounded-full"
                :class="signalServerConnected ? 'bg-emerald-500' : 'bg-slate-600'"
              />
              信令服务器: {{ signalServerConnected ? '已连接' : '未连接' }}
            </div>
            <div class="flex items-center gap-2">
              <span
                class="h-2 w-2 rounded-full"
                :class="
                  webrtcPcState === 'connected'
                    ? 'bg-emerald-500'
                    : webrtcPcState === 'failed' ||
                        webrtcPcState === 'disconnected' ||
                        webrtcPcState === 'closed'
                      ? 'bg-rose-500'
                      : 'bg-sky-500'
                "
              />
              WebRTC: {{ webrtcPcState }}
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  </div>

  <!-- 控制端 -->
  <div
    v-else-if="mode === 'controller'"
    class="flex h-screen max-h-screen min-h-0 overflow-hidden bg-slate-950 font-sans text-white"
  >
    <div
      class="flex w-16 flex-col items-center gap-8 border-r border-slate-800 bg-slate-900 py-6"
    >
      <button
        type="button"
        class="text-slate-500 transition-colors hover:text-white"
        @click="goSelect"
      >
        <ChevronLeft :size="24" />
      </button>
      <div class="rounded-lg bg-indigo-500/10 p-2 text-indigo-500">
        <Command :size="24" />
      </div>
      <div class="cursor-pointer text-slate-500 hover:text-white">
        <History :size="24" />
      </div>
      <button
        type="button"
        class="mt-auto text-slate-500 transition-colors hover:text-white"
        title="配置 AI（模型、API Key、接口地址）"
        @click="openAiSettings"
      >
        <Settings :size="24" />
      </button>
    </div>

    <div class="mx-auto flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden p-10">
      <div class="mb-8 shrink-0 flex items-end justify-between">
        <div>
          <h1 class="mb-2 text-3xl font-bold">远程控制中心</h1>
          <p class="text-slate-400">输入控制码快速建立 P2P 极速连接</p>
        </div>
        <div class="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-2">
          <div class="rounded-xl bg-indigo-500/10 p-2 text-indigo-500">
            <User :size="20" />
          </div>
          <div class="pr-4">
            <div class="text-xs font-bold uppercase tracking-wider text-slate-500">当前用户</div>
            <div class="text-sm font-semibold">Administrator</div>
          </div>
        </div>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-12 gap-8 overflow-hidden">
        <div class="col-span-12 flex min-h-0 flex-col gap-6 overflow-hidden lg:col-span-8">
          <div class="shrink-0 rounded-[2rem] border border-slate-800 bg-slate-900 p-8 shadow-xl">
            <label class="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-500"
              >信令地址</label
            >
            <input
              v-model="signalWsUrl"
              type="text"
              spellcheck="false"
              class="mb-6 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
              placeholder="ws://127.0.0.1:8787/ws"
            />
            <p class="mb-4 text-xs text-slate-500">
              若从被控端复制了整段「连接信息」，在下方控制码框内 <strong class="text-slate-400">粘贴</strong> 即可自动填入信令与控制码。
            </p>
            <div class="flex items-center gap-4">
              <div class="relative flex-1">
                <Search
                  class="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-slate-500"
                  :size="24"
                />
                <input
                  type="text"
                  placeholder="输入 8 位远程控制码或粘贴连接信息…"
                  class="w-full rounded-2xl border border-slate-800 bg-slate-950 py-5 pl-14 pr-6 font-mono text-2xl transition-all focus:border-indigo-500 focus:outline-none"
                  :value="controllerCodeDisplay"
                  @input="onControllerInput"
                  @paste="onControllerPaste"
                />
              </div>
              <button
                type="button"
                class="flex h-[74px] items-center gap-2 rounded-2xl bg-indigo-600 px-10 text-lg font-bold text-white shadow-lg shadow-indigo-600/20 transition-all hover:bg-indigo-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="controllerDialInProgress"
                @click="connectController"
              >
                <Zap :size="20" fill="currentColor" />
                <span v-if="controllerDialInProgress">连接中…</span>
                <span v-else>建立连接</span>
              </button>
            </div>
            <div class="mt-4 space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs">
              <div class="flex flex-wrap items-center gap-2 text-slate-300">
                <span v-if="controllerDialInProgress" class="font-semibold text-amber-400">正在建立会话…</span>
                <span v-if="signalServerConnected" class="text-emerald-400/90">信令 WebSocket 已打开</span>
                <span v-else-if="controllerDialInProgress" class="text-slate-500">
                  信令 WebSocket 尚未打开（请看下方日志里的 HTTP /health 探测：失败＝本机到该 IP:端口不通或信令未启动）
                </span>
              </div>
              <p class="leading-relaxed text-slate-500">
                若长时间停在「连接中」，请看下方日志：应有「信令: 已连接」→「房间已就绪」。只有前者没有后者时，多为控制码不一致、或控制端连的不是被控端正在用的那台信令服务。
              </p>
              <div
                class="max-h-44 overflow-y-auto rounded-lg border border-slate-800/80 bg-black/40 px-3 py-2 font-mono text-[11px] text-slate-400"
              >
                <div v-for="(row, idx) in agentLogLines" :key="idx" class="whitespace-pre-wrap break-all">
                  {{ row.time }} {{ row.text }}
                </div>
                <div v-if="!agentLogLines.length" class="text-slate-600">暂无日志</div>
              </div>
            </div>
          </div>

          <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            <h3 class="flex shrink-0 items-center gap-2 px-2 text-lg font-semibold">
              <History :size="18" class="text-slate-500" />
              最近连接
            </h3>
            <div
              class="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/40 p-4"
            >
              <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div
                  v-for="device in recentControllerDevices"
                  :key="device.id"
                  class="group flex cursor-pointer items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/50 p-5 transition-all hover:bg-slate-900"
                  @click="enterSessionFromRecent(device.id)"
                >
                  <div class="flex min-w-0 flex-1 items-center gap-4">
                    <div
                      class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                      :class="
                        device.status === 'online'
                          ? 'bg-green-500/10 text-green-500'
                          : 'bg-slate-800 text-slate-500'
                      "
                    >
                      <Monitor :size="24" />
                    </div>
                    <div class="min-w-0">
                      <div class="truncate font-bold">{{ device.name }}</div>
                      <div class="truncate text-xs text-slate-500">
                        {{ device.codeDisplay }} · {{ device.time }}
                      </div>
                    </div>
                  </div>
                  <div
                    class="flex shrink-0 items-center gap-2 opacity-0 transition-all group-hover:opacity-100"
                  >
                    <span class="rounded-lg p-2 text-indigo-500 hover:bg-indigo-500/20">
                      <Zap :size="20" />
                    </span>
                  </div>
                </div>
                <div
                  class="flex cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-slate-800 p-5 text-slate-500 transition-all hover:border-slate-700"
                >
                  <Plus :size="24" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="col-span-12 min-h-0 space-y-6 overflow-y-auto lg:col-span-4">
          <div class="rounded-[2rem] border border-indigo-500/20 bg-indigo-600/5 p-8">
            <div class="mb-4 flex items-center gap-3 text-indigo-400">
              <Zap :size="24" />
              <h3 class="text-lg font-bold">AI 自动化加持</h3>
            </div>
            <p class="mb-6 text-sm leading-relaxed text-slate-400">
              建立连接后，您可以启用内置的 AI 视觉引擎。系统将自动理解屏幕内容并执行复杂的业务流程。
            </p>
            <p class="mb-4 text-xs text-slate-500">左侧齿轮可添加多套 AI（模型 / Key / 端点），连接后在侧栏切换。</p>
            <ul class="space-y-3 text-sm">
              <li class="flex items-start gap-3">
                <CheckCircle2 :size="16" class="mt-1 flex-shrink-0 text-indigo-500" />
                <span>视觉精准定位元素坐标</span>
              </li>
              <li class="flex items-start gap-3">
                <CheckCircle2 :size="16" class="mt-1 flex-shrink-0 text-indigo-500" />
                <span>自然语言描述任务指令</span>
              </li>
              <li class="flex items-start gap-3">
                <CheckCircle2 :size="16" class="mt-1 flex-shrink-0 text-indigo-500" />
                <span>自动生成结构化执行报告</span>
              </li>
            </ul>
          </div>

          <div class="rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <h4 class="mb-4 text-xs font-bold uppercase tracking-widest text-slate-500">安全提示</h4>
            <div
              class="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs leading-relaxed text-amber-500/80"
            >
              <AlertCircle :size="16" class="flex-shrink-0" />
              请勿随意向不可信的人员分享您的控制码，本系统 P2P 连接虽然加密，但物理控制权极高。
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 远程会话 -->
  <div v-else-if="mode === 'session'" class="relative flex h-full min-h-0 overflow-hidden bg-black font-sans text-white">
    <div
      class="flex w-16 shrink-0 flex-col items-center gap-8 border-r border-slate-800 bg-slate-900 py-6"
    >
      <button
        type="button"
        title="返回首页（将断开当前远程连接）"
        class="text-slate-500 transition-colors hover:text-white"
        @click="goSelect"
      >
        <ChevronLeft :size="24" />
      </button>
      <div class="rounded-lg bg-indigo-500/10 p-2 text-indigo-500" title="远程会话">
        <Command :size="24" />
      </div>
      <div class="cursor-pointer text-slate-500 hover:text-white" title="记录（预留）">
        <History :size="24" />
      </div>
      <button
        type="button"
        class="mt-auto text-slate-500 transition-colors hover:text-white"
        title="配置 AI（模型、API Key）"
        @click="openAiSettings"
      >
        <Settings :size="24" />
      </button>
    </div>

    <div class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-950">
      <div
        class="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-slate-700/50 bg-slate-900/80 p-1.5 shadow-2xl backdrop-blur-md"
      >
        <div class="flex items-center gap-2 border-r border-slate-700 px-4">
          <div
            class="h-2 w-2 rounded-full"
            :class="
              webrtcPcState === 'connected'
                ? 'bg-green-500'
                : webrtcPcState === 'failed'
                  ? 'bg-red-500'
                  : 'animate-pulse bg-amber-500'
            "
          />
          <span class="font-mono text-xs font-bold">{{ sessionBannerCode }}</span>
          <span class="text-[10px] text-slate-500">· {{ webrtcPcState }}</span>
        </div>
        <button
          type="button"
          title="切换远程画面源：被控端将弹出共享选择，请选「整个屏幕」或真实显示器（勿选 OBS Virtual Camera）"
          class="rounded-xl p-2 text-slate-400 transition-all hover:bg-slate-800 hover:text-white"
          @click="requestRemoteSwitchCapture"
        >
          <RefreshCw :size="18" />
        </button>
        <button
          type="button"
          class="rounded-xl p-2 text-slate-400 transition-all hover:bg-slate-800 hover:text-white"
        >
          <ShieldCheck :size="18" />
        </button>
        <button
          type="button"
          title="配置 AI（模型、API Key）"
          class="rounded-xl p-2 text-slate-400 transition-all hover:bg-slate-800 hover:text-white"
          @click="openAiSettings"
        >
          <Settings :size="18" />
        </button>
        <button
          type="button"
          class="flex items-center gap-2 rounded-xl bg-red-500/10 px-4 py-1.5 text-xs font-bold text-red-500 transition-all hover:bg-red-500 hover:text-white"
          @click="disconnectSession"
        >
          <LogOut :size="16" />
          断开
        </button>
      </div>

      <div class="flex min-h-0 flex-1 flex-col items-center gap-3 px-4 pb-3 pt-20 sm:px-6">
        <div
          ref="remoteStageRootRef"
          class="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-slate-800 bg-black shadow-[0_0_100px_rgba(0,0,0,0.5)] [&:fullscreen]:max-h-none [&:fullscreen]:flex-1 [&:fullscreen]:rounded-none"
        >
          <video
            ref="remoteVideoRef"
            class="absolute inset-0 z-10 h-full w-full cursor-crosshair object-cover bg-black"
            autoplay
            playsinline
            tabindex="0"
            @mousedown="onRemotePointerDown"
            @mousemove="onRemotePointerMove"
            @mouseup="onRemotePointerUp"
            @mouseleave="onRemotePointerUp"
            @wheel.prevent="onRemoteWheel"
            @keydown="onRemoteKeyDown"
            @keyup="onRemoteKeyUp"
            @compositionend="onRemoteCompositionEnd"
          />
          <div
            v-if="!remoteVideoHasTrack"
            class="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center gap-2 bg-slate-950/85 text-slate-500"
          >
            <Monitor :size="40" class="opacity-40" />
            <span class="text-sm">等待远程画面…</span>
          </div>

          <div
            v-if="aiTaskRunning"
            class="pointer-events-none absolute left-[60%] top-[40%] z-30 h-16 w-32 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-lg border-2 border-blue-500"
          >
            <div
              class="absolute -top-6 left-0 rounded bg-blue-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white"
            >
              AI 运行中
            </div>
          </div>

          <div
            class="absolute bottom-6 left-6 z-20 rounded bg-black/40 px-2 py-1 font-mono text-[10px] text-slate-500 backdrop-blur"
          >
            {{ videoStatsLine }}
          </div>
        </div>

        <div class="flex shrink-0 flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            class="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-white"
            @click="toggleRemoteFullscreen"
          >
            <Maximize2 v-if="!remoteStageFs" :size="18" />
            <Minimize2 v-else :size="18" />
            {{ remoteStageFs ? '退出全屏' : '全屏观看' }}
          </button>
          <span class="text-center text-xs text-slate-500">
            被控端约 15fps，优先保证分辨率；画面铺满窗口（上下或左右可能被裁切少许）；全屏可减少缩放模糊
          </span>
        </div>
      </div>
    </div>

    <div
      v-if="aiPanelOpen"
      class="flex w-[400px] shrink-0 flex-col overflow-hidden border-l border-slate-800 bg-slate-900 transition-all duration-500"
    >
      <div class="flex shrink-0 flex-col border-b border-slate-800 p-6">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="rounded-xl bg-blue-600 p-2">
              <Zap :size="20" fill="white" class="text-white" />
            </div>
            <h2 class="text-lg font-bold">AI Vision Copilot</h2>
          </div>
          <button
            type="button"
            class="text-slate-500 hover:text-white"
            @click="aiPanelOpen = false"
          >
            <LogOut :size="20" class="rotate-180" />
          </button>
        </div>
      </div>

      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div class="flex-1 space-y-6 overflow-y-auto p-6">
          <div class="space-y-4">
            <label class="text-xs font-bold uppercase tracking-widest text-slate-500">任务描述</label>
            <textarea
              v-model="aiTaskGoal"
              :disabled="aiTaskRunning"
              class="min-h-[100px] w-full rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              placeholder="例如：自动打开浏览器，进入登录页面并使用管理员账号登录..."
            />
            <p class="text-[11px] leading-relaxed text-slate-500">
              流程：配置 API（齿轮）→ 填写目标 → 每轮截取远程画面 → 规划步骤 → 经 DataChannel 执行 →
              <strong class="font-medium text-slate-400">轮末截图验收</strong>
              → 循环直至通过或达最大轮次。请使用支持<strong class="font-medium text-slate-400">视觉</strong>的模型（如
              gpt-4o、gpt-4o-mini、<span class="font-medium text-slate-400">gemini-2.0-flash</span>）。
            </p>
            <p v-if="aiCopilotBlockedReason" class="text-[11px] leading-relaxed text-amber-500/90">
              {{ aiCopilotBlockedReason }}，「开始 AI 任务」已禁用。
            </p>
            <div class="grid grid-cols-2 gap-3">
              <div class="rounded-xl border border-slate-800 bg-slate-950 p-3">
                <label class="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500"
                  >执行模型</label
                >
                <select
                  v-model="copilotProfileId"
                  :disabled="aiTaskRunning"
                  class="w-full cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs font-medium text-white focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option v-for="p in aiStore.profiles" :key="p.id" :value="p.id">
                    {{ p.name }} — {{ p.provider === 'gemini' ? 'Gemini' : 'OpenAI' }} · {{ p.model }}
                  </option>
                </select>
              </div>
              <div class="rounded-xl border border-slate-800 bg-slate-950 p-3">
                <div class="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">最大轮次</div>
                <div class="text-xs font-medium">{{ activeAiProfile.maxRounds }} Steps</div>
              </div>
            </div>
          </div>

          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <label class="text-xs font-bold uppercase tracking-widest text-slate-500">执行日志</label>
              <div v-if="aiTaskRunning" class="flex items-center gap-2 text-xs text-blue-500">
                <Activity :size="14" class="animate-spin" />
                运行中
              </div>
              <div v-else-if="aiStatus === 'success'" class="flex items-center gap-2 text-xs text-green-500">
                <CheckCircle2 :size="14" />
                已完成
              </div>
              <div v-else-if="aiStatus === 'error'" class="flex items-center gap-2 text-xs text-red-400">
                <AlertCircle :size="14" />
                未通过或异常
              </div>
              <div v-else class="text-xs text-slate-500">空闲</div>
            </div>

            <div
              class="flex h-64 flex-col gap-3 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs"
            >
              <div
                v-if="logs.length === 0"
                class="flex h-full items-center justify-center italic text-slate-700"
              >
                等待任务开始...
              </div>
              <div v-for="(log, i) in logs" :key="i" class="flex gap-3">
                <span class="shrink-0 text-slate-600">{{ log.time }}</span>
                <span
                  :class="
                    log.text.includes('任务完成')
                      ? 'text-green-500'
                      : log.text.includes('AI:')
                        ? 'text-blue-400'
                        : 'text-slate-300'
                  "
                  >{{ log.text }}</span
                >
              </div>
            </div>
          </div>
        </div>

        <div class="shrink-0 space-y-4 border-t border-slate-800 bg-slate-950 p-6">
          <button
            v-if="lastReportMarkdown"
            type="button"
            class="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 py-3 text-sm font-bold text-white transition-all hover:bg-slate-700"
            @click="openAiReportExportModal"
          >
            <ExternalLink :size="16" />
            导出测试报告
          </button>
          <div class="flex gap-2">
            <button
              v-if="aiTaskRunning"
              type="button"
              class="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-600 py-3 text-sm font-bold text-slate-200 transition-all hover:bg-slate-800"
              @click="cancelAiTask"
            >
              <Square :size="16" />
              停止
            </button>
            <button
              type="button"
              class="flex flex-1 items-center justify-center gap-2 rounded-2xl py-4 text-lg font-bold shadow-lg transition-all"
              :disabled="aiTaskRunning || !aiCopilotCanStart"
              :title="aiTaskRunning ? '任务进行中' : aiCopilotBlockedReason || '开始 AI 任务'"
              :class="
                aiTaskRunning || !aiCopilotCanStart
                  ? 'cursor-not-allowed border border-slate-700 bg-slate-800/50 text-slate-500'
                  : 'bg-blue-600 text-white shadow-blue-600/20 hover:bg-blue-700 active:scale-95'
              "
              @click="runAiTask"
            >
              <template v-if="aiTaskRunning"> AI 运行中… </template>
              <template v-else>
                <Play :size="20" fill="currentColor" />
                开始 AI 任务
              </template>
            </button>
          </div>
        </div>
      </div>
    </div>

    <button
      v-if="!aiPanelOpen"
      type="button"
      class="absolute right-6 top-1/2 z-40 flex h-24 w-12 -translate-y-1/2 items-center justify-center rounded-l-2xl bg-blue-600 text-white shadow-2xl transition-all hover:bg-blue-700"
      @click="aiPanelOpen = true"
    >
      <ChevronLeft :size="24" />
    </button>
  </div>

  <Teleport to="body">
    <div
      v-if="aiSettingsOpen"
      class="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-settings-title"
      @click.self="closeAiSettings"
    >
      <div
        class="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl"
        @click.stop
      >
        <div class="flex shrink-0 items-center justify-between border-b border-slate-800 px-5 py-4">
          <h2 id="ai-settings-title" class="text-lg font-bold">AI 能力配置</h2>
          <button
            type="button"
            class="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
            @click="closeAiSettings"
          >
            <X :size="20" />
          </button>
        </div>
        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <p class="text-xs leading-relaxed text-slate-500">
            支持多套配置：OpenAI 兼容网关（Bearer）或 Google Gemini（<code class="text-slate-400">x-goog-api-key</code>）。密钥保存在本机
            localStorage；公共电脑勿填生产 Key。
          </p>
          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <label class="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500"
                >当前任务使用</label
              >
              <select
                v-model="aiModalActiveId"
                class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              >
                <option v-for="r in aiModalRows" :key="r.id" :value="r.id">
                  {{ r.name }} — {{ r.provider === 'gemini' ? 'Gemini' : 'OpenAI' }} · {{ r.model }}
                </option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">编辑详情</label>
              <select
                v-model="aiModalEditId"
                class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              >
                <option v-for="r in aiModalRows" :key="`e-${r.id}`" :value="r.id">{{ r.name }}</option>
              </select>
            </div>
          </div>

          <div v-for="r in aiModalRows" v-show="r.id === aiModalEditId" :key="r.id" class="space-y-3 border-t border-slate-800 pt-4">
            <div>
              <label class="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">配置名称</label>
              <input
                v-model="r.name"
                type="text"
                class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                placeholder="例如：公司网关 / 个人 Key"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">提供方</label>
              <select
                v-model="r.provider"
                class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
              >
                <option value="openai-compatible">OpenAI 兼容（/v1/chat/completions）</option>
                <option value="gemini">Google Gemini（generateContent）</option>
              </select>
              <p v-if="r.provider === 'gemini'" class="mt-1 text-[11px] text-slate-500">
                Base 填 API 根路径，例如 <span class="font-mono text-slate-400">{{ GEMINI_API_DEFAULT_BASE }}</span>；Key 来自
                <a
                  class="text-indigo-400 underline hover:text-indigo-300"
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  >Google AI Studio</a
                >。
              </p>
            </div>
            <div>
              <label class="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">API Base URL</label>
              <input
                v-model="r.apiBaseUrl"
                type="url"
                spellcheck="false"
                class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-sm text-white placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
                :placeholder="r.provider === 'gemini' ? GEMINI_API_DEFAULT_BASE : 'https://api.openai.com/v1'"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">API Key</label>
              <input
                v-model="r.apiKeyDraft"
                type="password"
                autocomplete="off"
                :placeholder="
                  r._keySnap
                    ? '已保存密钥 · 留空不变'
                    : r.provider === 'gemini'
                      ? 'AI Studio API key'
                      : 'sk-...'
                "
                class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-sm text-white placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
              />
              <button
                v-if="r._keySnap && !r.clearKey"
                type="button"
                class="mt-2 text-xs text-amber-400/90 underline hover:text-amber-300"
                @click="requestClearApiKeyForRow(r)"
              >
                清除此配置的密钥
              </button>
              <p v-else-if="r.clearKey" class="mt-2 text-xs text-amber-500">保存后将删除此配置的已存密钥</p>
            </div>
            <div>
              <label class="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">模型 ID</label>
              <input
                v-model="r.model"
                type="text"
                spellcheck="false"
                class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-sm text-white focus:border-indigo-500 focus:outline-none"
                :placeholder="r.provider === 'gemini' ? 'gemini-2.0-flash' : 'gpt-4o'"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">最大轮次</label>
              <input
                v-model.number="r.maxRounds"
                type="number"
                min="1"
                max="100"
                class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div class="flex flex-wrap gap-2 border-t border-slate-800 pt-4">
            <button
              type="button"
              class="flex items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              @click="addAiModalProfile"
            >
              <Plus :size="16" />
              添加配置
            </button>
            <button
              type="button"
              :disabled="aiModalRows.length <= 1"
              class="rounded-xl border border-rose-500/40 px-3 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              @click="removeAiModalProfile"
            >
              删除当前配置
            </button>
          </div>
        </div>
        <div class="flex shrink-0 gap-3 border-t border-slate-800 px-5 py-4">
          <button
            type="button"
            class="flex-1 rounded-xl border border-slate-600 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800"
            @click="closeAiSettings"
          >
            取消
          </button>
          <button
            type="button"
            class="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500"
            @click="saveAiSettingsFromModal"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="aiReportExportOpen"
      class="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-report-export-title"
      @click.self="closeAiReportExportModal"
    >
      <div
        class="w-full max-w-md overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl"
        @click.stop
      >
        <div class="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h2 id="ai-report-export-title" class="text-lg font-bold">导出测试报告</h2>
          <button
            type="button"
            class="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
            @click="closeAiReportExportModal"
          >
            <X :size="20" />
          </button>
        </div>
        <p class="px-5 pt-3 text-xs leading-relaxed text-slate-500">
          Word / PDF 由当前 Markdown 报告转换生成；预览将写入临时目录并用系统默认 PDF 查看器打开。
        </p>
        <div class="grid gap-2 p-5">
          <button
            type="button"
            class="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-left text-sm font-semibold text-white transition-colors hover:border-indigo-500/50 hover:bg-slate-800"
            @click="runAiReportExport('word')"
          >
            <FileText :size="20" class="shrink-0 text-indigo-400" />
            导出 Word（.docx）
          </button>
          <button
            type="button"
            class="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-left text-sm font-semibold text-white transition-colors hover:border-indigo-500/50 hover:bg-slate-800"
            @click="runAiReportExport('pdf')"
          >
            <FileText :size="20" class="shrink-0 text-rose-400" />
            导出 PDF
          </button>
          <button
            type="button"
            class="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-left text-sm font-semibold text-white transition-colors hover:border-indigo-500/50 hover:bg-slate-800"
            @click="runAiReportExport('markdown')"
          >
            <FileText :size="20" class="shrink-0 text-emerald-400" />
            导出 Markdown（.md）
          </button>
          <button
            type="button"
            class="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-left text-sm font-semibold text-white transition-colors hover:border-indigo-500/50 hover:bg-slate-800"
            @click="runAiReportExport('preview-pdf')"
          >
            <Eye :size="20" class="shrink-0 text-sky-400" />
            预览（PDF）
          </button>
        </div>
        <div class="border-t border-slate-800 px-5 py-3">
          <button
            type="button"
            class="w-full rounded-xl border border-slate-600 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800"
            @click="closeAiReportExportModal"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
