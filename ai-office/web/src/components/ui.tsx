import type { ReactNode } from 'react';
import { STATUS_COLOR, STATUS_LABEL } from '../lib/api';

export function StatusBadge({ status }: { status: string }) {
  return <span className={`chip ${STATUS_COLOR[status] ?? 'bg-slate-100 text-slate-600'}`}>{STATUS_LABEL[status] ?? status}</span>;
}

const KIND: Record<string, [string, string]> = {
  real: ['Thật', 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'],
  ai: ['AI', 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300'],
  simulated: ['Mô phỏng', 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300'],
  manual: ['Thủ công', 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'],
  none: ['Không có dữ liệu', 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300'],
};
export function KindBadge({ kind }: { kind: string | null }) {
  if (!kind) return null;
  const [l, c] = KIND[kind] ?? [kind, 'bg-slate-100'];
  return <span className={`chip ${c}`} title="Nguồn gốc kết quả">{l}</span>;
}

export function Progress({ value, color }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-line overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.round(value * 100)}%`, background: color ?? 'rgb(var(--brand))' }} />
    </div>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-mute">{children}</div>;
}
