import { api } from '@/lib/api';

export interface InboxPreferences {
  scope?: 'ALL' | 'MINE';
  /** @deprecated mantido pra compat de leitura — não escrevemos mais aqui. */
  statusFilters?: string[];
  selectedChannelId?: string | null;
  /** Filtro por Segmento (grupos compartilhados entre vários números).
   *  Mutuamente exclusivo com selectedChannelId. */
  selectedSegmentId?: string | null;
  unreadOnly?: boolean;
  /** Quando true, conversas de grupos aparecem no inbox geral. Default
   *  false — esconde grupos da lista principal pra reduzir ruído. */
  showGroups?: boolean;
  /** IDs de tags filtradas (OR — conversa precisa ter pelo menos uma).
   *  Match em tag de conversa OU tag de contato. */
  tagIds?: string[];
  /** Filtro de status de projeto na inbox. */
  selectedProjectStatus?: string;
  /** "Meus projetos" — só grupos cujo responsável de projeto sou eu. */
  mineProjects?: boolean;
}

/** Assinatura "*Nome:*" acima das mensagens enviadas pelo atendente. */
export interface SignaturePreferences {
  /** Nome salvo pelo atendente. Vazio/ausente = usa o User.name. */
  name?: string;
  /** Conversas com a assinatura desligada (padrão é ligada). */
  disabledConversationIds?: string[];
}

export interface UserPreferences {
  inbox?: InboxPreferences;
  signature?: SignaturePreferences;
  [key: string]: unknown;
}

export const preferencesService = {
  async get(): Promise<UserPreferences> {
    const { data } = await api.get('/users/me/preferences');
    return data.data ?? {};
  },

  async patch(patch: Partial<UserPreferences>): Promise<UserPreferences> {
    const { data } = await api.patch('/users/me/preferences', {
      preferences: patch,
    });
    return data.data ?? {};
  },
};
