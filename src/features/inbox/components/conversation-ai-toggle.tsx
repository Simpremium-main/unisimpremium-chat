'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, BotOff, Sparkles, Check, Play, RotateCcw } from 'lucide-react';
import type { Conversation } from '../services/inbox.service';

type AiOverride = boolean | null;

interface Props {
  conversation: Conversation;
  disabled?: boolean;
  onChange: (next: AiOverride) => void | Promise<void>;
  onEngage: () => void | Promise<void>;
  /** Só admin: zera a conversa para a IA (teste). */
  onRestart?: () => void | Promise<void>;
}

const OPTIONS: Array<{
  value: AiOverride;
  label: string;
  hint: string;
  icon: React.ElementType;
  badgeCls: string;
  iconCls: string;
}> = [
  {
    value: null,
    label: 'Padrão',
    hint: 'Segue config geral, horário e canal',
    icon: Bot,
    badgeCls:
      'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700',
    iconCls: 'text-zinc-500',
  },
  {
    value: true,
    label: 'IA forçada',
    hint: 'Sobrepõe kill switch e horário — IA responde mesmo se geral estiver off',
    icon: Sparkles,
    badgeCls:
      'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/30',
    iconCls: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    value: false,
    label: 'IA pausada',
    hint: 'Sobrepõe global — IA NÃO responde nesta conversa',
    icon: BotOff,
    badgeCls:
      'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400 dark:hover:bg-amber-900/30',
    iconCls: 'text-amber-600 dark:text-amber-400',
  },
];

export function ConversationAiToggle({
  conversation,
  disabled,
  onChange,
  onEngage,
  onRestart,
}: Props) {
  const current =
    conversation.aiEnabled === undefined ? null : (conversation.aiEnabled as AiOverride);
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

  const meta = OPTIONS.find((o) => o.value === current) ?? OPTIONS[0];
  const Icon = meta.icon;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((p) => !p);
        }}
        disabled={disabled}
        title={meta.hint}
        aria-label={meta.label}
        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors md:h-auto md:px-2.5 md:py-1.5 ${meta.badgeCls}`}
      >
        <Icon className={`h-3.5 w-3.5 ${meta.iconCls}`} />
        <span className="hidden md:inline">{meta.label}</span>
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          // Mobile: fixo na tela — o cabeçalho rola na horizontal e cortaria
          // um menu absoluto.
          className="z-30 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg max-md:fixed max-md:inset-x-2 max-md:top-14 md:absolute md:right-0 md:top-full md:mt-1 md:w-80 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              IA nesta conversa
            </p>
          </div>
          {OPTIONS.map((opt) => {
            const isActive = opt.value === current;
            const OptIcon = opt.icon;
            return (
              <button
                key={String(opt.value)}
                onClick={() => {
                  setOpen(false);
                  onChange(opt.value);
                }}
                disabled={disabled}
                className={`flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                  isActive ? 'bg-zinc-50 dark:bg-zinc-800' : ''
                }`}
              >
                <OptIcon className={`mt-0.5 h-4 w-4 shrink-0 ${opt.iconCls}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {opt.label}
                    </span>
                    {isActive && <Check className="h-3 w-3 text-emerald-600" />}
                  </div>
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
            disabled={disabled || current === false}
            title={
              current === false
                ? 'A IA está pausada nesta conversa. Reative antes de engajar.'
                : 'Faz a IA ler o histórico e responder agora, sem esperar nova mensagem do cliente.'
            }
            className="flex w-full items-start gap-3 bg-primary/5 px-3 py-2.5 text-left text-sm text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary/10 dark:hover:bg-primary/20"
          >
            <Play className="mt-0.5 h-4 w-4 shrink-0 fill-current" />
            <div className="flex-1">
              <p className="font-medium">Engajar IA agora</p>
              <p className="mt-0.5 text-[11px] leading-tight opacity-80">
                Lê o histórico, entende o contexto e responde imediatamente.
              </p>
            </div>
          </button>
          {onRestart && (
            <button
              onClick={() => {
                setOpen(false);
                onRestart();
              }}
              disabled={disabled}
              className="flex w-full items-start gap-3 border-t border-zinc-200 px-3 py-2.5 text-left text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-zinc-700 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1">
                <p className="font-medium">Reiniciar (teste)</p>
                <p className="mt-0.5 text-[11px] leading-tight opacity-80">
                  A IA começa do zero: ignora o histórico, pedidos já confirmados e transferências. Só admin.
                </p>
              </div>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
