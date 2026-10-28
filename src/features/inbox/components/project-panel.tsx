'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, ExternalLink, Loader2, FolderKanban, Save } from 'lucide-react';
import { membersService } from '@/features/settings/services/members.service';
import {
  projectsService,
  type ProjectSummary,
} from '@/features/projects/services/projects.service';
import {
  PROJECT_FIELDS,
  buildUpdatePayload,
  hoppeTaskUrl,
  readField,
  type ProjectFieldDef,
} from '@/features/projects/project-fields';

interface ProjectPanelProps {
  conversationId: string;
  onClose: () => void;
}

const inputCls =
  'w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
const labelCls =
  'text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500';

/**
 * Painel lateral de Projeto (grupo = projeto). Renderiza os campos a partir do
 * registry PROJECT_FIELDS — adicionar campo novo é só editar o registry. Salva
 * via PUT /projects/by-conversation/:id (upsert por JID).
 */
export function ProjectPanel({ conversationId, onClose }: ProjectPanelProps) {
  const queryClient = useQueryClient();

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', conversationId],
    queryFn: () => projectsService.getByConversation(conversationId),
  });

  const { data: members = [] } = useQuery({
    queryKey: ['org-members'],
    queryFn: () => membersService.list(),
    staleTime: 60_000,
  });

  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  // (Re)hidrata o form quando o projeto carrega/troca.
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of PROJECT_FIELDS) next[f.key] = readField(project, f);
    setValues(next);
    setDirty(false);
  }, [project]);

  const setField = (key: string, val: string) => {
    setValues((v) => ({ ...v, [key]: val }));
    setDirty(true);
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      projectsService.updateByConversation(
        conversationId,
        buildUpdatePayload(values),
      ),
    onSuccess: (saved: ProjectSummary) => {
      queryClient.setQueryData(['project', conversationId], saved);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setDirty(false);
      toast.success('Projeto salvo');
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar projeto'),
  });

  const activeMembers = useMemo(
    () => members.filter((m) => m.user.isActive),
    [members],
  );

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Projeto
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-900"
              />
            ))}
          </div>
        ) : (
          PROJECT_FIELDS.map((field) => (
            <FieldRow
              key={field.key}
              field={field}
              value={values[field.key] ?? ''}
              onChange={(v) => setField(field.key, v)}
              members={activeMembers}
            />
          ))
        )}
      </div>

      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <button
          onClick={() => saveMutation.mutate()}
          disabled={!dirty || saveMutation.isPending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Salvar
        </button>
      </div>
    </aside>
  );
}

function FieldRow({
  field,
  value,
  onChange,
  members,
}: {
  field: ProjectFieldDef;
  value: string;
  onChange: (v: string) => void;
  members: { user: { id: string; name: string } }[];
}) {
  return (
    <div className="space-y-1.5">
      <label className={labelCls}>{field.label}</label>
      {field.type === 'textarea' ? (
        <textarea
          className={`${inputCls} min-h-[72px] resize-y`}
          placeholder={field.placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === 'select' ? (
        <select
          className={inputCls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : field.type === 'user' ? (
        <select
          className={inputCls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— Sem responsável —</option>
          {members.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.name}
            </option>
          ))}
        </select>
      ) : field.type === 'link' ? (
        <div className="flex items-center gap-1.5">
          <input
            className={inputCls}
            placeholder={field.placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {value.trim() && (
            <a
              href={hoppeTaskUrl(value.trim())}
              target="_blank"
              rel="noopener noreferrer"
              title="Abrir no Hoppe"
              className="shrink-0 rounded-md p-1.5 text-primary hover:bg-primary/10"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
      ) : (
        <input
          className={inputCls}
          placeholder={field.placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
