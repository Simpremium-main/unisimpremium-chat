'use client';

import { useState } from 'react';
import { Instagram, ImageOff } from 'lucide-react';
import type { StoryReplyContext } from '../services/inbox.service';

/**
 * Renders the original Instagram story a user replied to, rendered as a small
 * card above the reply bubble — mirrors the Instagram Direct UX so the agent
 * sees WHICH story triggered the message.
 *
 * Story media URLs expire (Meta CDN ~24h). We degrade gracefully to a title
 * card when the image fails to load.
 */
export function StoryReplyCard({
  story,
  isOutbound,
}: {
  story: StoryReplyContext;
  isOutbound: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const label =
    story.kind === 'mention' ? 'Mencionou você no story' : 'Respondeu ao seu story';

  const frame = `mb-1 overflow-hidden rounded-xl border ${
    isOutbound
      ? 'border-primary/40 bg-primary/10'
      : 'border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/60'
  }`;
  const labelColor = isOutbound
    ? 'text-primary-foreground/80'
    : 'text-zinc-500 dark:text-zinc-400';

  return (
    <div className={frame}>
      <div className={`flex items-center gap-1.5 px-3 pt-2 text-[10px] uppercase tracking-wider ${labelColor}`}>
        <Instagram className="h-3 w-3" />
        {label}
      </div>
      {story.url && !imgError ? (
        <div className="mt-1.5 p-2">
          <img
            src={story.url}
            alt="Story"
            onError={() => setImgError(true)}
            className="h-20 w-14 rounded-md object-cover"
          />
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-2 px-3 pb-2 text-xs text-zinc-500 dark:text-zinc-400">
          <ImageOff className="h-3.5 w-3.5 opacity-50" />
          <span>Mídia do story não disponível (expirada)</span>
        </div>
      )}
    </div>
  );
}
