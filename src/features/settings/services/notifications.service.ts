import { api } from '@/lib/api';

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, any>;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export const notificationsSettingsService = {
  async list(page = 1, limit = 20): Promise<{
    notifications: Notification[];
    unreadCount: number;
    pagination: any;
  }> {
    const { data } = await api.get('/notifications', { params: { page, limit } });
    return data.data;
  },
  async markRead(id: string): Promise<void> {
    await api.patch(`/notifications/${id}/read`);
  },
  async markAllRead(): Promise<void> {
    await api.patch('/notifications/read-all');
  },
  async getUnreadCount(): Promise<number> {
    const { data } = await api.get('/notifications/unread-count');
    return data.data;
  },
};
