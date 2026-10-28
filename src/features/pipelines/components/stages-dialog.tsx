'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  X,
  Plus,
  Trash2,
  GripVertical,
  Trophy,
  XCircle,
  Circle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  pipelinesService,
  type StageType,
  type PipelineStage,
} from '../services/pipelines.service';

interface DraftStage {
  // Frontend-only id for dnd; if existing, also has serverId
  key: string;
  serverId?: string;
  name: string;
  color: string;
  type: StageType;
}

interface Props {
  open: boolean;
  pipelineId: string;
  initialStages: PipelineStage[];
  onClose: () => void;
  onSaved: () => void;
}

const COLORS: Array<{ name: string; cls: string }> = [
  { name: 'zinc', cls: 'bg-zinc-400' },
  { name: 'blue', cls: 'bg-blue-500' },
  { name: 'amber', cls: 'bg-amber-500' },
  { name: 'green', cls: 'bg-green-500' },
  { name: 'red', cls: 'bg-red-500' },
  { name: 'violet', cls: 'bg-violet-500' },
  { name: 'pink', cls: 'bg-pink-500' },
];

const TYPE_OPTIONS: Array<{
  value: StageType;
  label: string;
  Icon: any;
  cls: string;
}> = [
  { value: 'NORMAL', label: 'Normal', Icon: Circle, cls: 'text-zinc-500' },
  { value: 'WON', label: 'Ganho', Icon: Trophy, cls: 'text-green-600' },
  { value: 'LOST', label: 'Perdido', Icon: XCircle, cls: 'text-red-600' },
];

function makeKey() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function SortableRow({
  stage,
  onChange,
  onDelete,
}: {
  stage: DraftStage;
  onChange: (patch: Partial<DraftStage>) => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stage.key });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <button
        {...attributes}
        {...listeners}
        className="mt-1 cursor-grab text-zinc-400 hover:text-zinc-700 active:cursor-grabbing"
        aria-label="Arrastar"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="flex-1 space-y-2">
        <input
          value={stage.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Nome da stage"
          className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />

        <div className="flex flex-wrap items-center gap-2">
          {/* Colors */}
          <div className="flex items-center gap-1">
            {COLORS.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => onChange({ color: c.name })}
                className={`size-5 rounded-full ${c.cls} ${
                  stage.color === c.name
                    ? 'ring-2 ring-zinc-900 ring-offset-1 dark:ring-white'
                    : ''
                }`}
                aria-label={c.name}
              />
            ))}
          </div>

          <div className="ml-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />

          {/* Type */}
          <div className="flex items-center gap-1">
            {TYPE_OPTIONS.map((t) => {
              const active = stage.type === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => onChange({ type: t.value })}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    active
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'
                  }`}
                  title={t.label}
                >
                  <t.Icon className={`h-3 w-3 ${!active ? t.cls : ''}`} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onDelete}
        className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
        title="Excluir"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function StagesDialog({
  open,
  pipelineId,
  initialStages,
  onClose,
  onSaved,
}: Props) {
  const qc = useQueryClient();
  const [stages, setStages] = useState<DraftStage[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setStages(
        initialStages.map((s) => ({
          key: s.id,
          serverId: s.id,
          name: s.name,
          color: s.color ?? 'zinc',
          type: s.type,
        })),
      );
    }
  }, [open, initialStages]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  if (!open) return null;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setStages((prev) => {
      const oldIdx = prev.findIndex((s) => s.key === active.id);
      const newIdx = prev.findIndex((s) => s.key === over.id);
      if (oldIdx < 0 || newIdx < 0) return prev;
      return arrayMove(prev, oldIdx, newIdx);
    });
  };

  const handleAdd = () => {
    setStages((prev) => [
      ...prev,
      { key: makeKey(), name: '', color: 'zinc', type: 'NORMAL' },
    ]);
  };

  const handleSave = async () => {
    if (stages.some((s) => !s.name.trim())) {
      toast.error('Toda stage precisa de um nome');
      return;
    }
    setSaving(true);
    try {
      await pipelinesService.upsertStages(
        pipelineId,
        stages.map((s, idx) => ({
          ...(s.serverId ? { id: s.serverId } : {}),
          name: s.name.trim(),
          color: s.color,
          type: s.type,
          order: idx,
        })),
      );
      toast.success('Stages atualizadas');
      qc.invalidateQueries({ queryKey: ['pipeline-board', pipelineId] });
      qc.invalidateQueries({ queryKey: ['pipelines'] });
      onSaved();
    } catch (err: any) {
      toast.error(
        err?.response?.data?.message || 'Erro ao salvar stages',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Configurar stages
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Adicione, renomeie, reordene (drag) ou troque o tipo. Stage com
              cards não pode ser deletada.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={stages.map((s) => s.key)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {stages.map((s, idx) => (
                  <SortableRow
                    key={s.key}
                    stage={s}
                    onChange={(patch) =>
                      setStages((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
                      )
                    }
                    onDelete={() =>
                      setStages((prev) => prev.filter((_, i) => i !== idx))
                    }
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <button
            type="button"
            onClick={handleAdd}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500 hover:border-primary hover:text-primary dark:border-zinc-700"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar stage
          </button>

          <p className="mt-4 text-[11px] text-zinc-400">
            Tipos: <strong>Normal</strong> = stage intermediária ·{' '}
            <strong>Ganho</strong> = ao arrastar pra cá, marca card como WON +
            closedAt = now · <strong>Perdido</strong> = idem com LOST.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || stages.length === 0}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar stages'}
          </button>
        </div>
      </div>
    </div>
  );
}
