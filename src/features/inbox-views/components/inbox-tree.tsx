'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Inbox,
  ChevronRight,
  ChevronDown,
  Plus,
  MessageSquare,
  Phone,
  Instagram,
  Mail,
  Send,
  Users,
  Tag,
  Star,
  Filter,
  Pencil,
  Trash2,
  CheckCircle,
  Bot,
  MailOpen,
  UserRoundCheck,
  Hourglass,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  inboxViewsService,
  type InboxView,
} from '../services/inbox-views.service';
import { InboxViewDialog } from './inbox-view-dialog';
import { useAuthStore } from '@/stores/auth-store';
import { useConfirm } from '@/components/ui/dialogs';
import { useSocket } from '@/features/inbox/hooks/use-socket';
import { setAppBadge } from '@/features/push/push';

/** Inboxes que somam no número do ícone do app (as mesmas do push). */
const APP_BADGE_INBOXES = ['Não respondidas'];

const VIEW_ICON: Record<string, any> = {
  Inbox,
  MessageSquare,
  Phone,
  Instagram,
  Mail,
  MailOpen,
  Send,
  Users,
  Tag,
  Star,
  Filter,
  CheckCircle,
  Bot,
  UserRoundCheck,
  Hourglass,
};

const COLOR_CLS: Record<string, string> = {
  default: 'text-zinc-500 dark:text-zinc-400',
  green: 'text-green-600 dark:text-green-400',
  pink: 'text-pink-600 dark:text-pink-400',
  violet: 'text-violet-600 dark:text-violet-400',
  blue: 'text-blue-600 dark:text-blue-400',
  amber: 'text-amber-600 dark:text-amber-400',
  red: 'text-red-600 dark:text-red-400',
};

const STORAGE_KEY = 'inbox-tree-expanded';
/** A página já foi aberta em "Aberto" neste carregamento (só na primeira vez). */
let openedOnLoad = false;

