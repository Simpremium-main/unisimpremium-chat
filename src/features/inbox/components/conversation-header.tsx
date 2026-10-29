'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  XCircle,
  RotateCcw,
  RefreshCw,
  MessageSquare,
  Instagram,
  Phone,
  Mail,
  Send,
  Activity,
  FolderKanban,
  History,
  ShoppingBag,
  Eraser,
  PanelLeftClose,
  PanelLeftOpen,
  CheckCheck,
} from 'lucide-react';
import { AssignmentPopover } from './assignment-popover';
import { PipelinePopover } from './pipeline-popover';
import { useOrgFeatures } from '@/features/settings/hooks/use-org-features';
import { inboxService, type Conversation } from '../services/inbox.service';
import { useConfirm } from '@/components/ui/dialogs';
import { useAccess } from '@/features/access/use-access';
import { useAuthStore } from '@/stores/auth-store';

interface ConversationHeaderProps {
  conversation: Conversation;
  onUpdate: () => void;
  /** Encerrada pelo botão Encerrar: a tela tira a conversa do painel. */
  onClosed?: () => void;
  /** When provided, renders a toggle button for the agent-runs sidebar. */
  onToggleAgentLogs?: () => void;
  agentLogsOpen?: boolean;
  /** When provided + conversation is a group, renders the Project panel toggle. */
  onToggleProject?: () => void;
  projectOpen?: boolean;
  /** Painel "Histórico do contato" (todos os atendimentos). */
  onToggleHistory?: () => void;
  historyOpen?: boolean;
  onToggleOrders?: () => void;
  ordersOpen?: boolean;
  /** Mobile: mostra/oculta a lista de conversas pra ver só o chat. */
  onToggleList?: () => void;
  listHidden?: boolean;
  /** Está em "Não respondidas": mostra "Tirar do Não respondidas". */
  unanswered?: boolean;
}

