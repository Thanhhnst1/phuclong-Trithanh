import type { AgentId, AgentState } from '../../lib/api';
import { shade } from './iso';

const HAIR: Partial<Record<AgentId, string>> = {
  researcher: '#3b2f2f', factchecker: '#7a4b2a', editor: '#d9468b', writer: '#2f4f3a', orchestrator: '#4b3b8f',
  zalo: '#1f3b73', facebook: '#25324d', tiktok: '#111', threads: '#222', reporter: '#8a5a00',
};

/** Prop each agent holds; animated while working. */
function Prop({ id, color }: { id: AgentId; color: string }) {
  switch (id) {
    case 'researcher':
      // satellite dish: scanning the web for stories
      return (
        <g className="av-prop-sway fbox" transform="translate(15,-30)">
          <line x1={0} y1={0} x2={0} y2={12} stroke="#556" strokeWidth={2} />
          <path d="M-8,-2 Q0,10 8,-2Z" fill="#e0f2ff" stroke="#334" strokeWidth={1.5} />
          <circle cx={0} cy={-6} r={2} fill="#f43f5e" />
        </g>
      );
    case 'factchecker':
      // magnifier over a document
      return (
        <g transform="translate(-16,-26)">
          <rect width={12} height={15} rx={1.5} fill="white" stroke="#9ca3af" />
          <path d="M3,8 L5.5,10.5 L9.5,5" stroke="#22c55e" strokeWidth={2} fill="none" />
          <g className="av-prop-sway fbox" transform="translate(30,4)">
            <circle r={6} fill="#e0f2ff" stroke="#334" strokeWidth={2} />
            <line x1={4} y1={4} x2={10} y2={10} stroke="#334" strokeWidth={3} strokeLinecap="round" />
          </g>
        </g>
      );
    case 'editor':
      return (
        <g className="av-prop-sway fbox" transform="translate(13,-26)">
          <ellipse rx={8} ry={6} fill="#fff4e0" stroke="#c48" />
          <circle cx={-3} cy={-1} r={1.8} fill="#f43f5e" />
          <circle cx={1} cy={-2.5} r={1.8} fill="#3b82f6" />
          <circle cx={3.5} cy={1} r={1.8} fill="#22c55e" />
        </g>
      );
    case 'writer':
      return (
        <g transform="translate(-14,-24)">
          <rect width={12} height={15} rx={1.5} fill="white" stroke="#9ca3af" />
          <line x1={2} y1={4} x2={10} y2={4} stroke="#cbd5e1" />
          <line x1={2} y1={7} x2={10} y2={7} stroke="#cbd5e1" />
          <line x1={2} y1={10} x2={8} y2={10} stroke="#cbd5e1" />
          <g className="av-hand"><line x1={16} y1={0} x2={22} y2={10} stroke="#f59e0b" strokeWidth={3} strokeLinecap="round" /></g>
        </g>
      );
    case 'reporter':
      return (
        <g transform="translate(10,-14)">
          <rect x={0} y={-14} width={4} height={14} fill="#60a5fa" className="av-bar fbottom" />
          <rect x={5} y={-20} width={4} height={20} fill="#f2c94c" className="av-bar fbottom" style={{ animationDelay: '.2s' }} />
          <rect x={10} y={-10} width={4} height={10} fill="#34d399" className="av-bar fbottom" style={{ animationDelay: '.4s' }} />
        </g>
      );
    case 'orchestrator':
      return (
        <g transform="translate(0,-56)" className="av-prop-fly">
          <path d="M0,-6 L2,-1 L7,-1 L3,2 L4.5,7 L0,4 L-4.5,7 L-3,2 L-7,-1 L-2,-1Z" fill="#fbbf24" stroke="#d97706" strokeWidth={0.8} />
        </g>
      );
    default:
      // publishers: paper plane in platform colour
      return (
        <g className="av-prop-fly" transform="translate(12,-30)">
          <path d="M0,0 L16,-6 L6,6 L5,1Z" fill={shade(color, 0.3)} stroke={shade(color, -0.3)} strokeWidth={1} />
        </g>
      );
  }
}

export function Avatar({ id, color, state, selected }: { id: AgentId; color: string; state: AgentState; selected: boolean }) {
  const st = state.status;
  const cls = st === 'working' ? 'av-working' : st === 'error' ? 'av-error' : 'av-idle';
  const body = color === '#25F4EE' ? '#1fb5b0' : color;
  return (
    <g className={cls}>
      <ellipse cx={0} cy={0} rx={15} ry={6} fill="#000" opacity={0.15} />
      {selected && <ellipse cx={0} cy={0} rx={22} ry={9} fill="none" stroke={color} strokeWidth={3} strokeDasharray="5 4" className="flow-active" />}
      <g className="av-all">
        {/* legs */}
        <rect x={-6} y={-8} width={5} height={8} rx={2} fill="#3f3f55" />
        <rect x={1} y={-8} width={5} height={8} rx={2} fill="#3f3f55" />
        {/* body */}
        <g className="av-body fbottom">
          <rect x={-11} y={-27} width={22} height={21} rx={8} fill={body} />
          <rect x={-4} y={-25} width={8} height={6} rx={2} fill="white" opacity={0.35} />
        </g>
        {/* hands */}
        <circle cx={-12} cy={-14} r={3.5} fill="#ffd9b8" className="av-hand" />
        <circle cx={12} cy={-14} r={3.5} fill="#ffd9b8" className="av-hand" style={{ animationDelay: '.12s' }} />
        {/* head */}
        <circle cx={0} cy={-38} r={13} fill="#ffe2c6" />
        <path d="M-13,-39 Q-12,-54 0,-53 Q13,-54 13,-39 Q8,-46 0,-45 Q-8,-46 -13,-39Z" fill={HAIR[id] ?? '#333'} />
        <ellipse cx={-4.5} cy={-37} rx={1.8} ry={2.4} fill="#2b2d42" className="av-eye fbox" />
        <ellipse cx={4.5} cy={-37} rx={1.8} ry={2.4} fill="#2b2d42" className="av-eye fbox" />
        <circle cx={-8} cy={-32} r={2.4} fill="#ff9aa2" opacity={0.6} />
        <circle cx={8} cy={-32} r={2.4} fill="#ff9aa2" opacity={0.6} />
        {st === 'error' ? (
          <path d="M-3,-29 Q0,-32 3,-29" stroke="#2b2d42" strokeWidth={1.5} fill="none" />
        ) : (
          <path d="M-3,-31 Q0,-28 3,-31" stroke="#2b2d42" strokeWidth={1.5} fill="none" />
        )}
        <Prop id={id} color={color} />
      </g>
      {/* status badge above head */}
      {st === 'waiting' && <StatusBadge fill="#fbbf24" text="?" />}
      {st === 'error' && <StatusBadge fill="#f43f5e" text="!" />}
      {st === 'done' && <StatusBadge fill="#60a5fa" text="✓" />}
    </g>
  );
}

function StatusBadge({ fill, text }: { fill: string; text: string }) {
  return (
    <g transform="translate(16,-58)" className="bubble">
      <circle r={8} fill={fill} stroke="white" strokeWidth={2} />
      <text textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={800} fill="white">{text}</text>
    </g>
  );
}
