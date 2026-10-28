'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Zap, Search, Loader2, Lock, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  quickRepliesService,
  QUICK_REPLY_VARIABLES,
  type QuickReply,
  type QuickReplyInput,
} from '@/features/settings/services/quick-replies.service';
import { useOrgId } from '@/hooks/use-org-query-key';
import { useConfirm } from '@/components/ui/dialogs';
import { MemberAvatar } from '@/components/ui/member-avatar';
import { useAuthStore } from '@/stores/auth-store';

const EMPTY: QuickReplyInput = { shortcut: '', title: '', content: '', isPrivate: false };

export default function SettingsQuickRepliesPage() {
  const queryClient = useQueryClient();
  const orgId = useOrgId();
  const confirm = useConfirm();
  const userId = useAuthStore((s) => s.user?.id);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const { data: replies, isLoading } = useQuery({
    queryKey: ['quick-replies', orgId],
    queryFn: () => quickRepliesService.list(),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['quick-replies'] });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/^\//, '');
    if (!q) return replies ?? [];
    return (replies ?? []).filter(
      (r) =>
        r.shortcut.includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.content.toLowerCase().includes(q),
    );
  }, [replies, search]);

  const handleCreate = async (input: QuickReplyInput) => {
    await quickRepliesService.create(input);
    toast.success('Resposta rápida criada');
    setCreating(false);
    refresh();
  };

  const handleUpdate = async (id: string, input: QuickReplyInput) => {
    await quickRepliesService.update(id, input);
    toast.success('Resposta rápida atualizada');
    setEditingId(null);
    refresh();
  };

  const handleDelete = async (reply: QuickReply) => {
    if (
      !(await confirm({
        title: `Apagar /${reply.shortcut}?`,
        description: reply.isPrivate ? 'Sua resposta pessoal será apagada.' : 'Some para toda a equipe.',
        confirmText: 'Apagar',
        tone: 'danger',
      }))
    )
      return;
    try {
      await quickRepliesService.remove(reply.id);
      toast.success('Resposta rápida apagada');
      refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao apagar');
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Respostas rápidas</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Textos padrão da equipe ou só seus. No inbox, use o botão{' '}
            <Zap className="inline h-3.5 w-3.5 align-[-2px]" /> ao lado da caixa de mensagem ou digite{' '}
            <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800">/atalho</code>.
          </p>
        </div>
        {!creating && (
          <button
            onClick={() => {
              setCreating(true);
              setEditingId(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Nova resposta
          </button>
        )}
      </div>

      {creating && (
        <div className="mt-6">
          <QuickReplyForm initial={EMPTY} submitLabel="Criar" onSubmit={handleCreate} onCancel={() => setCreating(false)} />
        </div>
      )}

      {(replies?.length ?? 0) > 5 && (
        <div className="relative mt-6">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por atalho, título ou texto…"
            className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
      )}

      <div className="mt-4 space-y-2">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg border bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900" />
          ))
        ) : !replies?.length ? (
          !creating && (
            <div className="flex flex-col items-center py-12 text-center">
              <Zap className="h-10 w-10 text-zinc-200 dark:text-zinc-700" />
              <p className="mt-3 text-sm text-zinc-500">Nenhuma resposta rápida cadastrada</p>
            </div>
          )
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">Nada encontrado para “{search}”</p>
        ) : (
          filtered.map((reply) =>
            editingId === reply.id ? (
              <QuickReplyForm
                key={reply.id}
                initial={{ shortcut: reply.shortcut, title: reply.title, content: reply.content, isPrivate: reply.isPrivate }}
                // Só quem cadastrou muda para quem aparece (antigas sem autor: qualquer um).
                canChangeVisibility={!reply.createdBy || reply.createdBy.id === userId}
                submitLabel="Salvar"
                onSubmit={(input) => handleUpdate(reply.id, input)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <QuickReplyRow
                key={reply.id}
                reply={reply}
                onEdit={() => {
                  setEditingId(reply.id);
                  setCreating(false);
                }}
                onDelete={() => handleDelete(reply)}
              />
            ),
          )
        )}
      </div>
    </div>
  );
}

