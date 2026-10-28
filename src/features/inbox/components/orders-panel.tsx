'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ChevronDown, Loader2, Package, RefreshCw, ShoppingBag, X } from 'lucide-react';
import { inboxService, type CustomerOrders } from '../services/inbox.service';

/**
 * Painel lateral do inbox com os pedidos do contato no Pedido Central,
 * achados pelo número da conversa (mesmo layout do Histórico do contato).
 */
export function OrdersPanel({
  conversationId,
  contactName,
  onClose,
}: {
  conversationId: string;
  contactName: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['conversation-orders', conversationId];
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey,
    queryFn: () => inboxService.getCustomerOrders(conversationId),
    staleTime: 60_000,
  });
  const [refreshing, setRefreshing] = useState(false);

  // Atualizar ignora o cache de 5 min do servidor.
  const refresh = async () => {
    setRefreshing(true);
    try {
      queryClient.setQueryData(queryKey, await inboxService.getCustomerOrders(conversationId, true));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex min-w-0 items-center gap-2">
          <ShoppingBag className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Pedidos</p>
            <p className="truncate text-[11px] text-zinc-400">
              {data?.phone ? `Pedido Central · ${data.phone}` : (contactName ?? 'Pedido Central')}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={refresh}
            disabled={refreshing || isFetching}
            title="Buscar de novo"
            aria-label="Buscar de novo"
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-50 dark:hover:bg-zinc-800"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            aria-label="Fechar pedidos"
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading || refreshing ? (
          <div className="flex flex-col items-center gap-2 py-10 text-xs text-zinc-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            Buscando no Pedido Central…
          </div>
        ) : error || !data ? (
          <Notice tone="error">Não foi possível buscar os pedidos agora.</Notice>
        ) : (
          <OrdersBody data={data} />
        )}
      </div>
    </aside>
  );
}

function OrdersBody({ data }: { data: CustomerOrders }) {
  switch (data.status) {
    case 'no-phone':
      return <Notice>Este contato não tem telefone para buscar no Pedido Central.</Notice>;
    case 'not-configured':
      return (
        <Notice tone="warn">
          O Pedido Central não está configurado.{' '}
          <Link href="/ai-agents?tab=tools" className="font-medium underline">
            Jarvis → Tools
          </Link>
        </Notice>
      );
    case 'error':
      return <Notice tone="error">Erro ao consultar o Pedido Central{data.message ? `: ${data.message}` : ''}.</Notice>;
    case 'not-found':
      return (
        <Notice>
          Nenhum cliente com este telefone no Pedido Central. Ele pode ter comprado com outro número — peça o
          número do pedido, CPF ou e-mail.
          <span className="mt-2 block text-[10px] text-zinc-400">Formatos buscados: {data.tried.join(' · ')}</span>
        </Notice>
      );
  }
  return (
    <div className="space-y-3">
      {data.customer && (
        <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs dark:bg-zinc-900">
          <p className="font-medium text-zinc-800 dark:text-zinc-200">{data.customer.name ?? 'Cliente'}</p>
          {data.customer.email && <p className="truncate text-zinc-500">{data.customer.email}</p>}
          {data.customer.cpf && <p className="text-zinc-500">CPF {data.customer.cpf}</p>}
        </div>
      )}
      {data.orders.length === 0 ? (
        <Notice>Cliente encontrado, mas sem pedidos.</Notice>
      ) : (
        <>
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
            {data.orders.length} {data.orders.length === 1 ? 'pedido' : 'pedidos'}
          </p>
          {data.orders.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </>
      )}
      <p className="text-center text-[10px] text-zinc-400">
        Atualizado às{' '}
        {new Date(data.fetchedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      </p>
    </div>
  );
}

function OrderCard({ order }: { order: CustomerOrders['orders'][number] }) {
  const [open, setOpen] = useState(false);
  const date = order.date && !Number.isNaN(Date.parse(order.date)) ? new Date(order.date).toLocaleDateString('pt-BR') : order.date;
  const total = money(order.total);
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Package className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">#{order.id}</span>
          {order.status && <StatusBadge status={order.status} />}
        </div>
        {order.items.length > 0 && (
          <ul className="mt-2 space-y-2">
            {order.items.map((it, i) => (
              <li key={i} className="text-xs">
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-300">
                    {it.quantity && it.quantity > 1 && (
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">{it.quantity}× </span>
                    )}
                    {it.name}
                  </span>
                  {it.total && <span className="shrink-0 text-[11px] text-zinc-400">{money(it.total)}</span>}
                </div>
                {(it.variants.length > 0 || it.sku) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {it.variants.map((v, j) => (
                      <span
                        key={j}
                        className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                      >
                        <span className="text-zinc-400">{v.label}:</span> {v.value}
                      </span>
                    ))}
                    {it.sku && <span className="px-0.5 py-0.5 text-[10px] text-zinc-400">SKU {it.sku}</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-400">
          <span>{date ?? ''}</span>
          <span className="font-medium text-zinc-600 dark:text-zinc-300">{total ?? ''}</span>
        </div>
      </div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-center gap-1 border-t border-zinc-100 py-1 text-[10px] text-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
      >
        {open ? 'Ocultar detalhes' : 'Ver todos os dados'}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto border-t border-zinc-100 bg-zinc-50 p-2 text-[10px] leading-snug text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          {JSON.stringify(order.raw, null, 2)}
        </pre>
      )}
    </div>
  );
}

/** "189.00" → "R$ 189,00"; o que não é número aparece como veio. */
function money(value: string | null): string | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isNaN(n) ? value : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Status do WooCommerce em português; outros aparecem como vieram. */
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Aguardando pagamento', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  processing: { label: 'Processando', cls: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  'on-hold': { label: 'Aguardando', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  completed: { label: 'Concluído', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  cancelled: { label: 'Cancelado', cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800' },
  refunded: { label: 'Reembolsado', cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800' },
  failed: { label: 'Falhou', cls: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status.toLowerCase().replace(/^wc-/, '')];
  return (
    <span
      className={`ml-auto truncate rounded px-1.5 py-0.5 text-[10px] font-medium ${
        s?.cls ?? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
      }`}
    >
      {s?.label ?? status}
    </span>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'error' }) {
  const cls =
    tone === 'error'
      ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-400'
        : 'bg-zinc-50 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400';
  return <div className={`rounded-lg px-3 py-3 text-xs leading-relaxed ${cls}`}>{children}</div>;
}
