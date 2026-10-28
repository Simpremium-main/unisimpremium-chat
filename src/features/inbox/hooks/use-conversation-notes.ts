'use client';

import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { inboxService, type InternalNote } from '../services/inbox.service';
import { useSocket } from './use-socket';

const byTime = (a: InternalNote, b: InternalNote) =>
  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

/**
 * Notas internas da conversa, em ordem cronológica. Os eventos `note:new`,
 * `note:updated` e `note:deleted` (atendentes e IA) atualizam o cache na hora.
 */
export function useConversationNotes(conversationId: string) {
  const queryClient = useQueryClient();
  const { on } = useSocket();
  const queryKey = ['notes', conversationId];

  const { data } = useQuery({
    queryKey,
    queryFn: () => inboxService.listNotes(conversationId),
    staleTime: 30_000,
  });

  const upsert = useCallback(
    (note: InternalNote) =>
      queryClient.setQueryData<InternalNote[]>(queryKey, (prev = []) =>
        [...prev.filter((n) => n.id !== note.id), note].sort(byTime),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, conversationId],
  );
  const drop = useCallback(
    (noteId: string) =>
      queryClient.setQueryData<InternalNote[]>(queryKey, (prev = []) =>
        prev.filter((n) => n.id !== noteId),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, conversationId],
  );

  useEffect(() => {
    const offs = [
      on('note:new', (p: any) => {
        if (p?.conversationId === conversationId && p.note) upsert(p.note);
      }),
      on('note:updated', (p: any) => {
        if (p?.conversationId === conversationId && p.note) upsert(p.note);
      }),
      on('note:deleted', (p: any) => {
        if (p?.conversationId === conversationId && p.noteId) drop(p.noteId);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [conversationId, on, upsert, drop]);

  const create = useCallback(
    async (content: string, messageId?: string) => {
      const note = await inboxService.createNote(conversationId, { content, messageId });
      upsert(note);
      return note;
    },
    [conversationId, upsert],
  );
  const update = useCallback(
    async (noteId: string, content: string) => upsert(await inboxService.updateNote(conversationId, noteId, content)),
    [conversationId, upsert],
  );
  const remove = useCallback(
    async (noteId: string) => {
      await inboxService.deleteNote(conversationId, noteId);
      drop(noteId);
    },
    [conversationId, drop],
  );

  return { notes: data ?? [], create, update, remove };
}
