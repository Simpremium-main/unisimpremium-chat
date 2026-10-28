import { api } from '@/lib/api';
import type { PendingAction } from './types';

/**
 * Thin wrappers around the backend's Pending Actions endpoints. Mirrors
 * the `inboxService` style used elsewhere in this feature — every call
 * returns the unwrapped `data.data` payload.
 */
export const pendingActionsService = {
  async list(conversationId: string): Promise<PendingAction[]> {
    const { data } = await api.get('/pending-actions', {
      params: { conversationId },
    });
    // Backend may return either { data: [...] } or a bare array — handle both
    // so we don't break if the envelope ever changes.
    const payload = data?.data ?? data;
    return Array.isArray(payload) ? payload : (payload?.items ?? []);
  },

  async get(id: string): Promise<PendingAction> {
    const { data } = await api.get(`/pending-actions/${id}`);
    return data?.data ?? data;
  },

  async approve(id: string): Promise<PendingAction> {
    const { data } = await api.post(`/pending-actions/${id}/approve`, {});
    return data?.data ?? data;
  },

  async reject(id: string, reason: string): Promise<PendingAction> {
    const { data } = await api.post(`/pending-actions/${id}/reject`, { reason });
    return data?.data ?? data;
  },
};

export const listPendingActions = (conversationId: string) =>
  pendingActionsService.list(conversationId);

export const approvePendingAction = (id: string) =>
  pendingActionsService.approve(id);

export const rejectPendingAction = (id: string, reason: string) =>
  pendingActionsService.reject(id, reason);
