'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { Bot, Calculator, Loader2, Lock, Search, Settings2, Sparkles, Workflow, Zap } from 'lucide-react';
import { toast } from 'sonner';
import {
  quickRepliesService,
  type QuickReply,
} from '@/features/settings/services/quick-replies.service';
import { chatbotService } from '@/features/chatbot/services/chatbot.service';
import { useOrgId } from '@/hooks/use-org-query-key';
import { inboxService } from '../services/inbox.service';
import { CountryMultiSelect, DateRangePicker } from './quote-pickers';

export function useQuickReplies() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['quick-replies', orgId],
    queryFn: () => quickRepliesService.list(),
    staleTime: 60_000,
  });
}

/** Atalho que começa com o termo primeiro; depois título/texto que contêm. */
export function filterQuickReplies(replies: QuickReply[], query: string): QuickReply[] {
  const q = query.trim().toLowerCase().replace(/^\//, '');
  if (!q) return replies;
  const starts = replies.filter((r) => r.shortcut.startsWith(q));
  const rest = replies.filter(
    (r) =>
      !r.shortcut.startsWith(q) &&
      (r.shortcut.includes(q) || r.title.toLowerCase().includes(q) || r.content.toLowerCase().includes(q)),
  );
  return [...starts, ...rest];
}

/**
 * Lista de respostas rápidas sobre a caixa de mensagem. Aberta pelo botão
 * (com busca própria) ou digitando "/" (filtra pelo que vem depois da barra;
 * setas + Enter escolhem, Esc fecha).
 */
export function QuickReplyPanel({
  replies,
  loading,
  activeIndex,
  onActiveIndexChange,
  onPick,
  search,
  onClose,
  preview,
}: {
  replies: QuickReply[];
  loading: boolean;
  activeIndex: number;
  onActiveIndexChange: (i: number) => void;
  onPick: (reply: QuickReply) => void;
  /** Modo botão: campo de busca no topo do painel. */
  search?: { value: string; onChange: (value: string) => void };
  onClose: () => void;
  /** Texto como vai sair (variáveis já trocadas). */
  preview: (content: string) => string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // Clique fora fecha (o botão ⚡ alterna por conta própria).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (panelRef.current?.contains(target) || target.closest('[data-quick-reply-toggle]')) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="absolute inset-x-3 bottom-full z-30 mb-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <Zap className="h-3.5 w-3.5 shrink-0 text-primary" />
        {search ? (
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              autoFocus
              value={search.value}
              onChange={(e) => {
                search.onChange(e.target.value);
                onActiveIndexChange(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  onActiveIndexChange(Math.min(activeIndex + 1, replies.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  onActiveIndexChange(Math.max(activeIndex - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  if (replies[activeIndex]) onPick(replies[activeIndex]);
                } else if (e.key === 'Escape') {
                  onClose();
                }
              }}
              placeholder="Buscar resposta rápida…"
              className="w-full rounded-md bg-zinc-50 py-1 pl-7 pr-2 text-xs text-zinc-800 focus:outline-none focus:ring-1 focus:ring-primary dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
        ) : (
          <span className="flex-1 text-xs font-medium text-zinc-500">
            Respostas rápidas{' '}
            <span className="hidden font-normal text-zinc-400 sm:inline">· ↑↓ escolher · Enter inserir · Esc fechar</span>
          </span>
        )}
        <Link
          href="/settings/quick-replies"
          className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
          title="Cadastrar respostas rápidas"
          aria-label="Cadastrar respostas rápidas"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
          </div>
        ) : replies.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-zinc-500">
            Nenhuma resposta rápida encontrada.{' '}
            <Link href="/settings/quick-replies" className="font-medium text-primary hover:underline">
              Cadastrar
            </Link>
          </p>
        ) : (
          replies.map((r, i) => (
            <button
              key={r.id}
              type="button"
              data-index={i}
              onMouseEnter={() => onActiveIndexChange(i)}
              onMouseDown={(e) => e.preventDefault()} // mantém o foco na caixa
              onClick={() => onPick(r)}
              className={`block w-full px-3 py-2 text-left ${
                i === activeIndex ? 'bg-primary/5 dark:bg-primary/10' : ''
              }`}
            >
              <span className="flex items-center gap-2">
                <code className="shrink-0 rounded bg-primary/10 px-1 text-[11px] font-semibold text-primary">/{r.shortcut}</code>
                <span className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">{r.title}</span>
                {r.isPrivate && (
                  <span title="Só para mim" aria-label="Só para mim" className="shrink-0">
                    <Lock className="h-3 w-3 text-zinc-400" />
                  </span>
                )}
              </span>
              <span className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-xs text-zinc-500 dark:text-zinc-400">
                {preview(r.content)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Aciona um fluxo do robô nesta conversa: ele manda o menu ao cliente e a
 * IA fica calada até o fluxo terminar (o bloco Fim diz se vai pra IA ou humano).
 */
export function BotTriggerButton({ conversationId, className = '' }: { conversationId: string; className?: string }) {
  const orgId = useOrgId();
  const [runningId, setRunningId] = useState<string | null>(null);
  const { data: flows = [], isLoading } = useQuery({
    queryKey: ['chatbot-flows', orgId],
    queryFn: () => chatbotService.list(),
    staleTime: 60_000,
  });
  const usable = useMemo(
    () =>
      flows
        .filter((f) => (f._count?.nodes ?? f.nodes?.length ?? 0) > 0)
        .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name)),
    [flows],
  );

  const run = async (flowId: string, name: string, close: () => void) => {
    setRunningId(flowId);
    try {
      await chatbotService.run(flowId, conversationId);
      toast.success(`Robô "${name}" acionado — a IA aguarda o fim do fluxo`);
      close();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao acionar o robô');
    } finally {
      setRunningId(null);
    }
  };

  return (
    <Popover className="relative">
      <PopoverButton
        className={`${className} text-zinc-400 outline-none hover:text-zinc-600 data-[open]:bg-zinc-100 data-[open]:text-primary dark:data-[open]:bg-zinc-800`}
        aria-label="Acionar robô"
        title="Acionar robô (fluxo com menu)"
      >
        <Bot className="h-4 w-4" />
      </PopoverButton>
      <PopoverPanel
        anchor="top start"
        className="z-50 w-72 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg outline-none dark:border-zinc-700 dark:bg-zinc-900 [--anchor-gap:0.5rem]"
      >
        {({ close }) => (
          <>
            <p className="px-2 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wider text-zinc-400">Acionar robô</p>
            {isLoading ? (
              <div className="flex justify-center py-3">
                <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
              </div>
            ) : usable.length === 0 ? (
              <p className="px-2 py-3 text-xs text-zinc-500">
                Nenhum fluxo pronto.{' '}
                <Link href="/chatbot" className="font-medium text-primary hover:underline">
                  Criar fluxo
                </Link>
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                {usable.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    disabled={!!runningId}
                    onClick={() => run(f.id, f.name, close)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-zinc-50 disabled:opacity-60 dark:hover:bg-zinc-800"
                  >
                    {runningId === f.id ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                    ) : (
                      <Workflow className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-200">{f.name}</span>
                    {!f.isActive && <span className="shrink-0 text-[10px] text-zinc-400">inativo</span>}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-1 border-t border-zinc-100 px-2 pt-1.5 text-[10px] leading-snug text-zinc-400 dark:border-zinc-800">
              O robô começa o fluxo do início com o cliente. A IA espera ele terminar; se você responder, o robô para.
            </p>
          </>
        )}
      </PopoverPanel>
    </Popover>
  );
}

const FIELD =
  'w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800 outline-none focus:border-primary dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200';

/**
 * Cotação de chip pelo atendente: destino, período e tipo → o texto da
 * cotação (o mesmo que a IA manda) para enviar ou editar. Não aciona a IA.
 */
export function QuoteButton({
  conversationId,
  onSend,
  onEdit,
  className = '',
}: {
  conversationId: string;
  onSend: (text: string) => Promise<void>;
  onEdit: (text: string) => void;
  className?: string;
}) {
  const [countries, setCountries] = useState<string[]>([]);
  // Período no calendário ou só a quantidade de dias.
  const [mode, setMode] = useState<'range' | 'days'>('range');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [days, setDays] = useState('');
  const [chipType, setChipType] = useState<'virtual' | 'physical'>('virtual');
  const [franquia, setFranquia] = useState(false);
  // 15% = cupom MINHAVIAGEM; outro valor sai sem citar cupom.
  const [discount, setDiscount] = useState('15');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<string[] | null>(null);

  const generate = async () => {
    const list = countries;
    const dated = mode === 'range';
    if (!list.length) return toast.error('Escolha o destino');
    if (dated && !(startDate && endDate)) return toast.error('Escolha a ida e a volta no calendário');
    if (!dated && !(Number(days) > 0)) return toast.error('Informe a quantidade de dias');
    const pct = discount.trim() === '' ? 15 : Number(discount.replace(',', '.'));
    if (!(pct >= 0 && pct <= 100)) return toast.error('Desconto entre 0 e 100%');
    setLoading(true);
    try {
      const res = await inboxService.quickQuote(conversationId, {
        countries: list,
        chipType,
        franquiaApenas: franquia,
        discountPercent: pct,
        ...(dated ? { startDate, endDate } : { days: Number(days) }),
      });
      setMessages(res.messages);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao calcular a cotação');
    } finally {
      setLoading(false);
    }
  };

  const send = async (close: () => void) => {
    if (!messages) return;
    setSending(true);
    try {
      for (const m of messages) await onSend(m);
      setMessages(null);
      close();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao enviar a cotação');
    } finally {
      setSending(false);
    }
  };

  return (
    <Popover className="relative">
      <PopoverButton
        className={`${className} text-zinc-400 outline-none hover:text-zinc-600 data-[open]:bg-zinc-100 data-[open]:text-primary dark:data-[open]:bg-zinc-800`}
        aria-label="Cotação de chip"
        title="Cotação de chip (sem acionar a IA)"
      >
        <Calculator className="h-4 w-4" />
      </PopoverButton>
      <PopoverPanel
        anchor="top start"
        className="z-50 max-h-[80vh] w-80 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-3 shadow-lg outline-none dark:border-zinc-700 dark:bg-zinc-900 [--anchor-gap:0.5rem]"
      >
        {({ close }) =>
          messages ? (
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Cotação</p>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {messages.map((m, i) => (
                  <p
                    key={i}
                    className="whitespace-pre-wrap rounded-lg bg-zinc-50 px-2 py-1.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  >
                    {m}
                  </p>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setMessages(null)}
                  className="rounded-md px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  Voltar
                </button>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => {
                    onEdit(messages.join('\n\n'));
                    setMessages(null);
                    close();
                  }}
                  className="rounded-md px-2 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Editar
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => send(close)}
                  className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                >
                  {sending && <Loader2 className="h-3 w-3 animate-spin" />}
                  Enviar
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Cotação de chip</p>
              <div className="text-xs text-zinc-500">
                <p className="mb-0.5">Destino</p>
                <CountryMultiSelect value={countries} onChange={setCountries} />
              </div>
              <div className="text-xs text-zinc-500">
                <div className="mb-1 flex items-center gap-1">
                  <span className="flex-1">Período</span>
                  {(['range', 'days'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={`rounded px-1.5 py-0.5 text-[11px] ${
                        mode === m ? 'bg-primary/10 font-medium text-primary' : 'text-zinc-400 hover:text-zinc-600'
                      }`}
                    >
                      {m === 'range' ? 'Datas' : 'Qtde de dias'}
                    </button>
                  ))}
                </div>
                {mode === 'range' ? (
                  <DateRangePicker
                    start={startDate}
                    end={endDate}
                    onChange={(a, b) => {
                      setStartDate(a);
                      setEndDate(b);
                    }}
                  />
                ) : (
                  <input
                    type="number"
                    min={1}
                    className={FIELD}
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    placeholder="Ex.: 10"
                  />
                )}
              </div>
              <div className="flex gap-1">
                {(['virtual', 'physical'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setChipType(t)}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-xs ${
                      chipType === t
                        ? 'border-primary bg-primary/10 font-medium text-primary'
                        : 'border-zinc-200 text-zinc-500 dark:border-zinc-700'
                    }`}
                  >
                    {t === 'virtual' ? 'Virtual (eSIM)' : 'Físico'}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs text-zinc-500">
                Desconto (%)
                <input
                  type="number"
                  min={0}
                  max={100}
                  className={`${FIELD} w-20`}
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
                <span className="text-[10px] leading-snug text-zinc-400">
                  {discount.trim() === '' || Number(discount) === 15 ? 'cupom MINHAVIAGEM' : 'sem citar cupom'}
                </span>
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-500">
                <input type="checkbox" checked={franquia} onChange={(e) => setFranquia(e.target.checked)} />
                Só planos com franquia (em vez do ilimitado)
              </label>
              <button
                type="button"
                disabled={loading}
                onClick={generate}
                className="flex w-full items-center justify-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
              >
                {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                Gerar cotação
              </button>
              <p className="text-[10px] leading-snug text-zinc-400">Mesmo texto e desconto da IA. A IA não é acionada.</p>
            </div>
          )
        }
      </PopoverPanel>
    </Popover>
  );
}

/** Partes da sugestão: mensagens separadas por uma linha só com "...". */
const splitDraft = (text: string) =>
  text
    .split(/\n[ \t]*(?:\.{3}|…)[ \t]*(?:\n|$)/)
    .map((p) => p.trim())
    .filter(Boolean);

/**
 * "Sugerir resposta": a IA escreve a mensagem que mandaria agora (pelo
 * histórico e/ou por uma orientação do atendente). Nada é enviado sem o
 * atendente clicar em Enviar.
 */
export function DraftReplyButton({
  conversationId,
  onSend,
  onEdit,
  className = '',
}: {
  conversationId: string;
  onSend: (text: string) => Promise<void>;
  onEdit: (text: string) => void;
  className?: string;
}) {
  const [useHistory, setUseHistory] = useState(true);
  const [extraInfo, setExtraInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [parts, setParts] = useState<string[] | null>(null);

  const generate = async () => {
    if (!useHistory && !extraInfo.trim()) return toast.error('Escreva o que a mensagem deve dizer');
    setLoading(true);
    try {
      const res = await inboxService.draftAiReply(conversationId, {
        useHistory,
        ...(extraInfo.trim() ? { extraInfo: extraInfo.trim() } : {}),
      });
      setParts(splitDraft(res.text));
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao sugerir a resposta');
    } finally {
      setLoading(false);
    }
  };

  const send = async (close: () => void) => {
    if (!parts) return;
    setSending(true);
    try {
      for (const p of parts) await onSend(p);
      setParts(null);
      setExtraInfo('');
      close();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao enviar');
    } finally {
      setSending(false);
    }
  };

  return (
    <Popover className="relative">
      <PopoverButton
        className={`${className} text-zinc-400 outline-none hover:text-zinc-600 data-[open]:bg-zinc-100 data-[open]:text-primary dark:data-[open]:bg-zinc-800`}
        aria-label="Sugerir resposta com a IA"
        title="Sugerir resposta com a IA (não envia sozinha)"
      >
        <Sparkles className="h-4 w-4" />
      </PopoverButton>
      <PopoverPanel
        anchor="top start"
        className="z-50 max-h-[80vh] w-80 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-3 shadow-lg outline-none dark:border-zinc-700 dark:bg-zinc-900 [--anchor-gap:0.5rem]"
      >
        {({ close }) =>
          parts ? (
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Sugestão da IA</p>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {parts.map((m, i) => (
                  <p
                    key={i}
                    className="whitespace-pre-wrap rounded-lg bg-zinc-50 px-2 py-1.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  >
                    {m}
                  </p>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setParts(null)}
                  className="rounded-md px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  Voltar
                </button>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => {
                    onEdit(parts.join('\n\n'));
                    setParts(null);
                    close();
                  }}
                  className="rounded-md px-2 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Editar
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => send(close)}
                  className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                >
                  {sending && <Loader2 className="h-3 w-3 animate-spin" />}
                  Enviar
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Sugerir resposta</p>
              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                <input type="checkbox" checked={useHistory} onChange={(e) => setUseHistory(e.target.checked)} />
                Usar o histórico da conversa
              </label>
              <label className="block text-xs text-zinc-500">
                Informação para incluir (opcional)
                <textarea
                  rows={3}
                  className={`${FIELD} mt-0.5 resize-none`}
                  value={extraInfo}
                  onChange={(e) => setExtraInfo(e.target.value)}
                  placeholder="Ex.: o pedido foi reenviado hoje; oferecer o plano de 10GB"
                />
              </label>
              <button
                type="button"
                disabled={loading}
                onClick={generate}
                className="flex w-full items-center justify-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
              >
                {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                {loading ? 'A IA está escrevendo…' : 'Sugerir resposta'}
              </button>
              <p className="text-[10px] leading-snug text-zinc-400">
                A IA escreve como responderia (pode consultar pedido e cotação). Nada é enviado sem você clicar em Enviar.
              </p>
            </div>
          )
        }
      </PopoverPanel>
    </Popover>
  );
}
