import { campaigns, contents, stories, tasks, workflows, now } from '../db/index.js';
import { bus, type AgentLiveState } from '../core/bus.js';
import { writeLog } from '../core/log.js';
import { config } from '../config.js';
import { sleep } from '../core/util.js';
import { resolveLLM } from '../llm/index.js';
import { resolveImpl } from '../agents/index.js';
import { AGENT_PROFILES } from '../agents/types.js';
import { resolveSteps } from './workflows.js';
import {
  FatalError,
  TERMINAL_TASK,
  type AgentId,
  type Campaign,
  type Platform,
  type RunMode,
  type Task,
  type HuntOptions,
} from '../core/types.js';

class TimeoutError extends Error {}
class CancelledError extends Error {}

const ACTIVE_CAMPAIGN = ['running'];

/**
 * The orchestration engine: a persistent task queue (SQLite) + in-process worker pool.
 * - Tasks form a DAG per campaign; ready tasks run in parallel (one task per agent at a time).
 * - Retries with exponential backoff for transient errors, timeouts, fallback agent hand-off.
 * - Approval gates pause the campaign until a human approves.
 * - Pause / resume / cancel; state survives restarts (running tasks are re-queued on boot).
 * To scale out, swap the tick loop for a Redis/BullMQ queue — task records stay the same.
 */
export class Engine {
  private running = new Map<string, { ctrl: AbortController; campaignId: string; agent: AgentId }>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  readonly agentStates = new Map<AgentId, AgentLiveState>();
  backoffBaseMs = 1000;

  constructor() {
    for (const a of AGENT_PROFILES) this.agentStates.set(a.id, idle());
  }

