import { api } from '@/lib/api';

export interface MonitoredGroup {
  id: string;
  name: string;
  avatarUrl: string | null;
  status: string;
  channel: { id: string; name: string };
  aiEnabled: boolean | null;
  lastMessageAt: string | null;
  createdAt: string;
  lastMessage: {
    text: string | null;
    senderName: string | null;
    direction: 'INBOUND' | 'OUTBOUND';
    createdAt: string;
  } | null;
  orderQueries: number;
  lastOrderQueryAt: string | null;
  partner: string | null;
  participants: number | null;
  left: boolean;
  syncedAt: string | null;
}

export interface GroupSyncResult {
  channels: number;
  groups: number;
  created: number;
  left: number;
  errors: Array<{ channel: string; message: string }>;
}

export type QueryOutcome = 'found' | 'not-found' | 'unverified' | 'error' | 'unknown';

export interface OrderQuery {
  id: string;
  tool: string;
  orderId: string | null;
  createdAt: string;
  outcome: QueryOutcome;
  orders: Array<{ id: string; status: string | null }>;
  conversation: { id: string; isGroup: boolean; name: string | null; channel: string | null };
  askedBy: string | null;
  question: string | null;
  reply: string | null;
  repliedAt: string | null;
}

export interface OrderQueriesPage {
  items: OrderQuery[];
  total: number;
  page: number;
  limit: number;
}

export const groupMonitorService = {
  async groups(): Promise<MonitoredGroup[]> {
    const { data } = await api.get('/group-monitor/groups');
    return data.data ?? data;
  },
  async syncGroups(): Promise<GroupSyncResult> {
    const { data } = await api.post('/group-monitor/groups/sync', {}, { timeout: 120_000 });
    return data.data ?? data;
  },
  async setPartner(id: string, partner: string | null): Promise<void> {
    await api.patch(`/group-monitor/groups/${id}/partner`, { partner });
  },
  async orderQueries(params: { conversationId?: string; orderId?: string; page?: number }): Promise<OrderQueriesPage> {
    const { data } = await api.get('/group-monitor/order-queries', {
      params: {
        ...(params.conversationId ? { conversationId: params.conversationId } : {}),
        ...(params.orderId ? { orderId: params.orderId } : {}),
        page: params.page ?? 1,
      },
    });
    return data.data ?? data;
  },
};

/** "há 5 min", "ontem 14:30", "12/10 09:15". */
export function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diffMin = Math.round((Date.now() - d.getTime()) / 60_000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return `hoje ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `ontem ${time}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${time}`;
}
