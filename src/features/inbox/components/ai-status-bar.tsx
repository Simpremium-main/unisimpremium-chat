'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, BotOff, Hourglass, Loader2 } from 'lucide-react';
import { inboxService, type ConversationAiStatus } from '../services/inbox.service';
import { useSocket } from '../hooks/use-socket';
import { aiStepLabel, type AiStep } from './ai-step-label';

const STYLES: Record<
  ConversationAiStatus['state'],
  { icon: React.ElementType; cls: string; spin?: boolean }
> = {
  RUNNING: {
    icon: Loader2,
    spin: true,
    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
  },
  QUEUED: {
    icon: Hourglass,
    cls: 'bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400',
  },
  ACTIVE: {
    icon: Bot,
    cls: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  },
  BLOCKED: {
    icon: BotOff,
    cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
  },
  ERROR: {
    icon: AlertTriangle,
    cls: 'bg-red-100 font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300',
  },
};

/**
 * Faixa fina abaixo do cabeçalho: o que a IA está fazendo nesta conversa —
 * respondendo, esperando o cliente terminar de digitar, aguardando mensagem —
 * ou por que não vai responder (pausada por atendente, fora do horário, …).
 * Atualiza pelos eventos em tempo real da conversa, com polling de segurança.
 */
export function AiStatusBar({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient();
  const { on } = useSocket();
  const queryKey = ['ai-status', conversationId];
  // Passo atual da execução ("consultando o pedido…"); some quando ela acaba.
  const [step, setStep] = useState<AiStep | null>(null);
  useEffect(() => setStep(null), [conversationId]);

  const { data } = useQuery({
    queryKey,
    queryFn: () => inboxService.getAiStatus(conversationId),
    staleTime: 5_000,
    // Estados transitórios mudam rápido; os demais quase nunca (horário,
    // limite mensal) — polling só como rede de segurança.
    refetchInterval: (q) => {
      const state = (q.state.data as ConversationAiStatus | undefined)?.state;
      return state === 'RUNNING' || state === 'QUEUED' ? 4_000 : 60_000;
    },
  });

  useEffect(() => {
    const refetch = () => queryClient.invalidateQueries({ queryKey });
    // A mensagem chega antes do debounce ser armado no backend — dá um respiro.
    const refetchSoon = () => setTimeout(refetch, 1_500);
    const offs = [
      on('ai:run:start', (p: any) => {
        if (p?.conversationId !== conversationId) return;
        setStep(null);
        queryClient.setQueryData<ConversationAiStatus>(queryKey, (prev) => ({
          state: 'RUNNING',
          reason: 'running',
          message: `${p.agent?.name ?? 'IA'} está respondendo…`,
          agent: p.agent ? { id: p.agent.id, name: p.agent.name } : (prev?.agent ?? null),
          lastRun: prev?.lastRun ?? null,
        }));
      }),
      on('ai:run:step', (p: any) => {
        if (p?.conversationId !== conversationId) return;
        setStep(p.kind === 'tool' ? { kind: 'tool', toolName: p.toolName, input: p.input } : { kind: 'thinking', iteration: p.iteration ?? 1 });
      }),
      on('ai:run:end', (p: any) => {
        if (p?.conversationId !== conversationId) return;
        setStep(null);
        refetch();
      }),
      on('message:new', (p: any) => {
        const id = p?.conversationId ?? p?.message?.conversationId;
        if (id === conversationId) refetchSoon();
      }),
      on('conversation:ai-toggle', (p: any) => {
        if (p?.conversationId === conversationId) refetch();
      }),
      on('conversation:updated', (p: any) => {
        if (p?.conversation?.id === conversationId) refetch();
      }),
    ];
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, on, queryClient]);

  if (!data) return null;
  const style = STYLES[data.state] ?? STYLES.ACTIVE;
  const Icon = style.icon;

  return (
    <div
      className={`flex items-center gap-2 border-b border-zinc-200/70 px-4 py-1.5 text-xs dark:border-zinc-800 ${style.cls}`}
      title={data.lastRun?.errorMessage ?? undefined}
      data-ai-reason={data.reason}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${style.spin ? 'animate-spin' : ''}`} />
      <span className="min-w-0 flex-1 truncate">
        {data.state === 'RUNNING' && step
          ? `${data.agent?.name ?? 'IA'}: ${aiStepLabel(step)}`
          : data.message}
      </span>
    </div>
  );
}
