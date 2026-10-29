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
  requests: number;
  lastRequestAt: string | null;
  partner: string | null;
  participants: number | null;
  left: boolean;
  syncedAt: string | null;
}

export type QueryOutcome = 'found' | 'not-found' | 'unverified' | 'error' | 'unknown';
export type RequestStatus = 'answered-ai' | 'answered-human' | 'pending';

export interface GroupRequest {
  id: string;
  createdAt: string;
  askedBy: string | null;
  text: string | null;
  group: { id: string; name: string | null; partner: string | null };
  status: RequestStatus;
  reply: { text: string | null; at: string; by: string | null } | null;
  lookups: Array<{ tool: string; orderId: string | null; outcome: QueryOutcome; status: string | null }>;
}

export interface RequestsPage {
  items: GroupRequest[];
  total: number;
  page: number;
  limit: number;
}

export interface GroupSyncResult {
  channels: number;
  groups: number;
  created: number;
  left: number;
  errors: Array<{ channel: string; message: string }>;
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
  async requests(params: {
    conversationId?: string;
    q?: string;
    partner?: string;
    status?: RequestStatus | '';
    page?: number;
  }): Promise<RequestsPage> {
    const { data } = await api.get('/group-monitor/requests', {
      params: {
        ...(params.conversationId ? { conversationId: params.conversationId } : {}),
        ...(params.q ? { q: params.q } : {}),
        ...(params.partner ? { partner: params.partner } : {}),
        ...(params.status ? { status: params.status } : {}),
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
