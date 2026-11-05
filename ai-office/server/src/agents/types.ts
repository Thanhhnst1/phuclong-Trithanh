import type { AgentId, Campaign, ResultKind, Task } from '../core/types.js';
import type { LLM } from '../llm/index.js';

export interface AgentContext {
  campaign: Campaign;
  task: Task;
  /** Outputs of completed dependency tasks keyed by step key. */
  inputs: Record<string, any>;
  llm: LLM | null;
  signal: AbortSignal;
  log: (message: string, level?: 'info' | 'warn' | 'error' | 'success', data?: any) => void;
  /** Update progress (0-1) and the speech-bubble message shown in the office. */
  progress: (p: number, message: string) => void;
  /** Pause between visible steps in demo mode so the animation is followable. */
  pace: () => Promise<void>;
}

export interface AgentResult {
  output: any;
  resultKind: ResultKind;
  summary: string;
}

export interface AgentImpl {
  run(ctx: AgentContext): Promise<AgentResult>;
}

export interface AgentProfile {
  id: AgentId;
  name: string;
  role: string;
  emoji: string;
  color: string;
  duties: string[];
}

export const AGENT_PROFILES: AgentProfile[] = [
  { id: 'orchestrator', name: 'Orchestrator', role: 'Bộ não điều phối', emoji: '🧠', color: '#8B7CF6',
    duties: ['Hiểu mục tiêu tiếng Việt', 'Lập kế hoạch & phân việc', 'Quản lý phụ thuộc, retry', 'Trình duyệt nội dung'] },
  { id: 'researcher', name: 'Researcher', role: 'Nghiên cứu', emoji: '🔎', color: '#5BB5F0',
    duties: ['Tìm thông tin, xu hướng', 'Phân tích đối thủ', 'Đề xuất ý tưởng', 'Tổng hợp nguồn'] },
  { id: 'collector', name: 'Asset Collector', role: 'Thu thập tư liệu', emoji: '📦', color: '#F5A25D',
    duties: ['Thu thập ảnh/video được phép', 'Phân loại & lưu trữ', 'Phát hiện ảnh trùng', 'Ghi nguồn & giấy phép'] },
  { id: 'editor', name: 'Media Editor', role: 'Chỉnh sửa', emoji: '🎨', color: '#F06C9B',
    duties: ['Poster theo tỉ lệ nền tảng', 'Thêm tiêu đề, logo', 'Dựng video ngắn 9:16'] },
  { id: 'writer', name: 'Content Writer', role: 'Viết nội dung', emoji: '✍️', color: '#7DCB8A',
    duties: ['Caption, tiêu đề, hashtag', 'Văn phong theo nền tảng', 'Nhiều phương án để chọn'] },
  { id: 'zalo', name: 'Zalo Publisher', role: 'Đăng Zalo OA', emoji: '💬', color: '#2D8CFF',
    duties: ['Chuẩn bị bài Zalo', 'Đăng qua Zalo OA API', 'Gói đăng thủ công cho nhóm Zalo'] },
  { id: 'facebook', name: 'Facebook Publisher', role: 'Đăng Facebook Page', emoji: '📘', color: '#4267B2',
    duties: ['Đăng ảnh/video + caption', 'Ghi link & trạng thái'] },
  { id: 'tiktok', name: 'TikTok Publisher', role: 'Đăng TikTok', emoji: '🎵', color: '#25F4EE',
    duties: ['Video chuẩn 9:16', 'Direct Post hoặc nháp Inbox'] },
  { id: 'threads', name: 'Threads Publisher', role: 'Đăng Threads', emoji: '🧵', color: '#444444',
    duties: ['Bài chữ/ảnh ngắn gọn', 'Ghi kết quả đăng'] },
  { id: 'reporter', name: 'Reporter', role: 'Báo cáo', emoji: '📊', color: '#F2C94C',
    duties: ['Tổng hợp tiến độ', 'Thu số liệu tương tác', 'Xuất PDF / Excel'] },
];

export const profileOf = (id: AgentId) => AGENT_PROFILES.find((a) => a.id === id)!;
