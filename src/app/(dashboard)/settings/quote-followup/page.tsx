'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Timer } from 'lucide-react';
import { api } from '@/lib/api';

interface QuoteFollowupSettings {
  enabled: boolean;
  followupDelayHours: number;
  closeDelayHours: number;
  windowStartHour: number;
  windowEndHour: number;
}

interface Limits {
  followupDelayHours: { min: number; max: number };
  closeDelayHours: { min: number; max: number };
}

const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Configurações → Cobrança de cotação: prazos e horário da cobrança feita pela IA. */
export default function QuoteFollowupSettingsPage() {
  const [form, setForm] = useState<QuoteFollowupSettings | null>(null);
  const [defaults, setDefaults] = useState<QuoteFollowupSettings | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get('/ai-settings/quote-followup')
      .then(({ data }) => {
        const body = data.data ?? data;
        setForm(body.settings);
        setDefaults(body.defaults);
        setLimits(body.limits);
      })
      .catch((err) => toast.error(err?.response?.data?.message || 'Erro ao carregar as configurações'));
  }, []);

  if (!form || !limits) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  const set = <K extends keyof QuoteFollowupSettings>(key: K, value: QuoteFollowupSettings[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  const invalidWindow = form.windowStartHour >= form.windowEndHour;

  const save = async () => {
    if (invalidWindow) return;
    setSaving(true);
    try {
      const { data } = await api.put('/ai-settings/quote-followup', form);
      setForm((data.data ?? data).settings);
      toast.success('Cobrança de cotação salva');
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      toast.error(Array.isArray(msg) ? msg.join(', ') : msg || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-24 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-primary focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
  const hours = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Cobrança de cotação</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Retorno automático da IA quando o cliente recebe a cotação e não responde.
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving || invalidWindow}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Salvar
        </button>
      </div>

      <div className="mt-6 space-y-4">
        <label className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-3">
            <Timer className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Cobrança automática ativa</p>
              <p className="text-xs text-zinc-500">Desligada, a IA não cobra nem encerra as conversas de cotação sem retorno.</p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
        </label>

        <div className={`space-y-5 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 ${form.enabled ? '' : 'opacity-60'}`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">1. Cobrança</p>
              <p className="text-xs text-zinc-500">
                Horas sem resposta depois da última mensagem até a IA perguntar se ficou alguma dúvida.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
              <input
                type="number"
                min={limits.followupDelayHours.min}
                max={limits.followupDelayHours.max}
                value={form.followupDelayHours}
                disabled={!form.enabled}
                onChange={(e) => set('followupDelayHours', Number(e.target.value))}
                className={inputCls}
              />
              horas
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">2. Encerramento</p>
              <p className="text-xs text-zinc-500">
                Horas sem resposta depois da cobrança até a IA mandar a mensagem de encerramento e fechar o atendimento.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
              <input
                type="number"
                min={limits.closeDelayHours.min}
                max={limits.closeDelayHours.max}
                value={form.closeDelayHours}
                disabled={!form.enabled}
                onChange={(e) => set('closeDelayHours', Number(e.target.value))}
                className={inputCls}
              />
              horas
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Horário de envio (Brasília)</p>
              <p className="text-xs text-zinc-500">
                Fora desse horário, a mensagem fica para a abertura do próximo período.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
              das
              <select
                value={form.windowStartHour}
                disabled={!form.enabled}
                onChange={(e) => set('windowStartHour', Number(e.target.value))}
                className={inputCls}
              >
                {hours(0, 23).map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
              às
              <select
                value={form.windowEndHour}
                disabled={!form.enabled}
                onChange={(e) => set('windowEndHour', Number(e.target.value))}
                className={inputCls}
              >
                {hours(1, 24).map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {invalidWindow && <p className="text-xs text-red-600">O início precisa ser antes do fim.</p>}
        </div>

        {defaults && (
          <p className="text-xs text-zinc-500">
            Padrão: cobrança após {defaults.followupDelayHours}h, encerramento {defaults.closeDelayHours}h depois da
            cobrança, das {hourLabel(defaults.windowStartHour)} às {hourLabel(defaults.windowEndHour)}. Para mudar os
            textos, crie em Jarvis → Fluxos os fluxos <code>cobranca-cotacao</code> e <code>encerramento-cotacao</code>{' '}
            (sem eles, a IA usa o texto padrão).
          </p>
        )}
      </div>
    </div>
  );
}
