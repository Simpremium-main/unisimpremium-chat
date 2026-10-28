'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Loader2, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { ChatPanel } from './chat-panel';
import {
  inboxService,
  type Conversation,
} from '../services/inbox.service';

interface Props {
  conversationId: string | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Floating ChatPanel shown over any page (kanban, runs, dashboard, …).
 * Lazy-loads the conversation by id. Same realtime/socket plumbing as
 * the inbox page — joining `conv:<id>` happens inside ChatPanel.
 *
 * Use this when the user is on a non-inbox page and wants to peek at
 * (or reply to) a thread without leaving context. For full-time
 * conversation work, the inbox page is still the right place.
 */
export function ConversationDialog({ conversationId, open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<Conversation | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => inboxService.getConversation(conversationId!),
    enabled: open && !!conversationId,
    refetchInterval: open ? 5000 : false,
  });

  useEffect(() => {
    if (data?.id === conversationId) setActive(data);
  }, [data, conversationId]);

  // Reset on close so reopening with a different id doesn't flash stale state.
  useEffect(() => {
    if (!open) setActive(null);
  }, [open]);

  // ESC closes; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleConversationUpdate = () => {
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
    if (conversationId) {
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      queryClient.invalidateQueries({
        queryKey: ['conversation', conversationId],
      });
    }
    // Pipeline cards may show conversation-derived bits — refetch the board.
    queryClient.invalidateQueries({ queryKey: ['pipeline-board'] });
  };

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <span className="px-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
            Conversa
          </span>
          <div className="flex items-center gap-1">
            {conversationId && (
              <Link
                href={`/inbox?conversationId=${conversationId}`}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                title="Abrir na inbox"
              >
                <ExternalLink className="h-3 w-3" />
                Abrir na inbox
              </Link>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {!conversationId ? (
            <EmptyState message="Sem conversa vinculada." />
          ) : isLoading && !active ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            </div>
          ) : error ? (
            <EmptyState message="Não foi possível carregar a conversa." />
          ) : active ? (
            <ChatPanel
              key={active.id}
              conversation={active}
              onConversationUpdate={handleConversationUpdate}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12 text-sm text-zinc-500">
      {message}
    </div>
  );
}
