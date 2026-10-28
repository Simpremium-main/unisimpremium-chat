import { api } from '@/lib/api';

export interface DashboardOverview {
  activeConversations: number;
  activeBreakdown: { pending: number; open: number; waiting: number; bot: number };
  /** Conversas marcadas como presas pelo watchdog (após exceder maxAttempts). */
  stuckConversations: number;

  avgFirstResponseMinutes: number | null;
  avgFirstResponseTrend: number;

  slaCompliancePercent: number | null;
  slaTrend: number;

  resolutionRatePercent: number | null;
  resolutionTrend: number;

  fcrPercent: number | null;
  csatScore: number | null;
  csatResponses: number;
  csatTrend: number;

  totalConversations: number;
  conversationsTrend: number;
  openConversations: number;
  pendingConversations: number;
  totalMessages: number;
  messagesTrend: number;
  avgResolutionMinutes: number | null;
}

export interface CsatBreakdown {
  avgScore: number | null;
  totalResponses: number;
  totalRequested: number;
  responseRate: number | null;
  distribution: Record<number, number>;
  recentComments: Array<{
    id: string;
    score: number;
    comment: string | null;
    respondedAt: string | null;
    contactName: string;
  }>;
}

export interface ReopenStats {
  totalReopens: number;
  uniqueConversationsReopened: number;
  reopenRate: number | null;
  series: Array<{ date: string; value: number }>;
  worstOffenders: Array<{
    conversationId: string;
    contactName: string;
    agentName: string | null;
    reopenedCount: number;
  }>;
}

export interface SparklinePoint { date: string; value: number; }
export interface KpiSparklines {
  active: SparklinePoint[];
  firstResponse: SparklinePoint[];
  sla: SparklinePoint[];
  resolution: SparklinePoint[];
}

export interface VolumeByDay { date: string; count: number; }
export interface VolumeByChannel { channelId: string; channelName: string; channelType: string; count: number; }
export interface VolumeByStatus { status: string; count: number; }
export interface VolumeFlow { date: string; created: number; closed: number; }
export interface MessagesFlow { date: string; inbound: number; outbound: number; }
export interface PeakHours { matrix: number[][]; max: number; }
export interface BotPerformance {
  botResolved: number;
  humanHandled: number;
  inFlight: number;
  total: number;
  botResolutionRate: number | null;
  escalationRate: number | null;
}
export interface TopTag { id: string; name: string; color: string; count: number; }
export interface AgentPerformance {
  agent: { id: string; name: string; avatarUrl: string | null };
  totalConversations: number;
  closedConversations: number;
  activeConversations: number;
  resolutionRate: number;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
}

export const dashboardService = {
  async getOverview(from?: string, to?: string): Promise<DashboardOverview> {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await api.get('/dashboard/overview', { params });
    return data.data;
  },
  async getVolumeByDay(from?: string, to?: string): Promise<VolumeByDay[]> {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await api.get('/dashboard/volume-by-day', { params });
    return data.data;
  },
  async getVolumeByChannel(from?: string, to?: string): Promise<VolumeByChannel[]> {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await api.get('/dashboard/volume-by-channel', { params });
    return data.data;
  },
  async getVolumeByStatus(): Promise<VolumeByStatus[]> {
    const { data } = await api.get('/dashboard/volume-by-status');
    return data.data;
  },
  async getKpiSparklines(from?: string, to?: string): Promise<KpiSparklines> {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await api.get('/dashboard/kpi-sparklines', { params });
    return data.data;
  },
  async getAgentPerformance(from?: string, to?: string): Promise<AgentPerformance[]> {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await api.get('/dashboard/agent-performance', { params });
    return data.data;
  },
  async getVolumeFlow(from?: string, to?: string): Promise<VolumeFlow[]> {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await api.get('/dashboard/volume-flow', { params });
    return data.data;
  },
  async getPeakHours(from?: string, to?: string): Promise<PeakHours> {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await api.get('/dashboard/peak-hours', { params });
    return data.data;
  },
  async getMessagesFlow(from?: string, to?: string): Promise<MessagesFlow[]> {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await api.get('/dashboard/messages-flow', { params });
    return data.data;
  },
  async getBotPerformance(from?: string, to?: string): Promise<BotPerformance> {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await api.get('/dashboard/bot-performance', { params });
    return data.data;
  },
  async getCsat(from?: string, to?: string): Promise<CsatBreakdown> {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await api.get('/dashboard/csat', { params });
    return data.data;
  },
  async getReopens(from?: string, to?: string): Promise<ReopenStats> {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await api.get('/dashboard/reopens', { params });
    return data.data;
  },
  async getTopTags(from?: string, to?: string, limit?: number): Promise<TopTag[]> {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    if (limit) params.limit = String(limit);
    const { data } = await api.get('/dashboard/top-tags', { params });
    return data.data;
  },
};
