'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search,
  Users,
  MessageSquare,
  PackageSearch,
  Bot,
  BotOff,
  RefreshCw,
  Building2,
  LogOut,
} from 'lucide-react';
import { useOrgId } from '@/hooks/use-org-query-key';
import { Avatar } from '@/components/ui/avatar';
import {
  formatWhen,
  groupMonitorService,
  type MonitoredGroup,
} from '@/features/group-monitor/group-monitor.service';

const NO_PARTNER = '__none__';

/** Grupos de WhatsApp em que o número está, com o parceiro, a última mensagem e as consultas de pedido. */
export default function GroupsPage() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [partnerFilter, setPartnerFilter] = useState('');
  const queryKey = ['group-monitor', 'groups', orgId];

  const { data: groups = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => groupMonitorService.groups(),
    refetchInterval: 30_000,
  });

  const sync = useMutation({
    mutationFn: () => groupMonitorService.syncGroups(),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey });
      if (r.channels === 0) {
        toast.error('Nenhum número de WhatsApp (Zappfy) conectado em Configurações → Canais.');
        return;
      }
      const parts = [`${r.groups} grupos`];
      if (r.created) parts.push(`${r.created} novos`);
      if (r.left) parts.push(`saiu de ${r.left}`);
      toast.success(`Grupos atualizados: ${parts.join(' · ')}`);
      r.errors.forEach((e) => toast.error(`${e.channel}: ${e.message}`));
    },
    onError: () => toast.error('Não foi possível buscar os grupos no WhatsApp.'),
  });

  const partners = useMemo(
    () => [...new Set(groups.map((g) => g.partner).filter((p): p is string => !!p))].sort(),
    [groups],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (q && !g.name.toLowerCase().includes(q) && !(g.partner ?? '').toLowerCase().includes(q)) return false;
      if (partnerFilter === NO_PARTNER) return !g.partner;
      if (partnerFilter) return g.partner === partnerFilter;
      return true;
    });
  }, [groups, search, partnerFilter]);

  const active = groups.filter((g) => !g.left).length;
  const withoutPartner = groups.filter((g) => !g.left && !g.partner).length;
  const totalQueries = groups.reduce((n, g) => n + g.orderQueries, 0);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col p-6">
      <div className="mx-auto w-full max-w-5xl shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Grupos</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {isLoading
                ? 'Carregando...'
                : `${active} grupos · ${withoutPartner} sem parceiro · ${totalQueries} consultas de pedido`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${sync.isPending ? 'animate-spin' : ''}`} />
            {sync.isPending ? 'Buscando grupos...' : 'Atualizar grupos'}
          </button>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar grupo ou parceiro..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 bg-white py-2.5 pl-10 pr-4 text-sm placeholder:text-zinc-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
          <select
            value={partnerFilter}
            onChange={(e) => setPartnerFilter(e.target.value)}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 sm:w-56"
          >
            <option value="">Todos os parceiros</option>
            <option value={NO_PARTNER}>Sem parceiro</option>
            {partners.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
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
                Clique em “Atualizar grupos” para trazer todos os grupos do número conectado
                (Configurações → Canais).
              </p>
            )}
          </div>
        )}

        <datalist id="group-partners">
          {partners.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>

        <ul className="space-y-2">
          {filtered.map((g) => (
            <GroupCard key={g.id} group={g} onSaved={() => queryClient.invalidateQueries({ queryKey })} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function GroupCard({ group: g, onSaved }: { group: MonitoredGroup; onSaved: () => void }) {
  return (
    <li
      className={`rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 ${g.left ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-3">
        <Avatar src={g.avatarUrl} initials={g.name.slice(0, 2).toUpperCase()} className="size-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold text-zinc-900 dark:text-zinc-100">{g.name}</span>
            {g.left ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] text-red-700 dark:bg-red-950 dark:text-red-300">
                <LogOut className="h-3 w-3" /> Número saiu do grupo
              </span>
            ) : g.aiEnabled === false ? (
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
          <p className="mt-0.5 text-xs text-zinc-400">
            {g.channel.name}
            {g.participants != null ? ` · ${g.participants} participantes` : ''}
          </p>

          <PartnerField group={g} onSaved={onSaved} />

          {g.lastMessage ? (
            <p className="mt-2 truncate text-sm text-zinc-600 dark:text-zinc-300">
              <span className="font-medium">
                {g.lastMessage.direction === 'OUTBOUND' ? 'IA' : g.lastMessage.senderName ?? 'Participante'}:
              </span>{' '}
              {g.lastMessage.text ?? '[mídia]'}
            </p>
          ) : (
            <p className="mt-2 text-sm text-zinc-400">Sem mensagens ainda</p>
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
            {g.lastOrderQueryAt && <span className="text-xs text-zinc-400">última {formatWhen(g.lastOrderQueryAt)}</span>}
          </div>
        </div>
      </div>
    </li>
  );
}

/** Parceiro do grupo: digita ou escolhe um já usado; salva ao sair do campo ou com Enter. */
function PartnerField({ group, onSaved }: { group: MonitoredGroup; onSaved: () => void }) {
  const [value, setValue] = useState(group.partner ?? '');
  useEffect(() => setValue(group.partner ?? ''), [group.partner]);

  const save = useMutation({
    mutationFn: (partner: string | null) => groupMonitorService.setPartner(group.id, partner),
    onSuccess: () => {
      onSaved();
      toast.success('Parceiro salvo');
    },
    onError: () => toast.error('Não foi possível salvar o parceiro.'),
  });

  const commit = () => {
    const next = value.trim();
    if (next === (group.partner ?? '')) return;
    save.mutate(next || null);
  };

  return (
    <label className="mt-2 flex items-center gap-2">
      <Building2 className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
      <input
        type="text"
        list="group-partners"
        maxLength={80}
        placeholder="Parceiro do grupo..."
        value={value}
        disabled={save.isPending}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setValue(group.partner ?? '');
        }}
        className={`w-full max-w-xs rounded-md border px-2 py-1 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:bg-zinc-900 dark:text-zinc-100 ${
          group.partner ? 'border-zinc-200 dark:border-zinc-700' : 'border-amber-300 dark:border-amber-700'
        }`}
      />
    </label>
  );
}
