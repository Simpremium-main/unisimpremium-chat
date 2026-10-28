'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KanbanSquare, Loader2 } from 'lucide-react';
import {
  pipelinesService,
  type Pipeline,
  type PipelineStage,
} from '@/features/pipelines/services/pipelines.service';

interface Props {
  count: number;
  disabled?: boolean;
  onConfirm: (pipelineId: string, stageId: string) => Promise<void>;
}

/**
 * Bulk action: drop selected conversations into a pipeline stage.
 *
 * Two-step picker (pipeline → stage filtered by pipeline) inside a popover.
 * Stages list comes embedded in /pipelines, so no second fetch — a single
 * cached query feeds the whole UI.
 */
export function BulkPipelinePopover({ count, disabled, onConfirm }: Props) {
  const [open, setOpen] = useState(false);
  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const { data: pipelines = [] } = useQuery<Pipeline[]>({
    queryKey: ['pipelines'],
    queryFn: () => pipelinesService.list(),
    staleTime: 5 * 60 * 1000,
  });

  // Filter out archived pipelines + stages of the picked one. Sorting
  // stages by `order` matches the kanban view so the user picks "left to
  // right" without surprise.
  const visiblePipelines = useMemo(
    () => pipelines.filter((p) => !p.archived),
    [pipelines],
  );
  const stages = useMemo<PipelineStage[]>(() => {
    const p = pipelines.find((x) => x.id === pipelineId);
    return (p?.stages ?? []).slice().sort((a, b) => a.order - b.order);
  }, [pipelines, pipelineId]);

  // Click-outside to dismiss. Keeps the popover from feeling sticky after
  // the user moves on.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Reset stage whenever pipeline changes — the previous stageId is
  // meaningless under a new pipeline.
  useEffect(() => {
    setStageId('');
  }, [pipelineId]);

  const handleConfirm = async () => {
    if (!pipelineId || !stageId) return;
    setSubmitting(true);
    try {
      await onConfirm(pipelineId, stageId);
      setOpen(false);
      // Don't reset selections — user might want to redo the same pick
      // on another batch. Will be cleared on next mount anyway.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title="Adicionar a um pipeline"
        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-violet-50 hover:text-violet-600 disabled:opacity-50 dark:hover:bg-violet-500/10"
      >
        <KanbanSquare className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-2 text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">
            Adicionar {count} {count === 1 ? 'conversa' : 'conversas'} a um
            pipeline
          </div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Pipeline
          </label>
          <select
            value={pipelineId}
            onChange={(e) => setPipelineId(e.target.value)}
            className="mb-2 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="">Selecione um pipeline…</option>
            {visiblePipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {pipelineId && (
            <>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                Estágio
              </label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="mb-3 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                <option value="">Selecione um estágio…</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.type !== 'NORMAL' ? ` (${s.type})` : ''}
                  </option>
                ))}
              </select>
            </>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={!pipelineId || !stageId || submitting}
              className="flex items-center gap-1 rounded bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
              Adicionar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
