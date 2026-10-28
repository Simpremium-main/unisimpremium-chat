export const fmtUsd = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(n);

export const fmtUsdShort = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

export const fmtNum = (n: number) =>
  new Intl.NumberFormat('pt-BR').format(n);

export const fmtMs = (ms: number | null) => {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

export const fmtRelative = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s atrás`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}min atrás`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h atrás`;
  return `${Math.floor(ms / 86_400_000)}d atrás`;
};

export const FINAL_ACTION_META: Record<
  string,
  { label: string; color: string }
> = {
  REPLIED: { label: 'Respondeu', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  DELEGATED: { label: 'Delegou', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  HANDED_BACK: { label: 'Devolveu', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  TRANSFERRED_TO_HUMAN: { label: 'Pra humano', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  CLOSED_CONVERSATION: { label: 'Encerrou', color: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  NO_ACTION: { label: 'Sem ação', color: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
  NONE: { label: 'Sem ação', color: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
};

export const STATUS_META: Record<string, { label: string; color: string }> = {
  COMPLETED: { label: 'OK', color: 'bg-emerald-500' },
  RUNNING: { label: 'rodando', color: 'bg-blue-500' },
  FAILED: { label: 'falhou', color: 'bg-red-500' },
  SKIPPED: { label: 'pulada', color: 'bg-zinc-400' },
};
