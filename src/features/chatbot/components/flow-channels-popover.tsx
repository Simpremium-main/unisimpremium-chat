'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { Check, Loader2, Radio } from 'lucide-react';
import { toast } from 'sonner';
import { channelsService } from '@/features/channels/services/channels.service';
import { chatbotService, type ChatbotFlow } from '../services/chatbot.service';
import { useOrgId } from '@/hooks/use-org-query-key';

/**
 * Em quais canais o robô roda. Um canal fica com um fluxo só — marcar aqui
 * tira o canal do outro fluxo (avisado na lista).
 */
export function FlowChannelsPopover({
  flow,
  onChanged,
}: {
  flow: ChatbotFlow;
  onChanged: (flow: ChatbotFlow) => void;
}) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>(flow.channels.map((c) => c.channelId));
  const [saving, setSaving] = useState(false);

  const { data: channels = [] } = useQuery({
    queryKey: ['channels', orgId],
    queryFn: () => channelsService.list(),
  });
  const { data: flows = [] } = useQuery({
    queryKey: ['chatbot-flows', orgId],
    queryFn: () => chatbotService.list(),
  });

  // Canal → outro fluxo que já o usa (pra avisar que vai trocar).
  const usedBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of flows) {
      if (f.id === flow.id) continue;
      for (const c of f.channels ?? []) map.set(c.channelId, f.name);
    }
    return map;
  }, [flows, flow.id]);

  const dirty =
    selected.length !== flow.channels.length ||
    selected.some((id) => !flow.channels.some((c) => c.channelId === id));

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = async (close: () => void) => {
    setSaving(true);
    try {
      const updated = await chatbotService.linkChannels(flow.id, selected);
      onChanged(updated);
      queryClient.invalidateQueries({ queryKey: ['chatbot-flows'] });
      toast.success(selected.length ? 'Canais do robô atualizados' : 'Robô sem canais (não vai disparar)');
      close();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao salvar canais');
    } finally {
      setSaving(false);
    }
  };

  const label =
    flow.channels.length === 0
      ? 'Nenhum canal'
      : flow.channels.length === 1
        ? flow.channels[0].channel.name
        : `${flow.channels.length} canais`;

  return (
    <Popover className="relative">
      <PopoverButton
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ${
          flow.channels.length
            ? 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'
            : 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400'
        }`}
        title="Canais onde o robô atende"
      >
        <Radio className="h-3.5 w-3.5" />
        {label}
      </PopoverButton>
      <PopoverPanel
        anchor="bottom end"
        className="z-50 w-72 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg outline-none dark:border-zinc-800 dark:bg-zinc-900 [--anchor-gap:0.25rem]"
      >
        {({ close }) => (
          <>
            <p className="px-1.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Robô atende nestes canais
            </p>
            {channels.length === 0 && (
              <p className="px-1.5 py-2 text-xs text-zinc-500">Nenhum canal cadastrado.</p>
            )}
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {channels.map((ch) => {
                const on = selected.includes(ch.id);
                const other = usedBy.get(ch.id);
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => toggle(ch.id)}
                    className="flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        on ? 'border-primary bg-primary text-white' : 'border-zinc-300 dark:border-zinc-600'
                      }`}
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-zinc-800 dark:text-zinc-200">{ch.name}</span>
                      {other && (
                        <span className="block text-[10px] text-amber-600 dark:text-amber-400">
                          {on ? `Sai do fluxo "${other}"` : `Usado no fluxo "${other}"`}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 px-1.5 text-[10px] leading-snug text-zinc-400">
              O robô só dispara com o fluxo <b>Ativo</b>. Cada canal usa um fluxo só.
            </p>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => save(close)}
                disabled={!dirty || saving}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                Salvar canais
              </button>
            </div>
          </>
        )}
      </PopoverPanel>
    </Popover>
  );
}
