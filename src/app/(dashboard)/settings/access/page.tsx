'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Trash2, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import { useOrgId } from '@/hooks/use-org-query-key';
import { useConfirm } from '@/components/ui/dialogs';
import {
  accessService,
  type AccessCatalogItem,
  type AccessProfile,
} from '@/features/access/access.service';

type Draft = { id: string | null; name: string; description: string; pages: string[]; actions: string[] };

const EMPTY: Draft = { id: null, name: '', description: '', pages: ['inbox'], actions: [] };

/** Configurações → Perfis de acesso: o que cada tipo de atendente vê e pode fazer. */
export default function SettingsAccessPage() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: catalog } = useQuery({ queryKey: ['access-catalog'], queryFn: () => accessService.catalog() });
  const { data: profiles, isLoading } = useQuery({
    queryKey: ['access-profiles', orgId],
    queryFn: () => accessService.list(),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  // Abre o primeiro perfil ao carregar.
  useEffect(() => {
    if (!draft && profiles?.length) select(profiles[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles]);

  const select = (p: AccessProfile) =>
    setDraft({ id: p.id, name: p.name, description: p.description ?? '', pages: p.pages, actions: p.actions });

  const dirty = useMemo(() => {
    if (!draft) return false;
    const original = profiles?.find((p) => p.id === draft.id);
    if (!original) return true;
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
    return (
      original.name !== draft.name ||
      (original.description ?? '') !== draft.description ||
      !same(original.pages, draft.pages) ||
      !same(original.actions, draft.actions)
    );
  }, [draft, profiles]);

  const toggle = (field: 'pages' | 'actions', key: string) =>
    setDraft((d) => {
      if (!d) return d;
      const on = d[field].includes(key);
      // Página com sub-páginas (Jarvis): marcar libera todas as abas,
      // desmarcar tira junto. Depois dá para desmarcar abas uma a uma.
      const children = (catalog?.pages ?? []).filter((p) => p.parent === key).map((p) => p.key);
      if (field === 'pages' && children.length > 0) {
        return {
          ...d,
          pages: on
            ? d.pages.filter((k) => k !== key && !children.includes(k))
            : [...new Set([...d.pages, key, ...children])],
        };
      }
      return { ...d, [field]: on ? d[field].filter((k) => k !== key) : [...d[field], key] };
    });

  const save = async () => {
    if (!draft) return;
    if (draft.name.trim().length < 2) return toast.error('Dê um nome ao perfil');
    setSaving(true);
    try {
      const input = { name: draft.name.trim(), description: draft.description.trim() || undefined, pages: draft.pages, actions: draft.actions };
      const saved = draft.id ? await accessService.update(draft.id, input) : await accessService.create(input);
      await qc.invalidateQueries({ queryKey: ['access-profiles'] });
      setDraft({ ...draft, id: saved.id });
      toast.success(draft.id ? 'Perfil atualizado — vale na hora para quem usa' : 'Perfil criado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: AccessProfile) => {
    if (
      !(await confirm({
        title: `Excluir o perfil "${p.name}"?`,
        description: p._count?.members
          ? `${p._count.members} membro(s) usam este perfil e voltam ao acesso padrão de atendente.`
          : 'Ninguém usa este perfil.',
        tone: 'danger',
      }))
    )
      return;
    try {
      await accessService.remove(p.id);
      await qc.invalidateQueries({ queryKey: ['access-profiles'] });
      setDraft(null);
      toast.success('Perfil excluído');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            <UserCog className="h-5 w-5 text-primary" />
            Perfis de acesso
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Escolha quais páginas aparecem e o que cada tipo de atendente pode fazer. Valem para membros com role
            Atendente; donos e admins sempre têm acesso total. Atribua o perfil em Membros.
          </p>
        </div>
        <button
          onClick={() => setDraft({ ...EMPTY })}
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Novo perfil
        </button>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="space-y-1.5">
          {isLoading && <div className="h-24 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />}
          {(profiles ?? []).map((p) => (
            <button
              key={p.id}
              onClick={() => select(p)}
              className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                draft?.id === p.id
                  ? 'border-primary bg-primary/5'
                  : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900'
              }`}
            >
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{p.name}</p>
              <p className="text-[11px] text-zinc-500">
                {p._count?.members ?? 0} membro(s) · {p.pages.length} página(s) · {p.actions.length} ação(ões)
              </p>
            </button>
          ))}
          {draft && !draft.id && (
            <div className="rounded-lg border border-dashed border-primary px-3 py-2 text-sm text-primary">Novo perfil</div>
          )}
        </div>

        {draft ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Nome</label>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Ex.: Atendente, Vendedor, Suporte"
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Descrição</label>
                <input
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="Opcional"
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
            </div>

            <CheckGroup
              title="Páginas que aparecem"
              items={catalog?.pages ?? []}
              selected={draft.pages}
              onToggle={(k) => toggle('pages', k)}
            />
            <CheckGroup
              title="O que pode fazer"
              items={catalog?.actions ?? []}
              selected={draft.actions}
              onToggle={(k) => toggle('actions', k)}
            />

            <div className="mt-5 flex items-center justify-between gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              {draft.id ? (
                <button
                  onClick={() => {
                    const p = profiles?.find((x) => x.id === draft.id);
                    if (p) remove(p);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                >
                  <Trash2 className="h-4 w-4" />
                  Excluir
                </button>
              ) : (
                <span />
              )}
              <button
                onClick={save}
                disabled={saving || !dirty}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Salvando…' : draft.id ? 'Salvar alterações' : 'Criar perfil'}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-200 p-10 text-center text-sm text-zinc-500 dark:border-zinc-800">
            Selecione um perfil
          </div>
        )}
      </div>
    </div>
  );
}

function CheckGroup({
  title,
  items,
  selected,
  onToggle,
}: {
  title: string;
  items: AccessCatalogItem[];
  selected: string[];
  onToggle: (key: string) => void;
}) {
  return (
    <div className="mt-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {items.filter((item) => !item.parent).map((item) => {
          const on = selected.includes(item.key);
          const children = items.filter((c) => c.parent === item.key);
          return (
            <div key={item.key} className={children.length > 0 && on ? 'sm:col-span-2' : undefined}>
            <button
              type="button"
              onClick={() => onToggle(item.key)}
              className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                on ? 'border-primary bg-primary/5' : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50'
              }`}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  on ? 'border-primary bg-primary text-primary-foreground' : 'border-zinc-300 dark:border-zinc-600'
                }`}
              >
                {on && <Check className="h-3 w-3" />}
              </span>
              <span>
                <span className="block text-sm text-zinc-900 dark:text-zinc-100">{item.label}</span>
                {item.description && <span className="block text-[11px] text-zinc-500">{item.description}</span>}
              </span>
            </button>
            {children.length > 0 && on && (
              <div className="ml-6 mt-2 border-l border-zinc-200 pl-3 dark:border-zinc-800">
                <p className="text-[11px] text-zinc-500">Abas que aparecem:</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {children.map((c) => {
                    const childOn = selected.includes(c.key);
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => onToggle(c.key)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                          childOn
                            ? 'border-primary bg-primary/5 text-zinc-900 dark:text-zinc-100'
                            : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50'
                        }`}
                      >
                        {childOn && <Check className="h-3 w-3" />}
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
