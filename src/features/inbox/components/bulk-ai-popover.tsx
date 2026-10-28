'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, BotOff, Sparkles, Play } from 'lucide-react';

type AiOverride = boolean | null;

interface Props {
  count: number;
  disabled?: boolean;
  onSetOverride: (override: AiOverride) => void | Promise<void>;
  onEngage: () => void | Promise<void>;
}

const OPTIONS: Array<{
  value: AiOverride;
  label: string;
  hint: string;
  icon: React.ElementType;
  iconCls: string;
}> = [
  {
    value: null,
    label: 'Padrão',
    hint: 'Segue config geral, horário e canal',
    icon: Bot,
    iconCls: 'text-zinc-500',
  },
  {
    value: true,
    label: 'IA forçada',
    hint: 'Sobrepõe kill switch e horário — IA responde mesmo se geral estiver off',
    icon: Sparkles,
    iconCls: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    value: false,
    label: 'IA pausada',
    hint: 'Sobrepõe global — IA NÃO responde nessas conversas',
    icon: BotOff,
    iconCls: 'text-amber-600 dark:text-amber-400',
  },
];

/**
 * Bulk-action variant of ConversationAiToggle. Same vocabulary as the
 * per-conversation toggle (Padrão / IA forçada / IA pausada / Engajar
 * agora) but applies to N selected conversations at once via fan-out.
 *
 * Doesn't show a "current" state — selection can have mixed overrides,
 * so we just present the four target actions.
 */
export function BulkAiPopover({ count, disabled, onSetOverride, onEngage }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((p) => !p);
        }}
        disabled={disabled}
        title="Configurar IA das conversas selecionadas"
        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-violet-50 hover:text-violet-600 disabled:opacity-50 dark:hover:bg-violet-500/10 dark:hover:text-violet-400"
      >
        <Bot className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full z-30 mt-1 w-80 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              IA · {count} selecionada{count > 1 ? 's' : ''}
            </p>
          </div>
          {OPTIONS.map((opt) => {
            const OptIcon = opt.icon;
            return (
              <button
                key={String(opt.value)}
                onClick={() => {
                  setOpen(false);
                  onSetOverride(opt.value);
                }}
                disabled={disabled}
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-800"
              >
                <OptIcon className={`mt-0.5 h-4 w-4 shrink-0 ${opt.iconCls}`} />
                <div className="flex-1">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {opt.label}
                  </span>
                  <p className="mt-0.5 text-[11px] leading-tight text-zinc-500">
                    {opt.hint}
                  </p>
                </div>
              </button>
            );
          })}

          <div className="border-t border-zinc-200 dark:border-zinc-700" />
          <button
            onClick={() => {
              setOpen(false);
              onEngage();
            }}
            disabled={disabled}
            title="Faz a IA ler o histórico e responder cada uma agora — pula conversas com IA pausada."
            className="flex w-full items-start gap-3 bg-primary/5 px-3 py-2.5 text-left text-sm text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary/10 dark:hover:bg-primary/20"
          >
            <Play className="mt-0.5 h-4 w-4 shrink-0 fill-current" />
            <div className="flex-1">
              <p className="font-medium">Engajar IA agora</p>
              <p className="mt-0.5 text-[11px] leading-tight opacity-80">
                Lê o histórico de cada conversa e responde imediatamente.
              </p>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
