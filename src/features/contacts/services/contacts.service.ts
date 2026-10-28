import { api } from '@/lib/api';

export interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  avatarUrl: string | null;
  notes: string | null;
  metadata: Record<string, any>;
  channels: { id: string; channelId: string; externalId: string; channel: { id: string; type: string; name: string } }[];
  tags: { tag: { id: string; name: string; color: string } }[];
  conversations?: any[];
  _count?: { conversations: number };
  createdAt: string;
}

/** Um atendimento do contato (item do histórico). */
export interface ContactConversation {
  id: string;
  protocol: string | null;
  subject: string | null;
  status: string;
  isGroup: boolean;
  createdAt: string;
  closedAt: string | null;
  lastMessageAt: string | null;
  channel: { id: string; type: string; name: string };
  assignedTo: { id: string; name: string; avatarUrl: string | null } | null;
  messages: { type: string; content: Record<string, any>; direction: string; createdAt: string }[];
  _count: { messages: number };
  /** Atendentes que responderam, do último pro primeiro. */
  responderIds: string[];
}

export const contactsService = {
  async list(params?: Record<string, string>): Promise<{
    contacts: Contact[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const { data } = await api.get('/contacts', { params });
    return data.data;
  },

  async getById(id: string): Promise<Contact> {
    const { data } = await api.get(`/contacts/${id}`);
    return data.data;
  },

  /** Todos os atendimentos do contato (canais visíveis), mais recentes primeiro. */
  async getConversations(id: string): Promise<ContactConversation[]> {
    const { data } = await api.get(`/contacts/${id}/conversations`);
    return data.data;
  },

  async update(id: string, payload: Partial<Contact>): Promise<Contact> {
    const { data } = await api.patch(`/contacts/${id}`, payload);
    return data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/contacts/${id}`);
  },
};
