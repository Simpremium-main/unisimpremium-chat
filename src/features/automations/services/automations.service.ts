import { api } from '@/lib/api';

export type AutomationTrigger =
  | 'TAG_ADDED'
  | 'TAG_REMOVED'
  | 'MESSAGE_RECEIVED'
  | 'CONVERSATION_STATUS_CHANGED'
  | 'CONVERSATION_ASSIGNED';

export type AutomationRunStatus =
  | 'SUCCESS'
  | 'PARTIAL'
  | 'FAILED'
  | 'SKIPPED';

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'in'
  | 'not_in'
  | 'is_set'
  | 'is_not_set';

export type ActionType =
  | 'add_tag'
  | 'remove_tag'
  | 'add_to_pipeline'
  | 'move_pipeline_stage'
  | 'assign_user'
  | 'send_message';

export interface ConditionRule {
  field: string;
  op: ConditionOperator;
  value?: string | number | boolean | string[] | number[] | null;
}

export interface ConditionGroup {
  match: 'AND' | 'OR';
  rules: ConditionRule[];
}

export interface ConditionRoot {
  match: 'AND' | 'OR';
  groups: ConditionGroup[];
}

export interface ActionDefinition {
  type: ActionType;
  params: Record<string, unknown>;
  continueOnError?: boolean;
}

export interface Automation {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  trigger: AutomationTrigger;
  conditions: ConditionRoot | Record<string, never>;
  actions: ActionDefinition[];
  schemaVersion: number;
  enabled: boolean;
  actorId: string;
  priority: number;
  consecutiveFailures: number;
  autoPausedAt: string | null;
  autoPausedReason: string | null;
  rateLimitPerMinute: number;
  lastRunAt: string | null;
  runCount: number;
  successCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  organizationId: string;
  outboxEventId: string;
  traceId: string;
  status: AutomationRunStatus;
  errorCode: string | null;
  errorMessage: string | null;
  triggerPayload: Record<string, unknown>;
  actionsLog: Array<{
    index: number;
    type: ActionType;
    status: 'success' | 'failed' | 'skipped';
    durationMs: number;
    errorCode?: string;
    errorMessage?: string;
    output?: Record<string, unknown>;
  }>;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface AutomationMeta {
  triggers: Array<{ value: AutomationTrigger; fields: string[] }>;
  actions: Array<{ type: ActionType; continueOnErrorDefault?: boolean }>;
  operators: ConditionOperator[];
}

export interface AutomationStats {
  runCount: number;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastRunAt: string | null;
  autoPausedAt: string | null;
  autoPausedReason: string | null;
}

export interface CreateAutomationPayload {
  name: string;
  description?: string;
  trigger: AutomationTrigger;
  conditions?: ConditionRoot | Record<string, never>;
  actions: ActionDefinition[];
  enabled?: boolean;
  priority?: number;
  rateLimitPerMinute?: number;
}

export type UpdateAutomationPayload = Partial<CreateAutomationPayload>;

export const automationsService = {
  async list(): Promise<Automation[]> {
    const { data } = await api.get('/automations');
    return data?.data ?? data;
  },
  async get(id: string): Promise<Automation> {
    const { data } = await api.get(`/automations/${id}`);
    return data?.data ?? data;
  },
  async meta(): Promise<AutomationMeta> {
    const { data } = await api.get('/automations/meta');
    return data?.data ?? data;
  },
  async create(payload: CreateAutomationPayload): Promise<Automation> {
    const { data } = await api.post('/automations', payload);
    return data?.data ?? data;
  },
  async update(
    id: string,
    payload: UpdateAutomationPayload,
  ): Promise<Automation> {
    const { data } = await api.patch(`/automations/${id}`, payload);
    return data?.data ?? data;
  },
  async toggle(id: string, enabled: boolean): Promise<Automation> {
    const { data } = await api.post(
      `/automations/${id}/toggle`,
      undefined,
      { params: { enabled } },
    );
    return data?.data ?? data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/automations/${id}`);
  },
  async dryRun(
    id: string,
    payload: Record<string, unknown>,
  ): Promise<{ matched: boolean; conditions: unknown; actions: unknown }> {
    const { data } = await api.post(`/automations/${id}/dry-run`, { payload });
    return data?.data ?? data;
  },
  async runs(
    id: string,
    params?: { limit?: number; cursor?: string; status?: AutomationRunStatus },
  ): Promise<{ data: AutomationRun[]; nextCursor: string | null }> {
    const { data } = await api.get(`/automations/${id}/runs`, { params });
    return data?.data ?? data;
  },
  async stats(id: string): Promise<AutomationStats> {
    const { data } = await api.get(`/automations/${id}/stats`);
    return data?.data ?? data;
  },
};