function ChannelBadge({ type, name }: { type: string; name: string }) {
  const t = type.toUpperCase();
  const isWhats = t.includes('WHATSAPP') || t.includes('ZAPPFY');
  const isInsta = t.includes('INSTAGRAM');
  const isTelegram = t.includes('TELEGRAM');
  const isEmail = t.includes('EMAIL') || t.includes('MAIL');
  const isSms = t.includes('SMS');

  let Icon = MessageSquare;
  let label = 'Chat';
  let cls =
    'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300';

  if (isWhats) {
    Icon = Phone;
    label = 'WhatsApp';
    cls = 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
  } else if (isInsta) {
    Icon = Instagram;
    label = 'Instagram';
    cls = 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400';
  } else if (isTelegram) {
    Icon = Send;
    label = 'Telegram';
    cls = 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400';
  } else if (isEmail) {
    Icon = Mail;
    label = 'Email';
    cls = 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
  } else if (isSms) {
    Icon = MessageSquare;
    label = 'SMS';
    cls = 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
  }

  return (
    <span
      title={name}
      className={`mt-1 inline-flex w-fit max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      <Icon className="h-3 w-3" />
      {label}
      <span className="truncate font-normal normal-case opacity-70">· {name}</span>
    </span>
  );
}

function HeaderAvatar({ name, avatarUrl }: { name: string | null; avatarUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  const initials = name?.slice(0, 2).toUpperCase() || '??';
  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt={name || 'avatar'}
        onError={() => setFailed(true)}
        className="h-10 w-10 shrink-0 rounded-full bg-zinc-100 object-cover dark:bg-zinc-800"
      />
    );
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      {initials}
    </div>
  );
}

export function ConversationHeader({
  conversation,
  onUpdate,
  onClosed,
  onToggleAgentLogs,
  agentLogsOpen,
  onToggleProject,
  projectOpen,
  onToggleHistory,
  historyOpen,
  onToggleOrders,
  ordersOpen,
  onToggleList,
  listHidden,
  unanswered,
}: ConversationHeaderProps) {
  const { pipelinesEnabled } = useOrgFeatures();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const confirm = useConfirm();
  // Perfil de acesso do atendente: esconde o que ele não pode fazer.
  const { can } = useAccess();
  const role = useAuthStore((s) => s.organizations.find((o) => o.id === s.activeOrgId)?.role);
  const isAdmin = role === 'OWNER' || role === 'ADMIN';

  const handleResetAiContext = async () => {
    if (
      !(await confirm({
        title: 'Limpar o contexto da IA nesta conversa?',
        description:
          'A IA passa a considerar só as mensagens que chegarem daqui pra frente, como se a conversa começasse agora, e esquece o que tinha aprendido sobre este contato. As mensagens continuam visíveis aqui para a equipe.',
        confirmText: 'Limpar contexto',
        tone: 'danger',
      }))
    )
      return;
    await handleAction(() => inboxService.resetAiContext(conversation.id), 'Contexto da IA limpo');
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await inboxService.syncConversation(conversation.id);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['messages', conversation.id] }),
        queryClient.refetchQueries({ queryKey: ['conversations'] }),
      ]);
      if (result.imported > 0) {
        toast.success(
          `${result.imported} ${result.imported === 1 ? 'mensagem nova' : 'mensagens novas'} sincronizada${result.imported === 1 ? '' : 's'}`,
        );
      } else {
        toast.success('Tudo em dia — nenhuma mensagem nova');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao sincronizar');
    } finally {
      setIsSyncing(false);
    }
  };
  const handleAction = async (action: () => Promise<any>, successMsg: string, onDone?: () => void) => {
    setIsLoading(true);
    try {
      await action();
      toast.success(successMsg);
      onUpdate();
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    // Mobile: uma linha só — telefone/canal ocultos, ações só com ícone e
    // rolando na horizontal se não couberem.
    <div className="flex items-center justify-between gap-2 border-b border-zinc-200 bg-white px-3 py-1.5 md:gap-3 md:px-4 md:py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex min-w-[96px] flex-1 items-center gap-2 md:min-w-[160px] md:gap-3">
        {onToggleList && (
          <button
            type="button"
            onClick={onToggleList}
            title={listHidden ? 'Mostrar conversas' : 'Ocultar conversas'}
            aria-label={listHidden ? 'Mostrar conversas' : 'Ocultar conversas'}
            className="-ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 md:hidden dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            {listHidden ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        )}
        <div className="hidden md:block">
          <HeaderAvatar
            name={conversation.contact.name}
            avatarUrl={conversation.contact.avatarUrl}
          />
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {conversation.contact.name || conversation.contact.phone || 'Desconhecido'}
          </div>
          {conversation.contact.phone && conversation.contact.name && (
            <div className="hidden text-xs text-zinc-500 md:block">{conversation.contact.phone}</div>
          )}
          <div className="hidden md:block">
            <ChannelBadge
              type={conversation.channel.type}
              name={conversation.channel.name}
            />
          </div>
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-end gap-1 overflow-x-auto [scrollbar-width:none] md:flex-wrap md:gap-1.5 md:overflow-visible">
        <button
          onClick={handleSync}
          disabled={isSyncing}
          title="Sincronizar mensagens"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
        </button>
        {can('conversations.ai') && (
        <button
          onClick={handleResetAiContext}
          disabled={isLoading}
          title="Limpar contexto da IA"
          aria-label="Limpar contexto da IA"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <Eraser className="h-3.5 w-3.5" />
        </button>
        )}
        {onToggleHistory && (
          <button
            onClick={onToggleHistory}
            title={historyOpen ? 'Fechar histórico do contato' : 'Histórico do contato'}
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${
              historyOpen
                ? 'bg-primary/10 text-primary dark:bg-primary/15'
                : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
            }`}
          >
            <History className="h-3.5 w-3.5" />
          </button>
        )}
        {onToggleOrders && !conversation.isGroup && (
          <button
            onClick={onToggleOrders}
            title={ordersOpen ? 'Fechar pedidos' : 'Pedidos deste número (Pedido Central)'}
            aria-label="Pedidos"
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${
              ordersOpen
                ? 'bg-primary/10 text-primary dark:bg-primary/15'
                : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
            }`}
          >
            <ShoppingBag className="h-3.5 w-3.5" />
          </button>
        )}
        {onToggleProject && conversation.isGroup && (
          <button
            onClick={onToggleProject}
            title={projectOpen ? 'Fechar projeto' : 'Abrir projeto'}
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${
              projectOpen
                ? 'bg-primary/10 text-primary dark:bg-primary/15'
                : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
            }`}
          >
            <FolderKanban className="h-3.5 w-3.5" />
          </button>
        )}
        {onToggleAgentLogs && (
          <button
            onClick={onToggleAgentLogs}
            title={agentLogsOpen ? 'Fechar logs do agente' : 'Abrir logs do agente'}
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${
              agentLogsOpen
                ? 'bg-primary/10 text-primary dark:bg-primary/15'
                : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
            }`}
          >
            <Activity className="h-3.5 w-3.5" />
          </button>
        )}
        {conversation.status !== 'CLOSED' && can('conversations.assign') && (
          <AssignmentPopover
            conversation={conversation}
            onChanged={onUpdate}
          />
        )}
        {pipelinesEnabled && can('pipelines.edit') && (
          <PipelinePopover conversation={conversation} onChanged={onUpdate} />
        )}
        {unanswered && conversation.status !== 'CLOSED' && (
          <button
            onClick={() =>
              handleAction(
                () => inboxService.dismissUnanswered(conversation.id),
                'Tirada de "Não respondidas"',
                () => queryClient.invalidateQueries({ queryKey: ['inbox-view-counts'] }),
              )
            }
            disabled={isLoading}
            title="Tirar do Não respondidas (volta se o cliente mandar mensagem nova)"
            aria-label="Tirar do Não respondidas"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-zinc-100 px-2 text-xs font-medium text-zinc-700 hover:bg-emerald-50 hover:text-emerald-700 md:h-auto md:px-3 md:py-1.5 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-emerald-900/20 dark:hover:text-emerald-400"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Tirar do Não respondidas</span>
          </button>
        )}
        {conversation.status !== 'CLOSED' && can('conversations.close') && (
          <button
            onClick={() =>
              handleAction(
                () => inboxService.closeConversation(conversation.id),
                'Conversa encerrada',
                () => {
                  // A conversa sai das inboxes de abertas: bolinhas na hora.
                  queryClient.invalidateQueries({ queryKey: ['inbox-view-counts'] });
                  onClosed?.();
                },
              )
            }
            disabled={isLoading}
            title="Encerrar conversa"
            aria-label="Encerrar conversa"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-zinc-100 px-2 text-xs font-medium text-zinc-700 hover:bg-red-50 hover:text-red-600 md:h-auto md:px-3 md:py-1.5 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-red-900/20 dark:hover:text-red-400"
          >
            <XCircle className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Encerrar</span>
          </button>
        )}
        {conversation.status === 'CLOSED' && can('conversations.close') && (
          <button
            onClick={() =>
              handleAction(
                () => inboxService.reopenConversation(conversation.id),
                'Conversa reaberta',
              )
            }
            disabled={isLoading}
            title="Reabrir conversa"
            aria-label="Reabrir conversa"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 md:h-auto md:px-3 md:py-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Reabrir</span>
          </button>
        )}
      </div>
    </div>
  );
}
