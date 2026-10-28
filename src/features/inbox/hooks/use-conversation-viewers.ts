'use client';

import { useEffect, useState } from 'react';
import { getConversationViewers, type ConversationViewer } from '@/lib/socket';
import { useSocket } from './use-socket';

/**
 * Membros com a conversa aberta agora, via Presence do tópico da conversa.
 * Inclui o próprio usuário — quem chama filtra se quiser só os colegas.
 */
export function useConversationViewers(conversationId: string): ConversationViewer[] {
  const { on } = useSocket();
  const [viewers, setViewers] = useState<ConversationViewer[]>(() =>
    getConversationViewers(conversationId),
  );

  useEffect(() => {
    setViewers(getConversationViewers(conversationId));
    return on(
      'conversation:viewers',
      (payload: { conversationId: string; viewers: ConversationViewer[] }) => {
        if (payload?.conversationId === conversationId) setViewers(payload.viewers);
      },
    );
  }, [conversationId, on]);

  return viewers;
}
