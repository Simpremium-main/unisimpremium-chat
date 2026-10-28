import { api } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────

export type ToolSource = 'CUSTOM_HTTP' | 'CUSTOM_SQL';
export type SkillSource = 'BUILTIN' | 'HTTP' | 'SQL';

/**
 * Tool = connection provider (Trivapp HTTP base+auth, or Hotwebinar SQL DSN).
 * Reused by many Skills.
 */
export interface AiTool {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  source: ToolSource;
  httpBaseUrl: string | null;
  httpHeaders: Record<string, string> | null;
  sqlConnectionRef: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { skills: number };
  skills?: Array<{ id: string; name: string }>;
}

export interface UpsertToolInput {
  name: string;
  description: string;
  source: ToolSource;
  httpBaseUrl?: string;
  httpHeaders?: Record<string, string>;
  sqlConnectionRef?: string;
  isActive?: boolean;
}

/**
 * Skill = the LLM-callable function. Binds to a Tool (provider) and carries
 * the per-call invocation (HTTP path/method/body or SQL query).
 */
export interface AiSkill {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  category: string | null;
  promptInstructions: string | null;
  source: SkillSource;
  parameters: Record<string, unknown>;
  toolId: string | null;
  httpMethod: string | null;
  httpPath: string | null;
  httpHeadersExtra: Record<string, string> | null;
  httpBodyTemplate: string | null;
  responseMap: Record<string, string> | null;
  sqlQuery: string | null;
  sqlParamMap: Array<{ name?: string; source: string }> | null;
  sqlReadOnly: boolean;
  sqlMaxRows: number;
  timeoutMs: number;
  currentVersion: number;
  isActive: boolean;
  tool?: AiTool | { id: string; name: string; source: ToolSource } | null;
  agents?: Array<{ agent: { id: string; name: string } }>;
  _count?: { agents: number; versions: number };
}

export interface AiSkillVersion {
  id: string;
  skillId: string;
  version: number;
  name: string;
  description: string;
  category: string | null;
  promptInstructions: string | null;
  source: SkillSource;
  parameters: Record<string, unknown>;
  toolId: string | null;
  httpMethod: string | null;
  httpPath: string | null;
  httpHeadersExtra: Record<string, string> | null;
  httpBodyTemplate: string | null;
  responseMap: Record<string, string> | null;
  sqlQuery: string | null;
  sqlParamMap: Array<{ name?: string; source: string }> | null;
  sqlReadOnly: boolean;
  sqlMaxRows: number;
  timeoutMs: number;
  changedById: string | null;
  changeNote: string | null;
  createdAt: string;
}

export interface UpsertSkillInput {
  name: string;
  description: string;
  category?: string;
  promptInstructions?: string;
  source: 'HTTP' | 'SQL';
  parameters: Record<string, unknown>;
  toolId: string;
  httpMethod?: string;
  httpPath?: string;
  httpHeadersExtra?: Record<string, string>;
  httpBodyTemplate?: string;
  responseMap?: Record<string, string>;
  sqlQuery?: string;
  sqlParamMap?: Array<{ name?: string; source: string }>;
  sqlReadOnly?: boolean;
  sqlMaxRows?: number;
  timeoutMs?: number;
  isActive?: boolean;
  changeNote?: string;
}

// ─── Service ──────────────────────────────────────────────────────

export const aiCatalogService = {
  // Tools
  async listTools(): Promise<AiTool[]> {
    const { data } = await api.get('/ai-catalog/tools');
    return data.data ?? data;
  },
  async findTool(id: string): Promise<AiTool> {
    const { data } = await api.get(`/ai-catalog/tools/${id}`);
    return data.data ?? data;
  },
  async createTool(input: UpsertToolInput): Promise<AiTool> {
    const { data } = await api.post('/ai-catalog/tools', input);
    return data.data ?? data;
  },
  async updateTool(id: string, input: UpsertToolInput): Promise<AiTool> {
    const { data } = await api.patch(`/ai-catalog/tools/${id}`, input);
    return data.data ?? data;
  },
  async removeTool(id: string): Promise<void> {
    await api.delete(`/ai-catalog/tools/${id}`);
  },

  // Skills
  async listSkills(): Promise<AiSkill[]> {
    const { data } = await api.get('/ai-catalog/skills');
    return data.data ?? data;
  },
  async findSkill(id: string): Promise<AiSkill> {
    const { data } = await api.get(`/ai-catalog/skills/${id}`);
    return data.data ?? data;
  },
  async listSkillVersions(id: string): Promise<AiSkillVersion[]> {
    const { data } = await api.get(`/ai-catalog/skills/${id}/versions`);
    return data.data ?? data;
  },
  async createSkill(input: UpsertSkillInput): Promise<AiSkill> {
    const { data } = await api.post('/ai-catalog/skills', input);
    return data.data ?? data;
  },
  async updateSkill(id: string, input: UpsertSkillInput): Promise<AiSkill> {
    const { data } = await api.patch(`/ai-catalog/skills/${id}`, input);
    return data.data ?? data;
  },
  async removeSkill(id: string): Promise<void> {
    await api.delete(`/ai-catalog/skills/${id}`);
  },

  // Agent ↔ skills
  async setAgentSkills(agentId: string, skillIds: string[]): Promise<void> {
    await api.put(`/ai-catalog/agents/${agentId}/skills`, { skillIds });
  },
};
