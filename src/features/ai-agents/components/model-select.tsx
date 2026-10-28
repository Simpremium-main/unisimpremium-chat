'use client';

import { useQuery } from '@tanstack/react-query';
import { useOrgId } from '@/hooks/use-org-query-key';
import { DEFAULT_AGENT_MODEL, formatModelLabel } from '../services/ai-agents.service';
import {
  AI_PROVIDER_LABEL,
  aiProvidersService,
  type AiProvider,
} from '../services/ai-providers.service';

interface ModelSelectProps {
  value: string;
  onChange: (modelId: string) => void;
  /** Texto da opção vazia (ex.: "Igual ao modelo principal"); sem ele não há opção vazia. */
  emptyLabel?: string;
  /** Esconde a opção "Padrão da organização". */
  hideDefault?: boolean;
  className?: string;
}

const PROVIDER_ORDER: AiProvider[] = ['anthropic', 'openai'];

/**
 * Seletor de modelo (Claude / ChatGPT) com os modelos que as chaves da org
 * enxergam. IDs fora da lista (legados ou digitados) continuam visíveis.
 */
export function ModelSelect({ value, onChange, emptyLabel, hideDefault, className }: ModelSelectProps) {
  const orgId = useOrgId();
  const { data } = useQuery({
    queryKey: ['ai-provider-models', orgId],
    queryFn: () => aiProvidersService.models(),
    staleTime: 5 * 60_000,
  });
  const { data: settings } = useQuery({
    queryKey: ['ai-providers', orgId],
    queryFn: () => aiProvidersService.get(),
    staleTime: 60_000,
  });

  const models = data?.models ?? [];
  const known = new Set(models.map((m) => m.id));
  const isCustom =
    !!value && value !== DEFAULT_AGENT_MODEL && !known.has(value);
  const defaultHint = settings?.effectiveDefaultModel
    ? ` (${formatModelLabel(settings.effectiveDefaultModel)})`
    : '';

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={
        className ??
        'mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100'
      }
    >
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {!hideDefault && (
        <option value={DEFAULT_AGENT_MODEL}>Padrão da organização{defaultHint}</option>
      )}
      {PROVIDER_ORDER.map((provider) => {
        const list = models.filter((m) => m.provider === provider);
        if (list.length === 0) return null;
        const configured = settings?.providers[provider]?.configured;
        return (
          <optgroup
            key={provider}
            label={`${AI_PROVIDER_LABEL[provider]}${configured ? '' : ' — sem chave'}`}
          >
            {list.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </optgroup>
        );
      })}
      {isCustom && (
        <option value={value}>
          {value}
          {/^(anthropic|openai)\/|^(claude-|gpt-|o\d)/.test(value)
            ? ' (fora da lista)'
            : ' (antigo — usa o padrão da organização)'}
        </option>
      )}
    </select>
  );
}
