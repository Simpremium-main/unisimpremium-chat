'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, Coins, Cpu, Activity, CheckCircle2, ArrowRightLeft } from 'lucide-react';
import {
  aiAgentsService,
  formatModelLabel,
  type Period,
} from '../../services/ai-agents.service';
import { useOrgId } from '@/hooks/use-org-query-key';
import { KpiCard } from './kpi-card';
import { PeriodSelector } from './period-selector';
import { BreakdownList } from './breakdown-list';
import { RunsTable } from './runs-table';
import { fmtMs, fmtNum, fmtUsdShort } from './format';

export function JarvisAgentTab() {
  const orgId = useOrgId();
  const [period, setPeriod] = useState<Period>('7d');
  const [agentId, setAgentId] = useState<string>('');

  const { data: agents } = useQuery({
    queryKey: ['ai-agents', orgId],
    queryFn: () => aiAgentsService.list(),
  });

  // Auto-select first agent
  useEffect(() => {
    if (!agentId && agents && agents.length > 0) {
      setAgentId(agents[0].id);
    }
  }, [agents, agentId]);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['ai-agent-stats', agentId, period],
    queryFn: () => aiAgentsService.agentStats(agentId, period),
    enabled: !!agentId,
    refetchInterval: 5000,
  });

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['ai-agent-feed', agentId],
    queryFn: () => aiAgentsService.feed({ agentId, limit: 50 }),
    enabled: !!agentId,
    refetchInterval: 5000,
  });

  const agent = agents?.find((a) => a.id === agentId);

  if (!agents) {
    return <div className="p-6 text-sm text-zinc-500">Carregando…</div>;
  }

  if (agents.length === 0) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-200 py-16 dark:border-zinc-800">
          <Bot className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-3 text-sm font-medium text-zinc-600">
            Nenhum agente cadastrado ainda
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Crie um agente na aba &quot;Agentes&quot; pra começar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-900"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.kind === 'ORCHESTRATOR' ? 'orquestrador' : a.category ?? 'worker'})
              </option>
            ))}
          </select>
          {agent && (
            <span className="text-xs text-zinc-500">
              {formatModelLabel(agent.modelId)}
            </span>
          )}
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* KPI cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Custo (USD)"
          value={statsLoading ? '…' : fmtUsdShort(stats?.cost.usd ?? 0)}
          hint={
            stats
              ? `${fmtUsdShort(stats.cost.avgPerRun)} por execução`
              : undefined
          }
          icon={Coins}
          accent="#16a34a"
        />
        <KpiCard
          label="Tokens"
          value={statsLoading ? '…' : fmtNum(stats?.tokens.total ?? 0)}
          hint={
            stats ? `${fmtNum(stats.tokens.cacheRead)} cache hits` : undefined
          }
          icon={Cpu}
          accent="#2563eb"
        />
        <KpiCard
          label="Runs"
          value={statsLoading ? '…' : fmtNum(stats?.runs.total ?? 0)}
          hint={
            stats
              ? `${stats.runs.completed} OK · ${stats.runs.failed} falhas`
              : undefined
          }
          icon={Activity}
          accent="#9333ea"
        />
        <KpiCard
          label="Sucesso"
          value={
            statsLoading
              ? '…'
              : stats?.runs.successRate != null
                ? `${stats.runs.successRate}%`
                : '—'
          }
          hint={
            stats
              ? `latência p50 ${fmtMs(stats.latency.p50)} · p95 ${fmtMs(stats.latency.p95)}`
              : undefined
          }
          icon={CheckCircle2}
          accent={
            stats?.runs.successRate == null
              ? undefined
              : stats.runs.successRate > 90
                ? '#16a34a'
                : stats.runs.successRate > 70
                  ? '#eab308'
                  : '#dc2626'
          }
        />
      </div>

      {/* Handoffs */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            <ArrowRightLeft className="h-3 w-3" /> Handoffs enviados
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {stats?.handoffs.sent ?? 0}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {agent?.kind === 'ORCHESTRATOR'
              ? 'Vezes que delegou pra outro worker'
              : 'Vezes que devolveu pro orquestrador ou outro worker'}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            <ArrowRightLeft className="h-3 w-3 rotate-180" /> Handoffs recebidos
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {stats?.handoffs.received ?? 0}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Vezes que outro agente delegou esse aqui
          </p>
        </div>
      </div>

      {/* Final actions */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Distribuição das runs
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
          {Object.entries(stats?.byFinalAction ?? {}).map(([action, count]) => (
            <div
              key={action}
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800/50"
            >
              <p className="text-[10px] uppercase text-zinc-500">{action}</p>
              <p className="text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {count}
              </p>
            </div>
          ))}
          {Object.keys(stats?.byFinalAction ?? {}).length === 0 && (
            <p className="col-span-full text-xs text-zinc-400">Sem runs.</p>
          )}
        </div>
      </div>

      {/* Tools used */}
      <BreakdownList
        title={`Tools usadas por ${agent?.name ?? 'este agente'}`}
        items={(stats?.tools ?? [])
          .sort((a, b) => b.calls - a.calls)
          .map((t) => ({ label: t.name, value: t.calls }))}
        unit="calls"
        empty="Esse agente ainda não chamou nenhuma tool."
      />

      {/* Runs deste agent */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Execuções recentes
        </h3>
        {runsLoading ? (
          <div className="h-40 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
        ) : (
          <RunsTable
            runs={runs ?? []}
            emptyHint={`${agent?.name ?? 'Esse agente'} ainda não rodou.`}
          />
        )}
      </div>
    </div>
  );
}
