'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  preferencesService,
  type InboxPreferences,
  type UserPreferences,
} from '../services/preferences.service';
import { useOrgId } from '@/hooks/use-org-query-key';

type UpdateFn = (patch: InboxPreferences) => void;

interface UseInboxPreferencesResult {
  preferences: InboxPreferences;
  isLoaded: boolean;
  update: UpdateFn;
}

export function useInboxPreferences(): UseInboxPreferencesResult {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const queryKey = ['user-preferences', orgId];

  const { data, isSuccess } = useQuery({
    queryKey,
    queryFn: () => preferencesService.get(),
    enabled: Boolean(orgId),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const mutation = useMutation({
    mutationFn: (patch: Partial<UserPreferences>) =>
      preferencesService.patch(patch),
    onSuccess: (merged) => {
      queryClient.setQueryData(queryKey, merged);
    },
  });

  // Merge patches quickly on the client, debounce the network write to avoid
  // saving every intermediate click when toggling multi-selects.
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingRef = useRef<InboxPreferences>({});

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const update = useCallback<UpdateFn>(
    (patch) => {
      const previous = queryClient.getQueryData<UserPreferences>(queryKey) ?? {};
      const nextInbox: InboxPreferences = { ...(previous.inbox ?? {}), ...patch };
      queryClient.setQueryData<UserPreferences>(queryKey, {
        ...previous,
        inbox: nextInbox,
      });

      pendingRef.current = { ...pendingRef.current, ...patch };
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const current = queryClient.getQueryData<UserPreferences>(queryKey) ?? {};
        mutation.mutate({ inbox: { ...(current.inbox ?? {}), ...pendingRef.current } });
        pendingRef.current = {};
      }, 400);
    },
    [queryClient, mutation, queryKey],
  );

  return {
    preferences: data?.inbox ?? {},
    isLoaded: isSuccess,
    update,
  };
}
