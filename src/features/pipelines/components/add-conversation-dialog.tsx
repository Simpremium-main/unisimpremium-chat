'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Search, MessageSquare, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { pipelinesService } from '../services/pipelines.service';
import {
  inboxService,
  type Conversation,
} from '@/features/inbox/services/inbox.service';

interface Props {
  open: boolean;
  pipelineId: string;
  stageId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Adds an existing conversation to a kanban pipeline. The card is just a
 * pointer to the conversation — title/contact are auto-derived on the
 * backend so the operator only has to pick which conversation enters the
 * pipeline (and optionally set a value).
 */
export function AddConversationDialog({
  open,
  pipelineId,
  stageId,
  onClose,
  onSaved,
}: Props) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [value, setValue] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setDebounced('');
      setValue('');
      setPickedId(null);
    }
  }, [open]);

  const { data, isLoading } = useQuery({
    queryKey: ['conversations', 'pipeline-picker', debounced],
    queryFn: () =>
      inboxService.getConversations({
        limit: '20',
        page: '1',
        ...(debounced ? { search: debounced } : {}),
      }),
    enabled: open,
  });

  const conversations = useMemo(
    () => data?.conversations ?? [],
    [data],
  );

  if (!open) return null;

  const handleAdd = async () => {
    if (!pickedId) {
      toast.error('Selecione uma conversa');
      return;
    }
    setSaving(true);
    try {
      const numericValue = value ? parseFloat(value.replace(',', '.')) : undefined;
      await pipelinesService.createCard(pipelineId, {
        conversationId: pickedId,
        stageId: stageId ?? undefined,
        value: numericValue,
      });
      toast.success('Conversa adicionada ao pipeline');
      onSaved();
    } catch (err: any) {
      toast.error(
        err?.response?.data?.message ||
          'Erro ao adicionar conversa no pipeline',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Adicionar conversa ao pipeline
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Escolha uma conversa existente. O card vai ser criado vinculado a ela.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou telefone…"
              className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {isLoading && (
            <div className="flex items-center justify-center py-10 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
          {!isLoading && conversations.length === 0 && (
            <p className="py-10 text-center text-sm text-zinc-400">
              Nenhuma conversa encontrada
            </p>
          )}
          {conversations.map((c: Conversation) => {
            const picked = pickedId === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setPickedId(c.id)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                  picked
                    ? 'bg-primary/10 dark:bg-primary/20'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60'
                }`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-500 dark:bg-zinc-800">
                  {(c.contact.name || c.contact.phone || '??')
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {c.contact.name || c.contact.phone || 'Desconhecido'}
                  </p>
                  <p className="truncate text-[11px] text-zinc-500">
                    <span className="uppercase">{c.channel.type}</span>
                    {c.contact.phone && c.contact.name
                      ? ` · ${c.contact.phone}`
                      : ''}
                  </p>
                </div>
                {c.isGroup && (
                  <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] uppercase text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                    grupo
                  </span>
                )}
                {picked && (
                  <MessageSquare className="h-4 w-4 shrink-0 text-primary" />
                )}
              </button>
            );
          })}
        </div>

        <div className="border-t border-zinc-200 px-6 py-3 dark:border-zinc-800">
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Valor estimado (R$) — opcional
          </label>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="ex: 4500"
            inputMode="decimal"
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            onClick={handleAdd}
            disabled={saving || !pickedId}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Adicionando…' : 'Adicionar ao pipeline'}
          </button>
        </div>
      </div>
    </div>
  );
}
