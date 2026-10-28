'use client';

import { useQuery } from '@tanstack/react-query';
import { MessageSquare, History } from 'lucide-react';
import {
  contactsService,
  type ContactConversation,
} from '../services/contacts.service';
import { ZappfyIcon, MetaIcon, InstagramIcon, GmailIcon } from '@/components/ui/icons';
import { MemberAvatar } from '@/components/ui/member-avatar';
import { useMemberDirectory } from '@/features/settings/hooks/use-member-directory';

const channelIcons: Record<string, React.ElementType> = {
  WHATSAPP_ZAPPFY: ZappfyIcon,
  WHATSAPP_OFFICIAL: MetaIcon,
  INSTAGRAM: InstagramIcon,
  GMAIL: GmailIcon,
};

// Só dois status pro operador: Aberto (qualquer estado não fechado) e Fechado.
const OPEN_META = { label: 'Aberto', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' };
const statusMeta: Record<string, { label: string; cls: string }> = {
  PENDING: OPEN_META,
  BOT: OPEN_META,
  OPEN: OPEN_META,
  WAITING: OPEN_META,
  CLOSED: { label: 'Fechado', cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
};

export function contactConversationsQueryKey(contactId: string) {
  return ['contact-conversations', contactId];
}

/** Query compartilhada (painel, gaveta e linha do tempo usam o mesmo cache). */
export function useContactConversations(contactId: string | null | undefined) {
  return useQuery({
    queryKey: contactConversationsQueryKey(contactId ?? ''),
    queryFn: () => contactsService.getConversations(contactId!),
    enabled: !!contactId,
    staleTime: 30_000,
  });
}

function formatDate(date: string | null) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

function preview(conv: ContactConversation) {
  const last = conv.messages[0];
  if (!last) return 'Sem mensagens';
  const c = last.content ?? {};
  const text = (typeof c.text === 'string' && c.text) || (typeof c.caption === 'string' && c.caption);
  return (last.direction === 'OUTBOUND' ? 'Você: ' : '') + (text || `[${last.type.toLowerCase()}]`);
}

/**
 * Histórico do contato: um item por atendimento (conversa), em todos os
 * canais que o usuário enxerga. Clique abre a conversa no inbox.
 */
export function ContactHistoryList({
  contactId,
  currentConversationId,
  onOpen,
}: {
  contactId: string;
  currentConversationId?: string;
  onOpen: (conversationId: string) => void;
}) {
  const { data, isLoading } = useContactConversations(contactId);
  const directory = useMemberDirectory();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
        ))}
      </div>
    );
  }
  if (!data?.length) {
    return (
      <div className="py-10 text-center">
        <History className="mx-auto h-8 w-8 text-zinc-200 dark:text-zinc-700" />
        <p className="mt-2 text-sm text-zinc-500">Nenhum atendimento encontrado</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">
        {data.length} {data.length === 1 ? 'atendimento' : 'atendimentos'}
      </p>
      {data.map((conv) => {
        const Icon = channelIcons[conv.channel.type] || MessageSquare;
        const status = statusMeta[conv.status] ?? statusMeta.CLOSED;
        const isCurrent = conv.id === currentConversationId;
        const end = conv.closedAt ?? conv.lastMessageAt;
        const responders = conv.responderIds
          .map((id) => directory.get(id))
          .filter((m): m is NonNullable<typeof m> => !!m);
        return (
          <button
            key={conv.id}
            type="button"
            onClick={() => onOpen(conv.id)}
            disabled={isCurrent}
            className={`w-full rounded-lg border p-3 text-left transition-colors ${
              isCurrent
                ? 'cursor-default border-primary/40 bg-primary/5'
                : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                {conv.channel.name}
              </span>
              <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${status.cls}`}>
                {isCurrent ? 'Atual' : status.label}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-400">
              {conv.protocol ? `#${conv.protocol} · ` : ''}
              {formatDate(conv.createdAt)}
              {end && formatDate(end) !== formatDate(conv.createdAt) ? ` → ${formatDate(end)}` : ''}
              {` · ${conv._count.messages} msg`}
            </p>
            {conv.subject && (
              <p className="mt-1 truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                {conv.subject}
              </p>
            )}
            <div className="mt-1.5 flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                {preview(conv)}
              </p>
              {responders.length > 0 && (
                <div
                  className="flex shrink-0 items-center -space-x-1.5"
                  title={responders.map((m) => m.name).join(', ')}
                >
                  {responders.slice(0, 4).map((m, i, arr) => (
                    <span key={m.userId} className="relative" style={{ zIndex: arr.length - i }}>
                      <MemberAvatar
                        name={m.name}
                        avatarUrl={m.avatarUrl}
                        color={m.color}
                        size={18}
                        className="ring-2 ring-white dark:ring-zinc-950"
                      />
                    </span>
                  ))}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
