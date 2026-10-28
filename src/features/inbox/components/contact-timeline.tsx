'use client';

import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Ban, ChevronUp, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { inboxService, type Conversation, type Message } from '../services/inbox.service';
import { useContactConversations } from '@/features/contacts/components/contact-history-list';
import type { ContactConversation } from '@/features/contacts/services/contacts.service';
import { AudioMessagePlayer } from './audio-message-player';
import {
  MediaImage,
  MediaVideo,
  MediaDocument,
  MediaSticker,
  MediaLocation,
} from './media-bubbles';

const PAGE_SIZE = 50;

interface Block {
  /** null = páginas mais antigas da própria conversa aberta. */
  conv: ContactConversation | null;
  messages: Message[];
}

interface Cursor {
  /** Índice em `sources`. */
  source: number;
  /** Próxima página a buscar (1 = mais recentes). */
  page: number;
}

/**
 * Linha do tempo do contato dentro da conversa: "Carregar anteriores" puxa
 * primeiro as mensagens mais antigas desta conversa (o painel só carrega as
 * 50 últimas) e depois, um a um, os atendimentos anteriores do mesmo
 * contato — cada um com um separador. Só leitura.
 */
export function ContactTimeline({
  conversation,
  loadedCount,
  totalCount,
  loadedIds,
  scrollRef,
  onOpenConversation,
}: {
  conversation: Conversation;
  /** Mensagens que o painel já mostra (página 1) e o total da conversa. */
  loadedCount: number;
  totalCount: number;
  loadedIds: Set<string>;
  scrollRef: RefObject<HTMLDivElement | null>;
  onOpenConversation?: (conversationId: string) => void;
}) {
  const { data: history } = useContactConversations(conversation.contactId);

  // Fontes em ordem de carregamento: resto desta conversa, depois os
  // atendimentos criados antes dela, do mais recente pro mais antigo.
  const sources = useMemo(() => {
    const list: { conv: ContactConversation | null; total: number }[] = [];
    if (totalCount > loadedCount) list.push({ conv: null, total: totalCount });
    const createdAt = new Date(conversation.createdAt).getTime();
    for (const c of history ?? []) {
      if (c.id === conversation.id) continue;
      if (new Date(c.createdAt).getTime() >= createdAt) continue;
      list.push({ conv: c, total: c._count.messages });
    }
    return list;
    // totalCount/loadedCount mudam com mensagens novas; a fonte "resto desta
    // conversa" só importa na primeira vez — fixa pelo id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, conversation.id, conversation.createdAt, totalCount > loadedCount]);

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [cursor, setCursor] = useState<Cursor>({ source: 0, page: 2 });
  const [loading, setLoading] = useState(false);

  // Página inicial da 1ª fonte: 2 se for a própria conversa (a 1 já está na tela).
  const startPage = (idx: number) => (idx === 0 && sources[0]?.conv === null ? 2 : 1);
  const effectiveCursor =
    blocks.length === 0 ? { source: 0, page: startPage(0) } : cursor;
  const next = sources[effectiveCursor.source];

  // Mantém a posição de leitura ao inserir conteúdo acima.
  const anchor = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && anchor.current !== null) {
      el.scrollTop = el.scrollHeight - anchor.current;
      anchor.current = null;
    }
  }, [blocks, scrollRef]);

  const loadMore = async () => {
    if (!next || loading) return;
    const convId = next.conv?.id ?? conversation.id;
    setLoading(true);
    try {
      const res = await inboxService.getMessages(convId, effectiveCursor.page, PAGE_SIZE);
      const fresh = res.messages.filter((m) => !loadedIds.has(m.id) && m.type !== 'REACTION');
      const el = scrollRef.current;
      if (el) anchor.current = el.scrollHeight - el.scrollTop;
      setBlocks((prev) => {
        const key = next.conv?.id ?? null;
        const existing = prev.find((b) => (b.conv?.id ?? null) === key);
        if (existing) {
          const ids = new Set(existing.messages.map((m) => m.id));
          return prev.map((b) =>
            b === existing
              ? { ...b, messages: [...fresh.filter((m) => !ids.has(m.id)), ...b.messages] }
              : b,
          );
        }
        // Atendimento mais antigo entra no topo.
        return [{ conv: next.conv, messages: fresh }, ...prev];
      });
      const totalPages = Math.max(1, Math.ceil(next.total / PAGE_SIZE));
      setCursor(
        effectiveCursor.page < totalPages
          ? { source: effectiveCursor.source, page: effectiveCursor.page + 1 }
          : { source: effectiveCursor.source + 1, page: startPage(effectiveCursor.source + 1) },
      );
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao carregar histórico');
    } finally {
      setLoading(false);
    }
  };

  const label = !next
    ? null
    : next.conv === null
      ? 'Carregar mensagens anteriores'
      : blocks.some((b) => b.conv?.id === next.conv!.id)
        ? `Carregar mais do atendimento de ${formatDate(next.conv.createdAt)}`
        : `Carregar atendimento anterior (${formatDate(next.conv.createdAt)} · ${next.conv.channel.name})`;

  const hadPrevious = (history ?? []).some(
    (c) => c.id !== conversation.id && new Date(c.createdAt) < new Date(conversation.createdAt),
  );

  if (!label && blocks.length === 0) return null;

  return (
    <div className="mx-auto mb-2 max-w-2xl space-y-2">
      {label ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-600 shadow-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronUp className="h-3 w-3" />}
            {label}
          </button>
        </div>
      ) : (
        hadPrevious && (
          <p className="text-center text-[11px] text-zinc-400">Início do histórico do contato</p>
        )
      )}

      {blocks.map((block) => (
        <div key={block.conv?.id ?? 'current'} className="space-y-2">
          {block.conv && (
            <ConversationSeparator conv={block.conv} onOpen={onOpenConversation} />
          )}
          {block.messages.map((msg) => (
            <HistoryBubble key={msg.id} msg={msg} isGroup={conversation.isGroup} />
          ))}
          {block.conv && (
            <div className="flex items-center gap-2 py-1">
              <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              <span className="text-[10px] uppercase tracking-wider text-zinc-400">
                Fim do atendimento
              </span>
              <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            </div>
          )}
        </div>
      ))}

      {blocks.length > 0 && (
        <div className="flex items-center gap-2 py-1">
          <div className="h-px flex-1 bg-primary/30" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-primary">
            Atendimento atual
          </span>
          <div className="h-px flex-1 bg-primary/30" />
        </div>
      )}
    </div>
  );
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

