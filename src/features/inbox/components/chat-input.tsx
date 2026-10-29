'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Paperclip, Mic, Trash2, Square, Loader2, X, Pencil, Check, Lock, MessageSquare, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useAudioRecorder } from '../hooks/use-audio-recorder';
import { MemberAvatar } from '@/components/ui/member-avatar';
import { fillQuickReply, type QuickReply, type QuickReplyVars } from '@/features/settings/services/quick-replies.service';
import { QuickReplyPanel, filterQuickReplies, useQuickReplies } from './composer-tools';

interface ChatInputProps {
  onSend: (text: string) => Promise<void>;
  onSendAudio?: (blob: Blob) => Promise<void>;
  onSendFile?: (file: File, caption?: string) => Promise<void>;
  disabled?: boolean;
  /** Assinatura "*Nome:*"; ausente = canal sem assinatura (sem toggle). */
  signature?: SignatureControl;
  /** Outros membros com esta conversa aberta agora. */
  viewers?: ConversationViewerInfo[];
  /** Modo "Nota interna": o texto vira nota (só a equipe vê), não mensagem. */
  note?: NoteControl;
  /** Respostas rápidas (botão ⚡ e "/atalho"): nomes que preenchem {nome}/{atendente}. */
  quickReplyVars?: QuickReplyVars;
  /** Conversa atual — liga o botão "Acionar robô". */
  conversationId?: string;
}

interface NoteControl {
  active: boolean;
  onActiveChange: (active: boolean) => void;
  onSend: (text: string) => Promise<void>;
}

export interface ConversationViewerInfo {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  color?: string | null;
}

interface SignatureControl {
  enabled: boolean;
  name: string;
  onToggle: (enabled: boolean) => void;
  onRename: (name: string) => void;
}

// Espelha o whitelist do backend (UploadsService.ALLOWED_MEDIA_MIME) — o
// accept é só UX; a validação real acontece no upload.
/** Ícones da linha de cima do compositor (anexo, respostas rápidas, robô). */
const TOOL_BUTTON = 'rounded-md p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800';

const FILE_ACCEPT = [
  'image/*',
  'video/*',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.txt',
  '.csv',
  '.zip',
].join(',');

