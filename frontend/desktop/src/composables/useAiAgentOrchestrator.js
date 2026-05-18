import { captureVideoFrameAsJpeg } from '../lib/ai/captureRemoteVideoFrame.js';
import { createAiProviderAdapter } from '../lib/ai/plugins/openAiVisionChat.js';
import { runVisionScreenUnderstanding } from '../lib/ai/agent/visionModule.js';
import { runPlanner } from '../lib/ai/agent/plannerModule.js';
import {
  extractJsonObject,
  normalizePlannerJson,
  stepToControlCommands,
} from '../lib/ai/agent/actionGenerator.js';
import { runRoundEndAssertion } from '../lib/ai/agent/assertionEngine.js';
import { buildMarkdownReport, buildBatchMarkdownReport } from '../lib/ai/report/buildMarkdownReport.js';
import { toReportWebpDataUrl } from '../lib/ai/report/encodeReportImage.js';
import { splitSubtasksFromDocument } from '../lib/ai/agent/batchSplitModule.js';
import { buildPlannerStagnationHint } from '../lib/ai/agent/plannerStagnationHint.js';
import { shouldCaptureTransientFeedback } from '../lib/ai/agent/transientCaptureTriggers.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {{ readRemoteClipboard?: () => Promise<{ ok: boolean, text: string, error?: string }> }} deps
 * @param {(msg: string) => void} [onFail]
 */
async function readRemoteClipboardSafe(deps, onFail) {
  if (!deps.readRemoteClipboard) {
    onFail?.('AI: 未配置远端剪贴板读取');
    return { ok: false, text: '', error: 'not-configured' };
  }
  try {
    const r = await deps.readRemoteClipboard();
    const ok = !!r?.ok;
    const text = typeof r?.text === 'string' ? r.text : '';
    if (!ok) {
      onFail?.(`AI: 远端剪贴板读取失败${r?.error ? ` — ${r.error}` : ''}`);
    }
    return { ok, text, error: r?.error };
  } catch (e) {
    const msg = String(/** @type {{ message?: string }} */ (e)?.message || e);
    onFail?.(`AI: 远端剪贴板读取异常 — ${msg}`);
    return { ok: false, text: '', error: msg };
  }
}

/**
 * click / Ctrl|Cmd+C 后：早帧 + 更新剪贴板采样（不进报告）
 * @param {{
 *   deps: Parameters<typeof readRemoteClipboardSafe>[0],
 *   getVideoEl: () => HTMLVideoElement | null | undefined,
 *   state: { earlySnap: { base64: string, mime: string } | null, clipboardAfterSteps: string, lastEarlySnap: { base64: string, mime: string } | null },
 *   onFail: (msg: string) => void,
 * }} p
 */
async function sampleAfterTransientAction(p) {
  await sleep(110);
  const snap = captureTransientFrame(p.getVideoEl);
  if (snap?.base64) {
    const frame = { base64: snap.base64, mime: snap.mime };
    p.state.earlySnap = frame;
    p.state.lastEarlySnap = frame;
  }
  const clip = await readRemoteClipboardSafe(p.deps, p.onFail);
  if (clip.ok) p.state.clipboardAfterSteps = clip.text;
}

/**
 * @param {() => HTMLVideoElement | null | undefined} getVideoEl
 * @returns {{ base64: string, mime: string, width: number, height: number, videoWidth: number, videoHeight: number } | null}
 */
function captureTransientFrame(getVideoEl) {
  const v = getVideoEl();
  if (!v?.videoWidth) return null;
  return captureVideoFrameAsJpeg(v, { maxWidth: 1600, quality: 0.76 });
}

/**
 * @param {Record<string, unknown>} cmd
 * @param {(c: Record<string, unknown>) => boolean} sendControl
 * @param {(s: string) => void} addLog
 */
async function dispatchControl(cmd, sendControl, addLog) {
  if (cmd.__wait != null) {
    await sleep(Math.floor(Number(cmd.__wait) || 0));
    return;
  }
  const ok = sendControl(cmd);
  if (!ok) addLog('AI: 控制指令未送达（请确认仍在会话且 DataChannel 已连接）');
  let pause = 90;
  if (cmd.type === 'text') pause = 240;
  else if (cmd.type === 'key') pause = 140;
  else if (cmd.type === 'click') pause = 220;
  else if (cmd.type === 'wheel') pause = 160;
  else if (cmd.type === 'move') pause = 55;
  await sleep(pause);
}

