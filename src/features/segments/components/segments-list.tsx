'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users, Star, Pencil, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useOrgId } from '@/hooks/use-org-query-key';
import { segmentsService, type Segment } from '../services/segments.service';
import { SegmentFormDialog } from './segment-form-dialog';
import { useConfirm } from '@/components/ui/dialogs';

export function SegmentsList() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Segment | null>(null);

  const { data: segments, isLoading } = useQuery({
    queryKey: ['segments', orgId],
    queryFn: () => segmentsService.list(),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['segments'] });

  const removeMutation = useMutation({
    mutationFn: (id: string) => segmentsService.remove(id),
    onSuccess: () => {
      toast.success('Segmento removido');
      refresh();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Erro ao remover'),
  });

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (segment: Segment) => {
    setEditing(segment);
    setDialogOpen(true);
  };

  const confirm = useConfirm();
  const handleRemove = async (segment: Segment) => {
    if (
      !(await confirm({
        title: `Remover o segmento "${segment.name}"?`,
        description: 'Os grupos voltam a ser tratados por canal individualmente.',
        confirmText: 'Remover',
        tone: 'danger',
      }))
    )
      return;
    removeMutation.mutate(segment.id);
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Segmentos
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            Vários números que compartilham os mesmos grupos e histórico
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Novo Segmento
        </button>
      </div>

      <div className="mt-6 space-y-3">
        {isLoading ? (
          Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
            />
          ))
        ) : segments && segments.length > 0 ? (
          segments.map((seg) => (
            <div
              key={seg.id}
              className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                      {seg.name}
                    </h3>
                    {!seg.isActive && (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
                        Inativo
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {seg.members.map((m) => {
                      const isPrimary = m.channelId === seg.primaryChannelId;
                      return (
                        <span
                          key={m.id}
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
                            isPrimary
                              ? 'bg-primary/10 text-primary'
                              : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                          }`}
                        >
                          {isPrimary && <Star className="h-3 w-3 fill-current" />}
                          {m.channel?.name ?? m.channelId}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => openEdit(seg)}
                    className="rounded-md p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                    title="Editar"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleRemove(seg)}
                    disabled={removeMutation.isPending}
                    className="rounded-md p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30"
                    title="Remover"
                  >
                    {removeMutation.isPending &&
                    removeMutation.variables === seg.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-200 py-16 dark:border-zinc-800">
            <Users className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
            <p className="mt-3 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Nenhum segmento criado
            </p>
            <p className="mt-1 max-w-sm text-center text-xs text-zinc-400 dark:text-zinc-500">
              Agrupe vários números que estão nos mesmos grupos para unificar
              conversas e histórico.
            </p>
            <button
              onClick={openCreate}
              className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              Criar Segmento
            </button>
          </div>
        )}
      </div>

      <SegmentFormDialog
        open={dialogOpen}
        segment={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={refresh}
      />
    </div>
  );
}
