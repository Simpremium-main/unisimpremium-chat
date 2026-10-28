'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, X, Check } from 'lucide-react';
import {
  channelsService,
  type Channel,
} from '@/features/channels/services/channels.service';
import { useQuery } from '@tanstack/react-query';
import { useOrgId } from '@/hooks/use-org-query-key';
import { segmentsService, type Segment } from '../services/segments.service';

const inputCls =
  'flex h-10 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm ring-offset-background placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';
const labelCls = 'text-sm font-medium text-zinc-700 dark:text-zinc-300';

// Grupos são um conceito de WhatsApp — só esses canais podem compartilhar.
const GROUP_CAPABLE_TYPES = new Set(['WHATSAPP_ZAPPFY', 'WHATSAPP_OFFICIAL']);

interface SegmentFormDialogProps {
  open: boolean;
  segment?: Segment | null;
  onClose: () => void;
  onSaved: () => void;
}

export function SegmentFormDialog({
  open,
  segment,
  onClose,
  onSaved,
}: SegmentFormDialogProps) {
  const orgId = useOrgId();
  const isEdit = !!segment;

  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [primaryId, setPrimaryId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const { data: channels } = useQuery({
    queryKey: ['channels', orgId],
    queryFn: () => channelsService.list(),
    enabled: open,
  });

  const groupChannels = useMemo(
    () => (channels ?? []).filter((c) => GROUP_CAPABLE_TYPES.has(c.type)),
    [channels],
  );

  // (Re)hidrata o form quando abre/troca de segmento.
  useEffect(() => {
    if (!open) return;
    setName(segment?.name ?? '');
    const ids = segment?.members.map((m) => m.channelId) ?? [];
    setMemberIds(ids);
    setPrimaryId(segment?.primaryChannelId ?? ids[0] ?? '');
  }, [open, segment]);

  const toggleMember = (channelId: string) => {
    setMemberIds((prev) => {
      const next = prev.includes(channelId)
        ? prev.filter((id) => id !== channelId)
        : [...prev, channelId];
      // Mantém um principal válido (membro da lista).
      setPrimaryId((cur) => {
        if (next.includes(cur)) return cur;
        return next[0] ?? '';
      });
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Informe um nome para o segmento');
      return;
    }
    if (memberIds.length < 1) {
      toast.error('Selecione ao menos um canal');
      return;
    }
    if (!primaryId || !memberIds.includes(primaryId)) {
      toast.error('Escolha o canal principal entre os membros');
      return;
    }

    setSaving(true);
    try {
      if (isEdit && segment) {
        if (name.trim() !== segment.name) {
          await segmentsService.update(segment.id, { name: name.trim() });
        }
        const currentIds = [...segment.members.map((m) => m.channelId)].sort();
        const nextIds = [...memberIds].sort();
        const membersChanged =
          currentIds.length !== nextIds.length ||
          currentIds.some((id, i) => id !== nextIds[i]);
        if (membersChanged) {
          await segmentsService.setChannels(segment.id, memberIds);
        }
        if (primaryId !== segment.primaryChannelId) {
          await segmentsService.setPrimary(segment.id, primaryId);
        }
        toast.success('Segmento atualizado');
      } else {
        await segmentsService.create({
          name: name.trim(),
          channelIds: memberIds,
          primaryChannelId: primaryId,
        });
        toast.success('Segmento criado');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar segmento');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {isEdit ? 'Editar Segmento' : 'Novo Segmento'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:text-zinc-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Vários números que compartilham os mesmos grupos. As mensagens de grupo
          viram uma única conversa, ancorada no canal principal.
        </p>

        <div className="mt-5 space-y-5">
          <div className="space-y-1.5">
            <label className={labelCls}>Nome</label>
            <input
              className={inputCls}
              placeholder="Ex.: Comercial — Grupos"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className={labelCls}>Canais membros</label>
            {groupChannels.length === 0 ? (
              <p className="rounded-md border border-dashed border-zinc-300 p-3 text-xs text-zinc-500 dark:border-zinc-700">
                Nenhum canal WhatsApp disponível. Conecte canais WhatsApp para
                montar um segmento.
              </p>
            ) : (
              <div className="space-y-1.5">
                {groupChannels.map((ch: Channel) => {
                  const checked = memberIds.includes(ch.id);
                  return (
                    <label
                      key={ch.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                        checked
                          ? 'border-primary bg-primary/5'
                          : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={checked}
                        onChange={() => toggleMember(ch.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {ch.name}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {ch.type}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {memberIds.length > 0 && (
            <div className="space-y-1.5">
              <label className={labelCls}>Canal principal</label>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Por onde as respostas dos grupos são enviadas.
              </p>
              <select
                className={inputCls}
                value={primaryId}
                onChange={(e) => setPrimaryId(e.target.value)}
              >
                {memberIds.map((id) => {
                  const ch = groupChannels.find((c) => c.id === id);
                  return (
                    <option key={id} value={id}>
                      {ch?.name ?? id}
                    </option>
                  );
                })}
              </select>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {isEdit ? 'Salvar' : 'Criar segmento'}
          </button>
        </div>
      </div>
    </div>
  );
}