/**
 * @param {{
 *   addLog: (s: string) => void,
 *   getProfile: () => { apiBaseUrl: string, apiKey: string, model: string, provider?: 'openai-compatible'|'gemini', name?: string, id?: string, maxRounds?: number } | null | undefined,
 *   getVideoEl: () => HTMLVideoElement | null | undefined,
 *   sendControl: (cmd: Record<string, unknown>) => boolean,
 *   readRemoteClipboard?: () => Promise<{ ok: boolean, text: string, error?: string }>,
 *   isControlReady: () => boolean,
 *   onStatus: (s: 'idle'|'planning'|'executing'|'success'|'error') => void,
 *   onReportReady: (markdown: string, meta: { taskId: string, outcome: string }) => void,
 *   providerId?: string,
 *   getSessionOk?: () => boolean,
 * }} deps
 */
export function createAiAgentRunner(deps) {
  /** @type {AbortController | null} */
  let ctl = null;
  /** @type {AbortController | null} */
  let batchCtl = null;

  /**
   * @param {string} goal
   * @param {{
   *   signal?: AbortSignal,
   *   maxRounds?: number,
   *   suppressCallbacks?: boolean,
   * }} [runOpts]
   * @returns {Promise<{ outcome: string, markdown: string, taskId: string, errorMessage: string } | void>}
   */
  async function runCore(goal, runOpts = {}) {
    const profile = deps.getProfile();
    if (!profile?.apiKey) {
      deps.addLog('AI: 未配置 API Key');
      deps.onStatus('idle');
      return { outcome: 'failed', markdown: '', taskId: '', errorMessage: 'no-api-key' };
    }

    const g = String(goal || '').trim();
    const runOptsSafe = runOpts || {};
    const suppressCallbacks = !!runOptsSafe.suppressCallbacks;
    if (!g) {
      if (suppressCallbacks) deps.addLog('多任务: 跳过空子任务');
      else {
        deps.addLog('AI: 请先填写任务描述');
        deps.onStatus('idle');
      }
      return { outcome: 'failed', markdown: '', taskId: '', errorMessage: 'empty-goal' };
    }

    const externalSignal = runOptsSafe.signal;
    let signal;
    if (externalSignal) {
      signal = externalSignal;
    } else {
      ctl = new AbortController();
      signal = ctl.signal;
    }

    const providerId =
      profile?.provider === 'gemini'
        ? 'gemini'
        : String(deps.providerId || 'openai-compatible').toLowerCase();
    const adapter = createAiProviderAdapter(providerId, {
      apiBaseUrl: profile.apiBaseUrl,
      apiKey: profile.apiKey,
      model: profile.model,
    });

    const maxRounds =
      runOptsSafe.maxRounds != null
        ? Math.min(50, Math.max(1, Math.floor(Number(runOptsSafe.maxRounds))))
        : Math.min(50, Math.max(1, Math.floor(Number(profile.maxRounds) || 10)));
    /** @type {{ round: number, vision: string, analysis: string, stepsExecuted: string[], roundEndVisionAssert?: { passed: boolean, evidence: string } | null, prePlanDataUrl?: string | null, postExecDataUrl?: string | null }[]} */
    const rounds = [];
    const executedLines = [];
    let taskId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `task-${Date.now()}`;
    let outcome = 'failed';
    let errorMessage = '';
    const finalAssertion = { passed: false, evidence: '' };
    let idleStreak = 0;
    let finalFrameDataUrl = /** @type {string | null} */ (null);

    const db = typeof window !== 'undefined' ? window.humanos?.agentDb : null;

    try {
      deps.onStatus('planning');
      if (db?.taskCreate) {
        const tr = await db.taskCreate({
          goal: g,
          profileId: profile.id || '',
          profileName: profile.name || '',
        });
        if (tr?.ok && tr.id) taskId = tr.id;
      }

      const logDb = async (message, payload, roundIndex = 0) => {
        deps.addLog(message);
        try {
          await db?.logAppend?.({ taskId, roundIndex, message, payload });
        } catch {
          /* ignore */
        }
      };

      const logClipFail = (msg) => {
        deps.addLog(msg);
      };

      const clipStartR = await readRemoteClipboardSafe(deps, logClipFail);
      const clipAtTaskStart = clipStartR.text;
      /** @type {{ base64: string, mime: string } | null} */
      let lastEarlySnap = null;
      let taskHadInteraction = false;

      for (let round = 0; round < maxRounds; round++) {
        if (signal.aborted) {
          outcome = 'aborted';
          errorMessage = '用户取消';
          break;
        }
        if (deps.getSessionOk && !deps.getSessionOk()) {
          outcome = 'aborted';
          errorMessage = '已离开远程会话';
          break;
        }
        if (!deps.isControlReady()) {
          outcome = 'failed';
          errorMessage = '控制通道中断';
          break;
        }

        deps.onStatus('executing');
        const videoLoop = deps.getVideoEl();
        if (!videoLoop || !videoLoop.videoWidth) {
          outcome = 'failed';
          errorMessage = '远程画面丢失';
          break;
        }

        const cap = captureVideoFrameAsJpeg(videoLoop, { maxWidth: 1600, quality: 0.76 });

        try {
          await db?.screenshotSave?.({
            taskId,
            roundIndex: round,
            seq: 0,
            label: 'pre-plan',
            mime: cap.mime,
            base64: cap.base64,
            width: cap.width,
            height: cap.height,
            videoW: cap.videoWidth,
            videoH: cap.videoHeight,
          });
        } catch {
          /* ignore */
        }

        const visionText = await runVisionScreenUnderstanding(adapter, {
          userGoal: g,
          capture: { base64: cap.base64, mime: cap.mime },
          signal,
        });
        await logDb(`AI Vision: ${visionText.slice(0, 240)}${visionText.length > 240 ? '…' : ''}`, { vision: visionText }, round);

        const executedSummary = executedLines.slice(-20).join('\n');
        const stagnationHint = buildPlannerStagnationHint(executedLines);
        if (stagnationHint) {
          await logDb('AI: 近期相近坐标多次点击，已为 Planner 注入换策略提示', { stagnation: true }, round);
        }
        const plannerRaw = await runPlanner(adapter, {
          userGoal: g,
          screenDescription: visionText,
          executedSummary,
          stagnationHint: stagnationHint || undefined,
          signal,
          captureW: cap.width,
          captureH: cap.height,
        });

        let plan;
        try {
          plan = normalizePlannerJson(extractJsonObject(plannerRaw));
        } catch (e) {
          await logDb(
            `AI Planner JSON 解析失败: ${String(/** @type {{ message?: string }} */ (e)?.message || e)}`,
            { raw: plannerRaw.slice(0, 2000) },
            round,
          );
          outcome = 'failed';
          errorMessage = '规划 JSON 无效';
          break;
        }

        const stepCount = plan.steps?.length || 0;
        if (stepCount === 0 && !plan.macro_done) {
          idleStreak += 1;
          if (idleStreak >= 4) {
            outcome = 'failed';
            errorMessage = '连续多轮无可用步骤且未完成，请调整任务描述或换用更强模型';
            await logDb(`AI: ${errorMessage}`, { idleStreak }, round);
            break;
          }
        } else {
          idleStreak = 0;
        }

        await logDb(`AI 规划: ${plan.analysis || '—'}`, { macro_done: plan.macro_done, stepCount: plan.steps.length }, round);

        const preEnc = await toReportWebpDataUrl(cap.base64, cap.mime, { maxWidth: 1600, webpQuality: 0.82 });
        const roundEntry = {
          round,
          vision: visionText,
          analysis: plan.analysis,
          stepsExecuted: /** @type {string[]} */ ([]),
          roundEndVisionAssert: /** @type {{ passed: boolean, evidence: string } | null} */ (null),
          prePlanDataUrl: preEnc.dataUrl,
          postExecDataUrl: /** @type {string | null} */ (null),
        };
        rounds.push(roundEntry);

        if (plan.macro_done) {
          const clipMacroR = await readRemoteClipboardSafe(deps, logClipFail);
          const a = await runRoundEndAssertion(adapter, {
            userGoal: g,
            lateCapture: { base64: cap.base64, mime: cap.mime },
            earlyCapture: null,
            clipboardBefore: clipAtTaskStart,
            clipboardAfter: clipMacroR.ok ? clipMacroR.text : clipAtTaskStart,
            hadInteraction: taskHadInteraction,
            clipboardScope: 'task',
            signal,
          });
          finalAssertion.passed = a.passed;
          finalAssertion.evidence = a.evidence;
          roundEntry.roundEndVisionAssert = { passed: a.passed, evidence: a.evidence };
          await logDb(`AI 验收(macro·综合): ${a.passed ? '通过' : '未通过'} — ${a.evidence}`, a, round);
          if (a.passed) {
            outcome = 'passed';
            break;
          }
        }

        const clipBeforeRoundR = await readRemoteClipboardSafe(deps, logClipFail);
        const clipBeforeRound = clipBeforeRoundR.text;
        /** 点击/复制快捷键后早帧，仅用于验收，不写入报告 */
        let earlySnap = /** @type {{ base64: string, mime: string } | null} */ (null);
        let clipboardAfterSteps = clipBeforeRound;
        let hadInteractionThisRound = false;
        const transientState = {
          earlySnap,
          clipboardAfterSteps,
          lastEarlySnap,
        };

        const steps = plan.steps.slice(0, 10);
        for (let si = 0; si < steps.length; si++) {
          if (signal.aborted) break;
          const step = steps[si];
          const conv = stepToControlCommands(step, {
            videoW: cap.videoWidth,
            videoH: cap.videoHeight,
            visionW: cap.width,
            visionH: cap.height,
          });
          if (!conv.ok) {
            const line = `步骤 ${si + 1} 跳过: ${conv.reason}`;
            roundEntry.stepsExecuted.push(line);
            await logDb(line, { step }, round);
            continue;
          }
          for (const cmd of conv.cmds || []) {
            if (signal.aborted) break;
            await dispatchControl(cmd, deps.sendControl, deps.addLog);
          }
          if (shouldCaptureTransientFeedback(step)) {
            taskHadInteraction = true;
            hadInteractionThisRound = true;
            transientState.clipboardAfterSteps = clipboardAfterSteps;
            await sampleAfterTransientAction({
              deps,
              getVideoEl: deps.getVideoEl,
              state: transientState,
              onFail: (msg) => void logDb(msg, {}, round),
            });
            earlySnap = transientState.earlySnap;
            clipboardAfterSteps = transientState.clipboardAfterSteps;
            lastEarlySnap = transientState.lastEarlySnap;
          }
          const line = `步骤 ${si + 1}: ${JSON.stringify(step)}`;
          roundEntry.stepsExecuted.push(line);
          executedLines.push(line);
          await sleep(stagnationHint ? 320 : 240);
        }

        if (signal.aborted) {
          outcome = 'aborted';
          errorMessage = '用户取消';
          break;
        }

        await sleep(stagnationHint ? 260 : 200);
        const postVid = deps.getVideoEl();
        if (postVid?.videoWidth) {
          try {
            const postCap = captureVideoFrameAsJpeg(postVid, { maxWidth: 1600, quality: 0.76 });
            try {
              await db?.screenshotSave?.({
                taskId,
                roundIndex: round,
                seq: 1,
                label: 'post-exec',
                mime: postCap.mime,
                base64: postCap.base64,
                width: postCap.width,
                height: postCap.height,
                videoW: postCap.videoWidth,
                videoH: postCap.videoHeight,
              });
            } catch {
              /* ignore */
            }
            const postEnc = await toReportWebpDataUrl(postCap.base64, postCap.mime, { maxWidth: 1600, webpQuality: 0.82 });
            roundEntry.postExecDataUrl = postEnc.dataUrl;
            const ar = await runRoundEndAssertion(adapter, {
              userGoal: g,
              lateCapture: { base64: postCap.base64, mime: postCap.mime },
              earlyCapture: earlySnap,
              clipboardBefore: clipBeforeRound,
              clipboardAfter: clipboardAfterSteps,
              hadInteraction: hadInteractionThisRound,
              clipboardScope: 'round',
              signal,
            });
            finalAssertion.passed = ar.passed;
            finalAssertion.evidence = ar.evidence;
            roundEntry.roundEndVisionAssert = { passed: ar.passed, evidence: ar.evidence };
            await logDb(
              `AI 轮末验收${earlySnap ? '（早帧+晚帧/剪贴板）' : '（晚帧/剪贴板）'}: ${ar.passed ? '通过' : '未通过'} — ${ar.evidence}`,
              { ...ar, hadEarlySnap: !!earlySnap },
              round,
            );
            if (ar.passed) {
              outcome = 'passed';
              break;
            }
          } catch (e) {
            await logDb(`AI 轮末截图验收异常: ${String(/** @type {{ message?: string }} */ (e)?.message || e)}`, {}, round);
          }
        }

        if (signal.aborted) {
          outcome = 'aborted';
          errorMessage = '用户取消';
          break;
        }
        await sleep(350);
      }

      if (!signal.aborted && outcome !== 'passed' && outcome !== 'aborted' && !errorMessage) {
        const endVid = deps.getVideoEl();
        if (endVid?.videoWidth) {
          const cap2 = captureVideoFrameAsJpeg(endVid, { maxWidth: 1600, quality: 0.76 });
          const finEnc = await toReportWebpDataUrl(cap2.base64, cap2.mime, { maxWidth: 1600, webpQuality: 0.82 });
          finalFrameDataUrl = finEnc.dataUrl;
          const clipFinalR = await readRemoteClipboardSafe(deps, logClipFail);
          const a2 = await runRoundEndAssertion(adapter, {
            userGoal: g,
            lateCapture: { base64: cap2.base64, mime: cap2.mime },
            earlyCapture: lastEarlySnap,
            clipboardBefore: clipAtTaskStart,
            clipboardAfter: clipFinalR.ok ? clipFinalR.text : clipAtTaskStart,
            hadInteraction: taskHadInteraction,
            clipboardScope: 'task',
            signal,
          });
          finalAssertion.passed = a2.passed;
          finalAssertion.evidence = a2.evidence;
          await logDb(
            `AI 最终验收(综合${lastEarlySnap ? '·含早帧' : ''}): ${a2.passed ? '通过' : '未通过'} — ${a2.evidence}`,
            a2,
            maxRounds,
          );
          if (a2.passed) outcome = 'passed';
        } else {
          await logDb('AI 最终验收: 无可用画面，跳过', {}, maxRounds);
        }
      }

      const md = buildMarkdownReport({
        taskGoal: g,
        taskId,
        outcome,
        rounds,
        finalAssertion,
        finalFrameDataUrl: finalFrameDataUrl || undefined,
        errorMessage: errorMessage || undefined,
      });

      if (!suppressCallbacks) deps.onReportReady(md, { taskId, outcome });
      try {
        await db?.resultSave?.({
          taskId,
          outcome,
          markdown: md,
          summary: { rounds: rounds.length, finalAssertion },
        });
      } catch {
        /* ignore */
      }
      try {
        await db?.taskUpdateStatus?.({
          taskId,
          status: outcome === 'passed' ? 'completed' : outcome === 'aborted' ? 'aborted' : 'failed',
          errorMessage,
        });
      } catch {
        /* ignore */
      }

      if (!suppressCallbacks) {
        deps.onStatus(outcome === 'passed' ? 'success' : outcome === 'aborted' ? 'idle' : 'error');
        if (outcome === 'passed') deps.addLog('任务完成: 验收通过 ✅');
        else if (outcome === 'aborted') deps.addLog('任务已取消');
        else deps.addLog(`任务结束: ${outcome}${errorMessage ? ` — ${errorMessage}` : ''}`);
      } else {
        deps.addLog(`子任务结束: ${outcome}${errorMessage ? ` — ${errorMessage}` : ''}`);
      }

      return { outcome, markdown: md, taskId, errorMessage: errorMessage || '' };
    } catch (e) {
      const isAbort =
        signal.aborted ||
        /** @type {{ name?: string }} */ (e)?.name === 'AbortError' ||
        /aborted|AbortError|用户取消/i.test(String(/** @type {{ message?: string }} */ (e)?.message || e));
      if (isAbort) {
        outcome = 'aborted';
        errorMessage = errorMessage || '已中断';
        deps.addLog('AI: 任务已中断');
      } else {
        const msg = String(/** @type {{ message?: string }} */ (e)?.message || e);
        outcome = 'failed';
        errorMessage = msg;
        deps.addLog(`AI 异常: ${msg}`);
      }
      let mdCatch = '';
      try {
        mdCatch = buildMarkdownReport({
          taskGoal: g,
          taskId,
          outcome,
          rounds,
          finalAssertion,
          finalFrameDataUrl: finalFrameDataUrl || undefined,
          errorMessage: errorMessage || undefined,
        });
        if (!suppressCallbacks) deps.onReportReady(mdCatch, { taskId, outcome });
      } catch {
        /* ignore */
      }
      try {
        if (mdCatch) {
          await db?.resultSave?.({
            taskId,
            outcome,
            markdown: mdCatch,
            summary: { rounds: rounds.length, finalAssertion, catch: true },
          });
        }
      } catch {
        /* ignore */
      }
      try {
        await db?.taskUpdateStatus?.({
          taskId,
          status: outcome === 'passed' ? 'completed' : outcome === 'aborted' ? 'aborted' : 'failed',
          errorMessage,
        });
      } catch {
        /* ignore */
      }
      if (!suppressCallbacks) {
        deps.onStatus(isAbort ? 'idle' : 'error');
        if (!isAbort) deps.addLog(`任务结束: ${outcome}${errorMessage ? ` — ${errorMessage}` : ''}`);
      }
      return { outcome, markdown: mdCatch || '', taskId, errorMessage: errorMessage || '' };
    } finally {
      if (!externalSignal) ctl = null;
    }
  }

  return {
    cancel: () => {
      try {
        ctl?.abort();
      } catch {
        /* ignore */
      }
      try {
        batchCtl?.abort();
      } catch {
        /* ignore */
      }
      ctl = null;
      batchCtl = null;
    },
    /** @param {string} goal @param {{ maxRounds?: number, signal?: AbortSignal, suppressCallbacks?: boolean }} [runOpts] */
    async run(goal, runOpts) {
      const g = String(goal || '').trim();
      if (!g) {
        deps.addLog('AI: 请先填写任务描述');
        deps.onStatus('idle');
        return;
      }
      if (!deps.isControlReady()) {
        deps.addLog('AI: 控制通道未就绪，请在「会话」中建立连接并等待 DataChannel 打开');
        deps.onStatus('idle');
        return;
      }
      const video = deps.getVideoEl();
      if (!video || !video.videoWidth) {
        deps.addLog('AI: 远程画面未就绪，请等待视频轨出现');
        deps.onStatus('idle');
        return;
      }
      if (!deps.getProfile()?.apiKey) {
        deps.addLog('AI: 未配置 API Key');
        deps.onStatus('idle');
        return;
      }
      if (deps.getSessionOk && !deps.getSessionOk()) {
        deps.addLog('AI: 请在「远程会话」页面发起任务（当前不在会话模式）');
        deps.onStatus('idle');
        return;
      }
      return await runCore(g, runOpts || {});
    },

    /**
     * @param {{ plainText: string, sourceFileName?: string, maxRoundsPerSubtask?: number, attachment?: { mime: string, base64: string, fileName?: string } | null }} p
     */
    async runBatch(p) {
      const plainText = String(p?.plainText || '').trim();
      const sourceFileName = String(p?.sourceFileName || '任务文件');
      const attachment =
        p?.attachment &&
        typeof p.attachment.base64 === 'string' &&
        p.attachment.base64.length > 0 &&
        typeof p.attachment.mime === 'string'
          ? {
              mime: p.attachment.mime,
              base64: p.attachment.base64,
              fileName: p.attachment.fileName || sourceFileName,
            }
          : null;
      const maxRoundsPerSubtask = Math.min(
        50,
        Math.max(1, Math.floor(Number(p?.maxRoundsPerSubtask) || 10)),
      );

      if (!plainText && !attachment) {
        deps.addLog('多任务: 文档内容为空且无附件');
        deps.onStatus('idle');
        return;
      }
      if (!deps.isControlReady()) {
        deps.addLog('AI: 控制通道未就绪');
        deps.onStatus('idle');
        return;
      }
      const video = deps.getVideoEl();
      if (!video || !video.videoWidth) {
        deps.addLog('AI: 远程画面未就绪');
        deps.onStatus('idle');
        return;
      }
      const profile = deps.getProfile();
      if (!profile?.apiKey) {
        deps.addLog('AI: 未配置 API Key');
        deps.onStatus('idle');
        return;
      }
      if (deps.getSessionOk && !deps.getSessionOk()) {
        deps.addLog('AI: 请在「远程会话」页面发起任务');
        deps.onStatus('idle');
        return;
      }

      batchCtl = new AbortController();
      const signal = batchCtl.signal;
      const providerId =
        profile?.provider === 'gemini'
          ? 'gemini'
          : String(deps.providerId || 'openai-compatible').toLowerCase();
      const adapter = createAiProviderAdapter(providerId, {
        apiBaseUrl: profile.apiBaseUrl,
        apiKey: profile.apiKey,
        model: profile.model,
      });

      try {
        deps.onStatus('planning');
        deps.addLog(
          `多任务: 「${sourceFileName}」— ① 先将全文发给当前执行模型，拆成子任务；② 再逐条按与「单任务」相同方式执行（每轮截图 → 规划 → DataChannel → 轮末验收；单条最多 ${maxRoundsPerSubtask} 轮）。`,
        );
        const subs = await splitSubtasksFromDocument(adapter, plainText, deps.addLog, signal, attachment);
        if (!subs.length) {
          deps.addLog('多任务: 未得到有效子任务，已停止（请检查模型返回或文档内容）');
          deps.onStatus('idle');
          return;
        }
        deps.addLog(`多任务: ① 拆分结束，开始 ② 逐条执行（共 ${subs.length} 条）。`);
        const previewN = Math.min(subs.length, 15);
        for (let p = 0; p < previewN; p++) {
          const line = subs[p];
          deps.addLog(`  子任务 ${p + 1}: ${line.slice(0, 120)}${line.length > 120 ? '…' : ''}`);
        }
        if (subs.length > previewN) {
          deps.addLog(`  … 另有 ${subs.length - previewN} 条，执行日志中会继续编号输出`);
        }
        const items = [];
        for (let i = 0; i < subs.length; i++) {
          if (signal.aborted) break;
          deps.addLog(`[多任务 ${i + 1}/${subs.length}] 开始：${subs[i].slice(0, 120)}${subs[i].length > 120 ? '…' : ''}`);
          deps.onStatus('executing');
          const r = await runCore(subs[i], { signal, maxRounds: maxRoundsPerSubtask, suppressCallbacks: true });
          if (r)
            items.push({
              index: i,
              goal: subs[i],
              outcome: r.outcome,
              taskId: r.taskId,
              markdown: r.markdown,
            });
        }
        const merged = buildBatchMarkdownReport({ sourceFileName, items });
        deps.onReportReady(merged, { taskId: items.length ? items[items.length - 1].taskId : '', outcome: 'batch' });
        const allPass = items.length > 0 && items.every((x) => x.outcome === 'passed');
        deps.onStatus(allPass ? 'success' : 'error');
        deps.addLog(
          allPass ? '多任务套件: 全部子任务验收通过 ✅' : '多任务套件: 已结束（存在未通过或失败项，见汇总报告）',
        );
      } catch (e) {
        deps.addLog(`多任务: ${String(/** @type {{ message?: string }} */ (e)?.message || e)}`);
        deps.onStatus('error');
      } finally {
        batchCtl = null;
      }
    },
  };
}
