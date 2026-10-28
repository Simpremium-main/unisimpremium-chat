'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { AlertTriangle, X } from 'lucide-react';
import { notificationsSettingsService } from '@/features/settings/services/notifications.service';

/**
 * Persistent banner shown app-wide whenever there are unread
 * AI_TOOL_FAILURE notifications. Polls every 30s. Click "Marcar como
 * vistas" to dismiss all related notifications. The point is to make
 * silent IA failures impossible to miss — without this, the Lívia 404
 * case (run completes "successfully" while the skill output is broken)
 * stays invisible until a customer complains.
 */
export function ToolFailureBanner() {
  const queryClient = useQueryClient();

  const { data: notif } = useQuery({
    queryKey: ['notifications', 'tool-failures'],
    queryFn: async () => {
      const r = await notificationsSettingsService.list(1, 50);
      return r.notifications.filter(
        (n) => n.type === 'AI_TOOL_FAILURE' && !n.isRead,
      );
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const markAll = useMutation({
    mutationFn: async () => {
      const ids = (notif ?? []).map((n) => n.id);
      // Don't blast `markAllRead` — that would dismiss unrelated notifs
      // (new message, mention, etc) the user actually wants to see.
      await Promise.all(
        ids.map((id) => notificationsSettingsService.markRead(id)),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const count = notif?.length ?? 0;
  const headline = useMemo(() => {
    if (count === 0) return null;
    const last = notif![0];
    if (count === 1) return last.title;
    return `${count} skills falharam — última: ${last.title}`;
  }, [count, notif]);

  if (count === 0) return null;

  return (
    <div className="border-b border-red-200 bg-red-50 px-6 py-2.5 dark:border-red-900/40 dark:bg-red-900/20">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400" />
        <div className="flex-1 text-sm text-red-800 dark:text-red-200">
          <span className="font-medium">{headline}</span>
          {notif && notif[0]?.body && (
            <span className="ml-2 text-red-700 dark:text-red-300">
              · {notif[0].body}
            </span>
          )}
        </div>
        <Link
          href="/ai-agents?tab=runs"
          className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
        >
          Ver execuções
        </Link>
        <button
          type="button"
          onClick={() => markAll.mutate()}
          disabled={markAll.isPending}
          className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {markAll.isPending ? 'Marcando…' : 'Marcar como vistas'}
        </button>
        <button
          type="button"
          onClick={() => markAll.mutate()}
          className="text-red-500 hover:text-red-700 dark:text-red-400"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
