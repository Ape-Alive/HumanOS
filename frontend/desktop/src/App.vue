<script setup>
import { ref } from 'vue';
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
  resetAiUi();
}

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

const recentDevices = [
  { id: '83921122', name: 'Dev-Ubuntu-01', time: '10分钟前', status: 'online' },
  { id: '44521099', name: 'Design-MacBook', time: '昨天', status: 'offline' },
];
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

  <!-- 被控端 -->
  <div v-else-if="mode === 'agent'" class="flex min-h-full bg-slate-950 font-sans text-white">
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
      <div class="rounded-lg bg-blue-500/10 p-2 text-blue-500">
        <Monitor :size="24" />
      </div>
      <div class="cursor-pointer text-slate-500 hover:text-white">
        <History :size="24" />
      </div>
      <div class="mt-auto cursor-pointer text-slate-500 hover:text-white">
        <Settings :size="24" />
      </div>
    </div>

    <div class="flex flex-1 flex-col items-center justify-center p-12">
      <div
        class="relative w-full max-w-md overflow-hidden rounded-[2.5rem] border border-slate-800 bg-slate-900 p-10 shadow-2xl"
      >
        <div
          class="absolute left-0 top-0 h-1 w-full transition-all duration-1000"
          :class="
            !isAgentRunning
              ? 'bg-blue-500'
              : webrtcPcState === 'connected'
                ? 'bg-emerald-500'
                : webrtcPcState === 'failed' ||
                    webrtcPcState === 'disconnected' ||
                    webrtcPcState === 'closed'
                  ? 'bg-amber-500'
                  : 'bg-green-500'
          "
        />

        <div class="mb-10 text-center">
          <div
            class="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl shadow-lg transition-all duration-500"
            :class="
              !isAgentRunning
                ? 'bg-blue-600 shadow-blue-500/20'
                : webrtcPcState === 'connected'
                  ? 'bg-emerald-500 shadow-emerald-500/25'
                  : webrtcPcState === 'failed' ||
                      webrtcPcState === 'disconnected' ||
                      webrtcPcState === 'closed'
                    ? 'bg-amber-600 shadow-amber-500/20'
                    : 'bg-green-500 shadow-green-500/20'
            "
          >
            <ShieldCheck v-if="!isAgentRunning" :size="40" class="text-white" />
            <CheckCircle2
              v-else-if="webrtcPcState === 'connected'"
              :size="40"
              class="text-white"
            />
            <AlertCircle
              v-else-if="
                webrtcPcState === 'failed' ||
                webrtcPcState === 'disconnected' ||
                webrtcPcState === 'closed'
              "
              :size="40"
              class="text-white"
            />
            <Activity v-else :size="40" class="animate-pulse text-white" />
          </div>
          <h1 class="mb-2 text-2xl font-bold">被控端模式</h1>
          <p class="text-slate-400">
            <template v-if="!isAgentRunning">
              请先在本机启动信令服务（仓库根目录执行 <code class="rounded bg-slate-800 px-1 py-0.5 text-xs">npm run dev:signal</code>），再点击下方「启动服务」。
            </template>
            <template v-else-if="webrtcPcState === 'connected'">
              控制端已接入，WebRTC 已连接；桌面画面正在共享给对方。
            </template>
            <template
              v-else-if="
                webrtcPcState === 'failed' ||
                webrtcPcState === 'disconnected' ||
                webrtcPcState === 'closed'
              "
            >
              会话已结束或中断（{{ webrtcPcState }}）。控制端断开后可再次用同一控制码连接。
            </template>
            <template v-else-if="webrtcPcState === 'connecting'">
              正在与控制端建立加密通道…
            </template>
            <template v-else>正在等待控制端连接…（信令已就绪）</template>
          </p>
        </div>

        <div class="relative mb-8 rounded-2xl border border-slate-800 bg-slate-950 p-6 pt-5">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span class="text-xs font-bold uppercase tracking-widest text-slate-500">信令地址</span>
            <div class="flex shrink-0 rounded-lg border border-slate-700 bg-slate-900 p-0.5">
              <button
                type="button"
                class="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
                :class="agentSignalLocal ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'"
                @click="agentSignalLocal = true"
              >
                本机
              </button>
              <button
                type="button"
                class="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
                :class="!agentSignalLocal ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'"
                @click="agentSignalLocal = false"
              >
                远程
              </button>
            </div>
          </div>

          <template v-if="agentSignalLocal">
            <div class="flex gap-2">
              <input
                readonly
                type="text"
                :value="agentLocalSignalDisplay"
                class="min-w-0 flex-1 cursor-default rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 font-mono text-sm text-slate-200"
              />
              <button
                type="button"
                class="shrink-0 rounded-lg border border-slate-600 px-2 py-2 text-xs text-slate-300 hover:bg-slate-800"
                title="重新检测本机局域网地址"
                @click="refreshInviteHint()"
              >
                刷新
              </button>
            </div>
            <p v-if="inviteHint.lanIpv4 && inviteHint.lanIpv4 !== '127.0.0.1'" class="mt-2 text-xs text-slate-400">
              本机局域网 IPv4：<span class="font-mono text-slate-200">{{ inviteHint.lanIpv4 }}</span>
            </p>
            <p v-else-if="inviteHint.lanIpv4 === '127.0.0.1'" class="mt-2 text-xs text-slate-500">
              未找到可用的局域网 IPv4，已使用回环地址 <span class="font-mono text-slate-300">127.0.0.1</span>（适合本机测试）。跨电脑请连接 Wi‑Fi/网线，或改用「远程」填写运行信令那台机的
              <span class="font-mono text-slate-400">ws://局域网IP:端口/ws</span>。
            </p>
            <p v-else-if="inviteHint.suggestedUrl" class="mt-2 text-xs text-slate-500">
              已获取信令地址；本机未枚举到局域网 IPv4（可能为远程环境变量信令或仅虚拟网卡）。
            </p>
            <p v-else class="mt-2 text-xs text-slate-500">
              正在获取网络信息…若一直无显示，请点击「刷新」；请确认使用 Electron 打开（浏览器预览无本机网卡信息）。
            </p>
          </template>
          <template v-else>
            <input
              v-model="signalWsUrl"
              type="text"
              spellcheck="false"
              class="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
              placeholder="ws://服务器IP或域名:8787/ws"
            />
            <p class="mt-2 text-xs text-slate-500">
              远程模式：填写运行信令服务机器的 WebSocket 地址，路径须为 <code class="text-slate-600">/ws</code>。
            </p>
          </template>
        </div>

        <div class="relative mb-8 rounded-2xl border border-slate-800 bg-slate-950 p-6">
          <span
            class="absolute -top-2 left-4 bg-slate-950 px-2 text-xs font-bold uppercase tracking-widest text-slate-500"
            >本机控制码</span
          >
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono text-4xl font-bold tracking-wider text-white">{{
              controlCodeDisplay
            }}</span>
            <button
              type="button"
              class="shrink-0 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-blue-400"
              title="仅复制数字控制码"
              @click="copyCode"
            >
              <Copy :size="20" />
            </button>
          </div>
        </div>

        <div class="mb-8 rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <p class="mb-3 text-center text-xs leading-relaxed text-slate-500">
            复制内容包含<strong class="text-slate-400">信令地址</strong>与<strong class="text-slate-400">控制码</strong>，控制端在输入框粘贴即可自动回填。
          </p>
          <button
            type="button"
            class="flex w-full items-center justify-center gap-2 rounded-2xl border border-blue-500/30 bg-blue-500/10 py-3.5 text-sm font-semibold text-blue-400 transition-colors hover:bg-blue-500/20"
            @click="copyAgentInvite"
          >
            <Copy :size="18" />
            复制连接信息
          </button>
        </div>

        <div class="space-y-4">
          <button
            type="button"
            class="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-lg font-bold transition-all"
            :class="
              isAgentRunning
                ? 'border border-red-500/50 bg-red-500/10 text-red-500 hover:bg-red-500/20'
                : 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700'
            "
            @click="toggleAgentService"
          >
            <template v-if="isAgentRunning">
              <Square :size="20" fill="currentColor" />
              停止服务
            </template>
            <template v-else>
              <Play :size="20" fill="currentColor" />
              启动服务
            </template>
          </button>
          <p class="text-center text-xs text-slate-500">
            连接后屏幕将共享给控制端；「信令未连接」时请检查是否已运行信令进程并已点「启动服务」。
          </p>
        </div>
      </div>

      <div class="mt-12 flex items-center gap-6 text-slate-500">
        <div class="flex items-center gap-2">
          <div class="h-2 w-2 rounded-full" :class="signalServerConnected ? 'bg-green-500' : 'bg-slate-600'" />
          信令服务器: {{ signalServerConnected ? '已连接' : '未连接' }}
        </div>
        <div class="flex items-center gap-2">
          <div
            class="h-2 w-2 rounded-full"
            :class="
              webrtcPcState === 'connected'
                ? 'bg-green-500'
                : webrtcPcState === 'failed' || webrtcPcState === 'disconnected'
                  ? 'bg-red-500'
                  : 'bg-blue-500'
            "
          />
          WebRTC: {{ webrtcPcState }}
        </div>
      </div>
    </div>
  </div>

  <!-- 控制端 -->
  <div v-else-if="mode === 'controller'" class="flex min-h-full bg-slate-950 font-sans text-white">
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

    <div class="mx-auto flex w-full max-w-6xl flex-1 flex-col p-10">
      <div class="mb-10 flex items-end justify-between">
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

      <div class="grid grid-cols-12 gap-8">
        <div class="col-span-12 space-y-8 lg:col-span-8">
          <div class="rounded-[2rem] border border-slate-800 bg-slate-900 p-8 shadow-xl">
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

          <div class="space-y-4">
            <h3 class="flex items-center gap-2 px-2 text-lg font-semibold">
              <History :size="18" class="text-slate-500" />
              最近连接
            </h3>
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div
                v-for="device in recentDevices"
                :key="device.id"
                class="group flex cursor-pointer items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/50 p-5 transition-all hover:bg-slate-900"
                @click="enterSessionFromRecent(device.id)"
              >
                <div class="flex items-center gap-4">
                  <div
                    class="flex h-12 w-12 items-center justify-center rounded-xl"
                    :class="
                      device.status === 'online'
                        ? 'bg-green-500/10 text-green-500'
                        : 'bg-slate-800 text-slate-500'
                    "
                  >
                    <Monitor :size="24" />
                  </div>
                  <div>
                    <div class="font-bold">{{ device.name }}</div>
                    <div class="flex items-center gap-1 text-xs text-slate-500">
                      {{ device.id }} · {{ device.time }}
                    </div>
                  </div>
                </div>
                <div class="flex items-center gap-2 opacity-0 transition-all group-hover:opacity-100">
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

        <div class="col-span-12 space-y-6 lg:col-span-4">
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
    <div class="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-slate-950">
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

      <div class="flex h-full w-full items-center justify-center p-8">
        <div
          class="relative aspect-video w-full max-w-5xl overflow-hidden rounded-xl border border-slate-800 bg-black shadow-[0_0_100px_rgba(0,0,0,0.5)]"
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
