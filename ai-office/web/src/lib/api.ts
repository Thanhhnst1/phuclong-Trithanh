export type AgentId =
  | 'orchestrator' | 'researcher' | 'collector' | 'editor' | 'writer'
  | 'zalo' | 'facebook' | 'tiktok' | 'threads' | 'reporter';
export type Platform = 'zalo' | 'facebook' | 'tiktok' | 'threads';
export const PLATFORMS: Platform[] = ['zalo', 'facebook', 'tiktok', 'threads'];

export interface AgentState {
  status: 'idle' | 'working' | 'waiting' | 'done' | 'error';
  message: string;
  campaignId: string | null;
  taskId: string | null;
  progress: number;
  updatedAt: string;
}
export interface Agent {
  id: AgentId; name: string; role: string; emoji: string; color: string; duties: string[]; state: AgentState;
}
export interface User { id: string; email: string; name: string; role: 'admin' | 'editor' | 'viewer' }

export interface Campaign {
  id: string; title: string; goal: string; workflowId: string; platforms: Platform[]; status: string; mode: 'demo' | 'production';
  plan: any; createdAt: string; updatedAt: string; scheduledAt: string | null; publishAt: string | null;
  progress?: number; taskCount?: number;
}
export interface Task {
  id: string; campaignId: string; stepKey: string; agent: AgentId; title: string; type: 'agent' | 'approval'; platform: Platform | null;
  status: string; deps: string[]; output: any; resultKind: string | null; progress: number; message: string | null; attempts: number;
  maxAttempts: number; error: string | null; startedAt: string | null; finishedAt: string | null; runAfter: string | null;
}
export interface Asset {
  id: string; campaignId: string | null; kind: string; role: string; path: string; mime: string; width: number | null; height: number | null;
  source: string; license: string; label: string; meta: any; createdAt: string; derivedFrom: string | null;
}
export interface Content {
  id: string; campaignId: string; platform: Platform; variant: number; title: string; body: string; hashtags: string[]; cta: string;
  mediaIds: string[]; status: 'draft' | 'approved' | 'rejected'; resultKind: string;
}
export interface Publication {
  id: string; platform: Platform; mode: 'real' | 'simulated' | 'manual'; status: string; url: string | null; error: string | null;
  metrics: Record<string, number> | null; contentId: string | null; response: any; createdAt: string;
}
export interface CampaignDetail { campaign: Campaign; tasks: Task[]; contents: Content[]; assets: Asset[]; publications: Publication[] }
export interface LogRow { id: number; campaignId: string | null; taskId: string | null; agent: string | null; level: string; message: string; createdAt: string }
export interface Workflow { id: string; name: string; description: string; builtin: boolean; steps: any[] }
export interface SystemInfo {
  mode: 'demo' | 'production'; llm: { configured: boolean; active: boolean; model: string }; ffmpeg: boolean;
  publicBaseUrl: string | null; vaultKeySource: 'env' | 'file'; integrations: Record<string, boolean>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await fetch(url, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Lỗi ${res.status}`);
  return data as T;
}

export const api = {
  get: <T>(u: string) => req<T>('GET', u),
  post: <T>(u: string, b?: unknown) => req<T>('POST', u, b ?? {}),
  put: <T>(u: string, b?: unknown) => req<T>('PUT', u, b ?? {}),
  patch: <T>(u: string, b?: unknown) => req<T>('PATCH', u, b ?? {}),
  del: <T>(u: string) => req<T>('DELETE', u),
  upload: <T>(u: string, fd: FormData) => req<T>('POST', u, fd),
};

export const mediaUrl = (id: string) => `/media/${id}`;

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Nháp', scheduled: 'Đã hẹn giờ', running: 'Đang chạy', awaiting_approval: 'Chờ duyệt', paused: 'Tạm dừng',
  completed: 'Hoàn tất', completed_with_errors: 'Xong (có lỗi)', failed: 'Thất bại', cancelled: 'Đã hủy',
  pending: 'Chờ', succeeded: 'Xong', skipped: 'Bỏ qua', blocked: 'Bị chặn',
  published: 'Đã đăng', draft_uploaded: 'Đã gửi nháp', simulated: 'MÔ PHỎNG', manual_pending: 'Chờ đăng tay', manual_done: 'Đã đăng tay',
};

export const STATUS_COLOR: Record<string, string> = {
  running: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  awaiting_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  paused: 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
  scheduled: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  succeeded: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  published: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  manual_done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  draft_uploaded: 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
  completed_with_errors: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
  failed: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  blocked: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  cancelled: 'bg-slate-200 text-slate-600 dark:bg-slate-500/20 dark:text-slate-400',
  simulated: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300',
  manual_pending: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  pending: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300',
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300',
};

export const PLATFORM_META: Record<Platform, { label: string; color: string; emoji: string }> = {
  zalo: { label: 'Zalo', color: '#2D8CFF', emoji: '💬' },
  facebook: { label: 'Facebook', color: '#4267B2', emoji: '📘' },
  tiktok: { label: 'TikTok', color: '#111111', emoji: '🎵' },
  threads: { label: 'Threads', color: '#444444', emoji: '🧵' },
};

export const fmtTime = (s: string | null) => (s ? new Date(s).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '—');
