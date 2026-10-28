'use client';

import { Building2 } from 'lucide-react';

export default function SettingsGeneralPage() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900/50">
      <Building2 className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-600" />
      <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
        Configurações gerais da organização — disponível em breve
      </p>
    </div>
  );
}
