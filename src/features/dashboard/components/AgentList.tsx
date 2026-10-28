'use client';

import type { AgentPerformance } from '@/features/dashboard/services/dashboard.service';

export function AgentList({ agents }: { agents: AgentPerformance[] }) {
  if (agents.length === 0) {
    return <p className="text-center text-xs text-zinc-400 py-8">Nenhum dado de agentes ainda</p>;
  }

  const sorted = [...agents].sort((a, b) => b.totalConversations - a.totalConversations);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_60px_60px_60px_60px] items-center gap-2 px-3 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
        <div>Agente</div>
        <div className="text-right">Ativas</div>
        <div className="text-right">TMR</div>
        <div className="text-right">TMA</div>
        <div className="text-right">Taxa</div>
      </div>
      {sorted.map((a) => (
        <div
          key={a.agent.id}
          className="grid grid-cols-[1fr_60px_60px_60px_60px] items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
              {a.agent.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">{a.agent.name}</p>
              <p className="text-[10px] text-zinc-400">
                {a.totalConversations} no período · {a.closedConversations} fechadas
              </p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-xs font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
              {a.activeConversations}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
              {a.avgFirstResponseMinutes ?? '—'}
              {a.avgFirstResponseMinutes !== null && <span className="text-[9px] text-zinc-400 ml-0.5">min</span>}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
              {a.avgResolutionMinutes ?? '—'}
              {a.avgResolutionMinutes !== null && <span className="text-[9px] text-zinc-400 ml-0.5">min</span>}
            </p>
          </div>

          <div className="text-right">
            <span
              className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                a.resolutionRate >= 70
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : a.resolutionRate >= 40
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300'
              }`}
            >
              {a.resolutionRate}%
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
