'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, MessageSquare, PackageSearch, Search, X } from 'lucide-react';
import { useOrgId } from '@/hooks/use-org-query-key';
import {
  formatWhen,
  groupMonitorService,
  type OrderQuery,
  type QueryOutcome,
} from '@/features/group-monitor/group-monitor.service';

const OUTCOME: Record<QueryOutcome, { label: string; className: string }> = {
  found: { label: 'Encontrado', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  'not-found': { label: 'Não encontrado', className: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  unverified: { label: 'Pediu confirmação', className: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300' },
  error: { label: 'Erro na consulta', className: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' },
  unknown: { label: 'Consultado', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300' },
};

const TOOL_LABEL: Record<string, string> = {
  consultar_pedido: 'Pedido',
  pedidos_do_cliente: 'Pedidos do cliente',
  status_entrega: 'Entrega',
  consultar_ativacoes: 'Ativação',
  consultar_seguro: 'Seguro',
};

/** Pedidos que a IA consultou nos grupos: quem pediu, o que achou e o que respondeu. */
export default function OrderQueriesPage() {
  const orgId = useOrgId();
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversationId = searchParams?.get('conversationId') ?? undefined;
  const [orderId, setOrderId] = useState('');
  const [page, setPage] = useState(1);

  const { data: groups = [] } = useQuery({
    queryKey: ['group-monitor', 'groups', orgId],
    queryFn: () => groupMonitorService.groups(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['group-monitor', 'order-queries', orgId, conversationId, orderId, page],
    queryFn: () => groupMonitorService.orderQueries({ conversationId, orderId, page }),
    refetchInterval: 30_000,
  });

  const items = data?.items ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  const setGroup = (id: string) => {
    setPage(1);
    router.replace(id ? `/order-queries?conversationId=${id}` : '/order-queries');
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col p-6">
      <div className="mx-auto w-full max-w-5xl shrink-0">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Pedidos consultados</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {data ? `${data.total} consultas da IA nos grupos` : 'Carregando...'}
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <select
            value={conversationId ?? ''}
            onChange={(e) => setGroup(e.target.value)}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 sm:w-72"
          >
            <option value="">Todos os grupos</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              inputMode="numeric"
              placeholder="Número do pedido..."
              value={orderId}
              onChange={(e) => {
                setOrderId(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-zinc-200 bg-white py-2.5 pl-10 pr-9 text-sm placeholder:text-zinc-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
            {orderId && (
              <button
                type="button"
                onClick={() => setOrderId('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                aria-label="Limpar"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto mt-4 w-full max-w-5xl min-h-0 flex-1 overflow-y-auto">
        {!isLoading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
            <PackageSearch className="h-10 w-10 text-zinc-300" />
            <p className="mt-3 text-sm font-medium text-zinc-600 dark:text-zinc-300">Nenhuma consulta de pedido</p>
          </div>
        )}
        <ul className="space-y-2">
          {items.map((q) => (
            <QueryRow key={q.id} query={q} />
          ))}
        </ul>

        {pages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-3 text-sm">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
            >
              Anterior
            </button>
            <span className="text-zinc-500">
              {page} de {pages}
            </span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
            >
              Próxima
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function QueryRow({ query: q }: { query: OrderQuery }) {
  const [open, setOpen] = useState(false);
  const outcome = OUTCOME[q.outcome];
  const status = q.orders.find((o) => o.id === q.orderId)?.status ?? q.orders[0]?.status ?? null;

  return (
    <li className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {q.orderId ? `#${q.orderId}` : 'Sem número'}
            </span>
            <span className="text-xs text-zinc-400">{TOOL_LABEL[q.tool] ?? q.tool}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${outcome.className}`}>
              {outcome.label}
            </span>
            {status && <span className="text-xs text-zinc-600 dark:text-zinc-300">Status: {status}</span>}
          </div>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {q.conversation.name ?? 'Conversa'}
            {q.askedBy ? ` · pedido por ${q.askedBy}` : ''}
          </p>
        </div>
        <span className="shrink-0 text-xs text-zinc-400">{formatWhen(q.createdAt)}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-zinc-100 px-4 py-3 text-sm dark:border-zinc-800">
          {q.question && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                Pergunta{q.askedBy ? ` — ${q.askedBy}` : ''}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-200">{q.question}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Resposta da IA{q.repliedAt ? ` — ${formatWhen(q.repliedAt)}` : ''}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-200">
              {q.reply ?? 'Sem resposta enviada nesta execução.'}
            </p>
          </div>
          {q.orders.length > 1 && (
            <p className="text-xs text-zinc-500">
              Pedidos retornados: {q.orders.map((o) => `#${o.id}${o.status ? ` (${o.status})` : ''}`).join(', ')}
            </p>
          )}
          <Link
            href={`/inbox?conversationId=${q.conversation.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <MessageSquare className="h-3.5 w-3.5" /> Abrir conversa
          </Link>
        </div>
      )}
    </li>
  );
}
