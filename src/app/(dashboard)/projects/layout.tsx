'use client';

import Link from 'next/link';
import { FolderKanban } from 'lucide-react';
import { useOrgFeatures } from '@/features/settings/hooks/use-org-features';

/** Com o módulo desligado em Configurações > Projetos, links antigos caem aqui. */
export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  const { projectsEnabled } = useOrgFeatures();
  if (projectsEnabled) return <>{children}</>;
  return (
    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
      <FolderKanban className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
      <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Projetos está desativado
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        Ative em{' '}
        <Link href="/settings/projects" className="text-primary hover:underline">
          Configurações &gt; Projetos
        </Link>
        .
      </p>
    </div>
  );
}
