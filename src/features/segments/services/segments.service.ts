import { api } from '@/lib/api';
import type { ChannelType } from '@/features/channels/services/channels.service';

export interface SegmentChannelRef {
  id: string;
  name: string;
  type: ChannelType;
}

export interface SegmentMember {
  id: string;
  channelId: string;
  channel: SegmentChannelRef;
}

export interface Segment {
  id: string;
  organizationId: string;
  name: string;
  primaryChannelId: string | null;
  primaryChannel: SegmentChannelRef | null;
  isActive: boolean;
  members: SegmentMember[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateSegmentPayload {
  name: string;
  channelIds: string[];
  primaryChannelId?: string;
}

export interface UpdateSegmentPayload {
  name?: string;
  isActive?: boolean;
}

export const segmentsService = {
  async list(): Promise<Segment[]> {
    const { data } = await api.get<{ data: Segment[] }>('/segments');
    return data.data;
  },

  async getById(id: string): Promise<Segment> {
    const { data } = await api.get<{ data: Segment }>(`/segments/${id}`);
    return data.data;
  },

  async create(payload: CreateSegmentPayload): Promise<Segment> {
    const { data } = await api.post<{ data: Segment }>('/segments', payload);
    return data.data;
  },

  async update(id: string, payload: UpdateSegmentPayload): Promise<Segment> {
    const { data } = await api.patch<{ data: Segment }>(`/segments/${id}`, payload);
    return data.data;
  },

  async setChannels(id: string, channelIds: string[]): Promise<Segment> {
    const { data } = await api.put<{ data: Segment }>(`/segments/${id}/channels`, {
      channelIds,
    });
    return data.data;
  },

  async setPrimary(id: string, primaryChannelId: string): Promise<Segment> {
    const { data } = await api.put<{ data: Segment }>(
      `/segments/${id}/primary-channel`,
      { primaryChannelId },
    );
    return data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/segments/${id}`);
  },
};
