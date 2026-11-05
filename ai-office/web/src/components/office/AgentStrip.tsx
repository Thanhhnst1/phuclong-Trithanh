import { useStore } from '../../lib/store';

const DOT: Record<string, string> = { idle: '#b8b5c9', working: '#4ade80', waiting: '#fbbf24', done: '#60a5fa', error: '#f43f5e' };

/** Compact live status of every agent — shown under the office on small screens. */
export function AgentStrip() {
  const { agents, selectAgent } = useStore();
  return (
    <div className="flex gap-2 overflow-x-auto border-t border-line bg-panel px-2 py-2 lg:hidden">
      {agents.map((a) => (
        <button key={a.id} onClick={() => selectAgent(a.id)} className="flex w-40 shrink-0 items-start gap-2 rounded-xl border border-line bg-card p-2 text-left">
          <span className="relative text-lg leading-none">{a.emoji}<span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-card" style={{ background: DOT[a.state.status] }} /></span>
          <span className="min-w-0">
            <span className="block truncate text-[11px] font-bold">{a.name}</span>
            <span className="block line-clamp-2 text-[10px] leading-tight text-mute">{a.state.message}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
