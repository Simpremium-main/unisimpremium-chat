'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  XCircle,
  ExternalLink,
  X,
} from 'lucide-react';
import {
  aiAgentsService,
  type FeedRun,
  type Period,
} from '../../services/ai-agents.service';

type RunStatus = FeedRun['status'];

const STATUS_LABEL: Record<RunStatus, string> = {
  RUNNING: 'Rodando',
  COMPLETED: 'Concluído',
  FAILED: 'Falhou',
  SKIPPED: 'Pulado',
};

const STATUS_BADGE: Record<RunStatus, string> = {
  RUNNING: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
  COMPLETED: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
  FAILED: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400',
  SKIPPED: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

const FINAL_ACTION_LABEL: Record<string, string> = {
  REPLIED: 'Respondeu',
  DELEGATED: 'Delegou',
  HANDED_BACK: 'Devolveu',
  TRANSFERRED_TO_HUMAN: 'Transferiu p/ humano',
  CLOSED_CONVERSATION: 'Fechou conversa',
  NO_ACTION: 'Sem ação',
  NONE: '—',
};

/**
 * "Execuções" tab for Jarvis. Lists every agent run with full tool-call
 * history so the operator can spot silent skill failures (e.g. resetPassword
 * returning 404). Auto-refreshes every 10s while the tab is open.
 */
export function JarvisRunsTab() {
  const [period, setPeriod] = useState<Period | 'all'>('7d');
  const [status, setStatus] = useState<RunStatus | ''>('');
  const [hasErrors, setHasErrors] = useState(false);
  const [agentId, setAgentId] = useState<string>('');
  const [selectedRun, setSelectedRun] = useState<FeedRun | null>(null);

  const { data: agents } = useQuery({
    queryKey: ['ai-agents'],
    queryFn: () => aiAgentsService.list(),
  });

  const { data: runs, isLoading } = useQuery({
    queryKey: ['ai-agents-runs-feed', { period, status, hasErrors, agentId }],
    queryFn: () =>
      aiAgentsService.feed({
        period: period === 'all' ? 'all' : period,
        status: status || undefined,
        hasErrors: hasErrors || undefined,
        agentId: agentId || undefined,
        limit: 100,
      }),
    refetchInterval: 10_000,
  });

  const errorCount = useMemo(
    () => (runs ?? []).filter((r) => r.hasFailedToolCalls || r.status === 'FAILED').length,
    [runs],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Execuções
            </h2>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              Histórico de runs e skills chamadas — atualiza a cada 10s
            </p>
          </div>
          {errorCount > 0 && (
            <div className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">{errorCount}</span> com falha
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-zinc-400" />
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period | 'all')}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            <option value="24h">Últimas 24h</option>
            <option value="7d">7 dias</option>
            <option value="30d">30 dias</option>
            <option value="all">Tudo</option>
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as RunStatus | '')}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            <option value="">Todos status</option>
            <option value="COMPLETED">Concluído</option>
            <option value="FAILED">Falhou</option>
            <option value="RUNNING">Rodando</option>
            <option value="SKIPPED">Pulado</option>
          </select>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            <option value="">Todos agents</option>
            {(agents ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
            <input
              type="checkbox"
              checked={hasErrors}
              onChange={(e) => setHasErrors(e.target.checked)}
              className="h-3 w-3"
            />
            Só com erros
          </label>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 p-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800"
              />
            ))}
          </div>
        ) : (runs?.length ?? 0) === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-zinc-300" />
            <p className="mt-3 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Nenhuma execução com esse filtro
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {runs!.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                onSelect={() => setSelectedRun(run)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedRun && (
        <RunDetailDrawer run={selectedRun} onClose={() => setSelectedRun(null)} />
      )}
    </div>
  );
}

