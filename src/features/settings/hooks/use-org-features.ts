'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useOrgId } from '@/hooks/use-org-query-key';

interface OrgWithFeatures {
  settings?: { features?: { pipelines?: boolean; projects?: boolean } } | null;
}

/**
 * Módulos liga/desliga da organização (`settings.features`). Ligado por
 * padrão — inclusive enquanto carrega, pra não piscar o menu de quem usa.
 */
export function useOrgFeatures() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const queryKey = ['org-features', orgId];

  const { data, isSuccess } = useQuery({
    queryKey,
    queryFn: async (): Promise<OrgWithFeatures> => {
      const { data } = await api.get('/organizations/current');
      return data.data ?? data;
    },
    enabled: Boolean(orgId),
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: async (patch: { pipelinesEnabled?: boolean; projectsEnabled?: boolean }) => {
      const { data } = await api.patch('/organizations/current', patch);
      return (data.data ?? data) as OrgWithFeatures;
    },
    onSuccess: (org) => queryClient.setQueryData(queryKey, org),
  });

  return {
    pipelinesEnabled: data?.settings?.features?.pipelines !== false,
    projectsEnabled: data?.settings?.features?.projects !== false,
    isLoaded: isSuccess,
    setPipelinesEnabled: (enabled: boolean) => mutation.mutateAsync({ pipelinesEnabled: enabled }),
    setProjectsEnabled: (enabled: boolean) => mutation.mutateAsync({ projectsEnabled: enabled }),
    isSaving: mutation.isPending,
  };
}
