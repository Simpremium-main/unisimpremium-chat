import { api } from '@/lib/api';
import type { AiPlaybook } from './ai-playbooks.service';

export type LearningKind = 'FLUXO' | 'CONHECIMENTO' | 'TEMPORARIO' | 'REGRA' | 'NENHUM';

/** Proposta de aprendizado (mesmos campos do backend). */
export interface Learning {
  tipo: LearningKind;
  motivo?: string;
  titulo?: string;
  gatilho?: string;
  instrucoes?: string;
  mensagens?: string[];
  conteudo?: string;
  palavras_chave?: string;
  expira_em?: string | null;
  regra?: string;
  agentId?: string | null;
  atualizar?: { tipo: 'FLUXO' | 'CONHECIMENTO'; id: string } | null;
}

export interface ExistingItems {
  knowledge: Array<{ id: string; title: string; content: string }>;
  flows: Array<{ id: string; name: string; trigger: string }>;
  rules: string[];
}

export interface HelpRequest {
  id: string;
  conversationId: string;
  agentId: string | null;
  question: string;
  status: 'PENDING' | 'RESOLVED' | 'DISMISSED';
  guidance: string | null;
  draft: { resumo: string; resposta: string[]; aprendizado: Learning } | null;
  resolution: { resposta: string[]; aprendizado: Learning; salvo: { tipo: string; id?: string; acao?: string } | null } | null;
  resolvedAt: string | null;
  createdAt: string;
  conversation: {
    id: string;
    status: string;
    contact: { name: string | null; phone: string | null };
    channel: { name: string };
  };
  messages?: Array<{ id: string; direction: 'INBOUND' | 'OUTBOUND'; text: string; senderName: string | null; createdAt: string }>;
}

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  keywords: string;
  isActive: boolean;
  expiresAt: string | null;
  sourceHelpRequestId: string | null;
  createdAt: string;
}

export interface LearnedData {
  knowledge: KnowledgeItem[];
  flows: AiPlaybook[];
  rules: Array<{ agentId: string; agentName: string; rules: string[] }>;
  agents: Array<{ id: string; name: string }>;
}

export const aiLearningService = {
  async pendingCount(): Promise<number> {
    const { data } = await api.get('/ai-learning/pending-count');
    return (data.data ?? data).count;
  },
  async list(status: HelpRequest['status'] = 'PENDING'): Promise<HelpRequest[]> {
    const { data } = await api.get('/ai-learning/requests', { params: { status } });
    return data.data ?? data;
  },
  async get(id: string): Promise<HelpRequest> {
    const { data } = await api.get(`/ai-learning/requests/${id}`);
    return data.data ?? data;
  },
  async draft(id: string, orientacao: string): Promise<{ draft: NonNullable<HelpRequest['draft']>; existing: ExistingItems }> {
    const { data } = await api.post(`/ai-learning/requests/${id}/draft`, { orientacao });
    return data.data ?? data;
  },
  async approve(id: string, resposta: string[], aprendizado: Learning): Promise<void> {
    await api.post(`/ai-learning/requests/${id}/approve`, { resposta, aprendizado });
  },
  async dismiss(id: string): Promise<void> {
    await api.post(`/ai-learning/requests/${id}/dismiss`);
  },
  async teachDraft(informacao: string, agentId?: string): Promise<{ aprendizado: Learning; existing: ExistingItems }> {
    const { data } = await api.post('/ai-learning/teach/draft', { informacao, agentId });
    return data.data ?? data;
  },
  async teachApply(aprendizado: Learning): Promise<void> {
    await api.post('/ai-learning/teach/apply', { aprendizado });
  },
  async learned(): Promise<LearnedData> {
    const { data } = await api.get('/ai-learning/learned');
    return data.data ?? data;
  },
  async updateKnowledge(id: string, patch: Partial<Pick<KnowledgeItem, 'title' | 'content' | 'keywords' | 'isActive' | 'expiresAt'>>) {
    await api.patch(`/ai-learning/knowledge/${id}`, patch);
  },
  async removeKnowledge(id: string) {
    await api.delete(`/ai-learning/knowledge/${id}`);
  },
  async removeRule(agentId: string, rule: string) {
    await api.post('/ai-learning/rules/remove', { agentId, rule });
  },
};
