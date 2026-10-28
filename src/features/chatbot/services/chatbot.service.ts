import { api } from '@/lib/api';

export interface ChatbotFlow {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  triggerType: string;
  triggerConfig: Record<string, any>;
  variables: any[];
  nodes: ChatbotNode[];
  channels: { flowId: string; channelId: string; channel: { id: string; name: string; type: string } }[];
  _count?: { nodes: number };
  createdAt: string;
}

export interface ChatbotNode {
  id: string;
  flowId: string;
  type: string;
  name: string | null;
  positionX: number;
  positionY: number;
  data: Record<string, any>;
  edges: { targetNodeId: string; condition?: string }[];
}

export const chatbotService = {
  async list(): Promise<ChatbotFlow[]> {
    const { data } = await api.get('/chatbot-flows');
    return data.data;
  },

  async getById(id: string): Promise<ChatbotFlow> {
    const { data } = await api.get(`/chatbot-flows/${id}`);
    return data.data;
  },

  async create(payload: { name: string; description?: string; triggerType?: string }): Promise<ChatbotFlow> {
    const { data } = await api.post('/chatbot-flows', payload);
    return data.data;
  },

  async update(id: string, payload: Partial<ChatbotFlow>): Promise<ChatbotFlow> {
    const { data } = await api.patch(`/chatbot-flows/${id}`, payload);
    return data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/chatbot-flows/${id}`);
  },

  async saveNodes(id: string, nodes: Omit<ChatbotNode, 'flowId'>[]): Promise<ChatbotNode[]> {
    const { data } = await api.post(`/chatbot-flows/${id}/nodes`, { nodes });
    return data.data;
  },

  async linkChannels(id: string, channelIds: string[]): Promise<ChatbotFlow> {
    const { data } = await api.post(`/chatbot-flows/${id}/channels`, { channelIds });
    return data.data;
  },

  /** Aciona o robô numa conversa (botão no compositor do inbox). */
  async run(id: string, conversationId: string): Promise<{ started: boolean; flowName: string }> {
    const { data } = await api.post(`/chatbot-flows/${id}/run`, { conversationId });
    return data.data;
  },
};
