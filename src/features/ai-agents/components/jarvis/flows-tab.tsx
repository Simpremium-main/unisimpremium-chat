'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Edit2, Film, Image as ImageIcon, MessageSquareText, Plus, Trash2, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { useOrgId } from '@/hooks/use-org-query-key';
import { useConfirm } from '@/components/ui/dialogs';
import { aiPlaybooksService, type AiPlaybook } from '../../services/ai-playbooks.service';
import { aiAgentsService } from '../../services/ai-agents.service';
import { FlowDialog } from './flow-dialog';

/** Jarvis → Fluxos: roteiros que os agentes seguem quando o cliente aciona o gatilho. */
export function JarvisFlowsTab() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<AiPlaybook | 'new' | null>(null);

  const { data: flows, isLoading } = useQuery({
    queryKey: ['ai-playbooks', orgId],
    queryFn: () => aiPlaybooksService.list(),
  });
  const { data: agents } = useQuery({
    queryKey: ['ai-agents', orgId],
    queryFn: () => aiAgentsService.list(),
  });
  const agentName = (id: string | null) =>
    id ? (agents ?? []).find((a) => a.id === id)?.name ?? 'Agente removido' : 'Todos os agentes';

  const refresh = () => qc.invalidateQueries({ queryKey: ['ai-playbooks'] });

  const toggle = async (flow: AiPlaybook) => {
    try {
      await aiPlaybooksService.update(flow.id, { ...flow, isActive: !flow.isActive });
      refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao salvar');
    }
  };

  // Cópia desativada (não concorre com o original) e já aberta para editar.
  const duplicate = async (flow: AiPlaybook) => {
    const taken = new Set((flows ?? []).map((f) => f.name.trim().toLowerCase()));
    let name = `${flow.name} (cópia)`;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${flow.name} (cópia ${n})`;
    try {
      const copy = await aiPlaybooksService.create({ ...flow, slug: undefined, name, isActive: false });
      toast.success('Fluxo duplicado (desativado) — ajuste e ative quando quiser');
      refresh();
      setEditing(copy);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao duplicar');
    }
  };

  const handleDelete = async (flow: AiPlaybook) => {
    if (
      !(await confirm({
        title: `Excluir o fluxo "${flow.name}"?`,
        description: 'Os agentes deixam de seguir esse roteiro.',
        tone: 'danger',
      }))
    )
      return;
    try {
      await aiPlaybooksService.remove(flow.id);
      toast.success('Fluxo excluído');
      refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao excluir');
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            <Workflow className="h-5 w-5 text-primary" />
            Fluxos de atendimento
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Quando o cliente aciona o gatilho, o agente segue as instruções. As mensagens fixas
            saem exatamente como cadastradas, na ordem.
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Novo fluxo
        </button>
      </div>

      {isLoading && <div className="h-40 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />}

      {flows && flows.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-zinc-200 p-10 text-center dark:border-zinc-800">
          <Workflow className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-3 text-sm font-medium text-zinc-600">Nenhum fluxo cadastrado</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-zinc-400">
            Ex.: &quot;Quando o cliente pedir cotação, pergunte destino e datas e use a ferramenta de
            cotação&quot;, com as mensagens de apresentação do produto.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {(flows ?? []).map((flow) => {
          const counts = {
            TEXT: flow.steps.filter((s) => s.type === 'TEXT').length,
            IMAGE: flow.steps.filter((s) => s.type === 'IMAGE').length,
            VIDEO: flow.steps.filter((s) => s.type === 'VIDEO').length,
          };
          return (
            <div
              key={flow.id}
              className={`animate-item-in rounded-xl border bg-white p-4 dark:bg-zinc-900 ${
                flow.isActive ? 'border-zinc-200 dark:border-zinc-800' : 'border-dashed border-zinc-300 opacity-70 dark:border-zinc-700'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{flow.name}</p>
                    <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {flow.slug}
                    </code>
                    {flow.groupName && (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        {flow.groupName}
                      </span>
                    )}
                    {!flow.isActive && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                        Inativo
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-zinc-600 line-clamp-2 dark:text-zinc-400">
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">Gatilho:</span> {flow.trigger}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                    <span>{agentName(flow.agentId)}</span>
                    {counts.TEXT > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <MessageSquareText className="h-3 w-3" /> {counts.TEXT}
                      </span>
                    )}
                    {counts.IMAGE > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <ImageIcon className="h-3 w-3" /> {counts.IMAGE}
                      </span>
                    )}
                    {counts.VIDEO > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Film className="h-3 w-3" /> {counts.VIDEO}
                      </span>
                    )}
                    {flow.steps.length === 0 && <span>sem mensagens fixas</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => toggle(flow)}
                    className="rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    {flow.isActive ? 'Desativar' : 'Ativar'}
                  </button>
                  <button
                    onClick={() => setEditing(flow)}
                    aria-label="Editar"
                    className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => duplicate(flow)}
                    aria-label="Duplicar"
                    title="Duplicar"
                    className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(flow)}
                    aria-label="Excluir"
                    className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <FlowDialog
          flow={editing === 'new' ? null : editing}
          agents={agents ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            refresh();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
