'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, HelpCircle, X } from 'lucide-react';

/**
 * Modais de confirmação e de entrada de texto do app — substituem o
 * `confirm()` / `prompt()` nativos do navegador.
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: 'Excluir tag?', tone: 'danger' }))) return;
 *
 *   const prompt = usePrompt();
 *   const name = await prompt({ title: 'Nome da inbox', defaultValue: 'Nova' });
 */

type Tone = 'default' | 'danger';

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: Tone;
}

export interface PromptOptions extends ConfirmOptions {
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  /** Só libera o botão quando o texto digitado for exatamente este. */
  requireMatch?: string;
}

type Request =
  | { id: number; kind: 'confirm'; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { id: number; kind: 'prompt'; options: PromptOptions; resolve: (v: string | null) => void };

let nextRequestId = 1;

interface DialogsApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const DialogsContext = createContext<DialogsApi | null>(null);

export function DialogsProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Request[]>([]);
  const current = queue[0] ?? null;

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) =>
        setQueue((q) => [...q, { id: nextRequestId++, kind: 'confirm', options, resolve }]),
      ),
    [],
  );
  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) =>
        setQueue((q) => [...q, { id: nextRequestId++, kind: 'prompt', options, resolve }]),
      ),
    [],
  );

  const close = useCallback(
    (result: boolean | string | null) => {
      if (!current) return;
      if (current.kind === 'confirm') current.resolve(result === true);
      else current.resolve(typeof result === 'string' ? result : null);
      setQueue((q) => q.slice(1));
    },
    [current],
  );

  return (
    <DialogsContext.Provider value={{ confirm, prompt }}>
      {children}
      <AnimatePresence>
        {current && <DialogView key={current.id} request={current} onClose={close} />}
      </AnimatePresence>
    </DialogsContext.Provider>
  );
}

function useDialogs(): DialogsApi {
  const ctx = useContext(DialogsContext);
  if (!ctx) throw new Error('useConfirm/usePrompt precisam do <DialogsProvider>');
  return ctx;
}

export function useConfirm() {
  return useDialogs().confirm;
}

export function usePrompt() {
  return useDialogs().prompt;
}

function DialogView({
  request,
  onClose,
}: {
  request: Request;
  onClose: (result: boolean | string | null) => void;
}) {
  const { options } = request;
  const isPrompt = request.kind === 'prompt';
  const promptOptions = isPrompt ? (options as PromptOptions) : null;
  const tone: Tone = options.tone ?? 'default';
  const [value, setValue] = useState(promptOptions?.defaultValue ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const canConfirm = !isPrompt
    ? true
    : promptOptions?.requireMatch !== undefined
      ? value.trim() === promptOptions.requireMatch
      : value.trim().length > 0;

  const cancel = useCallback(() => onClose(isPrompt ? null : false), [onClose, isPrompt]);
  const submit = useCallback(() => {
    if (!canConfirm) return;
    onClose(isPrompt ? value.trim() : true);
  }, [canConfirm, onClose, isPrompt, value]);

  // Foco inicial, ESC, trava a rolagem da página e devolve o foco ao fechar.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      if (isPrompt) inputRef.current?.select();
      else confirmRef.current?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [cancel, isPrompt]);

  const Icon = tone === 'danger' ? AlertTriangle : HelpCircle;

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.15 }}
      onMouseDown={cancel}
      role="presentation"
    >
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 4, transition: { duration: 0.12, ease: 'easeIn' } }}
        transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.8 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex gap-3 px-5 pb-4 pt-5">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                tone === 'danger'
                  ? 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400'
                  : 'bg-primary/10 text-primary'
              }`}
            >
              <Icon className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h2
                  id="app-dialog-title"
                  className="pt-1.5 text-[15px] font-semibold leading-snug text-zinc-900 dark:text-zinc-100"
                >
                  {options.title}
                </h2>
                <button
                  type="button"
                  onClick={cancel}
                  aria-label="Fechar"
                  className="-mr-1 -mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {options.description && (
                <div className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                  {options.description}
                </div>
              )}
              {isPrompt && (
                <div className="mt-3">
                  {promptOptions?.label && (
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-700 dark:text-zinc-300">
                      {promptOptions.label}
                    </label>
                  )}
                  <input
                    ref={inputRef}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={promptOptions?.placeholder ?? promptOptions?.requireMatch}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-zinc-100 bg-zinc-50/60 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
            <button
              type="button"
              onClick={cancel}
              className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 active:scale-[0.98] dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {options.cancelText ?? 'Cancelar'}
            </button>
            <button
              ref={confirmRef}
              type="submit"
              disabled={!canConfirm}
              className={`rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm outline-none transition-[background-color,transform,opacity] focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 dark:focus-visible:ring-offset-zinc-950 ${
                tone === 'danger'
                  ? 'bg-red-600 hover:bg-red-500 focus-visible:ring-red-500/40'
                  : 'bg-primary hover:opacity-90 focus-visible:ring-primary/40'
              }`}
            >
              {options.confirmText ?? (tone === 'danger' ? 'Excluir' : 'Confirmar')}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
