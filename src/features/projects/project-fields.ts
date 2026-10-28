import type {
  ProjectSummary,
  UpdateProjectPayload,
} from './services/projects.service';

/** Template da URL da task no Hoppe (link clicável). */
export const HOPPE_TASK_URL =
  process.env.NEXT_PUBLIC_HOPPE_TASK_URL ||
  'https://simpremium.com.br/task/{id}';

export function hoppeTaskUrl(id: string): string {
  return HOPPE_TASK_URL.replace('{id}', encodeURIComponent(id));
}

/** Opções de status do projeto (editar aqui pra adicionar/remover). */
export const PROJECT_STATUSES = [
  'Onboarding',
  'Ativo',
  'Pausado',
  'Concluído',
] as const;

export type ProjectFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'user'
  | 'link';
export type ProjectFieldStorage = 'column' | 'metadata';

export interface ProjectFieldDef {
  /** Nome da coluna (storage=column) ou chave em metadata (storage=metadata). */
  key: string;
  label: string;
  type: ProjectFieldType;
  storage: ProjectFieldStorage;
  options?: readonly string[];
  placeholder?: string;
}

/**
 * REGISTRY dos campos do Projeto. Painel e página de Projetos renderizam a
 * partir daqui. **Adicionar um campo novo = +1 entrada.** Se `storage:'metadata'`,
 * não precisa de NADA no backend (a coluna `metadata` é mesclada no update).
 */
export const PROJECT_FIELDS: ProjectFieldDef[] = [
  {
    key: 'name',
    label: 'Nome do projeto',
    type: 'text',
    storage: 'column',
    placeholder: 'Nome do projeto',
  },
  {
    key: 'hoppeId',
    label: 'Hoppe ID',
    type: 'link',
    storage: 'column',
    placeholder: 'ID da task no Hoppe',
  },
  {
    key: 'responsibleUserId',
    label: 'Responsável do projeto',
    type: 'user',
    storage: 'column',
  },
  {
    key: 'status',
    label: 'Status',
    type: 'select',
    storage: 'column',
    options: PROJECT_STATUSES,
  },
  {
    key: 'observacoes',
    label: 'Observações',
    type: 'textarea',
    storage: 'metadata',
    placeholder: 'Notas do projeto…',
  },
];

/** Lê o valor (string) de um campo a partir do ProjectSummary. */
export function readField(
  project: ProjectSummary | null | undefined,
  field: ProjectFieldDef,
): string {
  if (!project) return '';
  if (field.storage === 'metadata') {
    const v = project.metadata?.[field.key];
    return v == null ? '' : String(v);
  }
  const v = (project as unknown as Record<string, unknown>)[field.key];
  return v == null ? '' : String(v);
}

/**
 * Monta o payload de update a partir dos valores do form (por key do registry),
 * separando colunas de metadata.
 */
export function buildUpdatePayload(
  values: Record<string, string>,
): UpdateProjectPayload {
  const payload: UpdateProjectPayload = {};
  const metadata: Record<string, unknown> = {};
  let hasMetadata = false;
  for (const field of PROJECT_FIELDS) {
    const raw = values[field.key] ?? '';
    if (field.storage === 'metadata') {
      metadata[field.key] = raw;
      hasMetadata = true;
    } else {
      (payload as Record<string, unknown>)[field.key] = raw;
    }
  }
  if (hasMetadata) payload.metadata = metadata;
  return payload;
}
