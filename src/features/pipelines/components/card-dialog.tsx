'use client';

import { useEffect, useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  pipelinesService,
  type CardSummary,
} from '../services/pipelines.service';
import { useConfirm } from '@/components/ui/dialogs';

interface Props {
  open: boolean;
  pipelineId: string;
  card: CardSummary | null;
  stageId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

interface KirvanoMeta {
  event?: string;
  productName?: string | null;
  paymentMethod?: string | null;
  saleId?: string | null;
  checkoutUrl?: string | null;
  utm?: Record<string, unknown> | null;
}

function KirvanoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-zinc-500">{label}</span>
      <span className="truncate text-right font-medium text-zinc-800 dark:text-zinc-200">
        {value}
      </span>
    </div>
  );
}

export function CardDialog({
  open,
  pipelineId,
  card,
  stageId,
  onClose,
  onSaved,
}: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');
  const [closedReason, setClosedReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (card) {
      setTitle(card.title);
      setDescription(card.description ?? '');
      setValue(card.value ? String(card.value) : '');
      setClosedReason(card.closedReason ?? '');
    } else {
      setTitle('');
      setDescription('');
      setValue('');
      setClosedReason('');
    }
  }, [card, open]);

  // Hooks antes do retorno antecipado (a ordem dos hooks não pode mudar).
  const confirm = useConfirm();

  if (!open) return null;

  const meta = (card?.metadata ?? {}) as Record<string, unknown>;
  const kirvano = (meta.kirvano as KirvanoMeta | undefined) ?? null;
  const utmSource =
    kirvano?.utm && typeof kirvano.utm === 'object'
      ? (kirvano.utm as Record<string, unknown>).utm_source
      : undefined;
  const attempts = (meta.outreach as { attempts?: number } | undefined)
    ?.attempts;

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error('Título é obrigatório');
      return;
    }
    setSaving(true);
    try {
      const numericValue = value ? parseFloat(value.replace(',', '.')) : undefined;
      if (card) {
        await pipelinesService.updateCard(card.id, {
          title: title.trim(),
          description: description || null,
          value: numericValue as any,
          closedReason: closedReason || undefined,
        } as any);
      } else {
        await pipelinesService.createCard(pipelineId, {
          title: title.trim(),
          description: description || undefined,
          value: numericValue,
          stageId: stageId ?? undefined,
        });
      }
      toast.success(card ? 'Card atualizado' : 'Card criado');
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!card) return;
    if (!(await confirm({ title: `Excluir o card "${card.title}"?`, tone: 'danger' }))) return;
    setSaving(true);
    try {
      await pipelinesService.removeCard(card.id);
      toast.success('Card removido');
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao excluir');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-zinc-900">
        <div className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {card ? 'Editar card' : 'Novo card'}
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Título
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ex: Lead chip Europa"
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Descrição
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="contexto, próximos passos, info coletada…"
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Valor (R$)
            </label>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="ex: 4500"
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              inputMode="decimal"
            />
          </div>

          {card && card.status !== 'OPEN' && (
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Motivo do fechamento
              </label>
              <input
                value={closedReason}
                onChange={(e) => setClosedReason(e.target.value)}
                placeholder={
                  card.status === 'WON'
                    ? 'ex: assinou contrato 12 meses'
                    : 'ex: optou por concorrente'
                }
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
          )}

          {card?.contact && (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/50">
              <p className="text-zinc-500">Contato</p>
              <p className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-100">
                {card.contact.name || card.contact.phone}
              </p>
            </div>
          )}

          {kirvano && (
            <div className="space-y-1.5 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/50">
              <p className="font-medium text-zinc-500">Recuperação (Kirvano)</p>
              {kirvano.productName && (
                <KirvanoRow label="Produto" value={kirvano.productName} />
              )}
              {kirvano.event && (
                <KirvanoRow label="Origem" value={kirvano.event} />
              )}
              {kirvano.paymentMethod && (
                <KirvanoRow label="Pagamento" value={kirvano.paymentMethod} />
              )}
              {kirvano.saleId && (
                <KirvanoRow label="Sale ID" value={kirvano.saleId} />
              )}
              {utmSource ? (
                <KirvanoRow label="UTM source" value={String(utmSource)} />
              ) : null}
              {typeof attempts === 'number' && (
                <KirvanoRow label="Tentativas" value={String(attempts)} />
              )}
              {kirvano.checkoutUrl && (
                <a
                  href={kirvano.checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block pt-0.5 font-medium text-primary hover:underline"
                >
                  Abrir checkout →
                </a>
              )}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-zinc-200 bg-zinc-50 px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
          <div>
            {card && (
              <button
                onClick={handleDelete}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-900/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Excluir
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !title}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Salvando…' : card ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
