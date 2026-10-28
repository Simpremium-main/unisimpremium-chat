'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Eye,
  Timer,
  Activity,
  AlertTriangle,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react';
import { aiAgentsService, type WatchdogConversationLite } from '../../services/ai-agents.service';

/**
 * Aba "Watchdog" do Jarvis. Monitoramento das conversas presas:
 * - 4 KPI cards (timers ativos, checks 24h, reativações 24h, conversas presas)
 * - Estado do watchdog (enabled + thresholds)
 * - Lista de conversas em alerta (stuckAttempts > 0)
 * - Lista de conversas marcadas isStuck=true (precisam revisão humana)
 */
export function JarvisWatchdogTab() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['watchdog-stats'],
    queryFn: () => aiAgentsService.watchdogStats(),
    refetchInterval: 15_000, // refetch automático a cada 15s
    staleTime: 5_000,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-6 p-6">
        <p className="text-sm text-zinc-500">Carregando…</p>
      </div>
    );
  }

  const { enabled, config, stats, topAlert, recentStuck } = data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Watchdog
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Monitor de conversas presas — refresh a cada 15s
          </p>
        </div>
        <div
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
            enabled
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
              : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
          }`}
        >
          {enabled ? (
            <>
              <ShieldCheck className="h-3.5 w-3.5" />
              Ativo
            </>
          ) : (
            <>
              <ShieldOff className="h-3.5 w-3.5" />
              Desativado
            </>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiBox
          icon={Timer}
          label="Timers ativos"
          value={stats.activeTimers}
          hint="Jobs BullMQ aguardando o cliente avançar"
          tone="blue"
        />
        <KpiBox
          icon={Eye}
          label="Checks últimas 24h"
          value={stats.checks24h}
          hint="Conversas avaliadas pelo watchdog"
          tone="zinc"
        />
        <KpiBox
          icon={Activity}
          label="Reativações 24h"
          value={stats.reactivations24h}
          hint="IA reassumiu após detecção de travamento"
          tone="violet"
        />
        <KpiBox
          icon={AlertTriangle}
          label="Conversas presas"
          value={stats.stuck}
          hint={`isStuck=true (atingiu ${config.maxAttempts} tentativas)`}
          tone={stats.stuck > 0 ? 'red' : 'emerald'}
        />
      </div>

      {/* Configuração */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Thresholds atuais
        </h3>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <ConfigItem label="status=BOT" value={`${config.delayBotMin}min`} />
          <ConfigItem label="status=PENDING" value={`${config.delayPendingMin}min`} />
          <ConfigItem label="status=OPEN" value={`${config.delayHumanIdleMin}min`} />
          <ConfigItem label="Max tentativas" value={String(config.maxAttempts)} />
        </div>
      </div>

      {/* Lista: em alerta */}
      <Section
        title={`Em alerta (${topAlert.length})`}
        subtitle="Conversas com tentativas de reativação registradas — atenção se subirem"
        empty="Nenhuma conversa em alerta no momento ✓"
        list={topAlert}
        config={config}
      />

      {/* Lista: presas */}
      {recentStuck.length > 0 && (
        <Section
          title={`Presas (${recentStuck.length})`}
          subtitle="Atingiram o limite de tentativas — precisam intervenção humana"
          empty=""
          list={recentStuck}
          config={config}
          danger
        />
      )}

      <button
        onClick={() => refetch()}
        className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
      >
        Atualizar agora
      </button>
    </div>
  );
}

function KpiBox({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  hint: string;
  tone: 'blue' | 'zinc' | 'violet' | 'red' | 'emerald';
}) {
  const tones: Record<typeof tone, string> = {
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
    zinc: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    violet: 'bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400',
    red: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400',
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
  };
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-md ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          {label}
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-zinc-500">{hint}</p>
    </div>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="font-mono text-sm text-zinc-900 dark:text-zinc-100">{value}</p>
    </div>
  );
}

function Section({
  title,
  subtitle,
  empty,
  list,
  config,
  danger,
}: {
  title: string;
  subtitle: string;
  empty: string;
  list: WatchdogConversationLite[];
  config: { maxAttempts: number };
  danger?: boolean;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {title}
      </h3>
      <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
      {list.length === 0 ? (
        <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">
          {empty}
        </p>
      ) : (
        <div className="mt-2 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-900/50">
              <tr>
                <th className="px-3 py-2 text-left">Cliente</th>
                <th className="px-3 py-2 text-left">Canal</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Tentativas</th>
                <th className="px-3 py-2 text-left">Última checagem</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {list.map((c) => {
                const ratio = c.stuckAttempts / config.maxAttempts;
                return (
                  <tr key={c.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                    <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">
                      {c.contact.name ?? c.contact.phone ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                      {c.channel.name}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        {c.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={`inline-flex items-center justify-end gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${
                          danger
                            ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                            : ratio >= 0.66
                              ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                              : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                        }`}
                      >
                        {c.stuckAttempts}/{config.maxAttempts}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-500">
                      {c.lastWatchdogCheckAt
                        ? new Date(c.lastWatchdogCheckAt).toLocaleString('pt-BR')
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/inbox?conversationId=${c.id}`}
                        className="text-xs text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                      >
                        abrir →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
