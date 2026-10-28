'use client';

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  preferencesService,
  type SignaturePreferences,
  type UserPreferences,
} from '../services/preferences.service';
import { useOrgId } from '@/hooks/use-org-query-key';
import { useAuthStore } from '@/stores/auth-store';

// Teto da lista de conversas desligadas — o JSON de preferências não deve
// crescer sem limite; as mais antigas voltam ao padrão (ligado).
const MAX_DISABLED = 500;

interface UseMessageSignatureResult {
  enabled: boolean;
  /** Último nome salvo pelo atendente; de início, o User.name. */
  name: string;
  setEnabled: (enabled: boolean) => void;
  setName: (name: string) => void;
}

/**
 * Assinatura "*Nome:*" das mensagens enviadas. O nome é por atendente (vale
 * pra todas as conversas); o liga/desliga é por conversa, ligado por padrão
 * — guardamos só as conversas desligadas. Mesmo cache de
 * useInboxPreferences (`['user-preferences', orgId]`).
 */
export function useMessageSignature(conversationId: string): UseMessageSignatureResult {
  const orgId = useOrgId();
  const userName = useAuthStore((s) => s.user?.name ?? '');
  const queryClient = useQueryClient();
  const queryKey = ['user-preferences', orgId];

  const { data } = useQuery({
    queryKey,
    queryFn: () => preferencesService.get(),
    enabled: Boolean(orgId),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const mutation = useMutation({
    mutationFn: (signature: SignaturePreferences) =>
      preferencesService.patch({ signature }),
    onSuccess: (merged) => {
      queryClient.setQueryData(queryKey, merged);
    },
  });

  const signature = data?.signature ?? {};
  const disabled = signature.disabledConversationIds ?? [];

  const save = useCallback(
    (patch: SignaturePreferences) => {
      const previous = queryClient.getQueryData<UserPreferences>(queryKey) ?? {};
      const next = { ...(previous.signature ?? {}), ...patch };
      queryClient.setQueryData<UserPreferences>(queryKey, { ...previous, signature: next });
      mutation.mutate(next);
    },
    [queryClient, mutation, queryKey],
  );

  const setEnabled = useCallback(
    (enabled: boolean) => {
      const others = disabled.filter((id) => id !== conversationId);
      save({
        disabledConversationIds: enabled
          ? others
          : [...others, conversationId].slice(-MAX_DISABLED),
      });
    },
    [disabled, conversationId, save],
  );

  const setName = useCallback((name: string) => save({ name: name.trim() }), [save]);

  return {
    enabled: !disabled.includes(conversationId),
    name: signature.name?.trim() || userName,
    setEnabled,
    setName,
  };
}
