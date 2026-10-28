import { api } from '@/lib/api';

export interface QuickReply {
  id: string;
  organizationId: string;
  /** Sem a barra: "pix" é digitado como "/pix" no compositor. */
  shortcut: string;
  title: string;
  content: string;
  /** true: só quem cadastrou vê. false: toda a equipe. */
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string; avatarUrl: string | null } | null;
}

export type QuickReplyInput = Pick<QuickReply, 'shortcut' | 'title' | 'content' | 'isPrivate'>;

export const quickRepliesService = {
  async list(): Promise<QuickReply[]> {
    const { data } = await api.get('/quick-replies');
    return data.data;
  },
  async create(payload: QuickReplyInput): Promise<QuickReply> {
    const { data } = await api.post('/quick-replies', payload);
    return data.data;
  },
  async update(id: string, payload: Partial<QuickReplyInput>): Promise<QuickReply> {
    const { data } = await api.patch(`/quick-replies/${id}`, payload);
    return data.data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/quick-replies/${id}`);
  },
};

/** Variáveis aceitas no texto (mostradas na tela de cadastro). */
export const QUICK_REPLY_VARIABLES = [
  { key: '{nome}', description: 'Primeiro nome do cliente' },
  { key: '{atendente}', description: 'Seu nome (o da assinatura)' },
] as const;

export interface QuickReplyVars {
  /** Nome do contato (só o primeiro nome entra no texto). */
  contactName?: string | null;
  attendantName?: string | null;
}

/**
 * Troca as variáveis pelo nome do cliente/atendente. Contato sem nome (ou
 * com o telefone no lugar do nome): a variável some sem deixar "Olá , ...".
 */
export function fillQuickReply(content: string, vars: QuickReplyVars): string {
  const first = firstName(vars.contactName);
  return content
    .replace(/\{nome\}/gi, first)
    .replace(/\{atendente\}/gi, vars.attendantName?.trim() ?? '')
    .replace(/[ \t]+([,.!?;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

function firstName(name?: string | null): string {
  const trimmed = name?.trim() ?? '';
  if (!trimmed || /^[+\d\s()-]+$/.test(trimmed)) return '';
  return trimmed.split(/\s+/)[0];
}
