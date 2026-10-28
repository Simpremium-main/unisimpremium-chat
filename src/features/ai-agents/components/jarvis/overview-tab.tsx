'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Clock,
  Coins,
  Cpu,
  AlertTriangle,
  CheckCircle2,
  ArrowRightLeft,
} from 'lucide-react';
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

export function JarvisOverviewTab() {
  const orgId = useOrgId();
  const [period, setPeriod] = useState<Period>('7d');

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['ai-stats', orgId, period],
    queryFn: () => aiAgentsService.orgStats(period),
    refetchInterval: 5000,
  });

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['ai-feed', orgId],
    queryFn: () => aiAgentsService.feed({ limit: 50 }),
    refetchInterval: 5000,
  });

  const { data: agents } = useQuery({
    queryKey: ['ai-agents', orgId],
    queryFn: () => aiAgentsService.list(),
  });

  const agentsById = new Map((agents ?? []).map((a) => [a.id, a]));

  const successRate = stats?.runs.successRate ?? null;
  const failedRate =
    stats && stats.runs.total > 0
      ? (stats.runs.failed / stats.runs.total) * 100
      : 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Visão geral
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Custo, tokens, runs e qualidade — atualiza a cada 5s
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Alerts */}
      {stats?.monthlyCap.percentUsed != null &&
        stats.monthlyCap.percentUsed >= 80 && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-900/20">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-200">
                Cap mensal: {stats.monthlyCap.percentUsed}% usado
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {fmtNum(stats.monthlyCap.used)} de{' '}
                {fmtNum(stats.monthlyCap.cap ?? 0)} tokens. A IA vai parar
                automaticamente quando o limite for atingido.
              </p>
            </div>
          </div>
        )}

      {failedRate > 30 && stats && stats.runs.total >= 5 && (
        <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm dark:border-red-700 dark:bg-red-900/20">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-red-600" />
          <div>
            <p className="font-medium text-red-900 dark:text-red-200">
              Taxa de falha alta: {failedRate.toFixed(0)}%
            </p>
            <p className="text-xs text-red-700 dark:text-red-300">
              {stats.runs.failed} de {stats.runs.total} execuções falharam no
              período. Veja a tabela abaixo pra investigar.
            </p>
          </div>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Custo (USD)"
          value={statsLoading ? '…' : fmtUsdShort(stats?.cost.usd ?? 0)}
          hint={
            stats
              ? `${fmtUsdShort(stats.cost.avgPerRun)} por execução em média`
              : undefined
          }
          icon={Coins}
          accent="#16a34a"
        />
        <KpiCard
          label="Tokens"
          value={statsLoading ? '…' : fmtNum(stats?.tokens.total ?? 0)}
          hint={
            stats
              ? `${fmtNum(stats.tokens.cacheRead)} cache hits`
              : undefined
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
          label="Taxa de sucesso"
          value={
            statsLoading
              ? '…'
              : successRate != null
                ? `${successRate}%`
                : '—'
          }
          hint={
            stats
              ? `latência p50 ${fmtMs(stats.latency.p50)} · p95 ${fmtMs(stats.latency.p95)}`
              : undefined
          }
          icon={CheckCircle2}
          accent={
            successRate == null
              ? undefined
              : successRate > 90
                ? '#16a34a'
                : successRate > 70
                  ? '#eab308'
                  : '#dc2626'
          }
        />
      </div>

      {/* Cap progress (if cap defined) */}
      {stats?.monthlyCap.cap && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Limite mensal
            </p>
            <p className="text-xs tabular-nums text-zinc-500">
              {fmtNum(stats.monthlyCap.used)} / {fmtNum(stats.monthlyCap.cap)} tokens
              ·{' '}
              <span className="font-medium">
                {stats.monthlyCap.percentUsed?.toFixed(1)}%
              </span>
            </p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className={`h-full ${
                (stats.monthlyCap.percentUsed ?? 0) < 80
                  ? 'bg-emerald-500'
                  : (stats.monthlyCap.percentUsed ?? 0) < 95
                    ? 'bg-amber-500'
                    : 'bg-red-500'
              }`}
              style={{
                width: `${Math.min(stats.monthlyCap.percentUsed ?? 0, 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Breakdowns */}
      <div className="grid gap-3 lg:grid-cols-3">
        <BreakdownList
          title="Custo por modelo"
          items={(stats?.byModel ?? [])
            .sort((a, b) => b.cost - a.cost)
            .map((m) => ({
              label: formatModelLabel(m.modelId),
              value: Number(m.cost.toFixed(4)),
              secondaryLabel: `${fmtNum(m.tokens)} tk`,
            }))}
          unit="USD"
          empty="Sem execuções no período."
        />
        <BreakdownList
          title="Por agente"
          items={(stats?.byAgent ?? [])
            .sort((a, b) => b.runs - a.runs)
            .map((a) => ({
              label: agentsById.get(a.agentId)?.name ?? a.agentId.slice(0, 12),
              value: a.runs,
              secondaryLabel: fmtUsdShort(a.cost),
            }))}
          unit="runs"
          empty="Sem execuções no período."
        />
        <BreakdownList
          title="Tools chamadas"
          items={(stats?.tools ?? [])
            .sort((a, b) => b.calls - a.calls)
            .map((t) => ({ label: t.name, value: t.calls }))}
          unit="calls"
          empty="Sem chamadas no período."
        />
      </div>

      {/* Final actions + handoffs */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Como as runs terminaram
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
              <p className="col-span-full text-xs text-zinc-400">
                Sem dados.
              </p>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            <ArrowRightLeft className="h-3 w-3" /> Delegações entre agentes
          </p>
          <div className="mt-3 space-y-2">
            {(stats?.handoffs ?? []).length === 0 ? (
              <p className="text-xs text-zinc-400">Sem delegações.</p>
            ) : (
              stats?.handoffs.map((h, i) => {
                const fromName =
                  agentsById.get(h.fromAgentId)?.name ??
                  (h.fromAgentId === 'system' ? 'sistema' : h.fromAgentId.slice(0, 12));
                const toName =
                  agentsById.get(h.toAgentId)?.name ?? h.toAgentId.slice(0, 12);
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-1.5 text-xs dark:bg-zinc-800/50"
                  >
                    <span className="text-zinc-700 dark:text-zinc-300">
                      <span className="font-medium">{fromName}</span>
                      <span className="mx-2 text-zinc-400">→</span>
                      <span className="font-medium">{toName}</span>
                    </span>
                    <span className="tabular-nums text-zinc-500">
                      {h.count} {h.count === 1 ? 'vez' : 'vezes'}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Live feed */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-zinc-400" />
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Últimas execuções
          </h3>
          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
            <span className="h-1 w-1 animate-pulse rounded-full bg-emerald-500" />
            ao vivo
          </span>
        </div>
        {runsLoading ? (
          <div className="h-40 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
        ) : (
          <RunsTable runs={runs ?? []} emptyHint="Ainda não rolou execução." />
        )}
      </div>
    </div>
  );
}
