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
  { id: 'orchestrator', name: 'Tổng biên tập', role: 'Orchestrator — điều phối tòa soạn', emoji: '🧠', color: '#8B7CF6',
    duties: ['Hiểu yêu cầu tiếng Việt', 'Lập kế hoạch săn tin', 'Trình chủ đề & bài để duyệt', 'Quản lý tiến độ, retry'] },
  { id: 'researcher', name: 'Phóng viên săn tin', role: 'Tìm chủ đề HOT, chuyện lạ có thật', emoji: '🛰️', color: '#5BB5F0',
    duties: ['Quét báo chí, MXH, trang khoa học', 'Trong nước & thế giới', 'Không lặp chủ đề cũ', 'Chấm điểm hấp dẫn'] },
  { id: 'factchecker', name: 'Kiểm chứng viên', role: 'Fact-check bắt buộc', emoji: '🕵️', color: '#F5A25D',
    duties: ['Truy nguồn gốc', '≥2 nguồn độc lập', 'Phát hiện tin cũ, ảnh sai ngữ cảnh', 'Tách sự thật / giả thuyết'] },
  { id: 'editor', name: 'Thiết kế ảnh', role: 'Ảnh minh họa đúng chuẩn', emoji: '🎨', color: '#F06C9B',
    duties: ['Thẻ ảnh tỷ lệ Facebook', 'Ghi nguồn ảnh', 'Gắn nhãn "Ảnh minh họa"', 'Video 9:16 khi cần'] },
  { id: 'writer', name: 'Biên tập viên', role: 'Viết bài Facebook cuốn hút', emoji: '✍️', color: '#7DCB8A',
    duties: ['Hook mạnh 1–2 dòng', 'Kể chuyện có cao trào', 'Kết bằng câu hỏi mở', 'Luôn ghi nguồn'] },
  { id: 'zalo', name: 'Zalo Publisher', role: 'Đăng Zalo OA', emoji: '💬', color: '#2D8CFF',
    duties: ['Bài viết Zalo OA', 'Gói đăng thủ công cho nhóm'] },
  { id: 'facebook', name: 'Facebook Publisher', role: 'Đăng trang Facebook chính', emoji: '📘', color: '#4267B2',
    duties: ['Đăng ảnh + bài', 'Giãn cách giữa các bài', 'Ghi link & trạng thái'] },
  { id: 'tiktok', name: 'TikTok Publisher', role: 'Đăng TikTok', emoji: '🎵', color: '#25F4EE',
    duties: ['Video 9:16', 'Direct Post hoặc nháp Inbox'] },
  { id: 'threads', name: 'Threads Publisher', role: 'Đăng Threads', emoji: '🧵', color: '#444444',
    duties: ['Bản rút gọn ≤500 ký tự', 'Ghi kết quả đăng'] },
  { id: 'reporter', name: 'Reporter', role: 'Báo cáo', emoji: '📊', color: '#F2C94C',
    duties: ['Tổng hợp chủ đề & bài đăng', 'Thu số liệu tương tác', 'Xuất PDF / Excel'] },
];

export const profileOf = (id: AgentId) => AGENT_PROFILES.find((a) => a.id === id)!;
