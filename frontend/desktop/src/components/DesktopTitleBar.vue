<script setup>
import { Minus, Maximize2, X } from 'lucide-vue-next';

import appIconUrl from '../../build/icon.png';

defineProps({
  maximized: { type: Boolean, default: false },
});

const emit = defineEmits(['minimize', 'toggle-maximize', 'close']);
</script>

<template>
  <header
    class="desktop-titlebar flex h-11 shrink-0 select-none items-stretch border-b border-slate-800/90 bg-[#0c1220] text-slate-200"
    @dblclick="emit('toggle-maximize')"
  >
    <div class="titlebar-drag flex min-w-0 flex-1 items-center gap-2.5 pl-4">
      <img
        :src="appIconUrl"
        alt=""
        class="titlebar-no-drag h-[18px] w-[18px] shrink-0 rounded-[5px] object-cover"
        width="18"
        height="18"
        draggable="false"
      />
      <span class="truncate text-[13px] font-semibold tracking-wide text-slate-200">HumanOS</span>
    </div>

    <div class="titlebar-no-drag flex shrink-0 items-stretch">
      <button
        type="button"
        class="flex w-[52px] items-center justify-center text-slate-300 transition-colors hover:bg-slate-800/80 hover:text-white"
        title="最小化"
        aria-label="最小化"
        @click="emit('minimize')"
      >
        <Minus :size="16" :stroke-width="2.75" />
      </button>
      <button
        type="button"
        class="flex w-[52px] items-center justify-center text-slate-300 transition-colors hover:bg-slate-800/80 hover:text-white"
        :title="maximized ? '还原' : '最大化'"
        :aria-label="maximized ? '还原' : '最大化'"
        @click="emit('toggle-maximize')"
      >
        <Maximize2 v-if="!maximized" :size="15" :stroke-width="2.75" />
        <svg
          v-else
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 14 14"
          class="h-4 w-4"
          fill="none"
          stroke="currentColor"
          stroke-width="2.25"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3.5" y="3.5" width="7" height="7" rx="0.5" />
          <path d="M5 2.5h6.5V9" />
        </svg>
      </button>
      <button
        type="button"
        class="flex w-[52px] items-center justify-center text-slate-300 transition-colors hover:bg-red-600 hover:text-white"
        title="关闭"
        aria-label="关闭"
        @click="emit('close')"
      >
        <X :size="16" :stroke-width="2.75" />
      </button>
    </div>
  </header>
</template>
