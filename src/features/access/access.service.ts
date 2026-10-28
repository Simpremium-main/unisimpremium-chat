import { api } from '@/lib/api';

export interface AccessCatalogItem {
  key: string;
  label: string;
  description: string;
  /** Sub-página (ex.: aba do Jarvis): só vale com a página-mãe marcada. */
  parent?: string;
}

export interface AccessProfile {
  id: string;
  name: string;
  description: string | null;
  pages: string[];
  actions: string[];
  _count?: { members: number };
}

export interface UpsertAccessProfileInput {
  name: string;
  description?: string;
  pages: string[];
  actions: string[];
}

export const accessService = {
  async catalog(): Promise<{ pages: AccessCatalogItem[]; actions: AccessCatalogItem[] }> {
    const { data } = await api.get('/access-profiles/catalog');
    return data.data ?? data;
  },
  async list(): Promise<AccessProfile[]> {
    const { data } = await api.get('/access-profiles');
    return data.data ?? data;
  },
  async create(input: UpsertAccessProfileInput): Promise<AccessProfile> {
    const { data } = await api.post('/access-profiles', input);
    return data.data ?? data;
  },
  async update(id: string, input: UpsertAccessProfileInput): Promise<AccessProfile> {
    const { data } = await api.patch(`/access-profiles/${id}`, input);
    return data.data ?? data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/access-profiles/${id}`);
  },
  async assign(memberId: string, accessProfileId: string | null): Promise<void> {
    await api.patch(`/access-profiles/members/${memberId}`, { accessProfileId });
  },
};