function formatDateTime(date: string) {
  const d = new Date(date);
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

const statusLabels: Record<string, string> = {
  PENDING: 'aberto',
  BOT: 'aberto',
  OPEN: 'aberto',
  WAITING: 'aberto',
  CLOSED: 'fechado',
};

function ConversationSeparator({
  conv,
  onOpen,
}: {
  conv: ContactConversation;
  onOpen?: (conversationId: string) => void;
}) {
  const end = conv.closedAt ?? conv.lastMessageAt;
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white/70 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-400">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-zinc-700 dark:text-zinc-200">
          Atendimento {conv.protocol ? `#${conv.protocol}` : ''}
        </span>
        <span className="truncate">· {conv.channel.name}</span>
        {onOpen && (
          <button
            type="button"
            onClick={() => onOpen(conv.id)}
            className="ml-auto inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
          >
            Abrir <ExternalLink className="h-3 w-3" />
          </button>
        )}
      </div>
      <p className="mt-0.5 text-[11px]">
        {formatDate(conv.createdAt)}
        {end ? ` → ${formatDate(end)}` : ''} · {statusLabels[conv.status] ?? conv.status}
        {conv.assignedTo ? ` · ${conv.assignedTo.name}` : ''}
      </p>
    </div>
  );
}

/** Bolha só-leitura das mensagens do histórico (sem ações). */
function HistoryBubble({ msg, isGroup }: { msg: Message; isGroup: boolean }) {
  const isOutbound = msg.direction === 'OUTBOUND';
  const c = msg.content ?? {};
  const senderLabel = isOutbound
    ? (msg.sender?.name ?? null)
    : isGroup
      ? msg.senderName
      : null;

  let body: React.ReactNode;
  if (msg.revokedAt) {
    body = (
      <span className="inline-flex items-center gap-1.5 text-sm italic opacity-70">
        <Ban className="h-3.5 w-3.5" /> Mensagem deletada
      </span>
    );
  } else if (msg.type === 'TEXT') {
    body = <p className="whitespace-pre-wrap break-words text-sm">{c.text || ''}</p>;
  } else if (msg.type === 'AUDIO') {
    body = <AudioMessagePlayer message={msg} isOutbound={isOutbound} />;
  } else if (msg.type === 'IMAGE') {
    body = <MediaImage message={msg} isOutbound={isOutbound} />;
  } else if (msg.type === 'VIDEO') {
    body = <MediaVideo message={msg} isOutbound={isOutbound} />;
  } else if (msg.type === 'DOCUMENT') {
    body = <MediaDocument message={msg} isOutbound={isOutbound} />;
  } else if (msg.type === 'STICKER') {
    body = <MediaSticker message={msg} isOutbound={isOutbound} />;
  } else if (msg.type === 'LOCATION') {
    body = <MediaLocation message={msg} isOutbound={isOutbound} />;
  } else {
    body = (
      <p className="whitespace-pre-wrap break-words text-sm italic opacity-80">
        {c.text || c.caption || `[${msg.type.toLowerCase()}]`}
      </p>
    );
  }

  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[75%] opacity-90">
        {senderLabel && (
          <p className={`mb-0.5 text-xs font-semibold text-primary ${isOutbound ? 'mr-1 text-right' : 'ml-1'}`}>
            {senderLabel}
          </p>
        )}
        <div
          className={`rounded-2xl px-4 py-2.5 ${
            isOutbound
              ? 'rounded-br-md bg-primary/85 text-primary-foreground'
              : 'rounded-bl-md bg-white shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
          }`}
        >
          {isOutbound && c.signatureName && (
            <p className="text-sm font-bold">{c.signatureName}:</p>
          )}
          {body}
          <div className={`mt-1 text-[10px] ${isOutbound ? 'text-right opacity-70' : 'text-zinc-400'}`}>
            {formatDateTime(msg.createdAt)}
          </div>
        </div>
      </div>
    </div>
  );
}
