'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Tag as TagIcon } from 'lucide-react';
import { tagsService } from '@/features/settings/services/tags.service';
import { useSocket } from '@/features/inbox/hooks/use-socket';
import { inboxViewsService } from '../services/inbox-views.service';

const STORAGE_KEY = 'tags-tree-expanded';

/**
 * Seção "Tags" do menu: cada tag abre as conversas abertas com ela, sem as
 * que a IA está atendendo. Ao lado, quantas são (cinza) e quantas aguardam
 * resposta, em "Não respondidas" (vermelho).
 */
export function TagsTree() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(STORAGE_KEY) !== '0';
  });

  const { data: tags = [] } = useQuery({ queryKey: ['tags'], queryFn: () => tagsService.list(), staleTime: 60_000 });
  const { data: counts = {} } = useQuery({
    queryKey: ['tag-counts'],
    queryFn: () => inboxViewsService.tagCounts(),
    refetchInterval: 60_000,
    staleTime: 10_000,
    enabled: tags.length > 0,
  });

  // Mesma recontagem das bolinhas das inboxes: agrupa as rajadas de eventos.
  const { on } = useSocket();
  const recountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const recount = () => {
      if (recountTimer.current) return;
      recountTimer.current = setTimeout(() => {
        recountTimer.current = null;
        qc.invalidateQueries({ queryKey: ['tag-counts'] });
      }, 500);
    };
    const offs = ['message:new', 'conversation:updated', 'conversation:read'].map((ev) => on(ev, recount));
    return () => {
      offs.forEach((off) => off?.());
      if (recountTimer.current) clearTimeout(recountTimer.current);
    };
  }, [on, qc]);

  if (tags.length === 0) return null;

  const isInbox = pathname === '/inbox' || pathname?.startsWith('/inbox');
  const activeTagId = isInbox ? searchParams!.get('tag') : null;
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  };

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-0.5 rounded-lg text-left text-sm font-medium text-zinc-700 hover:bg-zinc-950/5 dark:text-zinc-300 dark:hover:bg-white/5"
      >
        <span className="flex h-7 w-5 items-center justify-center text-zinc-400">
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </span>
        <span className="flex flex-1 items-center gap-2 px-2 py-1.5">
          <TagIcon className="size-5" />
          <span className="flex-1">Tags</span>
        </span>
      </button>

      {expanded && (
        <div className="ml-5 space-y-0.5 border-l border-zinc-200 pl-2 dark:border-zinc-800">
          {tags.map((t) => {
            const isActive = activeTagId === t.id;
            const total = counts[t.id]?.total ?? 0;
            const waiting = counts[t.id]?.unanswered ?? 0;
            const fmt = (n: number) => (n > 99 ? '99+' : n);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => router.push(`/inbox?tag=${t.id}`)}
                title={t.name}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                  isActive
                    ? 'bg-zinc-950/5 font-medium text-zinc-900 dark:bg-white/5 dark:text-white'
                    : 'text-zinc-600 hover:bg-zinc-950/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white'
                }`}
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color || '#a1a1aa' }} />
                <span className="flex-1 truncate">{t.name}</span>
                {total > 0 && (
                  <span
                    className="ml-auto min-w-[18px] shrink-0 rounded-full bg-zinc-200 px-1.5 text-center text-[10px] font-semibold leading-[18px] text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
                    title={`${total} conversas abertas`}
                    aria-label={`${total} conversas abertas`}
                  >
                    {fmt(total)}
                  </span>
                )}
                {waiting > 0 && (
                  <span
                    className="min-w-[18px] shrink-0 rounded-full bg-red-500 px-1.5 text-center text-[10px] font-semibold leading-[18px] text-white"
                    title={`${waiting} aguardando resposta`}
                    aria-label={`${waiting} aguardando resposta`}
                  >
                    {fmt(waiting)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
