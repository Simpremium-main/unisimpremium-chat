import { api } from '@/lib/api';

export type AgentKind = 'ORCHESTRATOR' | 'WORKER';
export type AgentMode = 'AUTONOMOUS' | 'COPILOT' | 'DISABLED';
export type AgentTrigger = 'ALWAYS' | 'OFF_HOURS' | 'NO_HUMAN_ASSIGNED';

/**
 * Departamentos pré-definidos para o organograma matricial. A coluna
 * `department` no banco é uma string livre, mas a UI sugere esses valores
 * pra padronizar o agrupamento por área. `OUTRO` permite extensão sem
 * alterar a lista.
 */
export const DEPARTMENTS = [
  'VENDAS',
  'SUPORTE',
  'CS',
  'CONTABIL',
  'JURIDICO',
  'FINANCEIRO',
  'OPERACOES',
  'TECNOLOGIA',
  'MARKETING',
  'OUTRO',
] as const;
export type Department = (typeof DEPARTMENTS)[number];

/** Cor sutil por departamento — usada no card e nas swimlanes do organograma. */
export const DEPARTMENT_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  VENDAS:      { bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-700 dark:text-emerald-400', ring: 'ring-emerald-200 dark:ring-emerald-800' },
  SUPORTE:     { bg: 'bg-blue-50 dark:bg-blue-900/20',       text: 'text-blue-700 dark:text-blue-400',       ring: 'ring-blue-200 dark:ring-blue-800' },
  CS:          { bg: 'bg-violet-50 dark:bg-violet-900/20',   text: 'text-violet-700 dark:text-violet-400',   ring: 'ring-violet-200 dark:ring-violet-800' },
  CONTABIL:    { bg: 'bg-amber-50 dark:bg-amber-900/20',     text: 'text-amber-700 dark:text-amber-400',     ring: 'ring-amber-200 dark:ring-amber-800' },
  JURIDICO:    { bg: 'bg-rose-50 dark:bg-rose-900/20',       text: 'text-rose-700 dark:text-rose-400',       ring: 'ring-rose-200 dark:ring-rose-800' },
  FINANCEIRO:  { bg: 'bg-teal-50 dark:bg-teal-900/20',       text: 'text-teal-700 dark:text-teal-400',       ring: 'ring-teal-200 dark:ring-teal-800' },
  OPERACOES:   { bg: 'bg-cyan-50 dark:bg-cyan-900/20',       text: 'text-cyan-700 dark:text-cyan-400',       ring: 'ring-cyan-200 dark:ring-cyan-800' },
  TECNOLOGIA:  { bg: 'bg-indigo-50 dark:bg-indigo-900/20',   text: 'text-indigo-700 dark:text-indigo-400',   ring: 'ring-indigo-200 dark:ring-indigo-800' },
  MARKETING:   { bg: 'bg-pink-50 dark:bg-pink-900/20',       text: 'text-pink-700 dark:text-pink-400',       ring: 'ring-pink-200 dark:ring-pink-800' },
  OUTRO:       { bg: 'bg-zinc-100 dark:bg-zinc-800/50',      text: 'text-zinc-600 dark:text-zinc-400',       ring: 'ring-zinc-200 dark:ring-zinc-700' },
};

export interface AgentChannelLink {
  id: string;
  channelId: string;
  mode: AgentMode;
  trigger: AgentTrigger;
  channel: { id: string; name: string; type: string };
}

export interface AiAgent {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  kind: AgentKind;
  category: string | null;
  capabilities: string[];
  modelId: string;
  modelParams: Record<string, unknown> | null;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  canRespondDirectly: boolean;
  isActive: boolean;
  parentAgentId: string | null;
  department: string | null;
  squad: string | null;
  /** Contexto operacional vivo — atualizado quase diariamente pelo operador. */
  operationalContext: string | null;
  /** Quando foi a última vez que `operationalContext` mudou. */
  operationalContextUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  channels?: AgentChannelLink[];
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  kind?: AgentKind;
  category?: string;
  capabilities?: string[];
  modelId: string;
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
  canRespondDirectly?: boolean;
  isActive?: boolean;
  parentAgentId?: string | null;
  department?: string | null;
  squad?: string | null;
  operationalContext?: string | null;
  modelParams?: Record<string, unknown> | null;
}

export interface AgentRun {
  id: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  finalAction:
    | 'REPLIED'
    | 'DELEGATED'
    | 'HANDED_BACK'
    | 'TRANSFERRED_TO_HUMAN'
    | 'CLOSED_CONVERSATION'
    | 'NO_ACTION'
    | null;
  errorMessage: string | null;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: string;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
  conversationId: string;
  toolCalls: Array<{
    id: string;
    toolName: string;
    input: unknown;
    output: unknown;
    error: string | null;
    durationMs: number | null;
    createdAt: string;
  }>;
}

