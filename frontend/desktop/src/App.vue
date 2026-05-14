<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
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
} from 'lucide-vue-next';
import { useRemoteSession } from '@/composables/useRemoteSession.js';

const aiPanelOpen = ref(true);
const aiStatus = ref(/** @type {'idle'|'planning'|'executing'|'success'} */ ('idle'));
const logs = ref(/** @type {{ time: string, text: string }[]} */ ([]));

function addLog(msg) {
  logs.value = [{ time: new Date().toLocaleTimeString(), text: msg }, ...logs.value];
}

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
  requestRemoteSwitchCapture,
  recentControllerDevices,
} = rs;

function resetAiUi() {
  aiPanelOpen.value = true;
  aiStatus.value = 'idle';
  logs.value = [];
}

function goSelect() {
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
  (m) => {
    if (agentLoadPollId) {
      clearInterval(agentLoadPollId);
      agentLoadPollId = 0;
    }
    if (m === 'agent') {
      updateSystemLoad();
      agentLoadPollId = window.setInterval(updateSystemLoad, 5000);
      void refreshDisplaySpec();
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
  document.addEventListener('fullscreenchange', onDocFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onDocFullscreenChange);
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
  if (agentLoadPollId) clearInterval(agentLoadPollId);
  document.removeEventListener('fullscreenchange', onDocFullscreenChange);
  document.removeEventListener('webkitfullscreenchange', onDocFullscreenChange);
});

function goController() {
  rsGoController();
  resetAiUi();
}

function disconnectSession() {
  rs.disconnectSession();
  resetAiUi();
}

function runAiTask() {
  aiStatus.value = 'planning';
  addLog('Vision: 正在分析屏幕布局...');

  setTimeout(() => {
    aiStatus.value = 'executing';
    addLog("AI: 找到 '登录' 按钮，坐标 (820, 480)");
    addLog('DataChannel: 执行 Click 操作');
  }, 1500);

  setTimeout(() => {
    addLog('AI: 正在输入管理员账号...');
    addLog("DataChannel: 执行 Input 'admin@example.com'");
  }, 3000);

  setTimeout(() => {
    aiStatus.value = 'success';
    addLog('任务完成: 登录成功 ✅');
  }, 4500);
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
      <div class="mt-auto cursor-pointer text-slate-500 hover:text-white" title="设置（预留）">
        <Settings :size="24" />
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

          <button
            type="button"
            class="flex w-full items-center justify-center gap-3 rounded-2xl py-4 text-lg font-bold shadow-lg transition-all"
            :class="
              isAgentRunning
                ? 'border border-rose-500/40 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20'
                : 'bg-blue-600 text-white shadow-blue-600/25 hover:bg-blue-500'
            "
            @click="toggleAgentService"
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
      <div class="mt-auto cursor-pointer text-slate-500 hover:text-white">
        <Settings :size="24" />
      </div>
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
      <div class="mt-auto cursor-pointer text-slate-500 hover:text-white" title="设置（预留）">
        <Settings :size="24" />
      </div>
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
          class="rounded-xl p-2 text-slate-400 transition-all hover:bg-slate-800 hover:text-white"
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
            class="absolute inset-0 z-10 h-full w-full cursor-crosshair object-contain bg-black"
            autoplay
            playsinline
            tabindex="0"
            @mousedown="onRemotePointerDown"
            @mousemove="onRemotePointerMove"
            @mouseup="onRemotePointerUp"
            @mouseleave="onRemotePointerUp"
            @wheel.prevent="onRemoteWheel"
          />
          <div
            v-if="!remoteVideoHasTrack"
            class="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center gap-2 bg-slate-950/85 text-slate-500"
          >
            <Monitor :size="40" class="opacity-40" />
            <span class="text-sm">等待远程画面…</span>
          </div>

          <div
            v-if="aiStatus === 'executing'"
            class="pointer-events-none absolute left-[60%] top-[40%] z-30 h-16 w-32 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-lg border-2 border-blue-500"
          >
            <div
              class="absolute -top-6 left-0 rounded bg-blue-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white"
            >
              Target: Login Button
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
            被控端约 15fps，优先保证分辨率；全屏可减少缩放模糊
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
              class="min-h-[100px] w-full rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="例如：自动打开浏览器，进入登录页面并使用管理员账号登录..."
            />
            <div class="grid grid-cols-2 gap-3">
              <div class="rounded-xl border border-slate-800 bg-slate-950 p-3">
                <div class="mb-1 text-[10px] font-bold uppercase text-slate-500">执行模型</div>
                <div class="text-xs font-medium">Vision-GPT-4o</div>
              </div>
              <div class="rounded-xl border border-slate-800 bg-slate-950 p-3">
                <div class="mb-1 text-[10px] font-bold uppercase text-slate-500">最大轮次</div>
                <div class="text-xs font-medium">10 Steps</div>
              </div>
            </div>
          </div>

          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <label class="text-xs font-bold uppercase tracking-widest text-slate-500">执行日志</label>
              <div v-if="aiStatus === 'planning' || aiStatus === 'executing'" class="flex items-center gap-2 text-xs text-blue-500">
                <Activity :size="14" class="animate-spin" />
                运行中
              </div>
              <div v-else-if="aiStatus === 'success'" class="flex items-center gap-2 text-xs text-green-500">
                <CheckCircle2 :size="14" />
                已完成
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
            v-if="aiStatus === 'success'"
            type="button"
            class="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 py-3 text-sm font-bold text-white transition-all hover:bg-slate-700"
          >
            <ExternalLink :size="16" />
            生成 PDF 运行报告
          </button>
          <button
            type="button"
            class="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-lg font-bold shadow-lg transition-all"
            :disabled="aiStatus === 'planning' || aiStatus === 'executing'"
            :class="
              aiStatus === 'planning' || aiStatus === 'executing'
                ? 'border border-blue-500/30 bg-blue-600/20 text-blue-400'
                : 'bg-blue-600 text-white shadow-blue-600/20 hover:bg-blue-700 active:scale-95'
            "
            @click="runAiTask"
          >
            <template v-if="aiStatus === 'planning' || aiStatus === 'executing'"> AI 正在思考... </template>
            <template v-else>
              <Play :size="20" fill="currentColor" />
              开始 AI 任务
            </template>
          </button>
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
</template>
