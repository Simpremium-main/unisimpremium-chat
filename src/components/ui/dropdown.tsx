'use client';

import { type ReactNode } from 'react';
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
} from '@headlessui/react';
import { cn } from '@/lib/utils';

export function Dropdown({ children }: { children: ReactNode }) {
  return <Menu>{children}</Menu>;
}

export const DropdownButton = MenuButton;

interface DropdownMenuProps {
  className?: string;
  anchor?: 'bottom start' | 'bottom end' | 'top start' | 'top end';
  children: ReactNode;
}

export function DropdownMenu({
  className,
  anchor = 'bottom start',
  children,
}: DropdownMenuProps) {
  return (
    <MenuItems
      anchor={anchor}
      transition
      className={cn(
        'z-50 min-w-[var(--button-width)] rounded-lg border border-zinc-950/5 bg-white p-1 shadow-lg focus:outline-none dark:border-white/10 dark:bg-zinc-900',
        'transition duration-100 ease-out data-[closed]:scale-95 data-[closed]:opacity-0',
        '[--anchor-gap:0.25rem]',
        className,
      )}
    >
      {children}
    </MenuItems>
  );
}

interface DropdownItemProps {
  href?: string;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}

export function DropdownItem({
  href,
  onClick,
  className,
  children,
}: DropdownItemProps) {
  const classes = cn(
    'group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-zinc-950 dark:text-white',
    'data-[focus]:bg-zinc-950/5 dark:data-[focus]:bg-white/5',
    '[&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-zinc-500 dark:[&>svg]:text-zinc-400',
    className,
  );

  return href ? (
    <MenuItem as="a" href={href} className={classes}>
      {children}
    </MenuItem>
  ) : (
    <MenuItem as="button" type="button" onClick={onClick} className={classes}>
      {children}
    </MenuItem>
  );
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return <span className="truncate">{children}</span>;
}

export function DropdownDivider() {
  return <div className="my-1 h-px bg-zinc-950/5 dark:bg-white/5" />;
}
