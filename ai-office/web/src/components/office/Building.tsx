import { iso, pts, shade, type Zone } from './iso';
import type { AgentState } from '../../lib/api';

const LAMP: Record<AgentState['status'], string> = {
  idle: '#b8b5c9', working: '#4ade80', waiting: '#fbbf24', done: '#60a5fa', error: '#f43f5e',
};

/** A cute isometric house: pastel walls, gable roof in the agent colour, windows, door, sign & status lamp. */
export function Building({ zone, color, emoji, status, hq }: { zone: Zone; color: string; emoji: string; status: AgentState['status']; hq?: boolean }) {
  const { x, y, size: s, wall: h } = zone;
  const x0 = x + 0.12, y0 = y + 0.12, x1 = x0 + s, y1 = y0 + s;
  const rise = hq ? 26 : 30;
  const roof = color;
  const lit = status === 'working' || status === 'waiting';

  // window helper on the +y face (front-left) and +x face (front-right)
  const winL = (u0: number, u1: number, z0: number, z1: number) => pts([[x0 + u0 * s, y1, z0], [x0 + u1 * s, y1, z0], [x0 + u1 * s, y1, z1], [x0 + u0 * s, y1, z1]]);
  const winR = (v0: number, v1: number, z0: number, z1: number) => pts([[x1, y0 + v0 * s, z0], [x1, y0 + v1 * s, z0], [x1, y0 + v1 * s, z1], [x1, y0 + v0 * s, z1]]);
  const [sx, sy] = iso(x1, y0 + s / 2, h + rise + 4);
  const [lx, ly] = iso(x1, y1, h + 6);

  return (
    <g>
      {/* plot */}
      <polygon points={pts([[x - 0.15, y - 0.15], [x + s + 0.75, y - 0.15], [x + s + 0.75, y + s + 0.75], [x - 0.15, y + s + 0.75]])} fill={shade(color, 0.82)} opacity={0.75} />
      <polygon points={pts([[x - 0.15, y + s + 0.75], [x + s + 0.75, y + s + 0.75], [x + s + 0.75, y + s + 0.75, -5], [x - 0.15, y + s + 0.75, -5]])} fill={shade(color, 0.6)} opacity={0.6} />
      {/* walls */}
      <polygon points={pts([[x0, y1, 0], [x1, y1, 0], [x1, y1, h], [x0, y1, h]])} fill="var(--wall)" stroke={shade(color, -0.25)} strokeOpacity={0.25} />
      <polygon points={pts([[x1, y0, 0], [x1, y1, 0], [x1, y1, h], [x1, y0, h]])} fill="var(--wall2)" stroke={shade(color, -0.25)} strokeOpacity={0.25} />
      {hq && <polygon points={pts([[x0, y1, h * 0.48], [x1, y1, h * 0.48], [x1, y0, h * 0.48]])} fill="none" stroke={shade(color, -0.1)} strokeWidth={2} opacity={0.4} />}
      {/* windows */}
      <polygon points={winL(0.12, 0.36, h * 0.42, h * 0.78)} fill="var(--window)" opacity={lit ? 1 : 0.8} />
      <polygon points={winR(0.16, 0.42, h * 0.42, h * 0.78)} fill="var(--window)" opacity={lit ? 1 : 0.8} />
      {hq && <polygon points={winR(0.58, 0.84, h * 0.42, h * 0.78)} fill="var(--window)" opacity={lit ? 1 : 0.8} />}
      {hq && <polygon points={winL(0.12, 0.36, h * 0.08, h * 0.36)} fill="var(--window)" opacity={0.8} />}
      {/* door */}
      <polygon points={winL(0.58, 0.84, 0, h * (hq ? 0.36 : 0.62))} fill={shade(color, -0.2)} />
      {/* roof: back slope, front slope, gable end */}
      <polygon points={pts([[x0 - 0.06, y0 - 0.06, h], [x1 + 0.06, y0 - 0.06, h], [x1 + 0.06, y0 + s / 2, h + rise], [x0 - 0.06, y0 + s / 2, h + rise]])} fill={shade(roof, 0.25)} />
      <polygon points={pts([[x0 - 0.06, y1 + 0.06, h], [x1 + 0.06, y1 + 0.06, h], [x1 + 0.06, y0 + s / 2, h + rise], [x0 - 0.06, y0 + s / 2, h + rise]])} fill={roof} />
      <polygon points={pts([[x1, y0, h], [x1, y1, h], [x1, y0 + s / 2, h + rise]])} fill={shade(roof, -0.15)} />
      {/* chimney / antenna for HQ */}
      {hq && (
        <g>
          <line x1={sx} y1={sy} x2={sx} y2={sy - 26} stroke={shade(color, -0.3)} strokeWidth={3} />
          <circle cx={sx} cy={sy - 28} r={5} fill={lit ? '#fbbf24' : shade(color, 0.4)} />
        </g>
      )}
      {/* sign */}
      <g transform={`translate(${sx - (hq ? 34 : 0)}, ${sy - (hq ? 0 : 6)})`}>
        <circle r={hq ? 17 : 14} fill="white" stroke={roof} strokeWidth={3} />
        <text textAnchor="middle" dominantBaseline="central" fontSize={hq ? 18 : 15}>{emoji}</text>
      </g>
      {/* status lamp */}
      <g transform={`translate(${lx + 6}, ${ly})`}>
        {status === 'working' && <circle r={6} fill="none" stroke={LAMP[status]} strokeWidth={2} className="ring-pulse" />}
        <circle r={5} fill={LAMP[status]} stroke="white" strokeWidth={1.5} />
      </g>
    </g>
  );
}

export function Desk({ at, screenOn, color }: { at: [number, number]; screenOn: boolean; color: string }) {
  const [x, y] = at;
  const a = x + 0.05, b = y - 0.15, w = 0.55, d = 0.3, h = 14;
  return (
    <g>
      <polygon points={pts([[a, b + d, 0], [a + w, b + d, 0], [a + w, b + d, h], [a, b + d, h]])} fill="#c9a37c" />
      <polygon points={pts([[a + w, b, 0], [a + w, b + d, 0], [a + w, b + d, h], [a + w, b, h]])} fill="#b38c64" />
      <polygon points={pts([[a, b, h], [a + w, b, h], [a + w, b + d, h], [a, b + d, h]])} fill="#e3c39d" />
      {/* laptop */}
      <polygon points={pts([[a + 0.12, b + 0.06, h], [a + 0.42, b + 0.06, h], [a + 0.42, b + 0.06, h + 16], [a + 0.12, b + 0.06, h + 16]])} fill={screenOn ? color : '#6b7280'} opacity={screenOn ? 0.9 : 0.6} />
    </g>
  );
}
