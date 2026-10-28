'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, User, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { inboxService, type Conversation } from '../services/inbox.service';
import { useAccess } from '@/features/access/use-access';

interface Props {
  conversation: Conversation;
  open: boolean;
  onClose: () => void;
}

/**
 * Renames the contact (visible to anyone in the org viewing this contact)
 * and/or sets a per-conversation subject (internal nickname — only the
 * inbox shows it, the customer never sees it).
 */
export function RenameConversationDialog({ conversation, open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [contactName, setContactName] = useState(
    conversation.contact?.name ?? '',
  );
  const [subject, setSubject] = useState(conversation.subject ?? '');
  const [saving, setSaving] = useState(false);
  // Perfil sem "Editar contatos": o nome do contato fica só para leitura.
  const canEditContact = useAccess().can('contacts.edit');

  // Reset state when opening with a different conversation.
  useEffect(() => {
    if (open) {
      setContactName(conversation.contact?.name ?? '');
      setSubject(conversation.subject ?? '');
    }
  }, [open, conversation]);

  // ESC closes; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, saving]);

  if (!open) return null;

  const originalContactName = conversation.contact?.name ?? '';
  const originalSubject = conversation.subject ?? '';
  const contactDirty = contactName.trim() !== originalContactName.trim();
  const subjectDirty = subject.trim() !== originalSubject.trim();
  const dirty = contactDirty || subjectDirty;

  const handleSave = async () => {
    if (!dirty) return onClose();
    setSaving(true);
    try {
      const promises: Promise<unknown>[] = [];
      if (contactDirty && conversation.contact?.id) {
        promises.push(
          inboxService.renameContact(
            conversation.contact.id,
            contactName.trim(),
          ),
        );
      }
      if (subjectDirty) {
        promises.push(
          inboxService.updateConversation(conversation.id, {
            subject: subject.trim() || null,
          }),
        );
      }
      await Promise.all(promises);
      toast.success('Atualizado');
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['conversation', conversation.id] });
      if (conversation.contact?.id) {
        queryClient.invalidateQueries({
          queryKey: ['contact', conversation.contact.id],
        });
      }
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={() => !saving && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Renomear
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Fechar"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div>
            <label className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-700 dark:text-zinc-300">
              <User className="h-3.5 w-3.5 text-zinc-400" />
              Nome do contato
            </label>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Aparece pra todo o time. Não muda nada do lado do cliente.
            </p>
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              disabled={saving || !canEditContact}
              title={canEditContact ? undefined : 'Seu perfil de acesso não permite editar contatos'}
              placeholder={conversation.contact?.phone ?? 'Sem nome'}
              className="mt-1.5 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              autoFocus
            />
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-700 dark:text-zinc-300">
              <MessageSquare className="h-3.5 w-3.5 text-zinc-400" />
              Apelido da conversa
            </label>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Opcional. Só aparece pra você na inbox — o cliente não vê.
            </p>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={saving}
              placeholder="ex: liberou ontem, aguardando feedback"
              maxLength={120}
              className="mt-1.5 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 bg-zinc-50/50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
