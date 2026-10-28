'use client';

import type { Period } from '../../services/ai-agents.service';

const OPTIONS: Array<{ value: Period; label: string }> = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
];

interface Props {
  value: Period;
  onChange: (next: Period) => void;
}

export function PeriodSelector({ value, onChange }: Props) {
  return (
    <div className="inline-flex rounded-md border border-zinc-200 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