function RunRow({ run, onSelect }: { run: FeedRun; onSelect: () => void }) {
  const failed = run.hasFailedToolCalls || run.status === 'FAILED';
  const cost = parseFloat(run.costUsd) || 0;
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-center gap-4 px-6 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50 ${
        failed ? 'bg-red-50/40 dark:bg-red-900/5' : ''
      }`}
    >
      <div className="w-2 flex-shrink-0">
        {failed ? (
          <XCircle className="h-4 w-4 text-red-500" />
        ) : run.status === 'COMPLETED' ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : (
          <Clock className="h-4 w-4 text-blue-500" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {run.agent.name}
            </span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[run.status]}`}
            >
              {STATUS_LABEL[run.status]}
            </span>
            {run.finalAction && (
              <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {FINAL_ACTION_LABEL[run.finalAction] ?? run.finalAction}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
            <span>{new Date(run.startedAt).toLocaleString('pt-BR')}</span>
            <span>·</span>
            <span>{run.modelId}</span>
            {run.durationMs != null && (
              <>
                <span>·</span>
                <span>{(run.durationMs / 1000).toFixed(1)}s</span>
              </>
            )}
            {cost > 0 && (
              <>
                <span>·</span>
                <span>${cost.toFixed(4)}</span>
              </>
            )}
            <span>·</span>
            <span>{run.toolCalls.length} skills</span>
            {(run.failedToolCalls ?? 0) > 0 && (
              <span className="font-medium text-red-600 dark:text-red-400">
                · ⚠ {run.failedToolCalls} falharam
              </span>
            )}
          </div>
          {run.errorMessage && (
            <div className="mt-1 truncate text-[11px] text-red-600 dark:text-red-400">
              {run.errorMessage}
            </div>
          )}
        </div>
        <span className="flex-shrink-0 text-zinc-400">
          <ExternalLink className="h-4 w-4" />
        </span>
      </div>
    </button>
  );
}

function RunDetailDrawer({ run, onClose }: { run: FeedRun; onClose: () => void }) {
  const router = useRouter();

  const isFailedToolCall = (tc: FeedRun['toolCalls'][number]) => {
    if (tc.error) return true;
    const out = tc.output as Record<string, any> | null;
    if (!out || typeof out !== 'object') return false;
    if (out.ok === false) return true;
    const status = Number(out.status);
    return Number.isFinite(status) && status >= 400;
  };

  return (
    <div
      className="animate-drawer-in fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Execução de {run.agent.name}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[run.status]}`}
              >
                {STATUS_LABEL[run.status]}
              </span>
              {run.finalAction && (
                <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] dark:bg-zinc-800 dark:text-zinc-300">
                  {FINAL_ACTION_LABEL[run.finalAction] ?? run.finalAction}
                </span>
              )}
              <span>{new Date(run.startedAt).toLocaleString('pt-BR')}</span>
              {run.durationMs != null && (
                <span>· {(run.durationMs / 1000).toFixed(1)}s</span>
              )}
              <span>· {run.modelId}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() =>
                router.push(`/inbox?conversationId=${run.conversationId}`)
              }
              className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              <ExternalLink className="h-3 w-3" /> Ver conversa
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {run.errorMessage && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <div>
                  <p className="font-medium">Erro do run</p>
                  <p className="mt-0.5 text-xs">{run.errorMessage}</p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Skills chamadas ({run.toolCalls.length})
            </p>
            {run.toolCalls.length === 0 ? (
              <p className="text-sm text-zinc-500">
                Nenhuma skill foi chamada nesse run.
              </p>
            ) : (
              run.toolCalls.map((tc) => {
                const failed = isFailedToolCall(tc);
                return (
                  <div
                    key={tc.id}
                    className={`rounded-lg border p-3 ${
                      failed
                        ? 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/10'
                        : 'border-zinc-200 dark:border-zinc-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {failed ? (
                          <XCircle className="h-4 w-4 text-red-500" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        )}
                        <code className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {tc.toolName}
                        </code>
                      </div>
                      <span className="text-[11px] text-zinc-500">
                        {new Date(tc.createdAt).toLocaleTimeString('pt-BR')}
                        {tc.durationMs != null && ` · ${tc.durationMs}ms`}
                      </span>
                    </div>
                    {tc.error && (
                      <p className="mt-2 rounded bg-red-100 px-2 py-1 text-[11px] text-red-800 dark:bg-red-900/30 dark:text-red-300">
                        {tc.error}
                      </p>
                    )}
                    <details className="mt-2 group">
                      <summary className="cursor-pointer select-none text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                        Input
                      </summary>
                      <pre className="mt-1 overflow-x-auto rounded bg-zinc-50 p-2 text-[10px] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                        {JSON.stringify(tc.input, null, 2)}
                      </pre>
                    </details>
                    <details className="mt-1 group">
                      <summary className="cursor-pointer select-none text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                        Output
                      </summary>
                      <pre
                        className={`mt-1 overflow-x-auto rounded p-2 text-[10px] ${
                          failed
                            ? 'bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200'
                            : 'bg-zinc-50 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
                        }`}
                      >
                        {JSON.stringify(tc.output, null, 2)}
                      </pre>
                    </details>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
