'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Sparkles,
  Trash2,
  Edit2,
  History,
  Bot,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  aiCatalogService,
  type AiSkill,
} from '../../services/ai-catalog.service';
import { useOrgId } from '@/hooks/use-org-query-key';
import { SkillDialog } from './skill-dialog';
import { SkillVersionsDialog } from './skill-versions-dialog';
import { useConfirm } from '@/components/ui/dialogs';

export function JarvisSkillsTab() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AiSkill | null>(null);
  const [versions, setVersions] = useState<AiSkill | null>(null);

  const { data: skills, isLoading } = useQuery({
    queryKey: ['ai-skills', orgId],
    queryFn: () => aiCatalogService.listSkills(),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['ai-skills'] });

  const confirm = useConfirm();
  const handleDelete = async (skill: AiSkill) => {
    if (!(await confirm({ title: `Excluir a skill "${skill.name}"?`, tone: 'danger' }))) return;
    try {
      await aiCatalogService.removeSkill(skill.id);
      toast.success('Skill excluída');
      refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao excluir');
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            <Sparkles className="h-5 w-5 text-primary" />
            Skills
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Bundles reutilizáveis de tools + instruções. Atribua a um agent pra
            ele ganhar a capacidade.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Nova skill
        </button>
      </div>

      {isLoading && (
        <div className="h-40 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
      )}

      {skills && skills.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-zinc-200 p-10 text-center dark:border-zinc-800">
          <Sparkles className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-3 text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Nenhuma skill cadastrada
          </p>
          <p className="mt-1 max-w-md text-center text-xs text-zinc-400 mx-auto">
            Crie skills pra empacotar tools + instruções e reutilizar entre
            agents. Ex: &quot;Liberação de acesso&quot; com a tool unlockCourseAccess
            + prompt instruindo quando usar.
          </p>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {(skills ?? []).map((skill) => (
          <div
            key={skill.id}
            className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {skill.name}
                  </p>
                  {skill.category && (
                    <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase text-zinc-500 dark:bg-zinc-800">
                      {skill.category}
                    </span>
                  )}
                  <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                    v{skill.currentVersion}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-600 line-clamp-2 dark:text-zinc-400">
                  {skill.description}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => setVersions(skill)}
                  title="Histórico de versões"
                  className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                >
                  <History className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setEditing(skill)}
                  className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(skill)}
                  className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
              <span className="inline-flex items-center gap-1">
                <Bot className="h-3 w-3" /> {skill._count?.agents ?? 0} agents
              </span>
              <span className="inline-flex items-center gap-1">
                <History className="h-3 w-3" /> {skill._count?.versions ?? 0} versões
              </span>
            </div>

            {skill.tool && (
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="text-[10px] text-zinc-500">via</span>
                <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {skill.tool.name}
                </code>
                <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[9px] uppercase text-zinc-600 dark:bg-zinc-700">
                  {skill.source}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      <SkillDialog
        open={showCreate}
        skill={null}
        onClose={() => setShowCreate(false)}
        onSaved={() => {
          refresh();
          setShowCreate(false);
        }}
      />
      <SkillDialog
        open={!!editing}
        skill={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          refresh();
          setEditing(null);
        }}
      />
      <SkillVersionsDialog
        skill={versions}
        onClose={() => setVersions(null)}
      />
    </div>
  );
}
