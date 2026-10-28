'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Search, Users, MessageSquare, PackageSearch, Bot, BotOff } from 'lucide-react';
import { useOrgId } from '@/hooks/use-org-query-key';
import { Avatar } from '@/components/ui/avatar';
import { formatWhen, groupMonitorService } from '@/features/group-monitor/group-monitor.service';

/** Grupos de WhatsApp em que o número está, com a última mensagem e as consultas de pedido. */
export default function GroupsPage() {
  const orgId = useOrgId();
  const [search, setSearch] = useState('');

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['group-monitor', 'groups', orgId],
    queryFn: () => groupMonitorService.groups(),
    refetchInterval: 30_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? groups.filter((g) => g.name.toLowerCase().includes(q)) : groups;
  }, [groups, search]);

  const totalQueries = groups.reduce((n, g) => n + g.orderQueries, 0);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col p-6">
      <div className="mx-auto w-full max-w-5xl shrink-0">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Grupos</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {isLoading ? 'Carregando...' : `${groups.length} grupos · ${totalQueries} consultas de pedido`}
        </p>

        <div className="relative mt-6">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Buscar grupo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-white py-2.5 pl-10 pr-4 text-sm placeholder:text-zinc-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>
      </div>

      <div className="mx-auto mt-4 w-full max-w-5xl min-h-0 flex-1 overflow-y-auto">
        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
            <Users className="h-10 w-10 text-zinc-300" />
            <p className="mt-3 text-sm font-medium text-zinc-600 dark:text-zinc-300">
              {groups.length === 0 ? 'Nenhum grupo ainda' : 'Nenhum grupo encontrado'}
            </p>
            {groups.length === 0 && (
              <p className="mt-1 max-w-sm text-xs text-zinc-500">
                Os grupos aparecem aqui quando chega a primeira mensagem neles pelo número conectado
                (Configurações → Canais).
              </p>
            )}
          </div>
        )}

        <ul className="space-y-2">
          {filtered.map((g) => (
            <li
              key={g.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start gap-3">
                <Avatar src={g.avatarUrl} initials={g.name.slice(0, 2).toUpperCase()} className="size-10 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-zinc-900 dark:text-zinc-100">{g.name}</span>
                    {g.aiEnabled === false ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800">
                        <BotOff className="h-3 w-3" /> IA desligada
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        <Bot className="h-3 w-3" /> IA ativa
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-xs text-zinc-400">{formatWhen(g.lastMessageAt)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-400">{g.channel.name}</p>
                  {g.lastMessage && (
                    <p className="mt-2 truncate text-sm text-zinc-600 dark:text-zinc-300">
                      <span className="font-medium">
                        {g.lastMessage.direction === 'OUTBOUND' ? 'IA' : g.lastMessage.senderName ?? 'Participante'}:
                      </span>{' '}
                      {g.lastMessage.text ?? '[mídia]'}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Link
                      href={`/inbox?conversationId=${g.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      <MessageSquare className="h-3.5 w-3.5" /> Mensagens
                    </Link>
                    <Link
                      href={`/order-queries?conversationId=${g.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      <PackageSearch className="h-3.5 w-3.5" /> {g.orderQueries} consultas
                    </Link>
                    {g.lastOrderQueryAt && (
                      <span className="text-xs text-zinc-400">última {formatWhen(g.lastOrderQueryAt)}</span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
