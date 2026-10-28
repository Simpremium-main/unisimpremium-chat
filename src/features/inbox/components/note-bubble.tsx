'use client';

import { useState } from 'react';
import { Bot, Check, Lock, Pencil, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { InternalNote, Message } from '../services/inbox.service';

/**
 * Nota interna na linha do tempo da conversa: cartão amarelo, nunca enviado
 * ao cliente. Autor atendente (com editar/apagar pra quem escreveu) ou IA.
 * Nota presa a uma mensagem mostra o trecho e leva até ela no clique.
 */
export function NoteBubble({
  note,
  target,
  canEdit,
  canDelete,
  onUpdate,
  onDelete,
}: {
  note: InternalNote;
  /** Mensagem anotada, se carregada na tela. */
  target?: Message | null;
  canEdit: boolean;
  canDelete: boolean;
  onUpdate: (content: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const [busy, setBusy] = useState(false);

  const isAi = note.authorType === 'AI';
  const author = isAi ? `${note.agent?.name ?? 'IA'} (IA)` : (note.author?.name ?? 'Atendente');
  const time = new Date(note.createdAt).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const edited = new Date(note.updatedAt).getTime() - new Date(note.createdAt).getTime() > 1000;

  const save = async () => {
    const content = draft.trim();
    if (!content) return toast.error('A nota não pode ficar vazia');
    setBusy(true);
    try {
      await onUpdate(content);
      setEditing(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao salvar a nota');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Apagar esta nota interna?')) return;
    setBusy(true);
    try {
      await onDelete();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao apagar a nota');
      setBusy(false);
    }
  };

  const targetPreview = target
    ? (target.content?.text || target.content?.caption || `[${target.type.toLowerCase()}]`)
    : null;

  return (
    <div id={`note-${note.id}`} className="group/note flex justify-center sm:px-2">
      <div className="w-full rounded-xl sm:max-w-[85%] border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
          <Lock className="h-3 w-3 shrink-0" />
          <span className="hidden sm:inline">Nota interna</span>
          <span className="hidden opacity-60 sm:inline">·</span>
          {isAi && <Bot className="h-3 w-3 shrink-0" />}
          <span className="truncate">{author}</span>
          <span className="opacity-60">·</span>
          <span className="shrink-0">
            {time}
            {edited ? ' (editada)' : ''}
          </span>
          {!editing && (canEdit || canDelete) && (
            <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/note:opacity-100">
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(note.content);
                    setEditing(true);
                  }}
                  disabled={busy}
                  className="rounded p-1 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                  title="Editar nota"
                  aria-label="Editar nota"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="rounded p-1 hover:bg-amber-100 hover:text-red-600 dark:hover:bg-amber-900/40"
                  title="Apagar nota"
                  aria-label="Apagar nota"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </span>
          )}
        </div>

        {note.messageId && (
          <button
            type="button"
            onClick={() =>
              document
                .getElementById(`msg-${note.messageId}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
            className="mt-1 block w-full truncate border-l-2 border-amber-400 pl-2 text-left text-[11px] text-amber-800/80 hover:text-amber-900 dark:text-amber-300/80"
            title="Ir para a mensagem anotada"
          >
            Sobre a mensagem: {targetPreview ?? 'mensagem anterior'}
          </button>
        )}

        {editing ? (
          <div className="mt-1.5">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  save();
                } else if (e.key === 'Escape') {
                  setEditing(false);
                }
              }}
              rows={3}
              className="w-full resize-y rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-1 focus:ring-amber-400 dark:border-amber-800 dark:bg-zinc-900 dark:text-zinc-100"
            />
            <div className="mt-1 flex justify-end gap-1">
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-amber-100 dark:hover:bg-amber-900/40"
              >
                <X className="h-3 w-3" /> Cancelar
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded bg-amber-500 px-2 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-60"
              >
                <Check className="h-3 w-3" /> Salvar
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-wrap break-words text-sm">{note.content}</p>
        )}
      </div>
    </div>
  );
}
