'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Plus, Bot, MoreVertical, Trash2, Power, PowerOff } from 'lucide-react';
import { toast } from 'sonner';
import { chatbotService, type ChatbotFlow } from '@/features/chatbot/services/chatbot.service';
import { useOrgId } from '@/hooks/use-org-query-key';
import { useConfirm } from '@/components/ui/dialogs';

export default function ChatbotPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const orgId = useOrgId();
  const { data: flows, isLoading } = useQuery({
    queryKey: ['chatbot-flows', orgId],
    queryFn: () => chatbotService.list(),
  });

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const flow = await chatbotService.create({ name: newName.trim() });
      queryClient.invalidateQueries({ queryKey: ['chatbot-flows'] });
      setShowCreate(false);
      setNewName('');
      router.push(`/chatbot/${flow.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar fluxo');
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (flow: ChatbotFlow) => {
    try {
      await chatbotService.update(flow.id, { isActive: !flow.isActive });
      queryClient.invalidateQueries({ queryKey: ['chatbot-flows'] });
      toast.success(flow.isActive ? 'Fluxo desativado' : 'Fluxo ativado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro');
    }
  };

  const confirm = useConfirm();
  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: 'Remover este fluxo?', confirmText: 'Remover', tone: 'danger' }))) return;
    try {
      await chatbotService.remove(id);
      queryClient.invalidateQueries({ queryKey: ['chatbot-flows'] });
      toast.success('Fluxo removido');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro');
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Chatbot</h1>
          <p className="mt-1 text-sm text-zinc-500">Crie e gerencie fluxos de atendimento automático</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Novo Fluxo
        </button>
      </div>

      {showCreate && (
        <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Nome do fluxo</p>
          <div className="mt-2 flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Ex: Atendimento Inicial"
              className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              autoFocus
            />
            <button onClick={handleCreate} disabled={creating} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              Criar
            </button>
            <button onClick={() => { setShowCreate(false); setNewName(''); }} className="rounded-md px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {isLoading ? (
          Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900" />
          ))
        ) : flows && flows.length > 0 ? (
          flows.map((flow) => (
            <div
              key={flow.id}
              className="group relative rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start justify-between">
                <button
                  onClick={() => router.push(`/chatbot/${flow.id}`)}
                  className="flex items-start gap-3 text-left"
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${flow.isActive ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'}`}>
                    <Bot className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{flow.name}</h3>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {flow._count?.nodes || flow.nodes?.length || 0} nós · {flow.triggerType}
                    </p>
                    {flow.channels?.length > 0 && (
                      <div className="mt-1.5 flex gap-1">
                        {flow.channels.map((c) => (
                          <span key={c.channelId} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
                            {c.channel.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
                <div className="flex items-center gap-1">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${flow.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'}`}>
                    {flow.isActive ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
              </div>
              <div className="mt-3 flex gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <button
                  onClick={() => handleToggle(flow)}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {flow.isActive ? <PowerOff className="h-3 w-3" /> : <Power className="h-3 w-3" />}
                  {flow.isActive ? 'Desativar' : 'Ativar'}
                </button>
                <button
                  onClick={() => handleDelete(flow.id)}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                >
                  <Trash2 className="h-3 w-3" /> Remover
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-full flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-200 py-16 dark:border-zinc-800">
            <Bot className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
            <p className="mt-3 text-sm font-medium text-zinc-600 dark:text-zinc-400">Nenhum fluxo criado</p>
            <p className="mt-1 text-xs text-zinc-400">Crie seu primeiro chatbot para automatizar o atendimento</p>
          </div>
        )}
      </div>
    </div>
  );
}
