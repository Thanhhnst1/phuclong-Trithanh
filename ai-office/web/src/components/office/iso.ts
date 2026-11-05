import type { AgentId } from '../../lib/api';

/** Isometric projection: world (x, y, z px) → screen. One tile = 120×60 px. */
export const TW = 120;
export const TH = 60;
export const iso = (x: number, y: number, z = 0): [number, number] => [(x - y) * (TW / 2), (x + y) * (TH / 2) - z];
export const pts = (list: [number, number, number?][]) => list.map(([x, y, z]) => iso(x, y, z ?? 0).join(',')).join(' ');

export interface Zone {
  x: number;
  y: number;
  size: number; // house footprint
  wall: number; // wall height px
  label: string;
}

/** Layout of the miniature office: work flows from top-left (research) to bottom-right (report). */
export const ZONES: Record<AgentId, Zone> = {
  researcher: { x: 0, y: 0.4, size: 1.25, wall: 42, label: 'Phòng Nghiên cứu' },
  collector: { x: 0, y: 4.1, size: 1.25, wall: 42, label: 'Kho Tư liệu' },
  writer: { x: 2.6, y: 0.4, size: 1.25, wall: 42, label: 'Góc Viết bài' },
  editor: { x: 2.6, y: 4.1, size: 1.25, wall: 42, label: 'Studio Thiết kế' },
  orchestrator: { x: 5.1, y: 2.05, size: 1.7, wall: 78, label: 'Trung tâm Điều phối' },
  zalo: { x: 7.9, y: -0.75, size: 1.1, wall: 38, label: 'Zalo' },
  facebook: { x: 7.9, y: 1.2, size: 1.1, wall: 38, label: 'Facebook' },
  tiktok: { x: 7.9, y: 3.15, size: 1.1, wall: 38, label: 'TikTok' },
  threads: { x: 7.9, y: 5.1, size: 1.1, wall: 38, label: 'Threads' },
  reporter: { x: 10.4, y: 2.1, size: 1.3, wall: 52, label: 'Phòng Báo cáo' },
};

/** Where the avatar stands (in front of the house, toward the viewer). */
export const spot = (id: AgentId): [number, number] => {
  const z = ZONES[id];
  return [z.x + z.size + 0.35, z.y + z.size + 0.35];
};

export const ISLAND = { x0: -1.3, y0: -2.0, x1: 12.4, y1: 7.2 };

export const EDGES: { from: AgentId; to: AgentId; air?: boolean }[] = [
  { from: 'orchestrator', to: 'researcher', air: true },
  { from: 'orchestrator', to: 'collector', air: true },
  { from: 'researcher', to: 'writer' },
  { from: 'collector', to: 'editor' },
  { from: 'writer', to: 'orchestrator' },
  { from: 'editor', to: 'orchestrator' },
  { from: 'orchestrator', to: 'zalo' },
  { from: 'orchestrator', to: 'facebook' },
  { from: 'orchestrator', to: 'tiktok' },
  { from: 'orchestrator', to: 'threads' },
  { from: 'zalo', to: 'reporter' },
  { from: 'facebook', to: 'reporter' },
  { from: 'tiktok', to: 'reporter' },
  { from: 'threads', to: 'reporter' },
];

export function edgePath(from: AgentId, to: AgentId, air = false) {
  const [ax, ay] = spot(from);
  const [bx, by] = spot(to);
  const [sx, sy] = iso(ax, ay);
  const [ex, ey] = iso(bx, by);
  const mx = (sx + ex) / 2;
  const my = (sy + ey) / 2 - (air ? 150 : 18);
  return `M${sx},${sy} Q${mx},${my} ${ex},${ey}`;
}

export function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
  const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