export function ChatInput({
  onSend,
  onSendAudio,
  onSendFile,
  disabled,
  signature,
  viewers,
  note,
  quickReplyVars,
  conversationId,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isSendingAudio, setIsSendingAudio] = useState(false);
  const [isSendingFile, setIsSendingFile] = useState(false);
  const [pastedImage, setPastedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorder = useAudioRecorder();
  const noteMode = !!note?.active;

  // Respostas rápidas: "/pi" na caixa abre a lista filtrada; o ⚡ abre com busca.
  const quickReplies = useQuickReplies();
  const [qrButtonOpen, setQrButtonOpen] = useState(false);
  const [qrSearch, setQrSearch] = useState('');
  const [qrIndex, setQrIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const slashQuery = text.startsWith('/') && !/\s/.test(text) ? text.slice(1) : null;
  const qrMode: 'button' | 'slash' | null = qrButtonOpen
    ? 'button'
    : slashQuery !== null && !slashDismissed
      ? 'slash'
      : null;
  const qrResults = filterQuickReplies(
    quickReplies.data ?? [],
    qrMode === 'button' ? qrSearch : (slashQuery ?? ''),
  );

  const closeQuickReplies = useCallback(() => {
    setQrButtonOpen(false);
    setSlashDismissed(true);
  }, []);

  const pickQuickReply = (reply: QuickReply) => {
    const filled = fillQuickReply(reply.content, quickReplyVars ?? {});
    const el = textareaRef.current;
    let next: string;
    let caret: number;
    if (qrMode === 'slash' || !text) {
      next = filled;
      caret = filled.length;
    } else {
      // Pelo botão com texto já digitado: entra onde está o cursor.
      const start = el?.selectionStart ?? text.length;
      const end = el?.selectionEnd ?? text.length;
      const before = text.slice(0, start);
      const sep = before && !/\s$/.test(before) ? ' ' : '';
      next = before + sep + filled + text.slice(end);
      caret = before.length + sep.length + filled.length;
    }
    setText(next);
    setQrButtonOpen(false);
    setQrSearch('');
    setSlashDismissed(true);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    });
  };

  // Entrou em modo nota (aba ou "Anotar" numa mensagem) → foco no campo.
  useEffect(() => {
    if (noteMode) textareaRef.current?.focus();
  }, [noteMode]);

  // Preview da imagem colada; revoga o objectURL em toda troca/descarte/unmount.
  useEffect(() => {
    if (!pastedImage) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pastedImage);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pastedImage]);

  const handleSubmit = useCallback(async () => {
    // Nota interna: não vai pro cliente — nada de mídia/assinatura.
    if (noteMode && note) {
      const trimmed = text.trim();
      if (!trimmed || isSending) return;
      setIsSending(true);
      try {
        await note.onSend(trimmed);
        setText('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
      } catch (err: any) {
        toast.error(err?.response?.data?.message || err?.message || 'Erro ao salvar a nota');
      } finally {
        setIsSending(false);
      }
      return;
    }
    // Envio da imagem colada (com legenda opcional vinda do textarea).
    if (pastedImage) {
      if (isSendingFile || !onSendFile) return;
      setIsSendingFile(true);
      try {
        await onSendFile(pastedImage, text.trim() || undefined);
        setPastedImage(null);
        setText('');
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
      } catch (err: any) {
        toast.error(
          err?.response?.data?.message || err?.message || 'Erro ao enviar imagem',
        );
      } finally {
        setIsSendingFile(false);
      }
      return;
    }
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    setIsSending(true);
    try {
      await onSend(trimmed);
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } finally {
      setIsSending(false);
    }
  }, [noteMode, note, pastedImage, text, isSending, isSendingFile, onSend, onSendFile]);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items || !onSendFile || noteMode) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (!file) continue;
          e.preventDefault(); // evita colar o "path" como texto
          // Prints vêm sem nome útil ("image.png"); dá um nome único p/ o upload.
          const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
          const named =
            file.name && file.name !== 'image.png'
              ? file
              : new File([file], `pasted-${Date.now()}.${ext}`, { type: file.type });
          setPastedImage(named);
          return; // usa só a primeira imagem
        }
      }
      // sem imagem no clipboard → deixa o paste de texto normal seguir
    },
    [onSendFile, noteMode],
  );

  const discardImage = () => setPastedImage(null); // useEffect revoga a URL

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (qrMode === 'slash' && qrResults.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        setQrIndex((i) => Math.min(Math.max(i + delta, 0), qrResults.length - 1));
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        pickQuickReply(qrResults[Math.min(qrIndex, qrResults.length - 1)]);
        return;
      }
    }
    if (qrMode === 'slash' && e.key === 'Escape') {
      e.preventDefault();
      setSlashDismissed(true);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const handleSendAudio = useCallback(async () => {
    if (!recorder.blob || !onSendAudio) return;
    setIsSendingAudio(true);
    try {
      await onSendAudio(recorder.blob);
      recorder.reset();
    } catch (err: any) {
      toast.error(
        err?.response?.data?.message || err?.message || 'Erro ao enviar áudio',
      );
    } finally {
      setIsSendingAudio(false);
    }
  }, [recorder, onSendAudio]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Limpa o value pra permitir reenviar o MESMO arquivo em seguida —
      // sem isso o onChange não dispara na segunda escolha.
      e.target.value = '';
      if (!file || !onSendFile) return;
      setIsSendingFile(true);
      try {
        await onSendFile(file);
      } catch (err: any) {
        toast.error(
          err?.response?.data?.message || err?.message || 'Erro ao enviar arquivo',
        );
      } finally {
        setIsSendingFile(false);
      }
    },
    [onSendFile],
  );

  const formatElapsed = (ms: number) => {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (disabled) {
    return (
      <div className="border-t border-zinc-200 bg-zinc-50 px-4 py-3 text-center text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/50">
        Conversa encerrada — reabra para enviar mensagens
      </div>
    );
  }

  // RECORDING MODE: shows a big bar with a pulsing red dot and the timer.
  if (recorder.state === 'recording') {
    return (
      <div className="border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-900/40 dark:bg-red-500/10">
          <button
            onClick={recorder.cancel}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-100 dark:hover:bg-red-500/20"
            aria-label="Cancelar gravação"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <div className="flex flex-1 items-center gap-2 text-sm text-red-700 dark:text-red-300">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
            </span>
            <span className="font-medium tabular-nums">{formatElapsed(recorder.elapsedMs)}</span>
            <span className="text-xs opacity-70">Gravando…</span>
          </div>
          <button
            onClick={recorder.stop}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500 text-white hover:bg-red-600"
            aria-label="Parar gravação"
          >
            <Square className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // PREVIEW MODE: the recording finished, user can listen/discard/send.
  if (recorder.state === 'stopped' && recorder.blob) {
    const audioSrc = URL.createObjectURL(recorder.blob);
    return (
      <div className="border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900">
          <button
            onClick={recorder.cancel}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
            aria-label="Descartar áudio"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <audio
            controls
            src={audioSrc}
            className="h-9 flex-1 min-w-0"
          />
          <button
            onClick={handleSendAudio}
            disabled={isSendingAudio}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            aria-label="Enviar áudio"
          >
            {isSendingAudio ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar
          </button>
        </div>
        {recorder.error && (
          <p className="mt-1 text-xs text-red-500">{recorder.error}</p>
        )}
      </div>
    );
  }

  // IDLE MODE: text input + mic button.
  const canRecord = !!onSendAudio;
  const showMic = canRecord && !noteMode && !text.trim() && !pastedImage;

  return (
    <div className="relative border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      {qrMode && (
        <QuickReplyPanel
          replies={qrResults}
          loading={quickReplies.isLoading}
          activeIndex={Math.min(qrIndex, Math.max(qrResults.length - 1, 0))}
          onActiveIndexChange={setQrIndex}
          onPick={pickQuickReply}
          search={qrMode === 'button' ? { value: qrSearch, onChange: setQrSearch } : undefined}
          onClose={closeQuickReplies}
          preview={(content) => fillQuickReply(content, quickReplyVars ?? {})}
        />
      )}
      {pastedImage && previewUrl && (
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-900">
          <img
            src={previewUrl}
            alt="Imagem colada"
            className="h-16 w-16 rounded-lg object-cover"
          />
          <span className="flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
            {pastedImage.name}
          </span>
          <button
            type="button"
            onClick={discardImage}
            disabled={isSendingFile}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-red-500 disabled:opacity-50 dark:hover:bg-zinc-800"
            aria-label="Descartar imagem"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="mb-2 flex items-center gap-3">
        {/* Esquerda: assinatura (ou aviso da nota) + anexo e respostas rápidas;
            direita: quem está na conversa e Mensagem | Nota interna. Na Uni a IA
            fica sempre ativa nos grupos: sem robô, rascunho da IA nem cotação aqui. */}
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {signature && !noteMode ? (
            <SignatureBar {...signature} />
          ) : noteMode ? (
            <span className="min-w-0 truncate text-xs text-amber-700 dark:text-amber-400">
              Só a equipe vê — não é enviada ao cliente
            </span>
          ) : null}
          <div className="flex shrink-0 items-center gap-0.5">
            {!noteMode && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!onSendFile || isSendingFile}
                className={`${TOOL_BUTTON} text-zinc-400 hover:text-zinc-600 disabled:cursor-not-allowed disabled:opacity-50`}
                aria-label="Anexar arquivo"
                title="Anexar arquivo"
              >
                {isSendingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </button>
            )}
            <button
              type="button"
              data-quick-reply-toggle
              onClick={() => {
                setQrButtonOpen((open) => !open);
                setQrSearch('');
                setQrIndex(0);
              }}
              className={`${TOOL_BUTTON} ${
                qrMode === 'button' ? 'bg-zinc-100 text-primary dark:bg-zinc-800' : 'text-zinc-400 hover:text-zinc-600'
              }`}
              aria-label="Respostas rápidas"
              title="Respostas rápidas (ou digite /)"
            >
              <Zap className="h-4 w-4" />
            </button>
          </div>
        </div>
        {viewers && viewers.length > 0 && <ViewersIndicator viewers={viewers} />}
        {note && <ComposerModeTabs noteMode={noteMode} onChange={note.onActiveChange} />}
      </div>
      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={FILE_ACCEPT}
          onChange={handleFileChange}
          className="hidden"
        />
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            const value = e.target.value;
            setText(value);
            // Nova barra no começo reabre a lista; o termo mudou → volta pro 1º.
            if (!value.startsWith('/')) setSlashDismissed(false);
            setQrIndex(0);
          }}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
          placeholder={
            noteMode
              ? 'Escreva uma nota interna…'
              : pastedImage
                ? 'Adicione uma legenda...'
                : 'Digite uma mensagem ou /atalho'
          }
          rows={1}
          className={`max-h-40 min-h-[40px] flex-1 resize-none rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-1 dark:text-zinc-100 ${
            noteMode
              ? 'border-amber-300 bg-amber-50 placeholder:text-amber-500/80 focus:border-amber-400 focus:ring-amber-400 dark:border-amber-800 dark:bg-amber-950/30'
              : 'border-zinc-200 bg-zinc-50 placeholder:text-zinc-400 focus:border-primary focus:ring-primary dark:border-zinc-700 dark:bg-zinc-900'
          }`}
        />
        {showMic ? (
          <button
            onClick={recorder.start}
            type="button"
            className="mb-1 rounded-lg bg-zinc-100 p-2.5 text-zinc-600 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            aria-label="Gravar áudio"
          >
            <Mic className="h-5 w-5" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={(!text.trim() && !pastedImage) || isSending || isSendingFile}
            className={`mb-1 rounded-lg p-2.5 transition-colors disabled:opacity-50 ${
              noteMode
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
            aria-label={noteMode ? 'Salvar nota interna' : 'Enviar mensagem'}
            title={noteMode ? 'Salvar nota interna' : undefined}
          >
            {isSending || isSendingFile ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : noteMode ? (
              <Lock className="h-5 w-5" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        )}
      </div>
      {recorder.error && (
        <p className="mt-1.5 text-xs text-red-500">{recorder.error}</p>
      )}
    </div>
  );
}

/**
 * Toggle da assinatura + nome que vai no topo das mensagens ("*Nome:*" em
 * negrito no WhatsApp). Lápis abre edição inline: Enter salva, Esc cancela.
 */
function SignatureBar({ enabled, name, onToggle, onRename }: SignatureControl) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const startEdit = () => {
    setDraft(name);
    setEditing(true);
  };
  const save = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      toast.error('O nome da assinatura não pode ficar vazio');
      return;
    }
    if (trimmed !== name) onRename(trimmed);
    setEditing(false);
  };

  return (
    <div className="flex min-w-0 items-center gap-2 overflow-hidden text-xs text-zinc-500 dark:text-zinc-400">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Enviar meu nome nas mensagens"
        title={enabled ? 'Assinatura ligada' : 'Assinatura desligada'}
        onClick={() => onToggle(!enabled)}
        className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
          enabled ? 'bg-primary' : 'bg-zinc-300 dark:bg-zinc-700'
        }`}
      >
        <span
          className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${
            enabled ? 'translate-x-3.5' : 'translate-x-0.5'
          }`}
        />
      </button>
      <span className="hidden min-w-0 shrink-[10] truncate sm:block">Assinar como</span>
      {editing ? (
        <>
          <input
            autoFocus
            value={draft}
            maxLength={80}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                save();
              } else if (e.key === 'Escape') {
                setEditing(false);
              }
            }}
            className="w-28 min-w-0 rounded-md sm:w-36 border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-800 focus:border-primary focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <button
            type="button"
            onClick={save}
            className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-primary dark:hover:bg-zinc-800"
            aria-label="Salvar nome"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
            aria-label="Cancelar edição"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <>
          <span
            className={`min-w-0 truncate font-semibold ${
              enabled ? 'text-zinc-800 dark:text-zinc-100' : 'line-through opacity-60'
            }`}
          >
            {name}:
          </span>
          <button
            type="button"
            onClick={startEdit}
            className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
            aria-label="Editar nome da assinatura"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}

/** Bolinhas de quem mais está com esta conversa aberta agora. */
function ViewersIndicator({ viewers }: { viewers: ConversationViewerInfo[] }) {
  const names = viewers.map((v) => v.name).join(', ');
  return (
    <div
      className="flex shrink-0 items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400"
      title={`Com a conversa aberta: ${names}`}
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <span>Na conversa:</span>
      <div className="flex items-center -space-x-1.5">
        {viewers.slice(0, 4).map((v, i, arr) => (
          <span key={v.userId} className="relative" style={{ zIndex: arr.length - i }}>
            <MemberAvatar
              name={v.name}
              avatarUrl={v.avatarUrl}
              color={v.color}
              size={20}
              className="ring-2 ring-white dark:ring-zinc-950"
            />
          </span>
        ))}
        {viewers.length > 4 && (
          <span className="relative pl-2.5 text-[11px] font-medium">+{viewers.length - 4}</span>
        )}
      </div>
    </div>
  );
}

/** Abas do compositor: mensagem pro cliente × nota interna da equipe. */
function ComposerModeTabs({
  noteMode,
  onChange,
}: {
  noteMode: boolean;
  onChange: (noteMode: boolean) => void;
}) {
  const tab = (active: boolean, activeCls: string) =>
    `inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors sm:py-0.5 ${
      active ? activeCls : 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
    }`;
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-zinc-50 p-0.5 dark:bg-zinc-900" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={!noteMode}
        onClick={() => onChange(false)}
        className={tab(!noteMode, 'bg-white text-zinc-800 shadow-sm dark:bg-zinc-800 dark:text-zinc-100')}
        aria-label="Mensagem"
        title="Mensagem para o cliente"
      >
        <MessageSquare className="h-3 w-3" />
        <span className="hidden sm:inline">Mensagem</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={noteMode}
        onClick={() => onChange(true)}
        className={tab(noteMode, 'bg-amber-100 text-amber-800 shadow-sm dark:bg-amber-900/40 dark:text-amber-300')}
        aria-label="Nota interna"
        title="Nota interna (só a equipe vê)"
      >
        <Lock className="h-3 w-3" />
        <span className="hidden sm:inline">Nota interna</span>
      </button>
    </div>
  );
}
