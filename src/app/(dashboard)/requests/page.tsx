'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ClipboardList, MessageSquare, PackageSearch, Search, X } from 'lucide-react';
import { useOrgId } from '@/hooks/use-org-query-key';
import {
  formatWhen,
  groupMonitorService,
  type GroupRequest,
  type QueryOutcome,
  type RequestStatus,
} from '@/features/group-monitor/group-monitor.service';

const STATUS: Record<RequestStatus, { label: string; className: string }> = {
  'answered-ai': { label: 'Respondida pela IA', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  'answered-human': { label: 'Respondida pela equipe', className: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300' },
  pending: { label: 'Sem resposta', className: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
};

const OUTCOME: Record<QueryOutcome, string> = {
  found: 'encontrado',
  'not-found': 'não encontrado',
  unverified: 'pediu confirmação',
  error: 'erro na consulta',
  unknown: 'consultado',
};

/** Todas as solicitações feitas à IA nos grupos: quem pediu, o quê, a resposta e os pedidos consultados. */
export default function RequestsPage() {
  const orgId = useOrgId();
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversationId = searchParams?.get('conversationId') ?? undefined;
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [partner, setPartner] = useState('');
  const [status, setStatus] = useState<RequestStatus | ''>('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data: groups = [] } = useQuery({
    queryKey: ['group-monitor', 'groups', orgId],
    queryFn: () => groupMonitorService.groups(),
  });
  const partners = [...new Set(groups.map((g) => g.partner).filter((p): p is string => !!p))].sort();

  const { data, isLoading } = useQuery({
    queryKey: ['group-monitor', 'requests', orgId, conversationId, debouncedQ, partner, status, page],
    queryFn: () => groupMonitorService.requests({ conversationId, q: debouncedQ, partner, status, page }),
    refetchInterval: 30_000,
  });

  const items = data?.items ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  const setGroup = (id: string) => {
    setPage(1);
    router.replace(id ? `/requests?conversationId=${id}` : '/requests');
  };

  const selectClass =
    'rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col p-6">
      <div className="mx-auto w-full max-w-5xl shrink-0">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Solicitações</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {data ? `${data.total} solicitações feitas à IA nos grupos` : 'Carregando...'}
        </p>

        <div className="mt-6 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar no texto ou por quem pediu..."
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-zinc-200 bg-white py-2.5 pl-10 pr-9 text-sm placeholder:text-zinc-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                aria-label="Limpar"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <select value={conversationId ?? ''} onChange={(e) => setGroup(e.target.value)} className={selectClass}>
            <option value="">Todos os grupos</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <select
            value={partner}
            onChange={(e) => {
              setPartner(e.target.value);
              setPage(1);
            }}
            className={selectClass}
          >
            <option value="">Todos os parceiros</option>
            {partners.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as RequestStatus | '');
              setPage(1);
            }}
            className={selectClass}
          >
            <option value="">Todas</option>
            <option value="answered-ai">Respondidas pela IA</option>
            <option value="answered-human">Respondidas pela equipe</option>
            <option value="pending">Sem resposta</option>
          </select>
        </div>
      </div>

      <div className="mx-auto mt-4 w-full max-w-5xl min-h-0 flex-1 overflow-y-auto">
        {!isLoading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
            <ClipboardList className="h-10 w-10 text-zinc-300" />
            <p className="mt-3 text-sm font-medium text-zinc-600 dark:text-zinc-300">Nenhuma solicitação</p>
            <p className="mt-1 max-w-sm text-xs text-zinc-500">
              Entram aqui as mensagens dos grupos dirigidas à IA: menção ao número, resposta a uma
              mensagem dela ou pergunta sobre pedido.
            </p>
          </div>
        )}
        <ul className="space-y-2">
          {items.map((r) => (
            <RequestRow key={r.id} request={r} />
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

function RequestRow({ request: r }: { request: GroupRequest }) {
  const [open, setOpen] = useState(false);
  const st = STATUS[r.status];
  const orders = r.lookups.filter((l) => l.orderId);

  return (
    <li className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        {open ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{r.askedBy ?? 'Participante'}</span>
            <span className="text-xs text-zinc-400">
              em {r.group.name ?? 'Grupo'}
              {r.group.partner ? ` · ${r.group.partner}` : ''}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.className}`}>{st.label}</span>
          </div>
          <p className={`mt-1 text-sm text-zinc-700 dark:text-zinc-200 ${open ? 'whitespace-pre-wrap' : 'truncate'}`}>
            {r.text ?? '[mídia]'}
          </p>
          {orders.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
              <PackageSearch className="h-3.5 w-3.5" />
              {orders
                .map((l) => `#${l.orderId} (${l.status ?? OUTCOME[l.outcome]})`)
                .filter((v, i, a) => a.indexOf(v) === i)
                .join(', ')}
            </p>
          )}
        </div>
        <span className="shrink-0 text-xs text-zinc-400">{formatWhen(r.createdAt)}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-zinc-100 px-4 py-3 text-sm dark:border-zinc-800">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              {r.reply ? `Resposta — ${r.reply.by ?? 'equipe'} · ${formatWhen(r.reply.at)}` : 'Resposta'}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-200">
              {r.reply ? r.reply.text ?? '[mídia]' : 'Ainda sem resposta no grupo.'}
            </p>
          </div>
          {r.lookups.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">Consultas da IA</p>
              <ul className="mt-1 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-300">
                {r.lookups.map((l, i) => (
                  <li key={i}>
                    {l.tool.replace(/_/g, ' ')}
                    {l.orderId ? ` #${l.orderId}` : ''} — {OUTCOME[l.outcome]}
                    {l.status ? ` · status: ${l.status}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Link
            href={`/inbox?conversationId=${r.group.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <MessageSquare className="h-3.5 w-3.5" /> Abrir grupo
          </Link>
        </div>
      )}
    </li>
  );
}
