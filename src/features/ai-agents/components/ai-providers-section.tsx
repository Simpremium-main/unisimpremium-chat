'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useOrgId } from '@/hooks/use-org-query-key';
import { useConfirm } from '@/components/ui/dialogs';
import { formatModelLabel } from '../services/ai-agents.service';
import {
  AI_PROVIDER_LABEL,
  aiProvidersService,
  type AiProvider,
  type AiProvidersSettings,
  type UpdateAiProvidersInput,
} from '../services/ai-providers.service';
import { ModelSelect } from './model-select';

const PROVIDERS: Array<{ id: AiProvider; field: 'anthropicKey' | 'openaiKey'; placeholder: string; keysUrl: string }> = [
  {
    id: 'anthropic',
    field: 'anthropicKey',
    placeholder: 'sk-ant-…',
    keysUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    field: 'openaiKey',
    placeholder: 'sk-…',
    keysUrl: 'https://platform.openai.com/api-keys',
  },
];

function errorText(err: any, fallback: string): string {
  const msg = err?.response?.data?.message;
  return (Array.isArray(msg) ? msg.join(', ') : msg) || fallback;
}

/** Chaves do ChatGPT / Claude da organização e o modelo padrão. */
export function AiProvidersSection() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['ai-providers', orgId],
    queryFn: () => aiProvidersService.get(),
  });

  const save = async (input: UpdateAiProvidersInput, success: string) => {
    const updated = await aiProvidersService.update(input);
    qc.setQueryData(['ai-providers', orgId], updated);
    qc.invalidateQueries({ queryKey: ['ai-provider-models', orgId] });
    toast.success(success);
  };

  return (
    <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
        <KeyRound className="h-4 w-4 text-primary" />
        Provedores de IA
      </p>
      <p className="mt-0.5 text-xs text-zinc-500">
        Cadastre a chave de API do Claude, do ChatGPT ou dos dois. Cada agente escolhe o
        modelo na tela dele. As chaves ficam cifradas e não aparecem de novo depois de salvas.
      </p>

      {isLoading || !data ? (
        <div className="mt-4 h-40 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
      ) : (
        <>
          <div className="mt-4 space-y-3">
            {PROVIDERS.map((p) => (
              <ProviderKeyRow key={p.id} provider={p} settings={data} onSave={save} />
            ))}
          </div>

          <div className="mt-5 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Modelo padrão
            </label>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Usado pelos agentes em &quot;Padrão da organização&quot; e pelas tarefas internas
              (classificar intenção, memória, ranking de busca).
            </p>
            <div className="mt-1.5 max-w-md">
              <ModelSelect
                value={data.defaultModel ?? ''}
                hideDefault
                emptyLabel={`Automático${
                  data.effectiveDefaultModel && !data.defaultModel
                    ? ` (${formatModelLabel(data.effectiveDefaultModel)})`
                    : ' (o mais barato com chave)'
                }`}
                onChange={(value) =>
                  save({ defaultModel: value || null }, 'Modelo padrão salvo').catch((err) =>
                    toast.error(errorText(err, 'Erro ao salvar o modelo padrão')),
                  )
                }
              />
            </div>
            {!data.effectiveDefaultModel && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                Sem nenhuma chave cadastrada os agentes de IA não respondem.
              </p>
            )}
          </div>

          <p className="mt-4 text-[11px] text-zinc-500">
            Transcrição de áudio e busca semântica na memória (RAG) só existem na OpenAI: sem a
            chave do ChatGPT esses dois recursos ficam desligados.
          </p>
        </>
      )}
    </section>
  );
}

function ProviderKeyRow({
  provider,
  settings,
  onSave,
}: {
  provider: (typeof PROVIDERS)[number];
  settings: AiProvidersSettings;
  onSave: (input: UpdateAiProvidersInput, success: string) => Promise<void>;
}) {
  const status = settings.providers[provider.id];
  const label = AI_PROVIDER_LABEL[provider.id];
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);
  const confirm = useConfirm();

  const handleSave = async () => {
    if (!value.trim()) return;
    setBusy('save');
    try {
      await onSave({ [provider.field]: value.trim() }, `Chave ${label} salva e verificada`);
      setValue('');
    } catch (err) {
      toast.error(errorText(err, 'Erro ao salvar a chave'));
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    setBusy('test');
    try {
      const res = await aiProvidersService.test(provider.id);
      toast.success(`Chave ${label} funcionando (${res.models} modelos disponíveis)`);
    } catch (err) {
      toast.error(errorText(err, 'A chave não funcionou'));
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async () => {
    if (
      !(await confirm({
        title: `Remover a chave ${label}?`,
        description: 'Agentes que usam esse provedor passam a usar o modelo padrão.',
        tone: 'danger',
        confirmText: 'Remover',
      }))
    )
      return;
    setBusy('remove');
    try {
      await onSave({ [provider.field]: null }, `Chave ${label} removida`);
    } catch (err) {
      toast.error(errorText(err, 'Erro ao remover a chave'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
          {status.configured ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              {status.source === 'env' ? 'Chave do servidor' : status.hint}
            </span>
          ) : (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              Não configurada
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <a
            href={provider.keysUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            Gerar chave <ExternalLink className="h-3 w-3" />
          </a>
          {status.configured && (
            <button
              type="button"
              onClick={handleTest}
              disabled={busy !== null}
              className="rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {busy === 'test' ? 'Testando…' : 'Testar'}
            </button>
          )}
          {status.source === 'organization' && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy !== null}
              className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              Remover
            </button>
          )}
        </div>
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
      >
        <input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={status.configured ? 'Colar nova chave para trocar' : provider.placeholder}
          className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 font-mono text-sm placeholder:font-sans dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={!value.trim() || busy !== null}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy === 'save' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Salvar
        </button>
      </form>
    </div>
  );
}
