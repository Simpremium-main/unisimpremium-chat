import { api } from '@/lib/api';

export type Role = 'OWNER' | 'ADMIN' | 'AGENT';

export interface MemberChannelAccess {
  bypass: boolean;
  role: Role;
  channelIds: string[];
}

export interface ChannelAgent {
  grantId: string;
  grantedAt: string;
  role: Role;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  };
}

export interface EligibleAgent {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: Role;
}

export const channelAccessService = {
  async listMemberChannels(memberId: string): Promise<MemberChannelAccess> {
    const { data } = await api.get<{ data: MemberChannelAccess }>(
      `/organizations/members/${memberId}/channels`,
    );
    return data.data;
  },

  async setMemberChannels(
    memberId: string,
    channelIds: string[],
  ): Promise<{ added: string[]; removed: string[] }> {
    const { data } = await api.put<{
      data: { added: string[]; removed: string[] };
    }>(`/organizations/members/${memberId}/channels`, { channelIds });
    return data.data;
  },

  async listChannelAgents(channelId: string): Promise<ChannelAgent[]> {
    const { data } = await api.get<{ data: ChannelAgent[] }>(
      `/channels/${channelId}/agents`,
    );
    return data.data;
  },

  async addChannelAgent(channelId: string, userId: string): Promise<void> {
    await api.post(`/channels/${channelId}/agents`, { userId });
  },

  async removeChannelAgent(channelId: string, userId: string): Promise<void> {
    await api.delete(`/channels/${channelId}/agents/${userId}`);
  },

  async listEligibleAgents(channelId: string): Promise<EligibleAgent[]> {
    const { data } = await api.get<{ data: EligibleAgent[] }>(
      `/channels/${channelId}/eligible-agents`,
    );
    return data.data;
  },
};
