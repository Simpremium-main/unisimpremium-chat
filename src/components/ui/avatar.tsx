import { cn } from '@/lib/utils';

interface AvatarProps {
  src?: string | null;
  initials?: string;
  alt?: string;
  square?: boolean;
  className?: string;
}

export function Avatar({
  src,
  initials,
  alt = '',
  square = false,
  className,
}: AvatarProps) {
  return (
    <span
      className={cn(
        'inline-grid size-8 shrink-0 place-items-center align-middle overflow-hidden',
        square ? 'rounded-lg' : 'rounded-full',
        'bg-zinc-100 dark:bg-zinc-800',
        'outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10',
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          className={cn(
            'size-full object-cover',
            square ? 'rounded-lg' : 'rounded-full',
          )}
        />
      ) : initials ? (
        <span className="select-none text-[0.625em] font-medium uppercase text-zinc-600 dark:text-zinc-400">
          {initials}
        </span>
      ) : (
        <svg
          className="size-5 text-zinc-400"
          fill="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path d="M24 20.993V24H0v-2.996A14.977 14.977 0 0112.004 15c4.904 0 9.26 2.354 11.996 5.993zM16.002 8.999a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      )}
    </span>
  );
}
