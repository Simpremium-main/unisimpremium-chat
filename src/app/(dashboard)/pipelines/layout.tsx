'use client';

import Link from 'next/link';
import { KanbanSquare } from 'lucide-react';
import { useOrgFeatures } from '@/features/settings/hooks/use-org-features';

/** Com o módulo desligado em Configurações > Pipeline, links antigos caem aqui. */
export default function PipelinesLayout({ children }: { children: React.ReactNode }) {
  const { pipelinesEnabled } = useOrgFeatures();
  if (pipelinesEnabled) return <>{children}</>;
  return (
    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
      <KanbanSquare className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
      <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Pipelines está desativado
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        Ative em{' '}
        <Link href="/settings/pipeline" className="text-primary hover:underline">
          Configurações &gt; Pipeline
        </Link>
        .
      </p>
    </div>
  );
}
