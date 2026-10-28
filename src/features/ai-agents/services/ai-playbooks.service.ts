import { api } from '@/lib/api';

export type PlaybookStepType = 'TEXT' | 'IMAGE' | 'VIDEO';

export interface PlaybookStep {
  id?: string;
  type: PlaybookStepType;
  /** Texto, ou URL pública da imagem/vídeo. */
  content: string;
  caption?: string | null;
}

/** Fluxo de atendimento da IA: gatilho + instruções + mensagens fixas. */
export interface AiPlaybook {
  id: string;
  name: string;
  slug: string;
  trigger: string;
  instructions: string;
  agentId: string | null;
  groupName: string | null;
  isActive: boolean;
  sortOrder: number;
  steps: PlaybookStep[];
  updatedAt: string;
}

export type UpsertPlaybookInput = Omit<AiPlaybook, 'id' | 'updatedAt' | 'slug'> & { slug?: string };

/** Só os campos que a API aceita (ela recusa campos extras como `id`). */
export function toPlaybookInput(flow: AiPlaybook | UpsertPlaybookInput): UpsertPlaybookInput {
  return {
    name: flow.name,
    ...(flow.slug ? { slug: flow.slug } : {}),
    trigger: flow.trigger,
    instructions: flow.instructions,
    agentId: flow.agentId,
    groupName: flow.groupName,
    isActive: flow.isActive,
    sortOrder: flow.sortOrder,
    steps: flow.steps.map((s) => ({
      type: s.type,
      content: s.content,
      ...(s.type !== 'TEXT' && s.caption ? { caption: s.caption } : {}),
    })),
  };
}

export const aiPlaybooksService = {
  async list(): Promise<AiPlaybook[]> {
    const { data } = await api.get('/ai-playbooks');
    return data.data ?? data;
  },
  async create(input: UpsertPlaybookInput): Promise<AiPlaybook> {
    const { data } = await api.post('/ai-playbooks', toPlaybookInput(input));
    return data.data ?? data;
  },
  async update(id: string, input: UpsertPlaybookInput): Promise<AiPlaybook> {
    const { data } = await api.patch(`/ai-playbooks/${id}`, toPlaybookInput(input));
    return data.data ?? data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/ai-playbooks/${id}`);
  },
};
