import { useQuery } from '@tanstack/react-query';
import { tagsService, type Tag } from '@/features/settings/services/tags.service';
import {
  membersService,
  type Member,
} from '@/features/settings/services/members.service';
import {
  channelsService,
  type Channel,
} from '@/features/channels/services/channels.service';
import {
  pipelinesService,
  type Pipeline,
  type PipelineStage,
} from '@/features/pipelines/services/pipelines.service';

// Centralized lookup hook used by both the rule builder and the action
// editor. Doing the four list queries here means the builder mounts once
// and never cares about loading per-section — by the time the user picks
// a trigger, every dropdown already has data (or is at worst loading).
//
// 5min staleTime: these don't change often during a builder session.
// Refetch on window focus is fine — if the user just created a tag in
// another tab, they'll want it in the picker.

export interface AutomationLookups {
  tags: Tag[];
  members: Member[];
  channels: Channel[];
  pipelines: Pipeline[];
  isLoading: boolean;
  // Convenience helpers used by the builder. Inlined here so consumers
  // don't reach into raw arrays repeatedly.
  findStage(stageId: string): PipelineStage | undefined;
  stagesOf(pipelineId: string): PipelineStage[];
  tagName(tagId: string): string;
  memberName(userId: string): string;
  pipelineName(pipelineId: string): string;
  stageName(stageId: string): string;
  channelName(channelId: string): string;
}

const STALE = 5 * 60 * 1000;

export function useAutomationLookups(): AutomationLookups {
  const tagsQ = useQuery({
    queryKey: ['lookup', 'tags'],
    queryFn: () => tagsService.list(),
    staleTime: STALE,
  });
  const membersQ = useQuery({
    queryKey: ['lookup', 'members'],
    queryFn: () => membersService.list(),
    staleTime: STALE,
  });
  const channelsQ = useQuery({
    queryKey: ['lookup', 'channels'],
    queryFn: () => channelsService.list(),
    staleTime: STALE,
  });
  const pipelinesQ = useQuery({
    queryKey: ['lookup', 'pipelines'],
    queryFn: () => pipelinesService.list(),
    staleTime: STALE,
  });

  const tags = tagsQ.data ?? [];
  const members = membersQ.data ?? [];
  const channels = channelsQ.data ?? [];
  const pipelines = pipelinesQ.data ?? [];

  return {
    tags,
    members,
    channels,
    pipelines,
    isLoading:
      tagsQ.isLoading ||
      membersQ.isLoading ||
      channelsQ.isLoading ||
      pipelinesQ.isLoading,
    findStage(stageId: string) {
      for (const p of pipelines) {
        const s = p.stages?.find((st) => st.id === stageId);
        if (s) return s;
      }
      return undefined;
    },
    stagesOf(pipelineId: string) {
      return (
        pipelines.find((p) => p.id === pipelineId)?.stages ?? []
      ).slice().sort((a, b) => a.order - b.order);
    },
    tagName(tagId: string) {
      return tags.find((t) => t.id === tagId)?.name ?? tagId;
    },
    memberName(userId: string) {
      const m = members.find((x) => x.userId === userId);
      return m?.user?.name ?? userId;
    },
    pipelineName(pipelineId: string) {
      return pipelines.find((p) => p.id === pipelineId)?.name ?? pipelineId;
    },
    stageName(stageId: string) {
      for (const p of pipelines) {
        const s = p.stages?.find((st) => st.id === stageId);
        if (s) return `${p.name} → ${s.name}`;
      }
      return stageId;
    },
    channelName(channelId: string) {
      return channels.find((c) => c.id === channelId)?.name ?? channelId;
    },
  };
}