function QuickReplyRow({
  reply,
  onEdit,
  onDelete,
}: {
  reply: QuickReply;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const date = new Date(reply.createdAt).toLocaleDateString('pt-BR');
  return (
    <div className="group rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">/{reply.shortcut}</code>
            <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{reply.title}</span>
            {reply.isPrivate ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                <Lock className="h-2.5 w-2.5" /> Só para mim
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                <Users className="h-2.5 w-2.5" /> Todos
              </span>
            )}
          </div>
          <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap break-words text-sm text-zinc-600 dark:text-zinc-400">
            {reply.content}
          </p>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-400">
            {reply.createdBy ? (
              <>
                <MemberAvatar name={reply.createdBy.name} avatarUrl={reply.createdBy.avatarUrl} size={16} />
                <span>
                  Cadastrado por <span className="font-medium text-zinc-500 dark:text-zinc-300">{reply.createdBy.name}</span> em {date}
                </span>
              </>
            ) : (
              <span>Cadastrado em {date}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            onClick={onEdit}
            className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
            aria-label="Editar"
            title="Editar"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
            aria-label="Apagar"
            title="Apagar"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickReplyForm({
  initial,
  canChangeVisibility = true,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: QuickReplyInput;
  canChangeVisibility?: boolean;
  submitLabel: string;
  onSubmit: (input: QuickReplyInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [shortcut, setShortcut] = useState(initial.shortcut);
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const [isPrivate, setIsPrivate] = useState(initial.isPrivate);
  const [saving, setSaving] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  const normalized = shortcut.trim().replace(/^\/+/, '').toLowerCase().replace(/\s+/g, '-');
  const valid = !!normalized && !!title.trim() && !!content.trim();

  const insertVariable = (key: string) => {
    const el = contentRef.current;
    const start = el?.selectionStart ?? content.length;
    const end = el?.selectionEnd ?? content.length;
    setContent(content.slice(0, start) + key + content.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + key.length, start + key.length);
    });
  };

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onSubmit({ shortcut: normalized, title: title.trim(), content, isPrivate });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const input =
    'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';

  return (
    <div className="rounded-lg border border-primary/40 bg-white p-4 shadow-sm dark:bg-zinc-900">
      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <div>
          <label htmlFor={`${id}-shortcut`} className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Atalho</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">/</span>
            <input
              id={`${id}-shortcut`}
              autoFocus
              value={shortcut.replace(/^\/+/, '')}
              onChange={(e) => setShortcut(e.target.value)}
              maxLength={40}
              placeholder="pix"
              className={`${input} pl-6`}
            />
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-title`} className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Título</label>
          <input
            id={`${id}-title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            placeholder="Ex: Chave Pix para pagamento"
            className={input}
          />
        </div>
      </div>
      <div className="mt-3">
        <label htmlFor={`${id}-content`} className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Texto</label>
        <textarea
          ref={contentRef}
          id={`${id}-content`}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={4000}
          rows={5}
          placeholder="Olá {nome}! Segue a chave Pix: ..."
          className={`${input} resize-y`}
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
          <span>Inserir:</span>
          {QUICK_REPLY_VARIABLES.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => insertVariable(v.key)}
              title={v.description}
              className="rounded border border-zinc-200 px-1.5 py-0.5 font-mono hover:border-primary hover:text-primary dark:border-zinc-700"
            >
              {v.key}
            </button>
          ))}
          <span className="text-zinc-400">— {QUICK_REPLY_VARIABLES.map((v) => `${v.key} = ${v.description.toLowerCase()}`).join(' · ')}</span>
        </div>
      </div>
      <div className="mt-3">
        <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Para quem aparece</span>
        <div role="radiogroup" className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700">
          {[
            { value: false, label: 'Todos', hint: 'Toda a equipe vê e usa', Icon: Users },
            { value: true, label: 'Só para mim', hint: 'Só você vê e usa', Icon: Lock },
          ].map(({ value, label, hint, Icon }) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={isPrivate === value}
              disabled={!canChangeVisibility}
              onClick={() => setIsPrivate(value)}
              title={canChangeVisibility ? hint : 'Só quem cadastrou pode mudar'}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
                isPrivate === value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          {isPrivate ? 'Só você vê esta resposta, aqui e no inbox.' : 'Toda a equipe vê e pode usar esta resposta.'}
        </p>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          Cancelar
        </button>
        <button
          onClick={submit}
          disabled={!valid || saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
