'use client';

import Link from 'next/link';
import { FolderKanban } from 'lucide-react';
import { toast } from 'sonner';
import { useOrgFeatures } from '@/features/settings/hooks/use-org-features';
import { useAuthStore } from '@/stores/auth-store';

export default function SettingsProjectsPage() {
  const { projectsEnabled, isLoaded, setProjectsEnabled, isSaving } = useOrgFeatures();
  const role = useAuthStore(
    (s) => s.organizations.find((o) => o.id === s.activeOrgId)?.role,
  );
  const canEdit = role === 'OWNER' || role === 'ADMIN';

  const toggle = async () => {
    try {
      await setProjectsEnabled(!projectsEnabled);
      toast.success(projectsEnabled ? 'Projetos desativado' : 'Projetos ativado');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao salvar');
    }
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Projetos</h2>
      <p className="mt-0.5 text-sm text-zinc-500">
        Grupos de WhatsApp acompanhados como projetos (responsável e status)
      </p>

      <div className="mt-6 flex items-start gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FolderKanban className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Ativar Projetos</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Desativado, Projetos some do menu lateral, do filtro da lista de conversas e do
            cabeçalho das conversas de grupo. Os projetos existentes não são apagados — ao
            reativar, volta tudo como estava.
          </p>
          {projectsEnabled && (
            <Link href="/projects" className="mt-2 inline-block text-xs text-primary hover:underline">
              Ver projetos →
            </Link>
          )}
          {!canEdit && (
            <p className="mt-2 text-xs text-zinc-400">Só proprietários e admins podem alterar.</p>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={projectsEnabled}
          aria-label="Ativar Projetos"
          onClick={toggle}
          disabled={!isLoaded || isSaving || !canEdit}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            projectsEnabled ? 'bg-primary' : 'bg-zinc-300 dark:bg-zinc-700'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
              projectsEnabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
