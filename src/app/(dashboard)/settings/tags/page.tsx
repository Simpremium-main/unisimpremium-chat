'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Tags as TagsIcon } from 'lucide-react';
import { toast } from 'sonner';
import { tagsService, type Tag } from '@/features/settings/services/tags.service';
import { useOrgId } from '@/hooks/use-org-query-key';
import { useConfirm } from '@/components/ui/dialogs';

const PRESET_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#10b981', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#6b7280'];

export default function SettingsTagsPage() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  const orgId = useOrgId();
  const { data: tags, isLoading } = useQuery({
    queryKey: ['tags', orgId],
    queryFn: () => tagsService.list(),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tags'] });

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await tagsService.create({ name: newName.trim(), color: newColor });
      setNewName('');
      toast.success('Tag criada');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar tag');
    }
  };

  const handleUpdate = async (id: string) => {
    try {
      await tagsService.update(id, { name: editName, color: editColor });
      setEditingId(null);
      toast.success('Tag atualizada');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar');
    }
  };

  const confirm = useConfirm();
  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: 'Remover esta tag?', confirmText: 'Remover', tone: 'danger' }))) return;
    try {
      await tagsService.remove(id);
      toast.success('Tag removida');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover');
    }
  };

  const startEdit = (tag: Tag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Tags</h2>
          <p className="mt-0.5 text-sm text-zinc-500">Organize conversas e contatos com tags coloridas</p>
        </div>
      </div>

      <div className="mt-6 flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Nome da tag</label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Ex: VIP, Urgente, Lead..."
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">Cor</label>
          <div className="flex gap-1">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className={`h-8 w-8 rounded-md transition-transform ${newColor === c ? 'scale-110 ring-2 ring-offset-1 ring-zinc-400' : 'hover:scale-105'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <button
          onClick={handleCreate}
          disabled={!newName.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Criar
        </button>
      </div>

      <div className="mt-6 space-y-2">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg border bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900" />
          ))
        ) : !tags?.length ? (
          <div className="flex flex-col items-center py-12 text-center">
            <TagsIcon className="h-10 w-10 text-zinc-200 dark:text-zinc-700" />
            <p className="mt-3 text-sm text-zinc-500">Nenhuma tag criada</p>
          </div>
        ) : (
          tags.map((tag) => (
            <div key={tag.id} className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
              {editingId === tag.id ? (
                <div className="flex flex-1 items-center gap-3">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                  <div className="flex gap-1">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setEditColor(c)}
                        className={`h-6 w-6 rounded ${editColor === c ? 'ring-2 ring-offset-1 ring-zinc-400' : ''}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <button onClick={() => handleUpdate(tag.id)} className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">Salvar</button>
                  <button onClick={() => setEditingId(null)} className="rounded px-3 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Cancelar</button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <div className="h-5 w-5 rounded-full" style={{ backgroundColor: tag.color }} />
                    <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{tag.name}</span>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => startEdit(tag)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleDelete(tag.id)} className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
