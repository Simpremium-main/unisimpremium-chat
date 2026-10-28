'use client';

interface BreakdownItem {
  label: string;
  value: number;
  /** Optional secondary value (e.g. cost) shown in muted color. */
  secondaryLabel?: string;
}

interface Props {
  title: string;
  items: BreakdownItem[];
  unit?: string;
  empty?: string;
}

export function BreakdownList({ title, items, unit, empty }: Props) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-400">{empty ?? 'Sem dados.'}</p>
      ) : (
        <div className="mt-3 space-y-2">
          {items.map((item) => {
            const pct = (item.value / max) * 100;
            return (
              <div key={item.label}>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="truncate font-medium text-zinc-700 dark:text-zinc-300">
                    {item.label}
                  </span>
                  <span className="ml-2 shrink-0 tabular-nums text-zinc-500">
                    {item.value.toLocaleString('pt-BR')}
                    {unit ? ` ${unit}` : ''}
                    {item.secondaryLabel ? (
                      <span className="ml-2 text-zinc-400">
                        {item.secondaryLabel}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
