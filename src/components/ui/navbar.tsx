'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export function Navbar({ children }: { children: ReactNode }) {
  return (
    <nav className="flex flex-1 items-center gap-4">{children}</nav>
  );
}

export function NavbarSpacer() {
  return <div aria-hidden className="flex-1" />;
}

export function NavbarSection({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-3">{children}</div>;
}

interface NavbarItemProps {
  href?: string;
  'aria-label'?: string;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}

export function NavbarItem({
  href,
  onClick,
  className,
  children,
  ...props
}: NavbarItemProps) {
  const classes = cn(
    'flex items-center justify-center rounded-lg p-1.5 text-zinc-500 transition-colors hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white',
    '[&>svg]:size-5',
    className,
  );

  if (href) {
    return (
      <Link href={href} className={classes} {...props}>
        {children}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={classes} {...props}>
      {children}
    </button>
  );
}
