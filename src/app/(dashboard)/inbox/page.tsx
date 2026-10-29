'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
import { ConversationList } from '@/features/inbox/components/conversation-list';
import { ChatPanel } from '@/features/inbox/components/chat-panel';
import { ProjectPanel } from '@/features/inbox/components/project-panel';
import { useOrgFeatures } from '@/features/settings/hooks/use-org-features';
import { ContactHistoryPanel } from '@/features/inbox/components/contact-history-panel';
import { OrdersPanel } from '@/features/inbox/components/orders-panel';
import { inboxService, type Conversation } from '@/features/inbox/services/inbox.service';

const AGENT_LOGS_PREF_KEY = 'inbox.agentLogsOpen';
const PROJECT_PANEL_PREF_KEY = 'inbox.projectPanelOpen';
const HISTORY_PANEL_PREF_KEY = 'inbox.historyPanelOpen';
const ORDERS_PANEL_PREF_KEY = 'inbox.ordersPanelOpen';

function savePref(key: string, open: boolean) {
  try {
    localStorage.setItem(key, open ? '1' : '0');
  } catch {
    // Ignore storage failures — runtime state still flips.
  }
}

export default function InboxPage() {
  const { projectsEnabled } = useOrgFeatures();
  const searchParams = useSearchParams();
  const viewId = searchParams!.get('view');
  // Seção Tags do menu: conversas abertas com a tag, sem as da IA.
  const tagId = searchParams!.get('tag');
  const deepLinkConvId = searchParams!.get('conversationId');
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  // Persisted across sessions via localStorage so each operator keeps their
  // preferred layout (some live with the sidebar open, others want the chat
  // full width). Read on mount, write whenever it flips.
  const [agentLogsOpen, setAgentLogsOpen] = useState(false);
  useEffect(() => {
    try {
      setAgentLogsOpen(localStorage.getItem(AGENT_LOGS_PREF_KEY) === '1');
    } catch {
      // SSR / privacy mode — fine, defaults to closed.
    }
  }, []);
  const [projectPanelOpen, setProjectPanelOpen] = useState(false);
  useEffect(() => {
    try {
      setProjectPanelOpen(localStorage.getItem(PROJECT_PANEL_PREF_KEY) === '1');
    } catch {
      // SSR / privacy mode — fine, defaults to closed.
    }
  }, []);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  useEffect(() => {
    try {
      setHistoryPanelOpen(localStorage.getItem(HISTORY_PANEL_PREF_KEY) === '1');
    } catch {
      // SSR / privacy mode — fine, defaults to closed.
    }
  }, []);
  const [ordersPanelOpen, setOrdersPanelOpen] = useState(false);
  useEffect(() => {
    try {
      setOrdersPanelOpen(localStorage.getItem(ORDERS_PANEL_PREF_KEY) === '1');
    } catch {
      // SSR / privacy mode — fine, defaults to closed.
    }
  }, []);
  const closeOrdersPanel = useCallback(() => {
    setOrdersPanelOpen(false);
    savePref(ORDERS_PANEL_PREF_KEY, false);
  }, []);
  // Logs, Projeto, Histórico e Pedidos são mutuamente exclusivos (largura): abrir um fecha os outros.
  const toggleAgentLogs = useCallback(() => {
    setAgentLogsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AGENT_LOGS_PREF_KEY, next ? '1' : '0');
      } catch {
        // Ignore storage failures — runtime state still flips.
      }
      if (next) {
        setProjectPanelOpen(false);
        savePref(PROJECT_PANEL_PREF_KEY, false);
        setHistoryPanelOpen(false);
        savePref(HISTORY_PANEL_PREF_KEY, false);
        closeOrdersPanel();
      }
      return next;
    });
  }, [closeOrdersPanel]);
  const toggleProjectPanel = useCallback(() => {
    setProjectPanelOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PROJECT_PANEL_PREF_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      if (next) {
        setAgentLogsOpen(false);
        savePref(AGENT_LOGS_PREF_KEY, false);
        setHistoryPanelOpen(false);
        savePref(HISTORY_PANEL_PREF_KEY, false);
        closeOrdersPanel();
      }
      return next;
    });
  }, [closeOrdersPanel]);
  const toggleHistoryPanel = useCallback(() => {
    setHistoryPanelOpen((prev) => {
      const next = !prev;
      savePref(HISTORY_PANEL_PREF_KEY, next);
      if (next) {
        setAgentLogsOpen(false);
        savePref(AGENT_LOGS_PREF_KEY, false);
        setProjectPanelOpen(false);
        savePref(PROJECT_PANEL_PREF_KEY, false);
        closeOrdersPanel();
      }
      return next;
    });
  }, [closeOrdersPanel]);
  const toggleOrdersPanel = useCallback(() => {
    setOrdersPanelOpen((prev) => {
      const next = !prev;
      savePref(ORDERS_PANEL_PREF_KEY, next);
      if (next) {
        setAgentLogsOpen(false);
        savePref(AGENT_LOGS_PREF_KEY, false);
        setProjectPanelOpen(false);
        savePref(PROJECT_PANEL_PREF_KEY, false);
        setHistoryPanelOpen(false);
        savePref(HISTORY_PANEL_PREF_KEY, false);
      }
      return next;
    });
  }, []);
  const queryClient = useQueryClient();

  // Mobile: lista e chat não cabem lado a lado — mostra um OU outro. Abrir
  // uma conversa (toque, link direto ou histórico) mostra o chat em tela
  // cheia; o ícone no cabeçalho volta pra lista. Desktop (md+): os dois.
  const [listHidden, setListHidden] = useState(false);
  const isMobile = () =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
  const selectConversation = useCallback((conv: Conversation) => {
    setActiveConversation(conv);
    if (isMobile()) setListHidden(true);
  }, []);
  const toggleList = useCallback(() => setListHidden((v) => !v), []);

  // Abre outro atendimento (histórico do contato) no painel de chat.
  const openConversationById = useCallback((id: string) => {
    inboxService
      .getConversation(id)
      .then((conv) => {
        setActiveConversation(conv);
        if (isMobile()) setListHidden(true);
      })
      .catch(() => {
        // Sem acesso / apagada — mantém a conversa atual.
      });
  }, []);

  // Switching inbox view should clear the open conversation so the right
  // panel doesn't show a thread that may not even match the new filter.
  useEffect(() => {
    setActiveConversation(null);
  }, [viewId, tagId]);

  // Deep-link from elsewhere (e.g. Jarvis Execuções drawer): when the URL
  // carries ?conversationId=..., resolve it once and open in the chat panel.
  // We don't loop on it — the user clicking another thread should override.
  useEffect(() => {
    if (!deepLinkConvId) return;
    if (activeConversation?.id === deepLinkConvId) return;
    let cancelled = false;
    inboxService
      .getConversation(deepLinkConvId)
      .then((conv) => {
        if (cancelled) return;
        setActiveConversation(conv);
        if (isMobile()) setListHidden(true);
      })
      .catch(() => {
        // Silent — broken link shouldn't break the inbox; user still sees
        // the list and can pick another conversation.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkConvId]);

  // Keep the active conversation object in sync with the backend (enrichment, last message, etc.)
  const { data: freshActive } = useQuery({
    queryKey: ['conversation', activeConversation?.id],
    queryFn: () => inboxService.getConversation(activeConversation!.id),
    enabled: !!activeConversation?.id,
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (freshActive && freshActive.id === activeConversation?.id) {
      setActiveConversation(freshActive);
    }
  }, [freshActive, activeConversation?.id]);

  const handleConversationUpdate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
    if (activeConversation) {
      queryClient.invalidateQueries({
        queryKey: ['messages', activeConversation.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['conversation', activeConversation.id],
      });
    }
  }, [queryClient, activeConversation]);

  // Encerrou pelo botão: tira a conversa da tela (no celular, volta pra lista).
  const handleConversationClosed = useCallback(() => {
    setActiveConversation(null);
    setListHidden(false);
  }, []);

  return (
    <div className="flex h-full">
      <div
        className={`h-full shrink-0 max-md:flex-1 max-md:[&>div]:w-full ${
          listHidden && activeConversation ? 'hidden md:flex' : 'flex'
        }`}
      >
        <ConversationList
          activeId={activeConversation?.id || null}
          onSelect={selectConversation}
          viewId={viewId}
          tagId={tagId}
        />
      </div>

      {activeConversation ? (
        <div className={`min-w-0 flex-1 ${listHidden ? 'flex' : 'hidden md:flex'}`}>
          <ChatPanel
            key={activeConversation.id}
            conversation={activeConversation}
            onConversationUpdate={handleConversationUpdate}
            onConversationClosed={handleConversationClosed}
            onToggleProject={projectsEnabled ? toggleProjectPanel : undefined}
            projectOpen={projectPanelOpen}
            onToggleHistory={toggleHistoryPanel}
            historyOpen={historyPanelOpen}
            onToggleOrders={toggleOrdersPanel}
            ordersOpen={ordersPanelOpen}
            onOpenConversation={openConversationById}
            onToggleList={toggleList}
            listHidden={listHidden}
          />
          {historyPanelOpen && (
            <ContactHistoryPanel
              key={`history-${activeConversation.contactId}`}
              contactId={activeConversation.contactId}
              contactName={activeConversation.contact.name}
              currentConversationId={activeConversation.id}
              onOpen={openConversationById}
              onClose={toggleHistoryPanel}
            />
          )}
          {ordersPanelOpen && !activeConversation.isGroup && (
            <OrdersPanel
              key={`orders-${activeConversation.id}`}
              conversationId={activeConversation.id}
              contactName={activeConversation.contact.name}
              onClose={toggleOrdersPanel}
            />
          )}
          {projectsEnabled && projectPanelOpen && activeConversation.isGroup && (
            <ProjectPanel
              key={`project-${activeConversation.id}`}
              conversationId={activeConversation.id}
              onClose={toggleProjectPanel}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 max-md:hidden dark:bg-zinc-900/50">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
            <MessageSquare className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-zinc-700 dark:text-zinc-300">
            Uni
          </h2>
          <p className="mt-1 text-sm text-zinc-400 dark:text-zinc-500">
            Selecione uma conversa para começar
          </p>
        </div>
      )}
    </div>
  );
}
