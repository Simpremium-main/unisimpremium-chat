'use client';

import { History, X } from 'lucide-react';
import { ContactHistoryList } from '@/features/contacts/components/contact-history-list';

/**
 * Painel lateral do inbox com todos os atendimentos do contato da conversa
 * aberta (mesmo layout dos painéis de Projeto/Logs).
 */
export function ContactHistoryPanel({
  contactId,
  contactName,
  currentConversationId,
  onOpen,
  onClose,
}: {
  contactId: string;
  contactName: string | null;
  currentConversationId: string;
  onOpen: (conversationId: string) => void;
  onClose: () => void;
}) {
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex min-w-0 items-center gap-2">
          <History className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Histórico do contato
            </p>
            {contactName && <p className="truncate text-[11px] text-zinc-400">{contactName}</p>}
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <ContactHistoryList
          contactId={contactId}
          currentConversationId={currentConversationId}
          onOpen={onOpen}
        />
      </div>
    </aside>
  );
}