  start(intervalMs = 400) {
    this.recover();
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const r of this.running.values()) r.ctrl.abort(new CancelledError('shutdown'));
    while (this.running.size) await sleep(20);
  }

  /** Tasks left "running" by a crash/restart go back to the queue. */
  recover() {
    for (const t of tasks.byStatus('running')) {
      tasks.update(t.id, { status: 'pending', message: 'Khôi phục sau khi khởi động lại' });
      writeLog({ campaignId: t.campaignId, taskId: t.id, agent: t.agent, level: 'warn', message: `Khôi phục tác vụ "${t.title}" sau khi khởi động lại`, data: null });
    }
  }

  // ---------------------------------------------------------------- campaign lifecycle

  createCampaign(input: { goal: string; workflowId: string; platforms: Platform[]; mode: RunMode; createdBy: string; scheduledAt?: string | null; publishAt?: string | null; autoStart?: boolean; options?: HuntOptions }): Campaign {
    const wf = workflows.get(input.workflowId);
    if (!wf) throw new FatalError('Workflow không tồn tại');
    const scheduled = input.scheduledAt && new Date(input.scheduledAt).getTime() > Date.now();
    const c = campaigns.create({
      title: input.goal.slice(0, 80), goal: input.goal, workflowId: wf.id, platforms: input.platforms, mode: input.mode,
      status: input.autoStart === false ? 'draft' : scheduled ? 'scheduled' : 'running', plan: { options: input.options ?? { count: 8, categories: [], region: 'both' } } as any, createdBy: input.createdBy,
      scheduledAt: input.scheduledAt ?? null, publishAt: input.publishAt ?? null,
    });
    const steps = resolveSteps(wf, input.platforms);
    steps.forEach((s, i) =>
      tasks.create({
        campaignId: c.id, stepKey: s.key, agent: s.agent, title: s.title, type: s.type ?? 'agent', platform: s.platform ?? null,
        status: 'pending', deps: s.deps, depMode: s.depMode ?? 'success', output: null, resultKind: null, progress: 0, message: null,
        attempts: 0, maxAttempts: s.maxAttempts ?? 3, timeoutMs: s.timeoutMs ?? 180000, fallbackAgent: s.fallbackAgent ?? null,
        error: null, runAfter: null, startedAt: null, finishedAt: null, seq: i,
      }),
    );
    writeLog({ campaignId: c.id, taskId: null, agent: 'orchestrator', level: 'info', message: `Nhận mục tiêu: "${input.goal}" → ${steps.length} bước, nền tảng: ${input.platforms.join(', ') || '—'} (${input.mode === 'demo' ? 'DEMO' : 'PRODUCTION'})`, data: { steps: steps.map((s) => s.key) } });
    this.setAgent('orchestrator', { status: 'working', message: `Nhận chiến dịch mới: ${c.title}`, campaignId: c.id, taskId: null, progress: 0 });
    bus.publish({ type: 'campaign', campaignId: c.id, status: c.status });
    queueMicrotask(() => void this.tick());
    return c;
  }

  setStatus(cid: string, status: Campaign['status']) {
    campaigns.update(cid, { status });
    bus.publish({ type: 'campaign', campaignId: cid, status });
  }

  startCampaign(cid: string) {
    const c = mustCampaign(cid);
    if (!['draft', 'scheduled'].includes(c.status)) throw new FatalError('Chiến dịch đã chạy');
    this.setStatus(cid, 'running');
    void this.tick();
  }

  pause(cid: string) {
    const c = mustCampaign(cid);
    if (!['running', 'awaiting_approval', 'scheduled'].includes(c.status)) throw new FatalError('Không thể tạm dừng ở trạng thái này');
    this.setStatus(cid, 'paused');
    writeLog({ campaignId: cid, taskId: null, agent: 'orchestrator', level: 'info', message: 'Tạm dừng chiến dịch (tác vụ đang chạy sẽ hoàn tất, không giao việc mới)', data: null });
  }

  resume(cid: string) {
    const c = mustCampaign(cid);
    if (c.status !== 'paused') throw new FatalError('Chiến dịch không ở trạng thái tạm dừng');
    const hasApproval = tasks.forCampaign(cid).some((t) => t.status === 'awaiting_approval');
    this.setStatus(cid, hasApproval ? 'awaiting_approval' : 'running');
    writeLog({ campaignId: cid, taskId: null, agent: 'orchestrator', level: 'info', message: 'Tiếp tục chiến dịch', data: null });
    void this.tick();
  }

  cancel(cid: string) {
    const c = mustCampaign(cid);
    if (['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(c.status)) throw new FatalError('Chiến dịch đã kết thúc');
    for (const [tid, r] of this.running) if (r.campaignId === cid) r.ctrl.abort(new CancelledError('cancelled'));
    for (const t of tasks.forCampaign(cid)) if (!TERMINAL_TASK.includes(t.status)) tasks.update(t.id, { status: 'cancelled', finishedAt: now() });
    this.setStatus(cid, 'cancelled');
    writeLog({ campaignId: cid, taskId: null, agent: 'orchestrator', level: 'warn', message: 'Đã hủy chiến dịch', data: null });
  }

  private gate(cid: string, key?: 'select' | 'approve') {
    const g = tasks.forCampaign(cid).find((t) => t.type === 'approval' && t.status === 'awaiting_approval');
    if (!g || (key && g.stepKey !== key)) throw new FatalError(key === 'select' ? 'Không có danh sách chủ đề nào đang chờ chọn' : 'Không có nội dung nào đang chờ duyệt');
    return g;
  }

  private passGate(cid: string, gate: Task, output: any, message: string) {
    tasks.update(gate.id, { status: 'succeeded', progress: 1, finishedAt: now(), resultKind: 'real', output, message });
    this.emitTask(tasks.get(gate.id)!);
    contentsChanged(cid);
    this.setStatus(cid, 'running');
    void this.tick();
  }

  /** Gate 1: the owner picks which verified topics to develop into posts. */
  selectTopics(cid: string, storyIds: string[], userId: string) {
    const c = mustCampaign(cid);
    const gate = this.gate(cid, 'select');
    if (!storyIds.length) throw new FatalError('Hãy chọn ít nhất 1 chủ đề');
    for (const sid of storyIds) {
      const st = stories.get(sid);
      if (!st || st.campaignId !== cid) throw new FatalError('Chủ đề không hợp lệ');
      if (st.status !== 'proposed') throw new FatalError(`"${st.title}" chưa đạt kiểm chứng — không thể phát triển thành bài`);
      if (st.verification === 'demo' && c.mode !== 'demo') throw new FatalError('Chủ đề mẫu demo chỉ dùng trong Demo Mode');
    }
    for (const st of stories.forCampaign(cid)) if (storyIds.includes(st.id)) stories.update(st.id, { status: 'selected' });
    writeLog({ campaignId: cid, taskId: gate.id, agent: 'orchestrator', level: 'success', message: `Chủ kênh chọn ${storyIds.length} chủ đề → giao Thiết kế ảnh & Biên tập viên`, data: { storyIds } });
    this.setAgent('orchestrator', { status: 'done', message: `Đã chọn ${storyIds.length} chủ đề, giao việc viết bài`, campaignId: cid, taskId: gate.id, progress: 1 });
    this.passGate(cid, gate, { selectedBy: userId, storyIds }, `Đã chọn ${storyIds.length} chủ đề`);
  }

  /** Gate 2: approve at most one variant per story and platform; delayed until campaign.publishAt if set. */
  approve(cid: string, contentIds: string[], userId: string, media: Record<string, string[]> = {}) {
    const c = mustCampaign(cid);
    const gate = this.gate(cid, 'approve');
    if (!contentIds.length) throw new FatalError('Hãy chọn ít nhất 1 bài để đăng');
    const pairs = new Set<string>();
    for (const id of contentIds) {
      const v = contents.get(id);
      if (!v || v.campaignId !== cid) throw new FatalError('Nội dung không hợp lệ');
      const k = `${v.storyId}:${v.platform}`;
      if (pairs.has(k)) throw new FatalError('Mỗi chủ đề chỉ chọn 1 phương án cho mỗi nền tảng');
      pairs.add(k);
    }
    for (const v of contents.forCampaign(cid)) {
      if (contentIds.includes(v.id)) contents.update(v.id, { status: 'approved', approvedBy: userId, approvedAt: now(), ...(media[v.id] ? { mediaIds: media[v.id] } : {}) });
      else if (v.status === 'approved') contents.update(v.id, { status: 'draft', approvedBy: null, approvedAt: null });
    }
    if (c.publishAt && new Date(c.publishAt).getTime() > Date.now()) {
      for (const t of tasks.forCampaign(cid)) if (t.platform) tasks.update(t.id, { runAfter: c.publishAt });
      writeLog({ campaignId: cid, taskId: gate.id, agent: 'orchestrator', level: 'info', message: `Đã lên lịch đăng lúc ${new Date(c.publishAt).toLocaleString('vi-VN')}`, data: null });
    }
    writeLog({ campaignId: cid, taskId: gate.id, agent: 'orchestrator', level: 'success', message: `Đã duyệt ${contentIds.length} bài → chuyển sang xuất bản`, data: { contentIds } });
    this.setAgent('orchestrator', { status: 'done', message: 'Đã nhận phê duyệt, giao việc xuất bản', campaignId: cid, taskId: gate.id, progress: 1 });
    this.passGate(cid, gate, { approvedBy: userId, contentIds }, 'Đã duyệt');
  }

  /** Send back with feedback: at topic stage → hunt again; at post stage → rewrite. */
  reject(cid: string, feedback: string) {
    const c = mustCampaign(cid);
    const gate = this.gate(cid);
    const plan = { ...(c.plan as any), revisionNotes: [...((c.plan as any)?.revisionNotes ?? []), feedback] };
    campaigns.update(cid, { plan });
    const all = tasks.forCampaign(cid);
    const redo = gate.stepKey === 'select' ? ['research', 'verify'] : ['write'];
    for (const t of all) if (redo.includes(t.stepKey)) tasks.update(t.id, { status: 'pending', attempts: 0, progress: 0, error: null, output: null, message: 'Làm lại theo góp ý', runAfter: null });
    tasks.update(gate.id, { status: 'pending', message: null });
    writeLog({ campaignId: cid, taskId: gate.id, agent: 'orchestrator', level: 'warn', message: `${gate.stepKey === 'select' ? 'Săn tin lại' : 'Viết lại'} theo góp ý: "${feedback}"`, data: null });
    this.emitHandoff(cid, 'orchestrator', gate.stepKey === 'select' ? 'researcher' : 'writer', 'Góp ý');
    this.setStatus(cid, 'running');
    void this.tick();
  }

  /** Re-run a failed/blocked/cancelled task (and unblock its dependents). */
  retryTask(cid: string, tid: string) {
    const c = mustCampaign(cid);
    const t = tasks.get(tid);
    if (!t || t.campaignId !== cid) throw new FatalError('Không tìm thấy tác vụ');
    if (!['failed', 'blocked', 'cancelled'].includes(t.status)) throw new FatalError('Tác vụ đang chạy hoặc đang chờ');
    if (t.type === 'approval') throw new FatalError('Bước duyệt không chạy lại được');
    const all = tasks.forCampaign(cid);
    const reset = (x: Task) => tasks.update(x.id, { status: 'pending', attempts: 0, error: null, progress: 0, message: null, runAfter: null, finishedAt: null });
    reset(t);
    // Dependents downstream that were blocked/finished get re-run too.
    const queue = [t.stepKey];
    while (queue.length) {
      const k = queue.shift()!;
      for (const d of all.filter((x) => x.deps.includes(k))) {
        if (['blocked', 'cancelled'].includes(d.status)) {
          reset(d);
          queue.push(d.stepKey);
        }
      }
    }
    writeLog({ campaignId: cid, taskId: tid, agent: t.agent, level: 'info', message: `Chạy lại "${t.title}"`, data: null });
    if (c.status !== 'paused') this.setStatus(cid, 'running');
    void this.tick();
  }

  // ---------------------------------------------------------------- scheduler loop

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const c of campaigns.byStatus(['scheduled'])) {
        if (c.scheduledAt && new Date(c.scheduledAt).getTime() <= Date.now()) {
          writeLog({ campaignId: c.id, taskId: null, agent: 'orchestrator', level: 'info', message: 'Đến giờ hẹn → bắt đầu chiến dịch', data: null });
          this.setStatus(c.id, 'running');
        }
      }
      for (const c of campaigns.byStatus(ACTIVE_CAMPAIGN)) this.advance(c);
    } finally {
      this.ticking = false;
    }
  }

  private advance(c: Campaign) {
    const all = tasks.forCampaign(c.id);
    const byKey = new Map(all.map((t) => [t.stepKey, t]));
    const busyAgents = new Set([...this.running.values()].map((r) => r.agent));

    for (const t of all) {
      if (t.status !== 'pending') continue;
      const deps = t.deps.map((k) => byKey.get(k)).filter((d): d is Task => !!d);
      const failedDep = deps.find((d) => ['failed', 'blocked', 'cancelled'].includes(d.status));
      if (t.depMode === 'success' && failedDep) {
        tasks.update(t.id, { status: 'blocked', error: `Bước trước "${failedDep.title}" không hoàn thành`, finishedAt: now() });
        t.status = 'blocked';
        this.emitTask(t);
        continue;
      }
      const ready = t.depMode === 'settled'
        ? deps.every((d) => TERMINAL_TASK.includes(d.status))
        : deps.every((d) => d.status === 'succeeded' || d.status === 'skipped');
      if (!ready) continue;
      if (t.runAfter && new Date(t.runAfter).getTime() > Date.now()) continue;

      if (t.type === 'approval') {
        tasks.update(t.id, { status: 'awaiting_approval', startedAt: now(), message: 'Chờ người dùng duyệt nội dung' });
        t.status = 'awaiting_approval';
        this.emitTask(t);
        this.setStatus(c.id, 'awaiting_approval');
        const proposed = stories.forCampaign(c.id).filter((s) => s.status === 'proposed').length;
        const msg = t.stepKey === 'select' ? `Có ${proposed} chủ đề đã kiểm chứng — chờ anh chọn!` : 'Bài đã sẵn sàng — chờ anh duyệt!';
        this.setAgent('orchestrator', { status: 'waiting', message: msg, campaignId: c.id, taskId: t.id, progress: 0.5 });
        writeLog({ campaignId: c.id, taskId: t.id, agent: 'orchestrator', level: 'info', message: msg, data: null });
        return; // campaign leaves "running"
      }
      if (this.running.size >= config.workerConcurrency || busyAgents.has(t.agent)) continue;
      busyAgents.add(t.agent);
      void this.execute(c, t, byKey);
    }

    const fresh = tasks.forCampaign(c.id);
    const open = fresh.some((t) => ['pending', 'running', 'awaiting_approval'].includes(t.status)) || [...this.running.values()].some((r) => r.campaignId === c.id);
    if (!open) {
      const ok = fresh.every((t) => t.status === 'succeeded' || t.status === 'skipped');
      const anyOk = fresh.some((t) => t.status === 'succeeded');
      const status = ok ? 'completed' : anyOk ? 'completed_with_errors' : 'failed';
      this.setStatus(c.id, status);
      writeLog({ campaignId: c.id, taskId: null, agent: 'orchestrator', level: ok ? 'success' : 'warn', message: ok ? 'Chiến dịch hoàn tất 🎉' : 'Chiến dịch kết thúc nhưng có bước lỗi', data: null });
      this.setAgent('orchestrator', { status: ok ? 'done' : 'error', message: ok ? `Hoàn tất: ${c.title}` : `Kết thúc có lỗi: ${c.title}`, campaignId: c.id, taskId: null, progress: 1 });
    }
  }

  private async execute(c: Campaign, t: Task, byKey: Map<string, Task>) {
    const ctrl = new AbortController();
    this.running.set(t.id, { ctrl, campaignId: c.id, agent: t.agent });
    const attempt = t.attempts + 1;
    tasks.update(t.id, { status: 'running', attempts: attempt, startedAt: now(), error: null, progress: 0.02, message: 'Bắt đầu...' });
    t = { ...t, status: 'running', attempts: attempt };
    this.emitTask(t);
    for (const d of t.deps) {
      const dep = byKey.get(d);
      if (dep && dep.agent !== t.agent) this.emitHandoff(c.id, dep.agent, t.agent, dep.title);
    }
    this.setAgent(t.agent, { status: 'working', message: `${t.title}...`, campaignId: c.id, taskId: t.id, progress: 0 });
    writeLog({ campaignId: c.id, taskId: t.id, agent: t.agent, level: 'info', message: `Bắt đầu "${t.title}"${attempt > 1 ? ` (lần ${attempt})` : ''}`, data: null });

    const timer = setTimeout(() => ctrl.abort(new TimeoutError(`Quá thời gian ${Math.round(t.timeoutMs / 1000)}s`)), t.timeoutMs);
    const inputs: Record<string, any> = {};
    for (const dep of tasks.forCampaign(c.id)) if (dep.status === 'succeeded') inputs[dep.stepKey] = dep.output;
    const campaign = campaigns.get(c.id)!;
    const isDemo = campaign.mode === 'demo';
    try {
      const impl = resolveImpl(t);
      const run = impl.run({
        campaign, task: t, inputs, llm: resolveLLM(), signal: ctrl.signal,
        log: (message, level = 'info', data) => writeLog({ campaignId: c.id, taskId: t.id, agent: t.agent, level, message, data: data ?? null }),
        progress: (p, message) => {
          tasks.update(t.id, { progress: p, message });
          t.progress = p;
          t.message = message;
          this.emitTask(t);
          this.setAgent(t.agent, { status: 'working', message, campaignId: c.id, taskId: t.id, progress: p });
        },
        pace: () => (isDemo && config.demoStepDelayMs > 0 ? sleep(config.demoStepDelayMs, ctrl.signal) : Promise.resolve()),
      });
      // Make the abort signal win even if the agent ignores it.
      const aborted = new Promise<never>((_, rej) => ctrl.signal.addEventListener('abort', () => rej(ctrl.signal.reason), { once: true }));
      const res = await Promise.race([run, aborted]);
      tasks.update(t.id, { status: 'succeeded', output: res.output, resultKind: res.resultKind, progress: 1, message: res.summary, finishedAt: now() });
      writeLog({ campaignId: c.id, taskId: t.id, agent: t.agent, level: res.resultKind === 'simulated' ? 'warn' : 'success', message: `${t.title}: ${res.summary}`, data: { resultKind: res.resultKind } });
      this.setAgent(t.agent, { status: 'done', message: res.summary, campaignId: c.id, taskId: t.id, progress: 1 });
      this.emitTask({ ...t, status: 'succeeded', progress: 1, message: res.summary });
      if (['writer', 'researcher', 'factchecker'].includes(t.agent)) contentsChanged(c.id);
    } catch (err: any) {
      const reason = ctrl.signal.aborted ? ctrl.signal.reason : err;
      const msg = String(reason?.message ?? reason);
      if (reason instanceof CancelledError) {
        tasks.update(t.id, { status: 'cancelled', finishedAt: now(), message: 'Đã hủy' });
        this.setAgent(t.agent, { status: 'idle', message: 'Đã dừng', campaignId: null, taskId: null, progress: 0 });
      } else {
        const fatal = reason instanceof FatalError || reason?.retryable === false || reason?.status === 400 || reason?.status === 401 || reason?.status === 403;
        if (!fatal && attempt < t.maxAttempts) {
          const delay = this.backoffBaseMs * 2 ** (attempt - 1);
          tasks.update(t.id, { status: 'pending', error: msg, runAfter: new Date(Date.now() + delay).toISOString(), message: `Lỗi tạm thời, thử lại sau ${Math.round(delay / 1000)}s` });
          writeLog({ campaignId: c.id, taskId: t.id, agent: t.agent, level: 'warn', message: `${t.title} lỗi (lần ${attempt}/${t.maxAttempts}): ${msg} → thử lại sau ${Math.round(delay / 1000)}s`, data: null });
          this.setAgent(t.agent, { status: 'error', message: `Lỗi tạm thời, sẽ thử lại...`, campaignId: c.id, taskId: t.id, progress: t.progress });
        } else if (t.fallbackAgent && t.fallbackAgent !== t.agent) {
          tasks.update(t.id, { status: 'pending', agent: t.fallbackAgent, attempts: 0, error: msg, runAfter: null, message: `Chuyển cho ${t.fallbackAgent}` });
          writeLog({ campaignId: c.id, taskId: t.id, agent: t.agent, level: 'warn', message: `${t.title}: ${t.agent} thất bại → chuyển cho ${t.fallbackAgent}`, data: null });
          this.emitHandoff(c.id, t.agent, t.fallbackAgent, 'Chuyển giao do lỗi');
          this.setAgent(t.agent, { status: 'error', message: `Đã chuyển việc cho ${t.fallbackAgent}`, campaignId: c.id, taskId: t.id, progress: 0 });
        } else {
          tasks.update(t.id, { status: 'failed', error: msg, finishedAt: now(), message: 'Thất bại' });
          writeLog({ campaignId: c.id, taskId: t.id, agent: t.agent, level: 'error', message: `${t.title} thất bại: ${msg}`, data: null });
          this.setAgent(t.agent, { status: 'error', message: msg.slice(0, 120), campaignId: c.id, taskId: t.id, progress: t.progress });
        }
      }
      const fresh = tasks.get(t.id)!;
      this.emitTask(fresh);
    } finally {
      clearTimeout(timer);
      this.running.delete(t.id);
      queueMicrotask(() => void this.tick());
    }
  }

  // ---------------------------------------------------------------- live state

  setAgent(agent: AgentId, s: Omit<AgentLiveState, 'updatedAt'>) {
    const state = { ...s, updatedAt: now() };
    this.agentStates.set(agent, state);
    bus.publish({ type: 'agent', agent, state });
  }

  private emitTask(t: Task) {
    bus.publish({ type: 'task', campaignId: t.campaignId, taskId: t.id, status: t.status, progress: t.progress, message: t.message, agent: t.agent });
  }

  private emitHandoff(campaignId: string, from: AgentId, to: AgentId, label: string) {
    bus.publish({ type: 'handoff', campaignId, from, to, label });
  }

  isRunning(taskId: string) {
    return this.running.has(taskId);
  }
}

const idle = (): AgentLiveState => ({ status: 'idle', message: 'Đang rảnh', campaignId: null, taskId: null, progress: 0, updatedAt: now() });

function mustCampaign(cid: string) {
  const c = campaigns.get(cid);
  if (!c) throw new FatalError('Không tìm thấy chiến dịch');
  return c;
}

function contentsChanged(cid: string) {
  bus.publish({ type: 'content', campaignId: cid });
}

export const engine = new Engine();
