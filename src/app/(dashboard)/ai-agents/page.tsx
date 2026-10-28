'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAccess } from '@/features/access/use-access';
import { Bot, BarChart3, User, Sparkles, Wrench, Activity, ShieldCheck, Workflow, GraduationCap } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { JarvisLearningTab } from '@/features/ai-agents/components/jarvis/learning-tab';
import { AgentsList } from '@/features/ai-agents/components/agents-list';
import { JarvisOverviewTab } from '@/features/ai-agents/components/jarvis/overview-tab';
import { JarvisAgentTab } from '@/features/ai-agents/components/jarvis/agent-tab';
import { JarvisSkillsTab } from '@/features/ai-agents/components/jarvis/skills-tab';
import { JarvisToolsTab } from '@/features/ai-agents/components/jarvis/tools-tab';
import { JarvisFlowsTab } from '@/features/ai-agents/components/jarvis/flows-tab';
import { JarvisRunsTab } from '@/features/ai-agents/components/jarvis/runs-tab';
import { JarvisWatchdogTab } from '@/features/ai-agents/components/jarvis/watchdog-tab';

type Tab = 'overview' | 'agents' | 'flows' | 'learning' | 'skills' | 'tools' | 'agent' | 'runs' | 'watchdog';

const TAB_META: Record<Tab, { label: string; icon: React.ElementType }> = {
  overview: { label: 'Visão geral', icon: BarChart3 },
  agents: { label: 'Agentes', icon: Bot },
  flows: { label: 'Fluxos', icon: Workflow },
  learning: { label: 'Aprendizado', icon: GraduationCap },
  skills: { label: 'Skills', icon: Sparkles },
  tools: { label: 'Tools', icon: Wrench },
  runs: { label: 'Execuções', icon: Activity },
  watchdog: { label: 'Watchdog', icon: ShieldCheck },
  agent: { label: 'Por agente', icon: User },
};

const VALID_TABS: Tab[] = ['overview', 'agents', 'flows', 'learning', 'skills', 'tools', 'runs', 'watchdog', 'agent'];

export default function AiAgentsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { canPage } = useAccess();
  // Perfil de acesso: aba não liberada vai para a primeira permitida.
  const role = useAuthStore((s) => s.organizations.find((o) => o.id === s.activeOrgId)?.role);
  const isAdmin = role === 'OWNER' || role === 'ADMIN';
  // Aprendizado: só administradores.
  const allowedTabs = VALID_TABS.filter((t) => (t === 'learning' ? isAdmin : canPage(`jarvis.${t}`)));
  const raw = (searchParams!.get('tab') ?? allowedTabs[0] ?? 'overview') as Tab;
  const requested: Tab = VALID_TABS.includes(raw) ? raw : 'overview';
  const tab: Tab = allowedTabs.includes(requested) ? requested : (allowedTabs[0] ?? requested);
  useEffect(() => {
    if (tab !== requested) router.replace(`/ai-agents?tab=${tab}`);
  }, [tab, requested, router]);
  const meta = TAB_META[tab];
  const Icon = meta.icon;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="inline-flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          <Bot className="h-5 w-5 text-primary" />
          Jarvis
          <span className="text-zinc-300 dark:text-zinc-600">/</span>
          <Icon className="h-4 w-4 text-zinc-400" />
          <span className="text-zinc-700 dark:text-zinc-300">{meta.label}</span>
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'overview' && <JarvisOverviewTab />}
        {tab === 'agents' && <AgentsList />}
        {tab === 'flows' && <JarvisFlowsTab />}
        {tab === 'learning' && <JarvisLearningTab />}
        {tab === 'skills' && <JarvisSkillsTab />}
        {tab === 'tools' && <JarvisToolsTab />}
        {tab === 'runs' && <JarvisRunsTab />}
        {tab === 'watchdog' && <JarvisWatchdogTab />}
        {tab === 'agent' && <JarvisAgentTab />}
      </div>
    </div>
  );
}
