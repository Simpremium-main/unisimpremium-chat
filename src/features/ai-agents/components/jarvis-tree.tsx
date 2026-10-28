'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  BarChart3,
  Sparkles,
  Wrench,
  Activity,
  User,
  ShieldCheck,
  Workflow,
  GraduationCap,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAccess } from '@/features/access/use-access';
import { useAuthStore } from '@/stores/auth-store';
import { aiLearningService } from '@/features/ai-agents/services/ai-learning.service';

const STORAGE_KEY = 'jarvis-tree-expanded';

type Tab = 'overview' | 'agents' | 'flows' | 'learning' | 'skills' | 'tools' | 'runs' | 'agent' | 'watchdog';

const TABS: Array<{
  id: Tab;
  label: string;
  icon: React.ElementType;
}> = [
  { id: 'overview', label: 'Visão geral', icon: BarChart3 },
  { id: 'agents', label: 'Agentes', icon: Bot },
  { id: 'flows', label: 'Fluxos', icon: Workflow },
  // Só administradores (ver adminOnly abaixo).
  { id: 'learning', label: 'Aprendizado', icon: GraduationCap },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'runs', label: 'Execuções', icon: Activity },
  { id: 'watchdog', label: 'Watchdog', icon: ShieldCheck },
  { id: 'agent', label: 'Por agente', icon: User },
];

/**
 * Sidebar tree mirroring the InboxTree pattern. The /ai-agents page now
 * reads the active tab from the query string (`?tab=skills`), so each
 * leaf in the tree is a normal navigation link — no internal state in
 * the page itself.
 */
export function JarvisTree() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [expanded, setExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(STORAGE_KEY) !== '0';
  });

  const isAiAgents = pathname?.startsWith('/ai-agents');
  // Perfil de acesso: só as abas do Jarvis liberadas.
  const { canPage } = useAccess();
  const role = useAuthStore((s) => s.organizations.find((o) => o.id === s.activeOrgId)?.role);
  const isAdmin = role === 'OWNER' || role === 'ADMIN';
  const visibleTabs = TABS.filter((t) => (t.id === 'learning' ? isAdmin : canPage(`jarvis.${t.id}`)));
  // Bolinha: casos em que a IA pediu ajuda e esperam orientação.
  const orgId = useAuthStore((s) => s.activeOrgId);
  const { data: pendingHelp = 0 } = useQuery({
    queryKey: ['ai-learning-count', orgId],
    queryFn: () => aiLearningService.pendingCount(),
    refetchInterval: 60_000,
    enabled: isAdmin,
  });
  const activeTab = (searchParams!.get('tab') as Tab) ?? 'overview';

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    }
  };

  // Sempre passamos `?tab=` explícito (inclusive pra overview) — sem isso,
  // navegar de `/ai-agents?tab=runs` pra `/ai-agents` (mesma rota base, só
  // limpando o param) não dispara re-render confiável no Next.js App Router.
  const goRoot = () => router.push(`/ai-agents?tab=${visibleTabs[0]?.id ?? 'overview'}`);
  const goTab = (tab: Tab) => router.push(`/ai-agents?tab=${tab}`);

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={toggleExpanded}
          aria-label={expanded ? 'Recolher' : 'Expandir'}
          className="flex h-7 w-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-950/5 hover:text-zinc-700 dark:hover:bg-white/5 dark:hover:text-zinc-300"
        >
          {expanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={goRoot}
          className={`flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium ${
            isAiAgents
              ? 'bg-zinc-950/5 text-zinc-950 dark:bg-white/5 dark:text-white'
              : 'text-zinc-700 hover:bg-zinc-950/5 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-white/5 dark:hover:text-white'
          }`}
        >
          <Bot className="size-5" />
          <span className="flex-1">Jarvis</span>
          {/* Lista recolhida: a bolinha do Aprendizado sobe pro Jarvis. */}
          {!expanded && pendingHelp > 0 && (
            <span className="min-w-[18px] rounded-full bg-red-500 px-1.5 text-center text-[10px] font-semibold leading-[18px] text-white">
              {pendingHelp > 99 ? '99+' : pendingHelp}
            </span>
          )}
        </button>
      </div>

      {expanded && (
        <div className="ml-5 space-y-0.5 border-l border-zinc-200 pl-2 dark:border-zinc-800">
          {visibleTabs.map((t) => {
            const Icon = t.icon;
            const isActive = isAiAgents && activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => goTab(t.id)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                  isActive
                    ? 'bg-zinc-950/5 font-medium text-zinc-900 dark:bg-white/5 dark:text-white'
                    : 'text-zinc-600 hover:bg-zinc-950/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white'
                }`}
              >
                <Icon className="size-3.5 text-zinc-400" />
                <span className="flex-1">{t.label}</span>
                {t.id === 'learning' && pendingHelp > 0 && (
                  <span className="min-w-[18px] rounded-full bg-red-500 px-1.5 text-center text-[10px] font-semibold leading-[18px] text-white">
                    {pendingHelp > 99 ? '99+' : pendingHelp}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
