import { api } from '@/lib/api';

export interface ProjectResponsible {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface ProjectSummary {
  groupJid: string;
  name: string;
  hoppeId: string | null;
  responsibleUserId: string | null;
  responsible: ProjectResponsible | null;
  status: string | null;
  metadata: Record<string, unknown>;
  exists: boolean;
}

export interface ProjectListRow extends ProjectSummary {
  representativeConversationId: string;
  channelIds: string[];
}

export interface UpdateProjectPayload {
  name?: string;
  hoppeId?: string;
  responsibleUserId?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export const projectsService = {
  async list(params?: {
    hoppeId?: string;
    responsibleUserId?: string;
    status?: string;
    search?: string;
  }): Promise<ProjectListRow[]> {
    const { data } = await api.get<{ data: ProjectListRow[] }>('/projects', {
      params,
    });
    return data.data;
  },

  async filters(): Promise<{ hoppeIds: string[]; statuses: string[] }> {
    const { data } = await api.get<{
      data: { hoppeIds: string[]; statuses: string[] };
    }>('/projects/filters');
    return data.data;
  },

  async getByConversation(conversationId: string): Promise<ProjectSummary> {
    const { data } = await api.get<{ data: ProjectSummary }>(
      `/projects/by-conversation/${conversationId}`,
    );
    return data.data;
  },

  async updateByConversation(
    conversationId: string,
    payload: UpdateProjectPayload,
  ): Promise<ProjectSummary> {
    const { data } = await api.put<{ data: ProjectSummary }>(
      `/projects/by-conversation/${conversationId}`,
      payload,
    );
    return data.data;
  },
};
