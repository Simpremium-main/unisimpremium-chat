'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { membersService } from '../services/members.service';
import { useOrgId } from '@/hooks/use-org-query-key';

export interface MemberInfo {
  userId: string;
  name: string;
  avatarUrl: string | null;
  color: string | null;
}

/**
 * userId → nome/foto/cor dos membros da org. Mesmo cache da página
 * Configurações > Membros (`['members', orgId]`), então trocar a cor lá
 * reflete na hora no inbox.
 */
export function useMemberDirectory(): Map<string, MemberInfo> {
  const orgId = useOrgId();
  const { data } = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => membersService.list(),
    enabled: Boolean(orgId),
    staleTime: 5 * 60_000,
  });
  return useMemo(
    () =>
      new Map(
        (data ?? []).map((m) => [
          m.userId,
          {
            userId: m.userId,
            name: m.user.name,
            avatarUrl: m.user.avatarUrl,
            color: m.preferences?.avatarColor ?? null,
          },
        ]),
      ),
    [data],
  );
}
