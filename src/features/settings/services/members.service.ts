import { api } from '@/lib/api';

export interface Member {
  id: string;
  userId: string;
  organizationId: string;
  role: 'OWNER' | 'ADMIN' | 'AGENT';
  agentStatus: string;
  joinedAt: string;
  /** Só a chave usada no front; o JSON tem também as preferências do inbox. */
  preferences?: { avatarColor?: string };
  /** Perfil de acesso (só para AGENT); null = acesso padrão. */
  accessProfile?: { id: string; name: string } | null;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    isActive: boolean;
  };
}

export const membersService = {
  async list(): Promise<Member[]> {
    const { data } = await api.get('/organizations/members');
    return data.data;
  },
  /** Cadastro direto: cria a conta com a senha definida pelo admin. */
  async create(payload: {
    name: string;
    email: string;
    password: string;
    role: string;
    accessProfileId?: string;
  }): Promise<{ userId: string; email: string; existingAccount: boolean }> {
    const { data } = await api.post('/organizations/members', payload);
    return data.data ?? data;
  },

  async invite(payload: { email: string; role?: string; accessProfileId?: string }): Promise<any> {
    const { data } = await api.post('/organizations/members/invite', payload);
    return data.data;
  },
  async updateRole(memberId: string, role: string): Promise<any> {
    const { data } = await api.patch(`/organizations/members/${memberId}/role`, { role });
    return data.data;
  },
  async updateColor(memberId: string, color: string | null): Promise<void> {
    await api.patch(`/organizations/members/${memberId}/color`, { color });
  },
  async remove(memberId: string): Promise<void> {
    await api.delete(`/organizations/members/${memberId}`);
  },
};
