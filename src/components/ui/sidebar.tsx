"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";

export function Sidebar({ children }: { children: ReactNode }) {
  return <nav className="flex h-full flex-col">{children}</nav>;
}

export function SidebarHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-b border-zinc-950/5 px-4 py-4 dark:border-white/5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SidebarBody({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4">
      {children}
    </div>
  );
}

export function SidebarFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-t border-zinc-950/5 px-4 py-4 dark:border-white/5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SidebarSection({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>{children}</div>
  );
}

export function SidebarSpacer() {
  return <div aria-hidden className="mt-auto" />;
}

export function SidebarHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-1 px-2 text-xs/6 font-medium text-zinc-500 dark:text-zinc-400">
      {children}
    </h3>
  );
}

interface SidebarItemProps {
  href?: string;
  current?: boolean;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}

export function SidebarItem({
  href,
  current,
  onClick,
  className,
  children,
}: SidebarItemProps) {
  const pathname = usePathname();
  const isActive =
    current ??
    (href
      ? href === "/"
        ? pathname === "/"
        : pathname!.startsWith(href)
      : false);

  const classes = cn(
    "flex w-full items-center gap-3 rounded-lg p-2 text-left text-sm/6 font-medium transition-colors",
    isActive
      ? "bg-zinc-950/5 text-zinc-950 dark:bg-white/5 dark:text-white"
      : "text-zinc-500 hover:bg-zinc-950/5 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={classes}>
      {children}
    </button>
  );
}

export function SidebarLabel({ children }: { children: ReactNode }) {
  return <span className="truncate">{children}</span>;
}
