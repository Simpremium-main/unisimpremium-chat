'use client';

import { useQuery } from '@tanstack/react-query';
import { X, History } from 'lucide-react';
import {
  aiCatalogService,
  type AiSkill,
} from '../../services/ai-catalog.service';
import { fmtRelative } from './format';

interface Props {
  skill: AiSkill | null;
  onClose: () => void;
}

export function SkillVersionsDialog({ skill, onClose }: Props) {
  const { data: versions } = useQuery({
    queryKey: ['ai-skill-versions', skill?.id],
    queryFn: () => aiCatalogService.listSkillVersions(skill!.id),
    enabled: !!skill,
  });

  if (!skill) return null;

  return (
    <div className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-zinc-900">
        <div className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            <History className="h-4 w-4 text-primary" />
            Histórico — {skill.name}
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-6 py-5">
          {versions === undefined ? (
            <div className="h-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
          ) : versions.length === 0 ? (
            <p className="text-center text-sm text-zinc-500">Sem versões.</p>
          ) : (
            versions.map((v, i) => (
              <div
                key={v.id}
                className={`rounded-lg border p-3 text-sm ${
                  i === 0
                    ? 'border-primary bg-primary/5 dark:bg-primary/10'
                    : 'border-zinc-200 dark:border-zinc-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-mono dark:bg-zinc-800">
                      v{v.version}
                    </span>
                    {i === 0 && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                        atual
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-zinc-500">
                    {fmtRelative(v.createdAt)}
                  </span>
                </div>
                {v.changeNote && (
                  <p className="mt-1.5 text-xs italic text-zinc-600 dark:text-zinc-400">
                    &quot;{v.changeNote}&quot;
                  </p>
                )}
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-700">
                    Ver snapshot
                  </summary>
                  <div className="mt-2 space-y-1 text-[11px]">
                    <div>
                      <span className="text-zinc-500">Nome:</span>{' '}
                      <span className="text-zinc-700 dark:text-zinc-300">
                        {v.name}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Categoria:</span>{' '}
                      <span className="text-zinc-700 dark:text-zinc-300">
                        {v.category ?? '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Source:</span>{' '}
                      <span className="text-zinc-700 dark:text-zinc-300">
                        {v.source}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Tool:</span>{' '}
                      <span className="text-zinc-700 dark:text-zinc-300">
                        {v.toolId ?? '—'}
                      </span>
                    </div>
                    {v.source === 'HTTP' && v.httpPath && (
                      <div>
                        <span className="text-zinc-500">HTTP:</span>{' '}
                        <code className="font-mono text-zinc-700 dark:text-zinc-300">
                          {v.httpMethod} {v.httpPath}
                        </code>
                      </div>
                    )}
                    {v.source === 'SQL' && v.sqlQuery && (
                      <div>
                        <span className="text-zinc-500">SQL:</span>
                        <pre className="mt-1 max-h-32 overflow-auto rounded bg-zinc-50 p-2 font-mono text-[10px] dark:bg-zinc-800">
                          {v.sqlQuery}
                        </pre>
                      </div>
                    )}
                    {v.promptInstructions && (
                      <div>
                        <span className="text-zinc-500">Prompt:</span>
                        <pre className="mt-1 max-h-40 overflow-auto rounded bg-zinc-50 p-2 font-mono text-[10px] dark:bg-zinc-800">
                          {v.promptInstructions}
                        </pre>
                      </div>
                    )}
                  </div>
                </details>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
