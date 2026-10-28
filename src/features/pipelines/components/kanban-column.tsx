'use client';

import { useDroppable } from '@dnd-kit/core';
import { Plus, Trophy, X as XIcon } from 'lucide-react';
import { KanbanCard } from './kanban-card';
import type {
  CardSummary,
  PipelineStage,
} from '../services/pipelines.service';

const STAGE_COLOR: Record<string, string> = {
  zinc: 'border-zinc-300 bg-zinc-50 dark:bg-zinc-900',
  blue: 'border-blue-300 bg-blue-50 dark:bg-blue-950/30',
  amber: 'border-amber-300 bg-amber-50 dark:bg-amber-950/30',
  green: 'border-green-300 bg-green-50 dark:bg-green-950/30',
  red: 'border-red-300 bg-red-50 dark:bg-red-950/30',
  violet: 'border-violet-300 bg-violet-50 dark:bg-violet-950/30',
  pink: 'border-pink-300 bg-pink-50 dark:bg-pink-950/30',
};

const PILL_COLOR: Record<string, string> = {
  zinc: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300',
  blue: 'bg-blue-200 text-blue-800 dark:bg-blue-800/50 dark:text-blue-300',
  amber: 'bg-amber-200 text-amber-800 dark:bg-amber-800/50 dark:text-amber-300',
  green: 'bg-green-200 text-green-800 dark:bg-green-800/50 dark:text-green-300',
  red: 'bg-red-200 text-red-800 dark:bg-red-800/50 dark:text-red-300',
  violet: 'bg-violet-200 text-violet-800 dark:bg-violet-800/50 dark:text-violet-300',
  pink: 'bg-pink-200 text-pink-800 dark:bg-pink-800/50 dark:text-pink-300',
};

interface Props {
  stage: PipelineStage;
  cards: CardSummary[];
  onAddCard: () => void;
  onCardClick: (card: CardSummary) => void;
}

export function KanbanColumn({ stage, cards, onAddCard, onCardClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
    data: { type: 'stage', stage },
  });

  const colorKey = stage.color ?? 'zinc';
  const headerCls = STAGE_COLOR[colorKey] ?? STAGE_COLOR.zinc;
  const pillCls = PILL_COLOR[colorKey] ?? PILL_COLOR.zinc;
  const totalValue = cards.reduce((acc, c) => {
    const n = typeof c.value === 'string' ? parseFloat(c.value) : c.value ?? 0;
    return acc + (Number.isFinite(n) ? (n as number) : 0);
  }, 0);
  const totalLabel =
    totalValue > 0
      ? new Intl.NumberFormat('pt-BR', {
          style: 'currency',
          currency: 'BRL',
          maximumFractionDigits: 0,
        }).format(totalValue)
      : null;

  return (
    <div className="flex h-full w-72 shrink-0 flex-col">
      <div
        className={`flex items-center justify-between gap-2 rounded-t-lg border-b-2 px-3 py-2 ${headerCls}`}
      >
        <div className="flex min-w-0 items-center gap-2">
          {stage.type === 'WON' && (
            <Trophy className="h-3.5 w-3.5 shrink-0 text-green-600" />
          )}
          {stage.type === 'LOST' && (
            <XIcon className="h-3.5 w-3.5 shrink-0 text-red-600" />
          )}
          <span className="truncate text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-200">
            {stage.name}
          </span>
          <span
            className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold ${pillCls}`}
          >
            {cards.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onAddCard}
          className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/50 hover:text-zinc-900 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
          aria-label="Adicionar conversa"
          title="Adicionar conversa nessa stage"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 space-y-2 overflow-y-auto rounded-b-lg p-2 transition-colors ${
          isOver
            ? 'bg-primary/10 ring-2 ring-primary/30'
            : 'bg-zinc-50/40 dark:bg-zinc-900/40'
        }`}
      >
        {cards.length === 0 && (
          <p className="py-6 text-center text-[11px] text-zinc-400">
            Sem conversas. Click no + pra adicionar.
          </p>
        )}
        {cards.map((c) => (
          <KanbanCard key={c.id} card={c} onClick={() => onCardClick(c)} />
        ))}
        {totalLabel && (
          <p className="pt-2 text-center text-[10px] uppercase tracking-wide text-zinc-400">
            Total: {totalLabel}
          </p>
        )}
      </div>
    </div>
  );
}
