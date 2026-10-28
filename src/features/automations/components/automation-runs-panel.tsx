'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  CircleAlert,
  CircleSlash,
  XCircle,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { getSocket } from '@/lib/socket';
import {
  Automation,
  AutomationRun,
  AutomationRunStatus,
  automationsService,
} from '../services/automations.service';
import { ACTION_LABELS } from '../utils/labels';

const STATUS_META: Record<
  AutomationRunStatus,
  { label: string; cls: string; Icon: typeof CheckCircle2 }
> = {
  SUCCESS: {
    label: 'OK',
    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
    Icon: CheckCircle2,
  },
  PARTIAL: {
    label: 'Parcial',
    cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400',
    Icon: CircleAlert,
  },
  FAILED: {
    label: 'Falhou',
    cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
    Icon: XCircle,
  },
  SKIPPED: {
    label: 'Pulado',
    cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
    Icon: CircleSlash,
  },
};

export function AutomationRunsPanel({
  automation,
  onClose,
}: {
  automation: Automation;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<AutomationRunStatus | 'ALL'>(
    'ALL',
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: runsData, isLoading } = useQuery({
    queryKey: ['automation-runs', automation.id, statusFilter],
    queryFn: () =>
      automationsService.runs(automation.id, {
        limit: 50,
        ...(statusFilter !== 'ALL' ? { status: statusFilter } : {}),
      }),
    // No polling — Socket.IO `automation:run` push handles freshness.
  });

  // Subscribe to live runs. Backend emits to room `org:{orgId}` whenever
  // an AutomationRun is created. We prepend the new row into this query's
  // cache without refetching — single round-trip when the panel mounts,
  // then push-only.
  useEffect(() => {
    const socket = getSocket();
    const handler = (msg: { automationId: string; run: AutomationRun }) => {
      if (msg.automationId !== automation.id) return;
      // Respect the active status filter — runs that don't match are
      // dropped client-side instead of polluting the visible list.
      if (statusFilter !== 'ALL' && msg.run.status !== statusFilter) return;
      qc.setQueryData(
        ['automation-runs', automation.id, statusFilter],
        (prev: { data: AutomationRun[]; nextCursor: string | null } | undefined) => {
          const existing = prev?.data ?? [];
          // Idempotent prepend in case the same event arrives twice
          // (socket reconnect can replay during transports switch).
          if (existing.some((r) => r.id === msg.run.id)) return prev;
          return {
            data: [msg.run, ...existing].slice(0, 50),
            nextCursor: prev?.nextCursor ?? null,
          };
        },
      );
    };
    socket.on('automation:run', handler);
    return () => {
      socket.off('automation:run', handler);
    };
  }, [automation.id, statusFilter, qc]);

  const runs = runsData?.data ?? [];

  return (
    <div className="animate-drawer-in fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-black/40"
        onClick={onClose}
        aria-label="Fechar"
      />
      <div className="flex h-full w-full max-w-xl flex-col bg-white shadow-xl dark:bg-zinc-900">
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold">Logs de execução</h2>
            <p className="text-xs text-zinc-500">{automation.name}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <div className="flex flex-wrap gap-1">
            {(['ALL', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED'] as const).map(
              (s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    statusFilter === s
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  {s === 'ALL' ? 'Todos' : STATUS_META[s].label}
                </button>
              ),
            )}
          </div>
          {automation.autoPausedAt && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
              <strong>Pausada automaticamente:</strong>{' '}
              {automation.autoPausedReason}
              <br />
              <span className="text-red-500/80">
                Reative pra zerar o contador de falhas.
              </span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="px-5 py-8 text-center text-sm text-zinc-500">
              Carregando…
            </div>
          )}
          {!isLoading && runs.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-zinc-500">
              Nenhum run nesse filtro
            </div>
          )}
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {runs.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                expanded={expandedId === run.id}
                onToggle={() =>
                  setExpandedId(expandedId === run.id ? null : run.id)
                }
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function RunRow({
  run,
  expanded,
  onToggle,
}: {
  run: AutomationRun;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = STATUS_META[run.status];
  const Icon = meta.Icon;
  return (
    <li>
      <button
        className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-950/40"
        onClick={onToggle}
      >
        <span
          className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}
        >
          <Icon className="h-3 w-3" />
          {meta.label}
        </span>
        <div className="flex-1 text-sm">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{new Date(run.startedAt).toLocaleString('pt-BR')}</span>
            {run.durationMs !== null && (
              <span>{run.durationMs}ms</span>
            )}
          </div>
          {run.errorCode && (
            <div className="mt-1 text-xs text-red-600 dark:text-red-400">
              {run.errorCode}
              {run.errorMessage && `: ${run.errorMessage}`}
            </div>
          )}
          <div className="mt-1 text-xs text-zinc-500">
            {run.actionsLog.length === 0
              ? 'sem ações executadas'
              : `${run.actionsLog.length} ${
                  run.actionsLog.length === 1 ? 'ação' : 'ações'
                }`}
          </div>
        </div>
      </button>
      {expanded && (
        <div className="bg-zinc-50 px-5 py-3 dark:bg-zinc-950/40">
          {run.actionsLog.length > 0 ? (
            <ol className="space-y-2 text-xs">
              {run.actionsLog.map((entry, i) => (
                <li
                  key={i}
                  className="rounded border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {entry.index + 1}. {ACTION_LABELS[entry.type]}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        entry.status === 'success'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                          : entry.status === 'skipped'
                            ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400'
                      }`}
                    >
                      {entry.status} · {entry.durationMs}ms
                    </span>
                  </div>
                  {entry.errorCode && (
                    <div className="mt-1 text-red-600 dark:text-red-400">
                      {entry.errorCode}
                      {entry.errorMessage && `: ${entry.errorMessage}`}
                    </div>
                  )}
                  {entry.output && Object.keys(entry.output).length > 0 && (
                    <pre className="mt-1 overflow-x-auto text-[10px] text-zinc-500">
                      {JSON.stringify(entry.output, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <div className="text-xs text-zinc-500">
              Nenhuma ação executada (run pulado).
            </div>
          )}
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-zinc-500">
              Ver payload do gatilho
            </summary>
            <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-[10px] dark:bg-zinc-900">
              {JSON.stringify(run.triggerPayload, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </li>
  );
}
