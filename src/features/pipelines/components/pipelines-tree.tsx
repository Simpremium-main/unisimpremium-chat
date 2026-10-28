'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  KanbanSquare,
  ChevronDown,
  ChevronRight,
  Plus,
  Star,
  Filter,
} from 'lucide-react';
import { pipelinesService } from '../services/pipelines.service';

const STORAGE_KEY = 'pipelines-tree-expanded';

const COLOR_CLS: Record<string, string> = {
  default: 'text-zinc-500 dark:text-zinc-400',
  green: 'text-green-600 dark:text-green-400',
  pink: 'text-pink-600 dark:text-pink-400',
  violet: 'text-violet-600 dark:text-violet-400',
  blue: 'text-blue-600 dark:text-blue-400',
  amber: 'text-amber-600 dark:text-amber-400',
  red: 'text-red-600 dark:text-red-400',
};

/**
 * Sidebar tree for Pipelines — header opens the list page, children are
 * each non-archived pipeline going to /pipelines/[id]. Mirrors the
 * pattern of InboxTree / JarvisTree so the user gets a consistent
 * navigation surface across the app.
 */
export function PipelinesTree() {
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(STORAGE_KEY) !== '0';
  });

  const { data: pipelines = [] } = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => pipelinesService.list(),
    staleTime: 60_000,
  });

  const visible = pipelines.filter((p) => !p.archived);

  const isPipelinesRoot = pathname === '/pipelines';
  const activePipelineId = (() => {
    const m = pathname?.match(/^\/pipelines\/([^/]+)/);
    return m?.[1] ?? null;
  })();
  const isPipelinesArea = !!pathname?.startsWith('/pipelines');

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    }
  };

  const goRoot = () => router.push('/pipelines');
  const goPipeline = (id: string) => router.push(`/pipelines/${id}`);

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={toggleExpanded}
          aria-label={expanded ? 'Recolher' : 'Expandir'}
          className="flex h-7 w-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-950/5 hover:text-zinc-700 dark:hover:bg-white/5 dark:hover:text-zinc-300"
        >
          {expanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={goRoot}
          className={`flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium ${
            isPipelinesArea
              ? 'bg-zinc-950/5 text-zinc-950 dark:bg-white/5 dark:text-white'
              : 'text-zinc-700 hover:bg-zinc-950/5 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-white/5 dark:hover:text-white'
          }`}
        >
          <KanbanSquare className="size-5" />
          <span className="flex-1">Pipelines</span>
        </button>
      </div>

      {expanded && (
        <div className="ml-5 space-y-0.5 border-l border-zinc-200 pl-2 dark:border-zinc-800">
          <button
            type="button"
            onClick={goRoot}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
              isPipelinesRoot
                ? 'bg-zinc-950/5 font-medium text-zinc-900 dark:bg-white/5 dark:text-white'
                : 'text-zinc-600 hover:bg-zinc-950/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white'
            }`}
          >
            <KanbanSquare className="size-3.5 text-zinc-400" />
            <span className="flex-1">Todos</span>
          </button>

          {visible.map((p) => {
            const isActive = activePipelineId === p.id;
            const colorCls = COLOR_CLS[p.color ?? 'default'] ?? COLOR_CLS.default;
            const Icon = p.isDefault ? Star : Filter;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => goPipeline(p.id)}
                title={p.name}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                  isActive
                    ? 'bg-zinc-950/5 font-medium text-zinc-900 dark:bg-white/5 dark:text-white'
                    : 'text-zinc-600 hover:bg-zinc-950/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white'
                }`}
              >
                <Icon className={`size-3.5 ${colorCls}`} />
                <span className="flex-1 truncate">{p.name}</span>
                {typeof p._count?.cards === 'number' && p._count.cards > 0 && (
                  <span className="text-[10px] text-zinc-400">
                    {p._count.cards}
                  </span>
                )}
              </button>
            );
          })}

          <button
            type="button"
            onClick={goRoot}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-950/5 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-white/5 dark:hover:text-white"
            title="Gerenciar pipelines"
          >
            <Plus className="size-3.5" />
            <span>Novo pipeline</span>
          </button>
        </div>
      )}
    </div>
  );
}
