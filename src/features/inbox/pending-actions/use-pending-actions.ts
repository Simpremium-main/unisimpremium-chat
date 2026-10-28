'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  approvePendingAction,
  listPendingActions,
  rejectPendingAction,
} from './api';
import type { PendingAction } from './types';

const PENDING_ACTIONS_KEY = 'pending-actions';

export const pendingActionsQueryKey = (conversationId: string) =>
  [PENDING_ACTIONS_KEY, conversationId] as const;

/**
 * Lists pending actions for a conversation. Auto-refetches every 10s so
 * an approver sees newly-created actions without manual refresh, and
 * also re-runs on focus/reconnect (matches the inbox's pattern of
 * recovering from missed socket events).
 */
export function usePendingActions(conversationId: string | undefined) {
  return useQuery<PendingAction[]>({
    queryKey: pendingActionsQueryKey(conversationId ?? ''),
    queryFn: () => listPendingActions(conversationId as string),
    enabled: Boolean(conversationId),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 5_000,
  });
}

interface MutationContext {
  conversationId: string;
}

/**
 * Approves the action and forces a refetch of the conversation's list.
 * The caller passes `conversationId` so we can invalidate the right
 * query without needing to re-fetch the action's detail first.
 */
export function useApprovePendingAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string } & MutationContext) =>
      approvePendingAction(id),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: pendingActionsQueryKey(variables.conversationId),
      });
    },
  });
}

export function useRejectPendingAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      reason,
    }: { id: string; reason: string } & MutationContext) =>
      rejectPendingAction(id, reason),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: pendingActionsQueryKey(variables.conversationId),
      });
    },
  });
}