export function InboxTree() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();

  // Programmatic navigation that GUARANTEES the query string resets when
  // jumping back to "Geral" from a custom view. <Link href="/inbox"> on its
  // own keeps `?view=…` in the URL because Next treats same-pathname clicks
  // as a no-op for query params.
  //
  // Já na página da inbox, "Aberto" só tira o `?view=` pelo history nativo
  // (o Next sincroniza useSearchParams): no Safari, o router.push para
  // /inbox logo depois de carregar a página numa inbox não navegava.
  const goGeral = () => {
    if (window.location.pathname === '/inbox') window.history.pushState(null, '', '/inbox');
    else router.push('/inbox');
  };
  const goView = (id: string) => router.push(`/inbox?view=${id}`);
  // Ao entrar na página (carregamento completo), começa sempre em "Aberto".
  // Link de notificação (`?view=…&conversationId=…`) abre a inbox dela.
  useEffect(() => {
    if (openedOnLoad) return;
    const url = new URL(window.location.href);
    const inView = url.searchParams.has('view') || url.searchParams.has('tag');
    if (url.pathname !== '/inbox' || !inView || url.searchParams.has('conversationId')) {
      openedOnLoad = true;
      return;
    }
    url.searchParams.delete('view');
    url.searchParams.delete('tag');
    // Depois dos efeitos do próprio Next (é ele que liga o history ao
    // useSearchParams, e o efeito dele roda depois deste).
    const timer = window.setTimeout(() => {
      openedOnLoad = true;
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const [expanded, setExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(STORAGE_KEY) !== '0';
  });
  const [creating, setCreating] = useState(false);
  // Só admin cria inbox.
  const role = useAuthStore((s) => s.organizations.find((o) => o.id === s.activeOrgId)?.role);
  const isAdmin = role === 'OWNER' || role === 'ADMIN';
  const [editing, setEditing] = useState<InboxView | null>(null);

  const { data: views = [] } = useQuery({
    queryKey: ['inbox-views'],
    queryFn: () => inboxViewsService.list(),
    staleTime: 60000,
  });

  // Bolinha vermelha com o total em "Não respondidas".
  const { data: counts = {} } = useQuery({
    queryKey: ['inbox-view-counts'],
    queryFn: () => inboxViewsService.counts(),
    refetchInterval: 60_000,
    staleTime: 10_000,
    enabled: views.length > 0,
  });
  // Número no ícone do app (Tela de Início) acompanha as bolinhas.
  useEffect(() => {
    if (views.length === 0) return;
    const total = views
      .filter((v) => v.metadata?.builtin === true && APP_BADGE_INBOXES.includes(v.name))
      .reduce((sum, v) => sum + (counts[v.id] ?? 0), 0);
    setAppBadge(total);
  }, [views, counts]);

  // Mensagem nova, leitura ou mudança na conversa mexem nas contagens —
  // agrupa as rajadas numa recontagem só. O primeiro evento marca a
  // recontagem e os seguintes não a adiam: com mensagens chegando sem
  // parar, um debounce que reinicia a cada evento deixava as bolinhas
  // paradas até o movimento dar uma folga.
  const { on } = useSocket();
  const recountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const recount = () => {
      if (recountTimer.current) return;
      recountTimer.current = setTimeout(() => {
        recountTimer.current = null;
        qc.invalidateQueries({ queryKey: ['inbox-view-counts'] });
      }, 500);
    };
    const offs = ['message:new', 'conversation:updated', 'conversation:read'].map((ev) => on(ev, recount));
    return () => {
      offs.forEach((off) => off?.());
      if (recountTimer.current) clearTimeout(recountTimer.current);
    };
  }, [on, qc]);

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    }
  };

  const isInbox = pathname === '/inbox' || pathname?.startsWith('/inbox');
  const activeViewId = searchParams!.get('view');
  // Uma tag da seção Tags aberta: "Aberto" não fica marcado.
  const activeTagId = searchParams!.get('tag');

  const confirm = useConfirm();
  const handleDelete = async (view: InboxView) => {
    if (!(await confirm({ title: `Excluir a inbox "${view.name}"?`, tone: 'danger' }))) return;
    try {
      await inboxViewsService.remove(view.id);
      toast.success('Inbox removida');
      qc.invalidateQueries({ queryKey: ['inbox-views'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao excluir');
    }
  };

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
          onClick={goGeral}
          className={`flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium ${
            isInbox && !activeViewId && !activeTagId
              ? 'bg-zinc-950/5 text-zinc-950 dark:bg-white/5 dark:text-white'
              : 'text-zinc-700 hover:bg-zinc-950/5 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-white/5 dark:hover:text-white'
          }`}
        >
          <Inbox className="size-5" />
          <span className="flex-1">Inbox</span>
        </button>
      </div>

      {expanded && (
        <div className="ml-5 space-y-0.5 border-l border-zinc-200 pl-2 dark:border-zinc-800">
          <button
            type="button"
            onClick={goGeral}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
              isInbox && !activeViewId && !activeTagId
                ? 'bg-zinc-950/5 font-medium text-zinc-900 dark:bg-white/5 dark:text-white'
                : 'text-zinc-600 hover:bg-zinc-950/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white'
            }`}
          >
            <Inbox className="size-3.5 text-zinc-400" />
            <span className="flex-1">Aberto</span>
          </button>

          {views.map((v) => {
            const Icon = VIEW_ICON[v.icon ?? ''] ?? Filter;
            const colorCls = COLOR_CLS[v.color ?? 'default'] ?? COLOR_CLS.default;
            const isActive = activeViewId === v.id && isInbox;
            const isBuiltin = v.metadata?.builtin === true;
            return (
              <div
                key={v.id}
                className={`group flex items-center gap-1 rounded-md ${
                  isActive
                    ? 'bg-zinc-950/5 dark:bg-white/5'
                    : 'hover:bg-zinc-950/5 dark:hover:bg-white/5'
                }`}
              >
                <button
                  type="button"
                  onClick={() => goView(v.id)}
                  className={`flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                    isActive
                      ? 'font-medium text-zinc-900 dark:text-white'
                      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
                  }`}
                  title={v.name}
                >
                  <Icon className={`size-3.5 ${colorCls}`} />
                  <span className="flex-1 truncate">{v.name}</span>
                  {(counts[v.id] ?? 0) > 0 && (
                    <span
                      className="ml-auto min-w-[18px] shrink-0 rounded-full bg-red-500 px-1.5 text-center text-[10px] font-semibold leading-[18px] text-white"
                      aria-label={`${counts[v.id]} conversas`}
                    >
                      {counts[v.id] > 99 ? '99+' : counts[v.id]}
                    </span>
                  )}
                </button>
                {!isBuiltin && (
                  <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => setEditing(v)}
                      aria-label="Editar"
                      className="flex size-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-950/10 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-300"
                    >
                      <Pencil className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(v)}
                      aria-label="Excluir"
                      className="mr-1 flex size-6 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {isAdmin && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-950/5 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-white/5 dark:hover:text-white"
            >
              <Plus className="size-3.5" />
              <span>Nova inbox</span>
            </button>
          )}
        </div>
      )}

      <InboxViewDialog
        open={creating}
        view={null}
        onClose={() => setCreating(false)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['inbox-views'] });
          setCreating(false);
        }}
      />
      <InboxViewDialog
        open={!!editing}
        view={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['inbox-views'] });
          setEditing(null);
        }}
      />
    </div>
  );
}
