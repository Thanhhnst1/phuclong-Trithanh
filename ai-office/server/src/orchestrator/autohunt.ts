import { settings, users } from '../db/index.js';
import { engine } from './engine.js';
import { writeLog } from '../core/log.js';
import type { HuntOptions, Platform, RunMode } from '../core/types.js';

/** Daily automatic topic hunt ("hoạt động lâu dài"): creates one newsroom campaign per day at the configured time. */
export interface AutoHunt {
  enabled: boolean;
  time: string; // HH:MM, server local time
  goal: string;
  platforms: Platform[];
  workflowId: string;
  options: HuntOptions;
  userId: string;
  lastRun: string | null; // YYYY-MM-DD
}

export const DEFAULT_AUTOHUNT: Omit<AutoHunt, 'userId'> = {
  enabled: false, time: '07:15', goal: 'Săn 8 câu chuyện kỳ lạ, bí ẩn, khám phá khoa học có thật trong 24 giờ qua cho trang Facebook',
  platforms: ['facebook'], workflowId: 'wf_newsroom', options: { count: 8, categories: [], region: 'both' }, lastRun: null,
};

export function getAutoHunt(): AutoHunt | null {
  const raw = settings.get('autoHunt');
  return raw ? JSON.parse(raw) : null;
}

export function saveAutoHunt(a: AutoHunt) {
  settings.set('autoHunt', JSON.stringify(a));
}

const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function runAutoHunt(mode: RunMode, nowDate = new Date()) {
  const a = getAutoHunt();
  if (!a?.enabled) return null;
  const [hh, mm] = a.time.split(':').map(Number);
  const due = nowDate.getHours() > hh || (nowDate.getHours() === hh && nowDate.getMinutes() >= mm);
  if (!due || a.lastRun === today(nowDate)) return null;
  if (!users.byId(a.userId)) return null;
  saveAutoHunt({ ...a, lastRun: today(nowDate) });
  const c = engine.createCampaign({ goal: a.goal, workflowId: a.workflowId, platforms: a.platforms, mode, createdBy: a.userId, options: a.options });
  writeLog({ campaignId: c.id, taskId: null, agent: 'orchestrator', level: 'info', message: `Săn tin tự động hằng ngày (${a.time}) đã bắt đầu`, data: null });
  return c;
}
