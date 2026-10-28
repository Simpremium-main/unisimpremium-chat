'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { initialsColorFor } from '@/lib/member-color';

interface MemberAvatarProps {
  name: string | null | undefined;
  avatarUrl?: string | null;
  /** Cor de identificação do membro (#rrggbb); sem ela, fundo neutro. */
  color?: string | null;
  /** Diâmetro em px. */
  size?: number;
  className?: string;
  title?: string;
}

/** Bolinha do membro: foto, ou iniciais sobre a cor escolhida em Membros. */
export function MemberAvatar({
  name,
  avatarUrl,
  color,
  size = 24,
  className,
  title,
}: MemberAvatarProps) {
  const [failed, setFailed] = useState(false);
  const initials = (name || '??').slice(0, 2).toUpperCase();
  const dim = { width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.4)) };

  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt={name ?? ''}
        title={title}
        onError={() => setFailed(true)}
        style={{ ...dim, ...(color ? { boxShadow: `0 0 0 2px ${color}` } : {}) }}
        className={cn('shrink-0 rounded-full object-cover', className)}
      />
    );
  }
  return (
    <div
      title={title}
      style={{
        ...dim,
        ...(color ? { backgroundColor: color, color: initialsColorFor(color) } : {}),
      }}
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none',
        !color && 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
        className,
      )}
    >
      {initials}
    </div>
  );
}
