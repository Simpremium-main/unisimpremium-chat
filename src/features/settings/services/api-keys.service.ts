import { api } from '@/lib/api';

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string };
}

export interface CreatedApiKey {
  id: string;
  name: string;
  prefix: string;
  expiresAt: string | null;
  createdAt: string;
  rawKey: string;
}

export const apiKeysService = {
  async list(): Promise<ApiKey[]> {
    const { data } = await api.get('/api-keys');
    return data.data;
  },
  async create(payload: { name: string; expiresAt?: string }): Promise<CreatedApiKey> {
    const { data } = await api.post('/api-keys', payload);
    return data.data;
  },
  async revoke(id: string): Promise<void> {
    await api.delete(`/api-keys/${id}`);
  },
};
