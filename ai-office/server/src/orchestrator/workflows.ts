import { workflows } from '../db/index.js';
import type { Platform, Workflow, WorkflowStep } from '../core/types.js';

const publishSteps = (deps: string[]): WorkflowStep[] => [
  { key: 'publish_zalo', agent: 'zalo', title: 'Đăng Zalo OA', deps, platform: 'zalo', maxAttempts: 3 },
  { key: 'publish_facebook', agent: 'facebook', title: 'Đăng Facebook Page', deps, platform: 'facebook', maxAttempts: 3 },
  { key: 'publish_tiktok', agent: 'tiktok', title: 'Đăng TikTok', deps, platform: 'tiktok', maxAttempts: 3, timeoutMs: 600000 },
  { key: 'publish_threads', agent: 'threads', title: 'Đăng Threads', deps, platform: 'threads', maxAttempts: 3 },
];
const PUB_KEYS = ['publish_zalo', 'publish_facebook', 'publish_tiktok', 'publish_threads'];

export const BUILTIN_WORKFLOWS: Workflow[] = [
  {
    id: 'wf_newsroom',
    name: 'Tòa soạn: săn tin → kiểm chứng → đăng',
    description: 'Lập kế hoạch → Săn tin → Kiểm chứng → Anh chọn chủ đề → Thiết kế ảnh ∥ Viết bài → Anh duyệt bài → Đăng → Số liệu → Báo cáo',
    builtin: true,
    steps: [
      { key: 'plan', agent: 'orchestrator', title: 'Lập kế hoạch săn tin', deps: [], maxAttempts: 2 },
      { key: 'research', agent: 'researcher', title: 'Săn chủ đề HOT', deps: ['plan'], timeoutMs: 600000 },
      { key: 'verify', agent: 'factchecker', title: 'Kiểm chứng thông tin', deps: ['research'], timeoutMs: 1800000, maxAttempts: 2 },
      { key: 'select', agent: 'orchestrator', title: 'Chọn chủ đề phát triển', deps: ['verify'], type: 'approval' },
      { key: 'edit', agent: 'editor', title: 'Thiết kế ảnh minh họa', deps: ['select'], timeoutMs: 300000 },
      { key: 'write', agent: 'writer', title: 'Viết bài', deps: ['select'], timeoutMs: 900000 },
      { key: 'approve', agent: 'orchestrator', title: 'Duyệt bài trước khi đăng', deps: ['edit', 'write'], type: 'approval' },
      ...publishSteps(['approve']),
      { key: 'metrics', agent: 'reporter', title: 'Thu thập kết quả', deps: PUB_KEYS, depMode: 'settled' },
      { key: 'report', agent: 'reporter', title: 'Xuất báo cáo', deps: ['metrics'], depMode: 'settled' },
    ],
  },
  {
    id: 'wf_proposals',
    name: 'Chỉ đề xuất chủ đề (không viết bài)',
    description: 'Săn tin → Kiểm chứng → Báo cáo danh sách 5–10 chủ đề kèm nguồn, để anh tự triển khai.',
    builtin: true,
    steps: [
      { key: 'plan', agent: 'orchestrator', title: 'Lập kế hoạch săn tin', deps: [] },
      { key: 'research', agent: 'researcher', title: 'Săn chủ đề HOT', deps: ['plan'], timeoutMs: 600000 },
      { key: 'verify', agent: 'factchecker', title: 'Kiểm chứng thông tin', deps: ['research'], timeoutMs: 1800000, maxAttempts: 2 },
      { key: 'report', agent: 'reporter', title: 'Xuất báo cáo chủ đề', deps: ['verify'], depMode: 'settled' },
    ],
  },
];

export function seedWorkflows() {
  const ids = new Set(BUILTIN_WORKFLOWS.map((w) => w.id));
  for (const w of workflows.list()) if (w.builtin && !ids.has(w.id)) workflows.forceRemove(w.id);
  for (const w of BUILTIN_WORKFLOWS) workflows.upsert(w);
}

/**
 * Instantiate the steps that apply to a campaign: drop disabled steps and publishers for
 * platforms not selected, rewiring dependencies through removed steps so ordering is kept.
 */
export function resolveSteps(wf: Workflow, platforms: Platform[]): WorkflowStep[] {
  const keep = (s: WorkflowStep) => s.enabled !== false && (!s.platform || platforms.includes(s.platform));
  const byKey = new Map(wf.steps.map((s) => [s.key, s]));
  const resolveDeps = (deps: string[], seen = new Set<string>()): string[] =>
    deps.flatMap((d) => {
      if (seen.has(d)) return [];
      seen.add(d);
      const s = byKey.get(d);
      if (!s) return [];
      if (keep(s)) return [d];
      // A publisher for an unselected platform simply disappears; a disabled step is bridged.
      if (s.platform && !platforms.includes(s.platform)) return [];
      return resolveDeps(s.deps, seen);
    });
  return wf.steps.filter(keep).map((s) => ({ ...s, deps: [...new Set(resolveDeps(s.deps))] }));
}

export function validateWorkflow(w: Pick<Workflow, 'steps'>): string | null {
  const keys = new Set<string>();
  for (const s of w.steps) {
    if (!s.key || keys.has(s.key)) return `Khóa bước trùng hoặc trống: ${s.key}`;
    keys.add(s.key);
  }
  for (const s of w.steps) for (const d of s.deps) if (!keys.has(d)) return `Bước "${s.key}" phụ thuộc bước không tồn tại "${d}"`;
  // cycle check
  const state = new Map<string, number>();
  const byKey = new Map(w.steps.map((s) => [s.key, s]));
  const visit = (k: string): boolean => {
    if (state.get(k) === 1) return false;
    if (state.get(k) === 2) return true;
    state.set(k, 1);
    for (const d of byKey.get(k)!.deps) if (!visit(d)) return false;
    state.set(k, 2);
    return true;
  };
  for (const s of w.steps) if (!visit(s.key)) return 'Workflow có vòng lặp phụ thuộc';
  return null;
}
