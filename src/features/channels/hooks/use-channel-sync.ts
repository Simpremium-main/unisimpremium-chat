'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { channelsService, type ChannelSyncJob } from '../services/channels.service';

interface UseChannelSyncOptions {
  channelId: string;
  channelType: string;
  pollIntervalMs?: number;
}

const SUPPORTED_SYNC_TYPES = new Set(['INSTAGRAM', 'WHATSAPP_ZAPPFY']);

export function useChannelSync({ channelId, channelType, pollIntervalMs = 3000 }: UseChannelSyncOptions) {
  const [job, setJob] = useState<ChannelSyncJob | null>(null);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const supported = SUPPORTED_SYNC_TYPES.has(channelType);

  const fetchStatus = useCallback(async () => {
    if (!supported) return;
    try {
      const result = await channelsService.getSyncStatus(channelId);
      setJob(result);
    } catch {
      // swallow — UI renders idle when null
    }
  }, [channelId, supported]);

  const startSync = useCallback(async () => {
    if (!supported) return;
    setLoading(true);
    try {
      await channelsService.startSync(channelId);
      await fetchStatus();
    } finally {
      setLoading(false);
    }
  }, [channelId, fetchStatus, supported]);

  const cancelSync = useCallback(async () => {
    if (!supported) return;
    setLoading(true);
    try {
      await channelsService.cancelSync(channelId);
      await fetchStatus();
    } finally {
      setLoading(false);
    }
  }, [channelId, fetchStatus, supported]);

  useEffect(() => {
    if (!supported) return;
    fetchStatus();
  }, [fetchStatus, supported]);

  useEffect(() => {
    const active = job && (job.status === 'PENDING' || job.status === 'RUNNING');
    if (!active) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    pollRef.current = setInterval(fetchStatus, pollIntervalMs);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [job, fetchStatus, pollIntervalMs]);

  return {
    job,
    supported,
    loading,
    startSync,
    cancelSync,
    refresh: fetchStatus,
  };
}
