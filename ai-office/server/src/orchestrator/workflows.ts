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
    id: 'wf_full',
    name: 'Quảng bá đa nền tảng (đầy đủ)',
    description: 'Lập kế hoạch → Nghiên cứu ∥ Thu thập → Chỉnh sửa ∥ Viết bài → Duyệt → Đăng đa nền tảng → Số liệu → Báo cáo',
    builtin: true,
    steps: [
      { key: 'plan', agent: 'orchestrator', title: 'Lập kế hoạch', deps: [], maxAttempts: 2 },
      { key: 'research', agent: 'researcher', title: 'Nghiên cứu thị trường', deps: ['plan'], timeoutMs: 300000 },
      { key: 'collect', agent: 'collector', title: 'Thu thập tư liệu', deps: ['plan'] },
      { key: 'edit', agent: 'editor', title: 'Chỉnh sửa ảnh & video', deps: ['collect'], timeoutMs: 300000 },
      { key: 'write', agent: 'writer', title: 'Viết nội dung', deps: ['research'], timeoutMs: 300000 },
      { key: 'approve', agent: 'orchestrator', title: 'Người dùng phê duyệt', deps: ['edit', 'write'], type: 'approval' },
      ...publishSteps(['approve']),
      { key: 'metrics', agent: 'reporter', title: 'Thu thập kết quả', deps: PUB_KEYS, depMode: 'settled' },
      { key: 'report', agent: 'reporter', title: 'Xuất báo cáo', deps: ['metrics'], depMode: 'settled' },
    ],
  },
  {
    id: 'wf_quick',
    name: 'Đăng nhanh (bỏ nghiên cứu)',
    description: 'Dùng ảnh có sẵn: Thu thập → Chỉnh sửa ∥ Viết bài → Duyệt → Đăng → Báo cáo',
    builtin: true,
    steps: [
      { key: 'plan', agent: 'orchestrator', title: 'Lập kế hoạch', deps: [] },
      { key: 'collect', agent: 'collector', title: 'Thu thập tư liệu', deps: ['plan'] },
      { key: 'edit', agent: 'editor', title: 'Chỉnh sửa ảnh & video', deps: ['collect'] },
      { key: 'write', agent: 'writer', title: 'Viết nội dung', deps: ['plan'] },
      { key: 'approve', agent: 'orchestrator', title: 'Người dùng phê duyệt', deps: ['edit', 'write'], type: 'approval' },
      ...publishSteps(['approve']),
      { key: 'report', agent: 'reporter', title: 'Xuất báo cáo', deps: PUB_KEYS, depMode: 'settled' },
    ],
  },
  {
    id: 'wf_content',
    name: 'Chỉ sản xuất nội dung (không đăng)',
    description: 'Nghiên cứu → Thu thập → Chỉnh sửa ∥ Viết → Duyệt → Báo cáo. Phù hợp khi muốn tự đăng.',
    builtin: true,
    steps: [
      { key: 'plan', agent: 'orchestrator', title: 'Lập kế hoạch', deps: [] },
      { key: 'research', agent: 'researcher', title: 'Nghiên cứu thị trường', deps: ['plan'] },
      { key: 'collect', agent: 'collector', title: 'Thu thập tư liệu', deps: ['plan'] },
      { key: 'edit', agent: 'editor', title: 'Chỉnh sửa ảnh & video', deps: ['collect'] },
      { key: 'write', agent: 'writer', title: 'Viết nội dung', deps: ['research'] },
      { key: 'approve', agent: 'orchestrator', title: 'Người dùng phê duyệt', deps: ['edit', 'write'], type: 'approval' },
      { key: 'report', agent: 'reporter', title: 'Xuất báo cáo', deps: ['approve'], depMode: 'settled' },
    ],
  },
];

export function seedWorkflows() {
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
