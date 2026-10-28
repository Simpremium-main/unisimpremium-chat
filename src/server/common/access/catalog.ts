/**
 * Páginas e ações que um perfil de acesso (AccessProfile) libera para
 * atendentes (role AGENT). OWNER/ADMIN sempre têm tudo; AGENT sem perfil
 * mantém o acesso padrão (tudo que o role já permitia).
 *
 * O front usa a mesma lista (GET /access-profiles/catalog) para montar a
 * tela de configuração, esconder o menu e os botões.
 */
export const ACCESS_PAGES = [
  { key: 'inbox', label: 'Inbox', description: 'Conversas com os clientes' },
  { key: 'contacts', label: 'Contatos', description: 'Lista e ficha dos contatos' },
  { key: 'pipelines', label: 'Pipelines', description: 'Quadros de vendas/atendimento' },
  { key: 'dashboard', label: 'Dashboard', description: 'Métricas do atendimento' },
  { key: 'projects', label: 'Projetos', description: 'Projetos dos clientes' },
  { key: 'jarvis', label: 'Jarvis (IA)', description: 'Agentes de IA, fluxos e execuções' },
  // Abas do Jarvis: com "Jarvis" marcado e nenhuma aba escolhida, vale todas.
  { key: 'jarvis.overview', label: 'Visão geral', description: '', parent: 'jarvis' },
  { key: 'jarvis.agents', label: 'Agentes', description: '', parent: 'jarvis' },
  { key: 'jarvis.flows', label: 'Fluxos', description: '', parent: 'jarvis' },
  { key: 'jarvis.skills', label: 'Skills', description: '', parent: 'jarvis' },
  { key: 'jarvis.tools', label: 'Tools', description: '', parent: 'jarvis' },
  { key: 'jarvis.runs', label: 'Execuções', description: '', parent: 'jarvis' },
  { key: 'jarvis.watchdog', label: 'Watchdog', description: '', parent: 'jarvis' },
  { key: 'jarvis.agent', label: 'Por agente', description: '', parent: 'jarvis' },
  { key: 'automations', label: 'Automações', description: 'Regras automáticas' },
  { key: 'settings', label: 'Configurações', description: 'Abas de configuração que o perfil já pode ver' },
] as const;

export const ACCESS_ACTIONS = [
  { key: 'conversations.create', label: 'Iniciar novas conversas', description: 'Mandar a primeira mensagem para um contato' },
  { key: 'conversations.assign', label: 'Atribuir e transferir conversas', description: 'Passar a conversa para outro atendente ou setor' },
  { key: 'conversations.close', label: 'Encerrar e reabrir conversas', description: '' },
  { key: 'conversations.ai', label: 'Controlar a IA na conversa', description: 'Pausar/ligar a IA, escolher o agente e limpar o contexto' },
  { key: 'messages.delete', label: 'Apagar mensagens', description: 'Apagar mensagens enviadas' },
  { key: 'contacts.edit', label: 'Editar contatos', description: 'Nome, e-mail e dados do contato' },
  { key: 'pipelines.edit', label: 'Editar pipelines', description: 'Criar, mover e apagar cards e etapas' },
] as const;

export type AccessPage = (typeof ACCESS_PAGES)[number]['key'];
export type AccessAction = (typeof ACCESS_ACTIONS)[number]['key'];

export const PAGE_KEYS = new Set<string>(ACCESS_PAGES.map((p) => p.key));
export const ACTION_KEYS = new Set<string>(ACCESS_ACTIONS.map((a) => a.key));

/** Perfil criado automaticamente em cada organização. */
export const DEFAULT_ATTENDANT_PROFILE = {
  name: 'Atendente',
  description: 'Atende os clientes pelo inbox.',
  pages: ['inbox', 'contacts'] as AccessPage[],
  actions: ['conversations.create', 'conversations.close', 'conversations.assign'] as AccessAction[],
};

/** Permissões efetivas do usuário na org; null = sem restrição. */
export interface EffectiveAccess {
  profileId: string;
  profileName: string;
  pages: string[];
  actions: string[];
}

export function canAccess(
  access: EffectiveAccess | null | undefined,
  kind: 'page' | 'action',
  key: string,
): boolean {
  if (!access) return true;
  if (kind === 'action') return access.actions.includes(key);
  // Sub-página (ex.: jarvis.skills): precisa da página-mãe; se o perfil não
  // escolheu nenhuma sub-página dela, todas valem.
  const dot = key.indexOf('.');
  if (dot > 0) {
    const parent = key.slice(0, dot);
    if (!access.pages.includes(parent)) return false;
    const chosen = access.pages.filter((p) => p.startsWith(`${parent}.`));
    return chosen.length === 0 || chosen.includes(key);
  }
  return access.pages.includes(key);
}
