'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Listens for live `permissions:updated` events the API emits when an admin
 * grants or revokes channel access. Updates the auth-store immediately and
 * invalidates the channels/conversations queries so the inbox reflects the
 * new visibility without a relogin.
 */
export function usePermissionsSync() {
  const queryClient = useQueryClient();
  const applyChannelPermissionUpdate = useAuthStore(
    (s) => s.applyChannelPermissionUpdate,
  );

  useEffect(() => {
    const socket = getSocket();
    const handler = (payload: { channelId: string; granted: boolean }) => {
      applyChannelPermissionUpdate(payload.channelId, payload.granted);
      queryClient.invalidateQueries({ queryKey: ['channels'] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['conversation-counts'] });
    };
    socket.on('permissions:updated', handler);
    return () => {
      socket.off('permissions:updated', handler);
    };
  }, [applyChannelPermissionUpdate, queryClient]);
}
