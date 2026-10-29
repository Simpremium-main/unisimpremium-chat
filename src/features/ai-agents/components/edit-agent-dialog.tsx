'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, X, Plus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  aiAgentsService,
  DEFAULT_AGENT_MODEL,
  getToolModel,
  withToolModel,
  getAdvancedOptions,
  withAdvancedOptions,
  type AgentAdvancedOptions,
  DEPARTMENTS,
  type AiAgent,
  type AgentMode,
} from '../services/ai-agents.service';
import { aiCatalogService } from '../services/ai-catalog.service';
import { channelsService } from '@/features/channels/services/channels.service';
import { useOrgId } from '@/hooks/use-org-query-key';
import { useConfirm } from '@/components/ui/dialogs';
import { ModelSelect } from './model-select';

interface EditAgentDialogProps {
  agent: AiAgent | null;
  onClose: () => void;
  onSaved: () => void;
}

export function EditAgentDialog({
  agent,
  onClose,
  onSaved,
}: EditAgentDialogProps) {
  const orgId = useOrgId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [modelId, setModelId] = useState(DEFAULT_AGENT_MODEL);
  const [toolModelId, setToolModelId] = useState('');
  const [advanced, setAdvanced] = useState<AgentAdvancedOptions>(getAdvancedOptions(null));
  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [parentAgentId, setParentAgentId] = useState<string>('');
  const [department, setDepartment] = useState<string>('');
  const [squad, setSquad] = useState('');
  const [operationalContext, setOperationalContext] = useState('');
  const [operationalContextUpdatedAt, setOperationalContextUpdatedAt] = useState<
    string | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [newChannelId, setNewChannelId] = useState('');
  const [newChannelMode, setNewChannelMode] = useState<AgentMode>('AUTONOMOUS');

  const { data: channels } = useQuery({
    queryKey: ['channels'],
    queryFn: () => channelsService.list(),
    enabled: !!agent,
  });

  // Other agents in the org for the "reports to" dropdown.
  const { data: allAgents } = useQuery({
    queryKey: ['ai-agents', orgId],
    queryFn: () => aiAgentsService.list(),
    enabled: !!agent,
  });

  useEffect(() => {
    if (!agent) return;
    setName(agent.name);
    setDescription(agent.description ?? '');
    setModelId(agent.modelId);
    setToolModelId(getToolModel(agent.modelParams));
    setAdvanced(getAdvancedOptions(agent.modelParams));
    setSystemPrompt(agent.systemPrompt);
    setTemperature(agent.temperature);
    setParentAgentId(agent.parentAgentId ?? '');
    setDepartment(agent.department ?? '');
    setSquad(agent.squad ?? '');
    setOperationalContext(agent.operationalContext ?? '');
    setOperationalContextUpdatedAt(agent.operationalContextUpdatedAt ?? null);
  }, [agent]);

  // Hooks antes do retorno antecipado (a ordem dos hooks não pode mudar).
  const confirm = useConfirm();

  if (!agent) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await aiAgentsService.update(agent.id, {
        name,
        description,
        modelId,
        modelParams: withAdvancedOptions(withToolModel(agent.modelParams, toolModelId), advanced),
        systemPrompt,
        temperature,
        parentAgentId: parentAgentId || null,
        department: department || null,
        squad: squad.trim() || null,
        operationalContext: operationalContext.trim() || null,
      });
      toast.success('Agente atualizado');
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (
      !(await confirm({
        title: `Excluir o agente "${agent.name}"?`,
        description: 'Essa ação é irreversível.',
        tone: 'danger',
      }))
    )
      return;
    try {
      await aiAgentsService.remove(agent.id);
      toast.success('Agente excluído');
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao excluir');
    }
  };

  const handleAddChannel = async () => {
    if (!newChannelId) return;
    try {
      await aiAgentsService.assignChannel(agent.id, {
        channelId: newChannelId,
        mode: newChannelMode,
      });
      toast.success('Canal vinculado');
      setShowAddChannel(false);
      setNewChannelId('');
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao vincular canal');
    }
  };

  const handleRemoveChannel = async (channelId: string) => {
    try {
      await aiAgentsService.unassignChannel(agent.id, channelId);
      toast.success('Canal removido do agente');
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao desvincular');
    }
  };

  const availableChannels = (channels ?? []).filter(
    (c) => !agent.channels?.some((ac) => ac.channelId === c.id),
  );

  return (
    <div className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Editar agente
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Nome
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Descrição
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Modelo
            </label>
            <ModelSelect value={modelId} onChange={setModelId} />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Modelo para as etapas de ferramentas (opcional)
            </label>
            <ModelSelect
              value={toolModelId}
              onChange={setToolModelId}
              emptyLabel="Igual ao modelo principal"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Um modelo mais barato aqui economiza nas consultas internas; a resposta
              final ao cliente continua no modelo principal.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              System prompt
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={10}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          <div className="rounded-lg border-2 border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900/40 dark:bg-amber-900/10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                  Contexto operacional do dia
                </p>
                <p className="mt-0.5 text-[11px] text-amber-700/80 dark:text-amber-200/70">
                  Memória viva injetada no prompt — atualize quando rodar
                  campanha, der aula, mudar oferta. Ex: &quot;Hoje 20h teve aula
                  de Skills. Pra quem responder feedback positivo, ofereça
                  Dominando Claude Code R$ 1.497 (link X).&quot;
                </p>
              </div>
              {operationalContextUpdatedAt && (
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Atualizado{' '}
                  {formatRelative(operationalContextUpdatedAt)}
                </span>
              )}
            </div>
            <textarea
              value={operationalContext}
              onChange={(e) => setOperationalContext(e.target.value)}
              rows={4}
              placeholder="Deixe vazio se hoje não tem nada operacional..."
              maxLength={8000}
              className="mt-3 w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-xs dark:border-amber-900/60 dark:bg-zinc-900 dark:text-zinc-100"
            />
            <p className="mt-1 text-right text-[10px] text-amber-700/60 dark:text-amber-300/60">
              {operationalContext.length}/8000
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Criatividade ({temperature.toFixed(2)})
            </label>
            <input
              type="range"
              min="0"
              max="1.5"
              step="0.05"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="mt-2 w-full"
            />
          </div>

          {/* Opções avançadas (modelParams) */}
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Opções avançadas
            </p>
            <div className="mt-3 space-y-3">
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={advanced.standalonePrompt}
                  onChange={(e) => setAdvanced((a) => ({ ...a, standalonePrompt: e.target.checked }))}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm text-zinc-800 dark:text-zinc-200">Usar só o prompt deste agente</span>
                  <span className="block text-[11px] text-zinc-500">
                    Desliga as regras padrão da plataforma (tom, emojis, venda consultiva, passagem entre
                    agentes). Para agentes com prompt completo, como o importado do Simp-Atendimento.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={advanced.simpremiumTools}
                  onChange={(e) => setAdvanced((a) => ({ ...a, simpremiumTools: e.target.checked }))}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm text-zinc-800 dark:text-zinc-200">Ferramentas Uni</span>
                  <span className="block text-[11px] text-zinc-500">
                    Cotação de chip e seguro, pedidos, ativações, frete, cupom, roaming, escalar e finalizar
                    atendimento (servidor em Jarvis → Tools → Pedido Central).
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={advanced.unimobileTools}
                  onChange={(e) => setAdvanced((a) => ({ ...a, unimobileTools: e.target.checked }))}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm text-zinc-800 dark:text-zinc-200">Ferramentas Uni Mobile (linhas)</span>
                  <span className="block text-[11px] text-zinc-500">
                    Consulta de linha, consumo, cobertura, planos e compatibilidade. Reenvio de e-mail, ativação,
                    recarga, extensão, alteração, cancelamento, reinício e novo pedido executam na hora em que quem
                    pediu responde &quot;SIM + código&quot; no WhatsApp (API em UNIMOBILE_API_URL / UNIMOBILE_API_TOKEN).
                  </span>
                </span>
              </label>
              <div>
                <label className="block text-sm text-zinc-800 dark:text-zinc-200">Mensagens por resposta</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={advanced.maxRepliesPerRun}
                  onChange={(e) =>
                    setAdvanced((a) => ({
                      ...a,
                      maxRepliesPerRun: Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)),
                    }))
                  }
                  className="mt-1 w-24 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
                <p className="mt-1 text-[11px] text-zinc-500">
                  Quantas mensagens o agente pode mandar seguidas antes de esperar o cliente (padrão 1).
                </p>
              </div>
            </div>
          </div>

          {/* Organograma matricial ágil */}
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Organograma
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Define hierarquia (chefia direta), departamento e squad ágil.
            </p>

            <div className="mt-3 space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Reporta a (chefe direto)
                </label>
                <select
                  value={parentAgentId}
                  onChange={(e) => setParentAgentId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <option value="">— Raiz / sem chefe (CEO virtual) —</option>
                  {(allAgents ?? [])
                    .filter((a) => a.id !== agent.id)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}{' '}
                        {a.kind === 'ORCHESTRATOR' ? '(Orquestrador)' : ''}
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Departamento
                  </label>
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    <option value="">— Não definido —</option>
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Squad ágil
                  </label>
                  <input
                    type="text"
                    value={squad}
                    onChange={(e) => setSquad(e.target.value)}
                    placeholder="Ex: Inbound B2C"
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </div>
              </div>
            </div>
          </div>

          {agent && (
            <AgentSkillsAndTools agentId={agent.id} />
          )}

          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Canais
              </h4>
              {!showAddChannel && availableChannels.length > 0 && (
                <button
                  onClick={() => setShowAddChannel(true)}
                  className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  <Plus className="h-3 w-3" /> Vincular canal
                </button>
              )}
            </div>
            {showAddChannel && (
              <div className="mt-3 flex items-center gap-2">
                <select
                  value={newChannelId}
                  onChange={(e) => setNewChannelId(e.target.value)}
                  className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <option value="">Selecione um canal…</option>
                  {availableChannels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.type})
                    </option>
                  ))}
                </select>
                <select
                  value={newChannelMode}
                  onChange={(e) => setNewChannelMode(e.target.value as AgentMode)}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <option value="AUTONOMOUS">Autônomo</option>
                  <option value="COPILOT">Copiloto</option>
                  <option value="DISABLED">Desativado</option>
                </select>
                <button
                  onClick={handleAddChannel}
                  className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  OK
                </button>
                <button
                  onClick={() => setShowAddChannel(false)}
                  className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            <div className="mt-3 space-y-2">
              {(agent.channels ?? []).map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
                >
                  <div className="text-sm">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {c.channel.name}
                    </span>
                    <span className="ml-2 text-[11px] text-zinc-500">
                      {c.channel.type} · {c.mode.toLowerCase()}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRemoveChannel(c.channelId)}
                    className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {(agent.channels ?? []).length === 0 && (
                <p className="text-xs text-zinc-500">
                  Nenhum canal vinculado. O agente não vai responder ninguém ainda.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
          <button
            onClick={handleDelete}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <Trash2 className="h-3.5 w-3.5" /> Excluir
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Fechar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const ageMs = Date.now() - d.getTime();
  const ageHours = Math.floor(ageMs / 3_600_000);
  if (ageHours < 1) return 'há minutos';
  if (ageHours < 24) return `há ${ageHours}h`;
  const ageDays = Math.floor(ageHours / 24);
  if (ageDays < 30) return `há ${ageDays}d`;
  return `há ${Math.floor(ageDays / 30)} meses`;
}

function AgentSkillsAndTools({ agentId }: { agentId: string }) {
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [savingSkills, setSavingSkills] = useState(false);
  const queryClient = useQueryClient();

  const { data: skills } = useQuery({
    queryKey: ['ai-skills'],
    queryFn: () => aiCatalogService.listSkills(),
  });

  // Bindings (agent, skill) carregam o estado de `requiresApproval` por
  // skill já atribuída. Refetch agressivo porque mudança aqui é raríssima
  // mas crítica (define se executa direto ou cria PendingAction).
  const { data: bindings } = useQuery({
    queryKey: ['ai-agent-skills', agentId],
    queryFn: () => aiAgentsService.listAgentSkills(agentId),
    enabled: !!agentId,
  });

  const approvalByskillId = new Map(
    (bindings ?? []).map((b) => [b.skillId, b.requiresApproval]),
  );

  useEffect(() => {
    if (!skills) return;
    const ids = skills
      .filter((s) => (s.agents ?? []).some((a) => a.agent.id === agentId))
      .map((s) => s.id);
    setSkillIds(ids);
  }, [skills, agentId]);

  const toggleSkill = (id: string) =>
    setSkillIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const handleSaveSkills = async () => {
    setSavingSkills(true);
    try {
      await aiCatalogService.setAgentSkills(agentId, skillIds);
      // Recarrega bindings — skills atribuídas mudaram, requiresApproval
      // de skills novas é false por padrão.
      await queryClient.invalidateQueries({
        queryKey: ['ai-agent-skills', agentId],
      });
      toast.success('Skills atualizadas');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro');
    } finally {
      setSavingSkills(false);
    }
  };

  const toggleApproval = async (skillId: string, next: boolean) => {
    try {
      await aiAgentsService.setSkillApproval(agentId, skillId, next);
      await queryClient.invalidateQueries({
        queryKey: ['ai-agent-skills', agentId],
      });
      toast.success(
        next
          ? 'Skill agora exige aprovação humana antes de executar'
          : 'Skill volta a executar automaticamente',
      );
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao salvar');
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Skills atribuídas ({skillIds.length})
          </h4>
          <button
            onClick={handleSaveSkills}
            disabled={savingSkills}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {savingSkills ? '…' : 'Salvar skills'}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          Cada skill é uma função invocável (ex: /resetPassword) ligada à sua
          tool (provider). Built-in essenciais (reply/transfer/tag) são
          incluídas automaticamente.
        </p>
        <p className="mt-2 text-[10px] text-zinc-400">
          💡 Skills marcadas com <ShieldCheck className="inline h-3 w-3 text-amber-600" />{' '}
          exigem aprovação humana via inbox antes de executar — útil pra ações
          irreversíveis (liberar acesso, resetar senha). Padrão: executa direto.
        </p>
        <div className="mt-2 max-h-72 overflow-y-auto">
          {(skills ?? []).map((s) => {
            const checked = skillIds.includes(s.id);
            const requiresApproval = approvalByskillId.get(s.id) ?? false;
            return (
              <div
                key={s.id}
                className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white dark:hover:bg-zinc-800 ${
                  checked ? 'bg-white dark:bg-zinc-800' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSkill(s.id)}
                  className="mt-0.5 h-3.5 w-3.5 cursor-pointer"
                />
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {s.name}
                    </span>
                    {s.category && (
                      <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[9px] uppercase text-zinc-600 dark:bg-zinc-700">
                        {s.category}
                      </span>
                    )}
                    <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] uppercase text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                      {s.source}
                    </span>
                    {checked && (
                      <button
                        type="button"
                        onClick={() => toggleApproval(s.id, !requiresApproval)}
                        className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                          requiresApproval
                            ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300'
                            : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
                        }`}
                        title={
                          requiresApproval
                            ? 'Clique pra desligar — skill volta a executar automaticamente'
                            : 'Clique pra ligar — skill vai exigir aprovação humana antes de executar'
                        }
                      >
                        <ShieldCheck className="h-3 w-3" />
                        {requiresApproval ? 'Aprovação' : 'Auto'}
                      </button>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-zinc-500 line-clamp-1">
                    {s.description}
                    {s.tool && (
                      <>
                        {' · via '}
                        <code className="font-mono">{s.tool.name}</code>
                      </>
                    )}
                  </p>
                </div>
              </div>
            );
          })}
          {(skills ?? []).length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-zinc-400">
              Nenhuma skill cadastrada. Crie em Jarvis &gt; Skills.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
