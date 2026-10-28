'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  X,
  Bot,
  Wrench,
  Copy,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  aiAgentsService,
  type FeedRun,
} from '@/features/ai-agents/services/ai-agents.service';
import { inboxService, type Message } from '../services/inbox.service';
import { useSocket } from '../hooks/use-socket';

type ToolCall = FeedRun['toolCalls'][number];

interface AgentRunsSidebarProps {
  conversationId: string;
  onClose: () => void;
}

/**
 * Per-conversation agent execution log. Reactive: subscribes to the
 * `ai:run:*` socket events emitted by the backend's runner so operators
 * see tool calls land in real time as the agent works through a turn.
 *
 * The user joins `conv:<id>` while the chat panel is open (chat-panel.tsx
 * handles join/leave on mount/unmount), so this sidebar inherits that
 * subscription — we don't re-join here.
 */
export function AgentRunsSidebar({
  conversationId,
  onClose,
}: AgentRunsSidebarProps) {
  const queryClient = useQueryClient();
  const { on } = useSocket();

  const queryKey = useMemo(
    () => ['agent-runs', conversationId] as const,
    [conversationId],
  );

  const { data: runs = [], isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      aiAgentsService.feed({ conversationId, period: 'all', limit: 30 }),
    refetchInterval: 30000,
    staleTime: 5000,
  });

  // Auto-expand the most recent run on first load — operators almost
  // always want to see what's happening *right now* without an extra
  // click. Older runs stay collapsed.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (runs.length === 0) return;
    setExpandedIds((prev) => {
      if (prev.size > 0) return prev;
      return new Set([runs[0].id]);
    });
  }, [runs]);

  // Realtime wiring. We mutate the cache directly so the UI updates
  // without a network roundtrip; tools land instantly as the agent
  // emits them.
  useEffect(() => {
    const unsubStart = on('ai:run:start', (payload: any) => {
      if (payload?.conversationId !== conversationId) return;
      queryClient.setQueryData<FeedRun[]>(queryKey, (prev) => {
        const list = prev ?? [];
        if (list.some((r) => r.id === payload.runId)) return list;
        const fresh: FeedRun = {
          id: payload.runId,
          agentId: payload.agent?.id ?? '',
          conversationId,
          modelId: payload.modelId ?? '',
          status: 'RUNNING',
          finalAction: null,
          errorMessage: null,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: '0',
          durationMs: null,
          startedAt: payload.startedAt ?? new Date().toISOString(),
          finishedAt: null,
          agent: payload.agent ?? { id: '', name: 'Agent', kind: 'WORKER' },
          toolCalls: [],
          failedToolCalls: 0,
          hasFailedToolCalls: false,
        };
        return [fresh, ...list];
      });
      // Always expand a freshly started run.
      setExpandedIds((prev) => new Set([payload.runId, ...prev]));
    });

    const unsubTool = on('ai:run:tool-call', (payload: any) => {
      if (payload?.conversationId !== conversationId) return;
      queryClient.setQueryData<FeedRun[]>(queryKey, (prev) => {
        if (!prev) return prev;
        return prev.map((r) => {
          if (r.id !== payload.runId) return r;
          if (r.toolCalls.some((t) => t.id === payload.toolCall?.id)) return r;
          const tc: ToolCall = payload.toolCall;
          const failed = isToolCallFailure(tc);
          return {
            ...r,
            toolCalls: [...r.toolCalls, tc],
            failedToolCalls: (r.failedToolCalls ?? 0) + (failed ? 1 : 0),
            hasFailedToolCalls: r.hasFailedToolCalls || failed,
          };
        });
      });
    });

    const unsubEnd = on('ai:run:end', (payload: any) => {
      if (payload?.conversationId !== conversationId) return;
      queryClient.setQueryData<FeedRun[]>(queryKey, (prev) => {
        if (!prev) return prev;
        return prev.map((r) =>
          r.id === payload.runId
            ? {
                ...r,
                status: payload.status,
                finalAction: payload.finalAction ?? null,
                errorMessage: payload.errorMessage ?? null,
                finishedAt: payload.finishedAt ?? null,
                durationMs: payload.durationMs ?? r.durationMs,
                inputTokens: payload.inputTokens ?? r.inputTokens,
                outputTokens: payload.outputTokens ?? r.outputTokens,
                cacheReadTokens: payload.cacheReadTokens ?? r.cacheReadTokens,
                cacheWriteTokens: payload.cacheWriteTokens ?? r.cacheWriteTokens,
                costUsd: String(payload.costUsd ?? r.costUsd),
              }
            : r,
        );
      });
    });

    return () => {
      unsubStart?.();
      unsubTool?.();
      unsubEnd?.();
    };
  }, [conversationId, on, queryClient, queryKey]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-primary" />
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Logs do agente
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <CopyDumpButton conversationId={conversationId} runs={runs} />
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Fechar logs"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center px-6 pt-12 text-center">
            <Bot className="h-8 w-8 text-zinc-300 dark:text-zinc-700" />
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              Nenhum agente rodou nessa conversa ainda
            </p>
            <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
              Os logs vão aparecer aqui em tempo real assim que a IA executar.
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {runs.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                expanded={expandedIds.has(run.id)}
                onToggle={() => toggleExpanded(run.id)}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * Copia as mensagens da conversa e os logs do agente como texto, para colar
 * numa análise (ex.: conversa com o Claude).
 */
function CopyDumpButton({ conversationId, runs }: { conversationId: string; runs: FeedRun[] }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const done = () => {
    setState('done');
    toast.success('Conversa e logs copiados');
    setTimeout(() => setState('idle'), 2000);
  };
  const copy = async () => {
    setState('loading');
    const text = loadDump(conversationId, runs);
    try {
      // O navegador só deixa escrever na área de transferência durante o
      // clique: com um ClipboardItem que recebe a promessa, a escrita começa
      // já no clique e o texto entra quando a busca termina.
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) }),
        ]);
      } else {
        await navigator.clipboard.writeText(await text);
      }
      done();
    } catch {
      // Sem permissão: o texto já está pronto, um novo clique copia na hora.
      const ready = await text.catch((err) => {
        toast.error(`Não foi possível carregar a conversa: ${(err as Error)?.message ?? err}`);
        return null;
      });
      setState('idle');
      if (ready === null) return;
      toast('Conversa e logs prontos', {
        action: {
          label: 'Copiar',
          onClick: () => {
            if (copyNow(ready)) done();
            else toast.error('O navegador bloqueou a cópia.');
          },
        },
        duration: 15000,
      });
    }
  };
  return (
    <button
      onClick={copy}
      disabled={state === 'loading'}
      className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-60 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      aria-label="Copiar conversa e logs do contexto atual da IA"
      title="Copiar conversa e logs do contexto atual da IA"
    >
      {state === 'loading' ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : state === 'done' ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

/** Cópia síncrona (dentro de um clique), com o texto já pronto. */
function copyNow(text: string): boolean {
  navigator.clipboard?.writeText(text).catch(() => undefined);
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/** Só o que a IA enxerga hoje: depois do último "Limpar contexto da IA". */
async function loadDump(conversationId: string, runs: FeedRun[]): Promise<string> {
  const [conversation, { messages }, notes] = await Promise.all([
    inboxService.getConversation(conversationId),
    inboxService.getMessages(conversationId, 1, 200),
    inboxService.listNotes(conversationId).catch(() => []),
  ]);
  const resetAt = conversation.metadata?.aiContextResetAt ?? null;
  const since = resetAt ? new Date(resetAt).getTime() : 0;
  const after = (iso: string) => new Date(iso).getTime() > since;
  return buildDump(
    conversationId,
    resetAt,
    messages.filter((m) => m.conversationId === conversationId && after(m.createdAt)),
    notes.filter((n) => after(n.createdAt)),
    runs.filter((r) => after(r.startedAt)),
  );
}

const DUMP_JSON_MAX = 4000;

function stamp(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function dumpJson(value: unknown): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    s = String(value);
  }
  return s.length > DUMP_JSON_MAX ? `${s.slice(0, DUMP_JSON_MAX)}\n…[truncado]` : s;
}

function messageLine(m: Message): string {
  const c = m.content ?? {};
  const meta = m.metadata ?? {};
  const who =
    m.direction === 'INBOUND'
      ? `Cliente${m.senderName ? ` (${m.senderName})` : ''}`
      : meta.aiAgentId
        ? 'IA'
        : meta.chatbotFlowId
          ? 'Robô'
          : `Atendente${m.sender?.name ? ` (${m.sender.name})` : m.senderName ? ` (${m.senderName})` : ''}`;
  const text = [c.text, c.caption].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  const transcription = meta.transcription?.text ? ` [áudio transcrito] ${meta.transcription.text}` : '';
  const media = m.type !== 'TEXT' ? `[${m.type}${c.mediaUrl ? ` ${c.mediaUrl}` : ''}] ` : '';
  const status = m.status === 'FAILED' ? ` (FALHOU${m.failedReason ? `: ${m.failedReason}` : ''})` : '';
  return `[${stamp(m.createdAt)}] ${who}: ${media}${text ?? ''}${transcription}${status}${m.revokedAt ? ' (apagada)' : ''}`;
}

function buildDump(
  conversationId: string,
  resetAt: string | null,
  messages: Message[],
  notes: Awaited<ReturnType<typeof inboxService.listNotes>>,
  runs: FeedRun[],
): string {
  const timeline = [
    ...messages.map((m) => ({ at: m.createdAt, line: messageLine(m) })),
    ...notes.map((n) => ({
      at: n.createdAt,
      line: `[${stamp(n.createdAt)}] Nota interna (${n.agent?.name ?? n.author?.name ?? n.authorType}): ${n.content}`,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const context = resetAt ? `contexto da IA desde ${stamp(resetAt)}` : 'contexto da IA: conversa inteira';
  const out = [
    `=== Conversa ${conversationId} (${messages.length} mensagens, ${context}) ===`,
    ...timeline.map((t) => t.line),
    '',
  ];
  out.push(`=== Logs do agente (${runs.length} execuções, da mais antiga para a mais nova) ===`);
  for (const run of [...runs].reverse()) {
    const tokens = `${run.inputTokens} in · ${run.outputTokens} out`;
    out.push(
      '',
      `--- [${stamp(run.startedAt)}] ${run.agent.name} · ${run.status}${run.finalAction ? ` · ${humanFinalAction(run.finalAction)}` : ''}` +
        `${run.durationMs != null ? ` · ${formatDuration(run.durationMs)}` : ''} · ${tokens} · $${(parseFloat(run.costUsd) || 0).toFixed(4)}`,
    );
    if (run.errorMessage) out.push(`ERRO: ${run.errorMessage}`);
    for (const tc of run.toolCalls) {
      out.push(`* ${tc.toolName}${tc.durationMs != null ? ` (${formatDuration(tc.durationMs)})` : ''}`);
      out.push(`  input: ${dumpJson(tc.input)}`);
      if (tc.output !== null && tc.output !== undefined) out.push(`  output: ${dumpJson(tc.output)}`);
      if (tc.error) out.push(`  error: ${tc.error}`);
    }
  }
  return out.join('\n');
}

function RunCard({
  run,
  expanded,
  onToggle,
}: {
  run: FeedRun;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isRunning = run.status === 'RUNNING';
  const failed =
    run.status === 'FAILED' || run.hasFailedToolCalls === true;
  return (
    <div className="border-b border-zinc-100 dark:border-zinc-900">
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
      >
        <span className="mt-0.5 shrink-0">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
          )}
        </span>
        <span className="shrink-0">
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
          ) : failed ? (
            <XCircle className="h-3.5 w-3.5 text-red-500" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
              {run.agent.name}
            </span>
            {isRunning && (
              <span className="text-[10px] font-medium uppercase tracking-wide text-blue-500">
                rodando
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
            <span>{formatRelative(run.startedAt)}</span>
            {run.durationMs != null && (
              <span>· {formatDuration(run.durationMs)}</span>
            )}
            {run.finalAction && (
              <span className="rounded bg-zinc-100 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {humanFinalAction(run.finalAction)}
              </span>
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="bg-zinc-50/50 px-4 pb-3 pt-1 dark:bg-zinc-900/30">
          {run.errorMessage && (
            <div className="mb-2 flex items-start gap-1.5 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:border-red-900/40 dark:bg-red-900/15 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="flex-1">{run.errorMessage}</span>
            </div>
          )}

          {run.toolCalls.length === 0 ? (
            <p className="py-1 text-[11px] italic text-zinc-400">
              {isRunning ? 'Aguardando primeira tool…' : 'Sem tool calls.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {run.toolCalls.map((tc) => (
                <ToolCallRow key={tc.id} tc={tc} />
              ))}
            </ul>
          )}

          <RunFooter run={run} />
        </div>
      )}
    </div>
  );
}

function ToolCallRow({ tc }: { tc: ToolCall }) {
  const failed = isToolCallFailure(tc);
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
      >
        {failed ? (
          <XCircle className="h-3 w-3 shrink-0 text-red-500" />
        ) : (
          <Wrench className="h-3 w-3 shrink-0 text-zinc-400" />
        )}
        <span
          className={`flex-1 truncate text-[11px] font-medium ${
            failed
              ? 'text-red-700 dark:text-red-300'
              : 'text-zinc-700 dark:text-zinc-200'
          }`}
        >
          {tc.toolName}
        </span>
        {tc.durationMs != null && (
          <span className="shrink-0 text-[10px] text-zinc-400">
            {formatDuration(tc.durationMs)}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-0.5 ml-4 space-y-1.5 rounded border border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-950">
          <JsonBlock label="input" value={tc.input} />
          <JsonBlock label="output" value={tc.output} />
          {tc.error && (
            <div>
              <p className="text-[9px] font-medium uppercase tracking-wide text-red-500">
                error
              </p>
              <p className="mt-0.5 text-[10px] text-red-600 dark:text-red-400">
                {tc.error}
              </p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  let formatted: string;
  try {
    formatted = JSON.stringify(value, null, 2);
  } catch {
    formatted = String(value);
  }
  // Truncate large payloads — operators rarely need 5KB of JSON inline.
  const truncated =
    formatted.length > 600 ? formatted.slice(0, 600) + '\n…[truncated]' : formatted;
  return (
    <div>
      <p className="text-[9px] font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </p>
      <pre className="mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-50 px-1.5 py-1 font-mono text-[10px] leading-tight text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        {truncated}
      </pre>
    </div>
  );
}

function RunFooter({ run }: { run: FeedRun }) {
  const cost = parseFloat(run.costUsd) || 0;
  const tokens =
    run.inputTokens + run.outputTokens + run.cacheReadTokens + run.cacheWriteTokens;
  if (cost === 0 && tokens === 0) return null;
  return (
    <div className="mt-2 flex items-center gap-3 border-t border-zinc-200 pt-1.5 text-[10px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      {tokens > 0 && (
        <span>
          {run.inputTokens} in · {run.outputTokens} out
        </span>
      )}
      {cost > 0 && <span>${cost.toFixed(4)}</span>}
    </div>
  );
}

function isToolCallFailure(tc: ToolCall): boolean {
  if (tc.error) return true;
  const out = tc.output as any;
  if (!out || typeof out !== 'object') return false;
  if (out.ok === false) return true;
  const status = out.status ?? out.statusCode;
  if (typeof status === 'number' && status >= 400) return true;
  return false;
}

function humanFinalAction(action: string): string {
  const map: Record<string, string> = {
    REPLIED: 'reply',
    TRANSFERRED: 'transfer',
    DELEGATED: 'delegate',
    HANDED_BACK: 'hand back',
    TAGGED: 'tag',
    CLOSED_CONVERSATION: 'closed',
    NO_ACTION: 'no-op',
  };
  return map[action] ?? action.toLowerCase();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });
}
