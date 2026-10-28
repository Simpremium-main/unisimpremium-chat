import { api } from '@/lib/api';

export type StageType = 'NORMAL' | 'WON' | 'LOST';
export type CardStatus = 'OPEN' | 'WON' | 'LOST';

export interface PipelineStage {
  id: string;
  pipelineId: string;
  name: string;
  color: string | null;
  type: StageType;
  order: number;
  createdAt: string;
}

export interface Pipeline {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
  archived: boolean;
  order: number;
  stages?: PipelineStage[];
  _count?: { cards: number };
  createdAt: string;
  updatedAt: string;
}

export interface CardSummary {
  id: string;
  organizationId: string;
  pipelineId: string;
  stageId: string;
  title: string;
  description: string | null;
  value: string | number | null;
  currency: string;
  status: CardStatus;
  order: number;
  contactId: string | null;
  conversationId: string | null;
  assignedToId: string | null;
  metadata: Record<string, unknown>;
  closedAt: string | null;
  closedReason: string | null;
  createdAt: string;
  updatedAt: string;
  contact?: {
    id: string;
    name: string | null;
    phone: string | null;
    avatarUrl: string | null;
  } | null;
  assignedTo?: {
    id: string;
    name: string;
    avatarUrl: string | null;
  } | null;
  conversation?: {
    id: string;
    channelId: string;
    channel: {
      id: string;
      type: string;
      name: string;
    };
  } | null;
}

export interface BoardResponse {
  pipeline: Pipeline;
  stages: PipelineStage[];
  cards: Record<string, CardSummary[]>; // by stageId
}

export interface CreatePipelineInput {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  isDefault?: boolean;
  stages?: Array<{
    name: string;
    color?: string;
    type?: StageType;
    order?: number;
  }>;
}

export interface CreateCardInput {
  /** Optional when conversationId is set — backend derives title from contact. */
  title?: string;
  description?: string;
  stageId?: string;
  value?: number;
  currency?: string;
  contactId?: string;
  conversationId?: string;
  assignedToId?: string;
}

export interface ConversationCard {
  id: string;
  pipelineId: string;
  stageId: string;
  status: CardStatus;
  pipeline: {
    id: string;
    name: string;
    color: string | null;
    icon: string | null;
    archived: boolean;
  };
  stage: {
    id: string;
    name: string;
    color: string | null;
    type: StageType;
    order: number;
  };
}

export const pipelinesService = {
  async list(): Promise<Pipeline[]> {
    const { data } = await api.get('/pipelines');
    return data.data ?? data;
  },
  /**
   * Cards (across pipelines) que apontam pra essa conversa. Usado pelo
   * popover de pipelines no header da conversa.
   */
  async listByConversation(conversationId: string): Promise<ConversationCard[]> {
    const { data } = await api.get(
      `/pipelines/cards/by-conversation/${conversationId}`,
    );
    return data.data ?? data;
  },
  async create(input: CreatePipelineInput): Promise<Pipeline> {
    const { data } = await api.post('/pipelines', input);
    return data.data ?? data;
  },
  async update(id: string, input: Partial<Pipeline>): Promise<Pipeline> {
    const { data } = await api.patch(`/pipelines/${id}`, input);
    return data.data ?? data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/pipelines/${id}`);
  },
  async getBoard(id: string): Promise<BoardResponse> {
    const { data } = await api.get(`/pipelines/${id}/board`);
    return data.data ?? data;
  },
  async upsertStages(
    id: string,
    stages: Array<{
      id?: string;
      name: string;
      color?: string;
      type?: StageType;
      order?: number;
    }>,
  ): Promise<PipelineStage[]> {
    const { data } = await api.put(`/pipelines/${id}/stages`, { stages });
    return data.data ?? data;
  },
  async createCard(
    pipelineId: string,
    input: CreateCardInput,
  ): Promise<CardSummary> {
    const { data } = await api.post(`/pipelines/${pipelineId}/cards`, input);
    return data.data ?? data;
  },
  async updateCard(
    cardId: string,
    input: Partial<CardSummary>,
  ): Promise<CardSummary> {
    const { data } = await api.patch(`/pipelines/cards/${cardId}`, input);
    return data.data ?? data;
  },
  async removeCard(cardId: string): Promise<void> {
    await api.delete(`/pipelines/cards/${cardId}`);
  },
  async moveCard(
    cardId: string,
    toStageId: string,
    toIndex: number,
  ): Promise<CardSummary> {
    const { data } = await api.post(`/pipelines/cards/${cardId}/move`, {
      toStageId,
      toIndex,
    });
    return data.data ?? data;
  },
};
