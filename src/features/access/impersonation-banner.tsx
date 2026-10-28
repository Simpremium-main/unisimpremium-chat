'use client';

import { useEffect, useState } from 'react';
import { Eye, LogOut } from 'lucide-react';
import { exitImpersonation, getImpersonation } from './impersonation';
import { useAccess } from './use-access';

/** Faixa fixa enquanto o admin está vendo o app como outro membro. */
export function ImpersonationBanner() {
  const [session, setSession] = useState<ReturnType<typeof getImpersonation>>(null);
  const { access } = useAccess();
  useEffect(() => setSession(getImpersonation()), []);
  if (!session) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-400 px-4 py-1.5 text-center text-[13px] font-medium text-amber-950">
      <span className="inline-flex items-center gap-1.5">
        <Eye className="h-4 w-4" />
        Você está vendo como <strong>{session.targetName}</strong>
        {access ? ` (perfil ${access.profileName})` : ' (acesso padrão)'}
      </span>
      <button
        onClick={() => exitImpersonation()}
        className="inline-flex items-center gap-1 rounded-full bg-amber-950 px-3 py-0.5 text-xs font-semibold text-amber-50 hover:bg-amber-900"
      >
        <LogOut className="h-3 w-3" />
        Voltar para minha conta
      </button>
    </div>
  );
}
