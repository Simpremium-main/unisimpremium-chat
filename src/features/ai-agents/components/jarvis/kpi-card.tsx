'use client';

import type { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  accent?: string;
  trendPct?: number | null;
}

export function KpiCard({ label, value, hint, icon: Icon, accent, trendPct }: KpiCardProps) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          {label}
        </p>
        {Icon && (
          <Icon
            className="h-4 w-4 text-zinc-400"
            style={accent ? { color: accent } : undefined}
          />
        )}
      </div>
      <p className="mt-2 text-2xl font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-zinc-500">{hint}</p>}
      {typeof trendPct === 'number' && (
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className={`h-full ${trendPct < 80 ? 'bg-emerald-500' : trendPct < 95 ? 'bg-amber-500' : 'bg-red-500'}`}
            style={{ width: `${Math.min(trendPct, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
