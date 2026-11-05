import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, LocateFixed } from 'lucide-react';
import { useStore } from '../../lib/store';
import type { Agent, AgentId } from '../../lib/api';
import { EDGES, ISLAND, ZONES, edgePath, iso, pts, spot, shade } from './iso';
import { Building, Desk } from './Building';
import { Avatar } from './Avatar';

const VB = { x: -510, y: -215, w: 1340, h: 880 };
const ORDER = (Object.keys(ZONES) as AgentId[]).sort((a, b) => ZONES[a].x + ZONES[a].y - (ZONES[b].x + ZONES[b].y));

export function OfficeScene() {
  const agents = useStore((s) => s.agents);
  const handoffs = useStore((s) => s.handoffs);
  const selected = useStore((s) => s.selectedAgent);
  const selectAgent = useStore((s) => s.selectAgent);
  const byId = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])) as Record<AgentId, Agent>, [agents]);

  const svgRef = useRef<SVGSVGElement>(null);
  // On portrait phones start zoomed in on the centre of the office.
  const initialView = () => (window.innerWidth < 640 ? { k: 1.9, tx: -280, ty: -260 } : { k: 1, tx: 0, ty: 0 });
  const [view, setView] = useState(initialView);
  const drag = useRef<{ moved: boolean; pointers: Map<number, { x: number; y: number }>; last?: { x: number; y: number }; dist?: number }>({ moved: false, pointers: new Map() });
  const [, force] = useState(0);

  // re-render every second so expired hand-off animations disappear
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const toSvg = (cx: number, cy: number) => {
    const svg = svgRef.current!;
    const p = svg.createSVGPoint();
    p.x = cx; p.y = cy;
    const r = p.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: r.x, y: r.y };
  };
  const zoomAt = (cx: number, cy: number, factor: number) => {
    const p = toSvg(cx, cy);
    setView((v) => {
      const k = Math.min(3.5, Math.max(0.5, v.k * factor));
      const f = k / v.k;
      return { k, tx: p.x - (p.x - v.tx) * f, ty: p.y - (p.y - v.ty) * f };
    });
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [agents.length > 0]);

  const onPointerDown = (e: React.PointerEvent) => {
    const d = drag.current;
    d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    d.moved = false;
    d.last = { x: e.clientX, y: e.clientY };
    d.dist = undefined;
    const move = (ev: PointerEvent) => {
      if (!d.pointers.has(ev.pointerId)) return;
      d.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const ps = [...d.pointers.values()];
      if (ps.length >= 2) {
        const dist = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
        if (d.dist) zoomAt((ps[0].x + ps[1].x) / 2, (ps[0].y + ps[1].y) / 2, dist / d.dist);
        d.dist = dist;
        d.moved = true;
        return;
      }
      const a = toSvg(d.last!.x, d.last!.y);
      const b = toSvg(ev.clientX, ev.clientY);
      if (Math.hypot(ev.clientX - d.last!.x, ev.clientY - d.last!.y) > 0) {
        if (!d.moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5) return;
        d.moved = true;
        setView((v) => ({ ...v, tx: v.tx + (b.x - a.x), ty: v.ty + (b.y - a.y) }));
        d.last = { x: ev.clientX, y: ev.clientY };
      }
    };
    const up = (ev: PointerEvent) => {
      d.pointers.delete(ev.pointerId);
      if (d.pointers.size === 0) {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      }
      d.dist = undefined;
    };
    if (d.pointers.size === 1) {
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    }
  };

  const clickAgent = (id: AgentId) => {
    if (drag.current.moved) return;
    selectAgent(selected === id ? null : id);
  };

  const recent = handoffs.filter((h) => Date.now() - h.at < 3500);
  const activeEdge = (from: AgentId, to: AgentId) => recent.find((h) => h.from === from && h.to === to);
  const { x0, y0, x1, y1 } = ISLAND;

  if (!agents.length) return <div className="h-full grid place-items-center text-mute">Đang tải văn phòng…</div>;

  return (
    <div className="relative h-full w-full overflow-hidden select-none" style={{ background: 'linear-gradient(180deg, var(--sky1), var(--sky2))' }}>
      <svg
        ref={svgRef}
        viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
        className="h-full w-full touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        role="img"
        aria-label="Văn phòng ảo các AI Agent"
      >
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {EDGES.map((e) => <path key={`p-${e.from}-${e.to}`} id={`edge-${e.from}-${e.to}`} d={edgePath(e.from, e.to, e.air)} />)}
        </defs>

        {/* clouds */}
        <g opacity={0.8}>
          {[[-200, 0.0, 70], [120, 0.35, 55], [-40, 0.7, 90]].map(([y, delay, dur], i) => (
            <g key={i} className="cloud" style={{ animationDuration: `${dur}s`, animationDelay: `-${(delay as number) * (dur as number)}s` }}>
              <g transform={`translate(${VB.x - 100}, ${y})`} fill="white" opacity={0.75}>
                <ellipse rx={60} ry={20} /><ellipse cx={34} cy={-12} rx={36} ry={22} /><ellipse cx={-30} cy={-6} rx={30} ry={16} />
              </g>
            </g>
          ))}
        </g>

        <g transform={`translate(${view.tx},${view.ty}) scale(${view.k})`}>
          <g className="island">
            {/* island body */}
            <polygon points={pts([[x0, y1, 0], [x1, y1, 0], [x1, y1, -70], [x0 + 1.5, y1, -110], [x0, y1, -60]])} fill="var(--dirt)" />
            <polygon points={pts([[x1, y0, 0], [x1, y1, 0], [x1, y1, -70], [x1, y0 + 2, -120], [x1, y0, -50]])} fill="var(--dirt2)" />
            <polygon points={pts([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])} fill="var(--grass)" />
            <polygon points={pts([[x0, y1, 0], [x1, y1, 0], [x1, y1, -10], [x0, y1, -10]])} fill="var(--grass2)" />
            <polygon points={pts([[x1, y0, 0], [x1, y1, 0], [x1, y1, -10], [x1, y0, -10]])} fill="var(--grass2)" />
            {/* checker tiles for texture */}
            {Array.from({ length: Math.floor(x1 - x0) }).map((_, i) =>
              Array.from({ length: Math.floor(y1 - y0) }).map((__, j) =>
                (i + j) % 2 === 0 ? <polygon key={`${i}-${j}`} points={pts([[x0 + i, y0 + j], [x0 + i + 1, y0 + j], [x0 + i + 1, y0 + j + 1], [x0 + i, y0 + j + 1]])} fill="#fff" opacity={0.06} /> : null,
              ),
            )}
            <Pond />

            {/* ground paths */}
            {EDGES.filter((e) => !e.air).map((e) => {
              const h = activeEdge(e.from, e.to);
              return (
                <g key={`g-${e.from}-${e.to}`}>
                  <path d={edgePath(e.from, e.to)} stroke="var(--path)" strokeWidth={16} fill="none" strokeLinecap="round" opacity={0.9} />
                  <path d={edgePath(e.from, e.to)} stroke={h ? byId[e.from]?.color : '#ffffff'} strokeWidth={3} fill="none" strokeDasharray="8 12" className={h ? 'flow-active' : ''} opacity={h ? 1 : 0.6} />
                </g>
              );
            })}

            <Trees />

            {/* zones, back to front */}
            {ORDER.map((id) => {
              const a = byId[id];
              if (!a) return null;
              const [sx, sy] = spot(id);
              const [px, py] = iso(sx, sy);
              return (
                <g key={id} onClick={() => clickAgent(id)} className="cursor-pointer" role="button" aria-label={`${a.name}: ${a.state.message}`}>
                  <Building zone={ZONES[id]} color={a.color === '#25F4EE' ? '#3ccfd0' : a.color} emoji={a.emoji} status={a.state.status} hq={id === 'orchestrator'} />
                  <g transform={`translate(${px},${py})`}>
                    <Avatar id={id} color={a.color} state={a.state} selected={selected === id} />
                  </g>
                  <Desk at={[sx + 0.3, sy + 0.3]} screenOn={a.state.status === 'working'} color={a.color} />
                </g>
              );
            })}

            {/* air routes (plan hand-offs) */}
            {EDGES.filter((e) => e.air).map((e) => {
              const h = activeEdge(e.from, e.to);
              return <path key={`a-${e.from}-${e.to}`} d={edgePath(e.from, e.to, true)} stroke={h ? byId[e.from]?.color : '#ffffff'} strokeWidth={h ? 3 : 2} fill="none" strokeDasharray="4 10" opacity={h ? 0.95 : 0.35} className={h ? 'flow-active' : ''} />;
            })}

            {/* moving packets for recent hand-offs */}
            {recent.map((h) => {
              const edge = EDGES.find((e) => e.from === h.from && e.to === h.to);
              if (!edge) return null;
              return (
                <g key={h.id} filter="url(#glow)">
                  <g>
                    <circle r={9} fill={byId[h.from]?.color ?? '#fff'} stroke="white" strokeWidth={3} />
                    <text textAnchor="middle" dominantBaseline="central" fontSize={10}>📄</text>
                    <animateMotion dur="1.4s" repeatCount="2" fill="freeze" rotate="0">
                      <mpath href={`#edge-${edge.from}-${edge.to}`} />
                    </animateMotion>
                  </g>
                </g>
              );
            })}

            {/* name tags + speech bubbles (top layer) */}
            {ORDER.map((id) => {
              const a = byId[id];
              if (!a) return null;
              const z = ZONES[id];
              const [tx, ty] = iso(z.x + z.size / 2 + 0.4, z.y + z.size + 0.95);
              const [px, py] = iso(...spot(id));
              const st = a.state.status;
              const fresh = Date.now() - new Date(a.state.updatedAt).getTime() < 10000;
              const show = st === 'working' || st === 'waiting' || st === 'error' || (st === 'done' && fresh) || selected === id;
              return (
                <g key={`ui-${id}`} pointerEvents="none">
                  <g transform={`translate(${tx},${ty + 20})`}>
                    <rect x={-66} y={-11} width={132} height={22} rx={11} fill="var(--wall)" opacity={0.92} stroke={shade(a.color === '#25F4EE' ? '#1fb5b0' : a.color, -0.1)} strokeOpacity={0.5} />
                    <text textAnchor="middle" dominantBaseline="central" fontSize={12.5} fontWeight={700} fill="#2b2d42">{a.name}</text>
                  </g>
                  {show && (
                    <foreignObject x={px - 120} y={py - 178} width={240} height={110} className="overflow-visible">
                      <div className="h-full flex flex-col justify-end items-center">
                        <div key={a.state.message} className="bubble relative max-w-[240px] rounded-2xl bg-white/95 dark:bg-[#2a2a40]/95 px-3 py-1.5 shadow-soft border-2 text-[14px] font-medium leading-snug text-[#2b2d42] dark:text-white" style={{ borderColor: a.color }}>
                          <div className="line-clamp-2">{a.state.message}</div>
                          {a.state.status === 'working' && (
                            <div className="mt-1 h-1.5 rounded-full bg-black/10 overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.round(a.state.progress * 100)}%`, background: a.color }} />
                            </div>
                          )}
                          <div className="absolute left-1/2 -bottom-1.5 h-3 w-3 -translate-x-1/2 rotate-45 bg-white/95 dark:bg-[#2a2a40]/95 border-r border-b" style={{ borderColor: a.color }} />
                        </div>
                      </div>
                    </foreignObject>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {/* zoom controls */}
      <div className="absolute right-3 bottom-3 flex flex-col gap-1.5">
        <button className="btn-ghost !p-2 bg-panel/90" aria-label="Phóng to" onClick={() => setView((v) => ({ ...v, k: Math.min(3.5, v.k * 1.2) }))}><Plus size={16} /></button>
        <button className="btn-ghost !p-2 bg-panel/90" aria-label="Thu nhỏ" onClick={() => setView((v) => ({ ...v, k: Math.max(0.5, v.k / 1.2) }))}><Minus size={16} /></button>
        <button className="btn-ghost !p-2 bg-panel/90" aria-label="Về giữa" onClick={() => setView(initialView())}><LocateFixed size={16} /></button>
      </div>
      <Legend />
    </div>
  );
}

function Legend() {
  const items: [string, string][] = [['#4ade80', 'Đang làm'], ['#fbbf24', 'Chờ duyệt'], ['#60a5fa', 'Xong'], ['#f43f5e', 'Lỗi'], ['#b8b5c9', 'Rảnh']];
  return (
    <div className="absolute left-3 bottom-3 hidden sm:flex gap-2 rounded-xl bg-panel/85 backdrop-blur px-3 py-1.5 text-[11px] text-mute border border-line">
      {items.map(([c, l]) => (
        <span key={l} className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{l}</span>
      ))}
    </div>
  );
}

function Pond() {
  const cx = 11.2, cy = 6.1;
  return (
    <g>
      <polygon points={pts([[cx - 0.9, cy - 0.6], [cx + 0.7, cy - 0.8], [cx + 0.8, cy + 0.6], [cx - 0.7, cy + 0.7]])} fill="#9bd8f5" opacity={0.85} />
      <ellipse cx={iso(cx, cy)[0] + 10} cy={iso(cx, cy)[1]} rx={10} ry={4} fill="white" opacity={0.5} />
    </g>
  );
}

const TREE_SPOTS: [number, number, number][] = [
  [-0.9, -1.6, 1], [1.8, -1.7, 0.8], [4.4, -1.6, 1.1], [6.4, -1.8, 0.9], [-1.0, 2.6, 0.9], [-0.9, 6.7, 1], [2.0, 6.8, 0.85],
  [4.8, 6.6, 1], [6.3, 6.9, 0.8], [9.5, -1.7, 1], [12.0, -1.4, 0.9], [12.1, 1.0, 0.8], [12.0, 4.2, 1], [9.3, 6.8, 0.9], [4.2, 0.0, 0.7], [4.3, 5.0, 0.7],
];

function Trees() {
  return (
    <g>
      {TREE_SPOTS.map(([x, y, s], i) => {
        const [px, py] = iso(x, y);
        const green = i % 3 === 0 ? '#7cc98a' : i % 3 === 1 ? '#8fd6a0' : '#f4a9c4';
        return (
          <g key={i} transform={`translate(${px},${py}) scale(${s})`}>
            <ellipse rx={14} ry={5} fill="#000" opacity={0.12} />
            <rect x={-3} y={-16} width={6} height={16} rx={2} fill="#a87b55" />
            <circle cy={-30} r={17} fill={green} />
            <circle cx={-7} cy={-36} r={9} fill="#fff" opacity={0.18} />
          </g>
        );
      })}
    </g>
  );
}
