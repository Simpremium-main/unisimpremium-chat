'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Wrench,
  Trash2,
  Edit2,
  Globe,
  Database,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  aiCatalogService,
  type AiTool,
} from '../../services/ai-catalog.service';
import { useOrgId } from '@/hooks/use-org-query-key';
import { ToolDialog } from './tool-dialog';
import { useConfirm } from '@/components/ui/dialogs';

export function JarvisToolsTab() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AiTool | null>(null);

  const { data: tools, isLoading } = useQuery({
    queryKey: ['ai-tools', orgId],
    queryFn: () => aiCatalogService.listTools(),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['ai-tools'] });

  const confirm = useConfirm();
  const handleDelete = async (tool: AiTool) => {
    if (
      !(await confirm({
        title: `Excluir a tool "${tool.name}"?`,
        description: 'Todas as skills que usam essa tool vão ficar sem ela.',
        tone: 'danger',
      }))
    )
      return;
    try {
      await aiCatalogService.removeTool(tool.id);
      toast.success('Tool excluída');
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
            <Wrench className="h-5 w-5 text-primary" />
            Tools (conexões)
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Providers reusáveis: HTTP API ou Postgres. Skills bind a uma tool pra
            executar ações concretas.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Nova tool
        </button>
      </div>

      {isLoading && (
        <div className="h-40 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
      )}

      {tools && tools.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-zinc-200 p-10 text-center dark:border-zinc-800">
          <Wrench className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-3 text-sm font-medium text-zinc-600">
            Nenhuma tool cadastrada
          </p>
          <p className="mt-1 max-w-md text-center text-xs text-zinc-400 mx-auto">
            Cadastre uma conexão HTTP (ex: Trivapp) ou SQL (ex: Hotwebinar) e
            depois crie skills que usam essa conexão.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {(tools ?? []).map((tool) => {
          const isHttp = tool.source === 'CUSTOM_HTTP';
          const Icon = isHttp ? Globe : Database;
          return (
            <div
              key={tool.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-primary" />
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {tool.name}
                    </p>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] uppercase ${
                        isHttp
                          ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      }`}
                    >
                      {isHttp ? 'HTTP' : 'SQL'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-600 line-clamp-2 dark:text-zinc-400">
                    {tool.description}
                  </p>
                  {isHttp && tool.httpBaseUrl && (
                    <code className="mt-2 block truncate text-[11px] font-mono text-zinc-400">
                      {tool.httpBaseUrl}
                    </code>
                  )}
                  {!isHttp && tool.sqlConnectionRef && (
                    <code className="mt-2 block truncate text-[11px] font-mono text-zinc-400">
                      {`{{env.${tool.sqlConnectionRef}}}`}
                    </code>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => setEditing(tool)}
                    className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(tool)}
                    className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {tool._count && tool._count.skills > 0 && (
                <div className="mt-3 flex items-center gap-1 text-[11px] text-zinc-500">
                  <Sparkles className="h-3 w-3" />
                  {tool._count.skills} skill{tool._count.skills > 1 ? 's' : ''} usando
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ToolDialog
        open={showCreate}
        tool={null}
        onClose={() => setShowCreate(false)}
        onSaved={() => {
          refresh();
          setShowCreate(false);
        }}
      />
      <ToolDialog
        open={!!editing}
        tool={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          refresh();
          setEditing(null);
        }}
      />
    </div>
  );
}
