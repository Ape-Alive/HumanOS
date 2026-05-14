import { captureVideoFrameAsJpeg } from '../lib/ai/captureRemoteVideoFrame.js';
import { createAiProviderAdapter } from '../lib/ai/plugins/openAiVisionChat.js';
import { runVisionScreenUnderstanding } from '../lib/ai/agent/visionModule.js';
import { runPlanner } from '../lib/ai/agent/plannerModule.js';
import {
  extractJsonObject,
  normalizePlannerJson,
  stepToControlCommands,
} from '../lib/ai/agent/actionGenerator.js';
import { runAssertionWithVision } from '../lib/ai/agent/assertionEngine.js';
import { buildMarkdownReport } from '../lib/ai/report/buildMarkdownReport.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  await sleep(90);
}

/**
 * @param {{
 *   addLog: (s: string) => void,
 *   getProfile: () => { apiBaseUrl: string, apiKey: string, model: string, provider?: 'openai-compatible'|'gemini', name?: string, id?: string, maxRounds?: number } | null | undefined,
 *   getVideoEl: () => HTMLVideoElement | null | undefined,
 *   sendControl: (cmd: Record<string, unknown>) => boolean,
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

  return {
    cancel: () => {
      ctl?.abort();
      ctl = null;
    },
    /** @param {string} goal */
    async run(goal) {
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

      const profile = deps.getProfile();
      if (!profile?.apiKey) {
        deps.addLog('AI: 未配置 API Key');
        deps.onStatus('idle');
        return;
      }

      if (deps.getSessionOk && !deps.getSessionOk()) {
        deps.addLog('AI: 请在「远程会话」页面发起任务（当前不在会话模式）');
        deps.onStatus('idle');
        return;
      }

      ctl = new AbortController();
      const signal = ctl.signal;
      const providerId =
        profile?.provider === 'gemini'
          ? 'gemini'
          : String(deps.providerId || 'openai-compatible').toLowerCase();
      const adapter = createAiProviderAdapter(providerId, {
        apiBaseUrl: profile.apiBaseUrl,
        apiKey: profile.apiKey,
        model: profile.model,
      });

      const maxRounds = Math.min(50, Math.max(1, Math.floor(Number(profile.maxRounds) || 10)));
      /** @type {{ round: number, vision: string, analysis: string, stepsExecuted: string[], roundEndVisionAssert?: { passed: boolean, evidence: string } | null }}[]} */
      const rounds = [];
      const executedLines = [];
      let taskId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `task-${Date.now()}`;
      let outcome = 'failed';
      let errorMessage = '';
      const finalAssertion = { passed: false, evidence: '' };
      let idleStreak = 0;

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

          const cap = captureVideoFrameAsJpeg(videoLoop, { maxWidth: 1280, quality: 0.72 });

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
          const plannerRaw = await runPlanner(adapter, {
            userGoal: g,
            screenDescription: visionText,
            executedSummary,
            signal,
          });

          let plan;
          try {
            plan = normalizePlannerJson(extractJsonObject(plannerRaw));
          } catch (e) {
            await logDb(`AI Planner JSON 解析失败: ${String(/** @type {{message?:string}} */ (e)?.message || e)}`, { raw: plannerRaw.slice(0, 2000) }, round);
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

          const roundEntry = {
            round,
            vision: visionText,
            analysis: plan.analysis,
            stepsExecuted: /** @type {string[]} */ ([]),
            roundEndVisionAssert: /** @type {{ passed: boolean, evidence: string } | null} */ (null),
          };
          rounds.push(roundEntry);

          if (plan.macro_done) {
            const a = await runAssertionWithVision(adapter, {
              userGoal: g,
              capture: { base64: cap.base64, mime: cap.mime },
              signal,
            });
            finalAssertion.passed = a.passed;
            finalAssertion.evidence = a.evidence;
            roundEntry.roundEndVisionAssert = { passed: a.passed, evidence: a.evidence };
            await logDb(`AI 验收(macro·截图): ${a.passed ? '通过' : '未通过'} — ${a.evidence}`, a, round);
            if (a.passed) {
              outcome = 'passed';
              break;
            }
          }

          const steps = plan.steps.slice(0, 10);
          for (let si = 0; si < steps.length; si++) {
            if (signal.aborted) break;
            const step = steps[si];
            const conv = stepToControlCommands(step, {
              videoW: cap.videoWidth,
              videoH: cap.videoHeight,
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
            const line = `步骤 ${si + 1}: ${JSON.stringify(step)}`;
            roundEntry.stepsExecuted.push(line);
            executedLines.push(line);
            await sleep(200);
          }

          if (signal.aborted) {
            outcome = 'aborted';
            errorMessage = '用户取消';
            break;
          }

          await sleep(180);
          const postVid = deps.getVideoEl();
          if (postVid?.videoWidth) {
            try {
              const postCap = captureVideoFrameAsJpeg(postVid, { maxWidth: 1280, quality: 0.72 });
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
              const ar = await runAssertionWithVision(adapter, {
                userGoal: g,
                capture: { base64: postCap.base64, mime: postCap.mime },
                signal,
              });
              finalAssertion.passed = ar.passed;
              finalAssertion.evidence = ar.evidence;
              roundEntry.roundEndVisionAssert = { passed: ar.passed, evidence: ar.evidence };
              await logDb(`AI 轮末验收(截图): ${ar.passed ? '通过' : '未通过'} — ${ar.evidence}`, ar, round);
              if (ar.passed) {
                outcome = 'passed';
                break;
              }
            } catch (e) {
              await logDb(`AI 轮末截图验收异常: ${String(/** @type {{message?:string}} */ (e)?.message || e)}`, {}, round);
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
            const cap2 = captureVideoFrameAsJpeg(endVid, { maxWidth: 1280 });
            const a2 = await runAssertionWithVision(adapter, {
              userGoal: g,
              capture: { base64: cap2.base64, mime: cap2.mime },
              signal,
            });
            finalAssertion.passed = a2.passed;
            finalAssertion.evidence = a2.evidence;
            await logDb(`AI 最终验收(截图): ${a2.passed ? '通过' : '未通过'} — ${a2.evidence}`, a2, maxRounds);
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
          errorMessage: errorMessage || undefined,
        });

        deps.onReportReady(md, { taskId, outcome });
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

        deps.onStatus(outcome === 'passed' ? 'success' : outcome === 'aborted' ? 'idle' : 'error');
        if (outcome === 'passed') deps.addLog('任务完成: 验收通过 ✅');
        else if (outcome === 'aborted') deps.addLog('任务已取消');
        else deps.addLog(`任务结束: ${outcome}${errorMessage ? ` — ${errorMessage}` : ''}`);
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
            errorMessage: errorMessage || undefined,
          });
          deps.onReportReady(mdCatch, { taskId, outcome });
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
        deps.onStatus(isAbort ? 'idle' : 'error');
        if (!isAbort) deps.addLog(`任务结束: ${outcome}${errorMessage ? ` — ${errorMessage}` : ''}`);
      } finally {
        ctl = null;
      }
    },
  };
}