export const aiAgentsService = {
  async list(): Promise<AiAgent[]> {
    const { data } = await api.get('/ai-agents');
    return data.data ?? data;
  },

  async findOne(id: string): Promise<AiAgent> {
    const { data } = await api.get(`/ai-agents/${id}`);
    return data.data ?? data;
  },

  async create(input: CreateAgentInput): Promise<AiAgent> {
    const { data } = await api.post('/ai-agents', input);
    return data.data ?? data;
  },

  async update(id: string, input: Partial<CreateAgentInput>): Promise<AiAgent> {
    const { data } = await api.patch(`/ai-agents/${id}`, input);
    return data.data ?? data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/ai-agents/${id}`);
  },

  async assignChannel(
    id: string,
    payload: { channelId: string; mode?: AgentMode; trigger?: AgentTrigger },
  ): Promise<AgentChannelLink> {
    const { data } = await api.post(`/ai-agents/${id}/channels`, payload);
    return data.data ?? data;
  },

  async unassignChannel(id: string, channelId: string): Promise<void> {
    await api.delete(`/ai-agents/${id}/channels/${channelId}`);
  },

  async listRuns(id: string, limit = 50): Promise<AgentRun[]> {
    const { data } = await api.get(`/ai-agents/${id}/runs`, { params: { limit } });
    return data.data ?? data;
  },

  async listAgentSkills(id: string): Promise<AgentSkillBinding[]> {
    const { data } = await api.get(`/ai-agents/${id}/skills`);
    return data.data ?? data;
  },

  async watchdogStats(): Promise<WatchdogStats> {
    const { data } = await api.get('/ai-agents/watchdog/stats');
    return data.data ?? data;
  },

  async setSkillApproval(
    agentId: string,
    skillId: string,
    requiresApproval: boolean,
  ): Promise<void> {
    await api.patch(`/ai-agents/${agentId}/skills/${skillId}/approval`, {
      requiresApproval,
    });
  },

  async feed(
    params: {
      agentId?: string;
      conversationId?: string;
      period?: Period | 'all';
      status?: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
      finalAction?: string;
      hasErrors?: boolean;
      limit?: number;
      cursor?: string;
    } = {},
  ): Promise<FeedRun[]> {
    const { data } = await api.get('/ai-agents/runs/feed', {
      params: {
        ...params,
        hasErrors: params.hasErrors ? '1' : undefined,
      },
    });
    return data.data ?? data;
  },

  async orgStats(period: Period = '7d'): Promise<OrgStats> {
    const { data } = await api.get('/ai-agents/stats/overview', {
      params: { period },
    });
    return data.data ?? data;
  },

  async agentStats(id: string, period: Period = '7d'): Promise<AgentStats> {
    const { data } = await api.get(`/ai-agents/${id}/stats`, {
      params: { period },
    });
    return data.data ?? data;
  },

};

export interface WatchdogConversationLite {
  id: string;
  status: string;
  stuckAttempts: number;
  lastWatchdogCheckAt: string | null;
  watchdogJobId?: string | null;
  updatedAt: string;
  contact: { id: string; name: string | null; phone: string | null };
  channel: { id: string; name: string; type: string };
}

export interface WatchdogStats {
  enabled: boolean;
  config: {
    delayBotMin: number;
    delayPendingMin: number;
    delayHumanIdleMin: number;
    maxAttempts: number;
  };
  businessHours: unknown;
  timezone: string;
  stats: {
    activeTimers: number;
    checks24h: number;
    reactivations24h: number;
    stuck: number;
  };
  topAlert: WatchdogConversationLite[];
  recentStuck: WatchdogConversationLite[];
}

export interface AgentSkillBinding {
  skillId: string;
  requiresApproval: boolean;
  skill: {
    id: string;
    name: string;
    description: string;
    source: 'BUILTIN' | 'HTTP' | 'SQL';
    category: string | null;
    isActive: boolean;
  };
}

export type Period = '24h' | '7d' | '30d';

export interface FeedRun {
  id: string;
  agentId: string;
  conversationId: string;
  modelId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  finalAction: AgentRun['finalAction'];
  errorMessage: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: string;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
  agent: { id: string; name: string; kind: AgentKind };
  toolCalls: Array<{
    id: string;
    toolName: string;
    input: unknown;
    output: unknown;
    error: string | null;
    durationMs: number | null;
    createdAt: string;
  }>;
  /** Server-computed: count of tool calls flagged as failure (error || ok:false || status>=400). */
  failedToolCalls?: number;
  hasFailedToolCalls?: boolean;
}

export interface OrgStats {
  period: Period;
  since: string;
  runs: {
    total: number;
    completed: number;
    failed: number;
    skipped: number;
    successRate: number | null;
  };
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: { usd: number; avgPerRun: number };
  latency: { p50: number | null; p95: number | null };
  monthlyCap: {
    used: number;
    cap: number | null;
    percentUsed: number | null;
  };
  byModel: Array<{
    modelId: string;
    runs: number;
    tokens: number;
    cost: number;
  }>;
  byAgent: Array<{
    agentId: string;
    runs: number;
    tokens: number;
    cost: number;
  }>;
  byFinalAction: Record<string, number>;
  tools: Array<{ name: string; calls: number }>;
  handoffs: Array<{
    fromAgentId: string;
    toAgentId: string;
    count: number;
  }>;
}

export interface AgentStats {
  period: Period;
  since: string;
  runs: {
    total: number;
    completed: number;
    failed: number;
    successRate: number | null;
  };
  tokens: OrgStats['tokens'];
  cost: OrgStats['cost'];
  latency: OrgStats['latency'];
  byFinalAction: Record<string, number>;
  byModel: OrgStats['byModel'];
  tools: OrgStats['tools'];
  handoffs: { sent: number; received: number };
}

/** Alias: o agente usa o modelo padrão escolhido em Configurações → IA. */
export const DEFAULT_AGENT_MODEL = 'default';

/** Modelo das iterações de ferramenta (`modelParams.routing.primary`); '' = igual ao principal. */
export function getToolModel(modelParams: Record<string, unknown> | null | undefined): string {
  const routing = modelParams?.routing as Record<string, unknown> | undefined;
  return typeof routing?.primary === 'string' ? routing.primary : '';
}

/** `modelParams` com o modelo de ferramentas trocado, preservando o resto. */
export function withToolModel(
  modelParams: Record<string, unknown> | null | undefined,
  toolModelId: string,
): Record<string, unknown> {
  const { routing: rawRouting, ...rest } = modelParams ?? {};
  const routing = { ...((rawRouting as Record<string, unknown> | undefined) ?? {}) };
  if (toolModelId) routing.primary = toolModelId;
  else delete routing.primary;
  return Object.keys(routing).length > 0 ? { ...rest, routing } : rest;
}

/** Opções avançadas guardadas em `modelParams` (ver agent-options.ts no servidor). */
export interface AgentAdvancedOptions {
  standalonePrompt: boolean;
  simpremiumTools: boolean;
  /** Pacote "unimobile": API de linhas da Uni Mobile. */
  unimobileTools: boolean;
  maxRepliesPerRun: number;
}

/** Pacotes que o agente recebe quando `toolsets` não foi configurado. */
const LEGACY_TOOLSETS = ['trivapp'];

export function getAdvancedOptions(modelParams: Record<string, unknown> | null | undefined): AgentAdvancedOptions {
  const toolsets = Array.isArray(modelParams?.toolsets) ? (modelParams!.toolsets as string[]) : null;
  const max = Number(modelParams?.maxRepliesPerRun);
  return {
    standalonePrompt: modelParams?.promptMode === 'standalone',
    simpremiumTools: (toolsets ?? LEGACY_TOOLSETS).includes('simpremium'),
    unimobileTools: (toolsets ?? LEGACY_TOOLSETS).includes('unimobile'),
    maxRepliesPerRun: Number.isInteger(max) && max >= 1 ? max : 1,
  };
}

/** `modelParams` com as opções avançadas aplicadas, preservando o resto. */
export function withAdvancedOptions(
  modelParams: Record<string, unknown> | null | undefined,
  opts: AgentAdvancedOptions,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(modelParams ?? {}) };
  if (opts.standalonePrompt) next.promptMode = 'standalone';
  else delete next.promptMode;

  const current = Array.isArray(next.toolsets) ? (next.toolsets as string[]) : null;
  const base = current ?? LEGACY_TOOLSETS;
  const toggle = (list: string[], name: string, on: boolean) =>
    on ? Array.from(new Set([...list, name])) : list.filter((t) => t !== name);
  const toolsets = toggle(toggle(base, 'simpremium', opts.simpremiumTools), 'unimobile', opts.unimobileTools);
  if (current || opts.simpremiumTools || opts.unimobileTools) next.toolsets = toolsets;

  if (opts.maxRepliesPerRun > 1) next.maxRepliesPerRun = Math.min(opts.maxRepliesPerRun, 20);
  else delete next.maxRepliesPerRun;
  return next;
}

export function formatModelLabel(modelId: string): string {
  if (!modelId || modelId === DEFAULT_AGENT_MODEL) return 'Padrão da org';
  return modelId.replace(/^(anthropic|openai)\//, '');
}
