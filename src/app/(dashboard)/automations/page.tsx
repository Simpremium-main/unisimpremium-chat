'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Activity, Pause, Play, Zap } from 'lucide-react';
import { toast } from 'sonner';
import {
  Automation,
  automationsService,
} from '@/features/automations/services/automations.service';
import {
  ACTION_LABELS,
  TRIGGER_LABELS,
} from '@/features/automations/utils/labels';
import { AutomationBuilder } from '@/features/automations/components/automation-builder';
import { AutomationRunsPanel } from '@/features/automations/components/automation-runs-panel';
import { useConfirm } from '@/components/ui/dialogs';

export default function AutomationsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Automation | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewingRuns, setViewingRuns] = useState<Automation | null>(null);

  const { data: meta } = useQuery({
    queryKey: ['automations-meta'],
    queryFn: automationsService.meta,
  });

  const { data: automations = [], isLoading } = useQuery({
    queryKey: ['automations'],
    queryFn: automationsService.list,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      automationsService.toggle(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automations'] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const confirm = useConfirm();
  const removeMutation = useMutation({
    mutationFn: automationsService.remove,
    onSuccess: () => {
      toast.success('Automação removida');
      qc.invalidateQueries({ queryKey: ['automations'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleSaved = () => {
    setEditing(null);
    setCreating(false);
    qc.invalidateQueries({ queryKey: ['automations'] });
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            <div>
              <h1 className="text-lg font-semibold">Automações</h1>
              <p className="text-xs text-zinc-500">
                Quando algo acontece → execute uma sequência de ações
              </p>
            </div>
          </div>
          <button
            onClick={() => setCreating(true)}
            disabled={!meta}
            className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Nova automação
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {isLoading && (
          <div className="text-sm text-zinc-500">Carregando…</div>
        )}
        {!isLoading && automations.length === 0 && (
          <EmptyState onCreate={() => setCreating(true)} />
        )}
        {!isLoading && automations.length > 0 && (
          <ul className="space-y-2">
            {automations.map((a) => (
              <AutomationRow
                key={a.id}
                automation={a}
                onEdit={() => setEditing(a)}
                onToggle={(enabled) =>
                  toggleMutation.mutate({ id: a.id, enabled })
                }
                onRemove={async () => {
                  if (
                    await confirm({
                      title: `Remover a automação "${a.name}"?`,
                      confirmText: 'Remover',
                      tone: 'danger',
                    })
                  ) {
                    removeMutation.mutate(a.id);
                  }
                }}
                onViewRuns={() => setViewingRuns(a)}
              />
            ))}
          </ul>
        )}
      </div>

      {(creating || editing) && meta && (
        <AutomationBuilder
          meta={meta}
          initial={editing ?? undefined}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={handleSaved}
        />
      )}

      {viewingRuns && (
        <AutomationRunsPanel
          automation={viewingRuns}
          onClose={() => setViewingRuns(null)}
        />
      )}
    </div>
  );
}

function AutomationRow({
  automation,
  onEdit,
  onToggle,
  onRemove,
  onViewRuns,
}: {
  automation: Automation;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  onViewRuns: () => void;
}) {
  const failureRate =
    automation.runCount > 0
      ? Math.round((automation.failureCount / automation.runCount) * 100)
      : 0;

  const isAutoPaused = !!automation.autoPausedAt;
  const actionsCount = Array.isArray(automation.actions)
    ? automation.actions.length
    : 0;

  return (
    <li className="flex items-center gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <button
        onClick={() => onToggle(!automation.enabled)}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition ${
          automation.enabled
            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950 dark:text-emerald-400'
            : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
        }`}
        aria-label={automation.enabled ? 'Desativar' : 'Ativar'}
      >
        {automation.enabled ? (
          <Play className="h-4 w-4" />
        ) : (
          <Pause className="h-4 w-4" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-medium">{automation.name}</h3>
          {isAutoPaused && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950 dark:text-red-400">
              auto-pausada
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-zinc-500">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            Quando:
          </span>{' '}
          {TRIGGER_LABELS[automation.trigger]}
          {' · '}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            Faz:
          </span>{' '}
          {actionsCount === 0
            ? 'nenhuma ação'
            : (Array.isArray(automation.actions) ? automation.actions : [])
                .map((a) => ACTION_LABELS[a.type])
                .join(' → ')}
        </p>
        {automation.runCount > 0 && (
          <p className="mt-1 text-[11px] text-zinc-500">
            {automation.runCount} {automation.runCount === 1 ? 'run' : 'runs'} ·{' '}
            {automation.successCount} OK · {automation.failureCount} falhas
            {failureRate > 0 && ` (${failureRate}%)`}
            {automation.lastRunAt &&
              ` · último: ${new Date(automation.lastRunAt).toLocaleString('pt-BR')}`}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1">
        <IconButton onClick={onViewRuns} title="Ver logs">
          <Activity className="h-4 w-4" />
        </IconButton>
        <IconButton onClick={onEdit} title="Editar">
          <Pencil className="h-4 w-4" />
        </IconButton>
        <IconButton onClick={onRemove} title="Remover" className="hover:text-red-500">
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </li>
  );
}

function IconButton({
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-zinc-200 px-8 py-16 text-center dark:border-zinc-800">
      <Zap className="mx-auto h-10 w-10 text-zinc-400" />
      <h3 className="mt-4 text-lg font-semibold">
        Nenhuma automação ainda
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">
        Crie regras pra reagir automaticamente a eventos. Ex: <em>quando
        tag VIP for adicionada → atribuir ao João + responder boas-vindas</em>.
      </p>
      <button
        onClick={onCreate}
        className="mx-auto mt-6 flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        <Plus className="h-4 w-4" /> Criar primeira automação
      </button>
    </div>
  );
}
