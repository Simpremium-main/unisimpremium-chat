'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  BookOpen,
  Check,
  Clock,
  GraduationCap,
  HelpCircle,
  History,
  Loader2,
  MessageSquare,
  Plus,
  ScrollText,
  Sparkles,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/ui/dialogs';
import { useOrgId } from '@/hooks/use-org-query-key';
import {
  aiLearningService,
  type ExistingItems,
  type HelpRequest,
  type Learning,
  type LearningKind,
} from '../../services/ai-learning.service';

type View = 'pending' | 'teach' | 'learned' | 'history';

const errMsg = (err: any, fallback: string) => err?.response?.data?.message || err?.message || fallback;

/**
 * Jarvis → Aprendizado (só administradores):
 *  - Casos: a IA pediu ajuda; você orienta, ela redige a resposta + o
 *    aprendizado; aprovado, a resposta vai pro cliente e a conversa volta pra IA.
 *  - Ensinar a IA: você escreve uma informação e ela propõe onde guardar.
 *  - Aprendidos: o que já foi ensinado (desativar, apagar).
 */
export function JarvisLearningTab() {
  const orgId = useOrgId();
  const [view, setView] = useState<View>('pending');
  const { data: pending = 0 } = useQuery({
    queryKey: ['ai-learning-count', orgId],
    queryFn: () => aiLearningService.pendingCount(),
    refetchInterval: 60_000,
  });

  const tabs: Array<{ id: View; label: string; icon: React.ElementType; badge?: number }> = [
    { id: 'pending', label: 'Casos', icon: HelpCircle, badge: pending },
    { id: 'teach', label: 'Ensinar a IA', icon: GraduationCap },
    { id: 'learned', label: 'Aprendidos', icon: BookOpen },
    { id: 'history', label: 'Resolvidos', icon: History },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              view === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
            {!!t.badge && (
              <span className="min-w-[18px] rounded-full bg-red-500 px-1.5 text-center text-[10px] font-semibold leading-[18px] text-white">
                {t.badge > 99 ? '99+' : t.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      {view === 'pending' && <PendingView />}
      {view === 'teach' && <TeachView />}
      {view === 'learned' && <LearnedView />}
      {view === 'history' && <HistoryView />}
    </div>
  );
}

// ─── Casos pendentes ──────────────────────────────────────────────────

function PendingView() {
  const orgId = useOrgId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: requests = [], isLoading, error } = useQuery({
    queryKey: ['ai-learning-requests', orgId, 'PENDING'],
    queryFn: () => aiLearningService.list('PENDING'),
    refetchInterval: 60_000,
  });
  useEffect(() => {
    if (!selectedId && requests.length) setSelectedId(requests[0].id);
    if (selectedId && requests.length && !requests.some((r) => r.id === selectedId)) setSelectedId(requests[0].id);
  }, [requests, selectedId]);

  if (isLoading) return <Loading />;
  if (error) {
    // Ex.: tabela de casos ainda não criada no banco — não mostrar "vazio".
    return (
      <Empty
        icon={X}
        title="Não foi possível carregar os casos"
        text={`${errorMessage(error)} — se for a primeira vez, confira se o SQL do Aprendizado foi rodado no Supabase do chat.`}
      />
    );
  }
  if (requests.length === 0) {
    return (
      <Empty
        icon={Check}
        title="Nenhum caso pendente"
        text="Quando a IA não souber responder (pedir_ajuda), o caso aparece aqui para você orientar."
      />
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <div className="space-y-1.5">
        {requests.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelectedId(r.id)}
            className={`block w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
              selectedId === r.id
                ? 'border-primary bg-primary/5'
                : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {r.conversation.contact.name || r.conversation.contact.phone || 'Cliente'}
              </span>
              <span className="shrink-0 text-[10px] text-zinc-400">{when(r.createdAt)}</span>
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{r.question}</p>
          </button>
        ))}
      </div>
      {selectedId && <RequestDetail key={selectedId} id={selectedId} />}
    </div>
  );
}

function RequestDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: request, isLoading } = useQuery({
    queryKey: ['ai-learning-request', id],
    queryFn: () => aiLearningService.get(id),
  });
  const { data: learned } = useQuery({ queryKey: ['ai-learning-learned'], queryFn: () => aiLearningService.learned() });
  const [guidance, setGuidance] = useState('');
  const [reply, setReply] = useState<string[]>([]);
  const [learning, setLearning] = useState<Learning | null>(null);
  const [summary, setSummary] = useState('');
  const [existing, setExisting] = useState<ExistingItems | null>(null);
  const [busy, setBusy] = useState<'draft' | 'approve' | 'dismiss' | null>(null);

  // Rascunho já gerado antes (reabrindo o caso).
  useEffect(() => {
    if (!request) return;
    setGuidance(request.guidance ?? '');
    if (request.draft) {
      setReply(request.draft.resposta);
      setLearning(request.draft.aprendizado);
      setSummary(request.draft.resumo);
    }
  }, [request]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ai-learning-requests'] });
    qc.invalidateQueries({ queryKey: ['ai-learning-count'] });
    qc.invalidateQueries({ queryKey: ['inbox-view-counts'] });
    qc.invalidateQueries({ queryKey: ['ai-learning-learned'] });
  };

  const generate = async () => {
    setBusy('draft');
    try {
      const r = await aiLearningService.draft(id, guidance);
      setReply(r.draft.resposta.length ? r.draft.resposta : ['']);
      setLearning(r.draft.aprendizado);
      setSummary(r.draft.resumo);
      setExisting(r.existing);
    } catch (err) {
      toast.error(errMsg(err, 'Erro ao gerar a resposta'));
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!learning) return;
    setBusy('approve');
    try {
      await aiLearningService.approve(id, reply.map((m) => m.trim()).filter(Boolean), learning);
      toast.success(
        learning.tipo === 'NENHUM'
          ? 'Resposta enviada — a conversa voltou para a IA'
          : 'Resposta enviada, aprendizado salvo e conversa de volta para a IA',
      );
      refresh();
    } catch (err) {
      toast.error(errMsg(err, 'Erro ao aprovar'));
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async () => {
    if (!(await confirm({ title: 'Ignorar este caso?', description: 'Nada é enviado ao cliente nem aprendido.', confirmText: 'Ignorar' }))) return;
    setBusy('dismiss');
    try {
      await aiLearningService.dismiss(id);
      refresh();
    } catch (err) {
      toast.error(errMsg(err, 'Erro ao ignorar'));
    } finally {
      setBusy(null);
    }
  };

  if (isLoading || !request) return <Loading />;
  return (
    <div className="min-w-0 space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {request.conversation.contact.name || request.conversation.contact.phone || 'Cliente'}
            </p>
            <p className="text-[11px] text-zinc-400">
              {request.conversation.channel.name} · {when(request.createdAt)}
            </p>
          </div>
          <Link
            href={`/inbox?conversationId=${request.conversationId}`}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/5"
          >
            <MessageSquare className="h-3.5 w-3.5" /> Abrir conversa
          </Link>
        </div>
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          <span className="font-semibold">A IA não soube:</span> {request.question}
        </div>
        {summary && <p className="mt-2 text-xs text-zinc-500">Resumo: {summary}</p>}
        <details className="mt-3 group">
          <summary className="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-700">
            Ver conversa ({request.messages?.length ?? 0} {request.messages?.length === 1 ? 'mensagem' : 'mensagens'})
          </summary>
          <div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900">
            {request.messages?.map((m) => (
              <div key={m.id} className={`flex ${m.direction === 'OUTBOUND' ? 'justify-end' : ''}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-xs ${
                    m.direction === 'OUTBOUND'
                      ? 'bg-primary/10 text-zinc-800 dark:text-zinc-200'
                      : 'bg-white text-zinc-800 shadow-sm dark:bg-zinc-800 dark:text-zinc-200'
                  }`}
                >
                  {m.direction === 'OUTBOUND' && m.senderName && (
                    <span className="mb-0.5 block text-[10px] font-semibold text-zinc-400">{m.senderName}</span>
                  )}
                  {m.text}
                </div>
              </div>
            ))}
          </div>
        </details>
      </Card>

      <Card>
        <Label>O que deve ser feito ou dito?</Label>
        <textarea
          value={guidance}
          onChange={(e) => setGuidance(e.target.value)}
          rows={4}
          placeholder="Ex.: Modem 4G funciona sim com o nosso chip físico, desde que seja desbloqueado. eSIM não funciona em modem."
          className={inputCls}
        />
        <div className="mt-2 flex flex-wrap justify-between gap-2">
          <button onClick={dismiss} disabled={!!busy} className="rounded-md px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            Ignorar caso
          </button>
          <button
            onClick={generate}
            disabled={!guidance.trim() || !!busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy === 'draft' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {learning ? 'Gerar de novo' : 'Gerar resposta'}
          </button>
        </div>
      </Card>

      {learning && (
        <>
          <Card>
            <Label>Resposta para o cliente</Label>
            <MessagesEditor value={reply} onChange={setReply} />
          </Card>
          <Card>
            <Label>Aprendizado</Label>
            <LearningEditor value={learning} onChange={setLearning} agents={learned?.agents ?? []} existing={existing} allowNone />
          </Card>
          <div className="flex justify-end">
            <button
              onClick={approve}
              disabled={!!busy || !reply.some((m) => m.trim())}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Aprovar e enviar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Ensinar a IA ─────────────────────────────────────────────────────

function TeachView() {
  const qc = useQueryClient();
  const { data: learned } = useQuery({ queryKey: ['ai-learning-learned'], queryFn: () => aiLearningService.learned() });
  const [info, setInfo] = useState('');
  const [learning, setLearning] = useState<Learning | null>(null);
  const [existing, setExisting] = useState<ExistingItems | null>(null);
  const [busy, setBusy] = useState<'draft' | 'apply' | null>(null);

  const analyze = async () => {
    setBusy('draft');
    try {
      const r = await aiLearningService.teachDraft(info);
      setLearning(r.aprendizado);
      setExisting(r.existing);
    } catch (err) {
      toast.error(errMsg(err, 'Erro ao analisar'));
    } finally {
      setBusy(null);
    }
  };
  const apply = async () => {
    if (!learning) return;
    setBusy('apply');
    try {
      await aiLearningService.teachApply(learning);
      toast.success('Pronto — a IA já usa essa informação');
      setInfo('');
      setLearning(null);
      setExisting(null);
      qc.invalidateQueries({ queryKey: ['ai-learning-learned'] });
    } catch (err) {
      toast.error(errMsg(err, 'Erro ao salvar'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <Label>O que a IA precisa saber?</Label>
        <p className="mb-2 text-xs text-zinc-500">
          Escreva com suas palavras. A IA analisa e propõe onde guardar: regra no prompt, fluxo de mensagens, base de conhecimento ou aviso temporário.
        </p>
        <textarea
          value={info}
          onChange={(e) => setInfo(e.target.value)}
          rows={5}
          placeholder="Ex.: Até 30/11 os Correios estão em greve — avisar que o chip físico pode atrasar e sugerir o eSIM."
          className={inputCls}
        />
        <div className="mt-2 flex justify-end">
          <button
            onClick={analyze}
            disabled={!info.trim() || !!busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy === 'draft' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {learning ? 'Analisar de novo' : 'Analisar'}
          </button>
        </div>
      </Card>
      {learning && (
        <>
          <Card>
            <Label>Onde guardar</Label>
            <LearningEditor value={learning} onChange={setLearning} agents={learned?.agents ?? []} existing={existing} />
          </Card>
          <div className="flex justify-end">
            <button
              onClick={apply}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === 'apply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Aprovar e salvar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Editor do aprendizado ────────────────────────────────────────────

const KIND_INFO: Record<LearningKind, { label: string; icon: React.ElementType; help: string }> = {
  CONHECIMENTO: {
    label: 'Base de conhecimento',
    icon: BookOpen,
    help: 'Fato ou política. Só entra na conversa quando o assunto aparece — não deixa a IA mais lenta nem mais cara.',
  },
  FLUXO: {
    label: 'Fluxo de mensagens',
    icon: Workflow,
    help: 'Mensagens prontas enviadas exatamente como estão, sempre que o gatilho acontecer.',
  },
  TEMPORARIO: {
    label: 'Aviso temporário',
    icon: Clock,
    help: 'Como a base de conhecimento, mas sai sozinho na data escolhida.',
  },
  REGRA: {
    label: 'Regra no prompt',
    icon: ScrollText,
    help: 'Muda o comportamento em TODAS as conversas. Use só para regras gerais e curtas.',
  },
  NENHUM: { label: 'Só este caso', icon: X, help: 'Não guarda nada — vale só para esta conversa.' },
};

function LearningEditor({
  value,
  onChange,
  agents,
  existing,
  allowNone,
}: {
  value: Learning;
  onChange: (l: Learning) => void;
  agents: Array<{ id: string; name: string }>;
  existing: ExistingItems | null;
  allowNone?: boolean;
}) {
  const set = (patch: Partial<Learning>) => onChange({ ...value, ...patch });
  const kinds = (Object.keys(KIND_INFO) as LearningKind[]).filter((k) => allowNone || k !== 'NENHUM');
  const updating = useMemo(() => {
    if (!value.atualizar || !existing) return null;
    return value.atualizar.tipo === 'FLUXO'
      ? existing.flows.find((f) => f.id === value.atualizar!.id)?.name
      : existing.knowledge.find((k) => k.id === value.atualizar!.id)?.title;
  }, [value.atualizar, existing]);

  return (
    <div className="space-y-3">
      <div className="grid gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
        {kinds.map((k) => {
          const I = KIND_INFO[k].icon;
          const on = value.tipo === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => set({ tipo: k, ...(k !== value.tipo ? { atualizar: null } : {}) })}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left text-xs font-medium ${
                on ? 'border-primary bg-primary/5 text-primary' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300'
              }`}
            >
              <I className="h-3.5 w-3.5 shrink-0" />
              {KIND_INFO[k].label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-zinc-500">{KIND_INFO[value.tipo].help}</p>
      {value.motivo && (
        <p className="rounded-md bg-zinc-50 px-2.5 py-1.5 text-[11px] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <Sparkles className="mr-1 inline h-3 w-3 text-primary" />
          {value.motivo}
        </p>
      )}
      {updating && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-blue-50 px-2.5 py-1.5 text-[11px] text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
          <span>
            Vai <b>atualizar</b> o item existente “{updating}” em vez de criar outro.
          </span>
          <button type="button" onClick={() => set({ atualizar: null })} className="shrink-0 underline">
            Criar novo
          </button>
        </div>
      )}

      {value.tipo !== 'NENHUM' && (
        <Field label="Título">
          <input value={value.titulo ?? ''} onChange={(e) => set({ titulo: e.target.value })} maxLength={80} className={inputCls} />
        </Field>
      )}
      {value.tipo === 'FLUXO' && (
        <>
          <Field label="Quando usar (gatilho)">
            <textarea value={value.gatilho ?? ''} onChange={(e) => set({ gatilho: e.target.value })} rows={2} className={inputCls} />
          </Field>
          <Field label="Instruções para a IA (opcional)">
            <textarea value={value.instrucoes ?? ''} onChange={(e) => set({ instrucoes: e.target.value })} rows={2} className={inputCls} />
          </Field>
          <Field label="Mensagens (enviadas exatamente assim)">
            <MessagesEditor value={value.mensagens ?? []} onChange={(m) => set({ mensagens: m })} />
          </Field>
        </>
      )}
      {(value.tipo === 'CONHECIMENTO' || value.tipo === 'TEMPORARIO') && (
        <>
          <Field label="Conteúdo">
            <textarea value={value.conteudo ?? ''} onChange={(e) => set({ conteudo: e.target.value })} rows={4} className={inputCls} />
          </Field>
          <Field label="Palavras que o cliente usaria (ajuda a IA achar)">
            <input value={value.palavras_chave ?? ''} onChange={(e) => set({ palavras_chave: e.target.value })} className={inputCls} />
          </Field>
          {value.tipo === 'TEMPORARIO' && (
            <Field label="Vale até">
              <input type="date" value={value.expira_em ?? ''} onChange={(e) => set({ expira_em: e.target.value || null })} className={`${inputCls} sm:w-48`} />
            </Field>
          )}
        </>
      )}
      {value.tipo === 'REGRA' && (
        <>
          <Field label="Regra">
            <textarea value={value.regra ?? ''} onChange={(e) => set({ regra: e.target.value })} rows={2} className={inputCls} />
          </Field>
          <Field label="Agente">
            <select value={value.agentId ?? ''} onChange={(e) => set({ agentId: e.target.value || null })} className={`${inputCls} sm:w-72`}>
              <option value="">Escolha…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
    </div>
  );
}

function MessagesEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const list = value.length ? value : [''];
  return (
    <div className="space-y-2">
      {list.map((m, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <span className="mt-2 w-4 shrink-0 text-right text-[10px] text-zinc-400">{i + 1}</span>
          <textarea
            value={m}
            onChange={(e) => onChange(list.map((x, j) => (j === i ? e.target.value : x)))}
            rows={Math.min(8, Math.max(2, m.split('\n').length))}
            className={inputCls}
          />
          {list.length > 1 && (
            <button
              type="button"
              onClick={() => onChange(list.filter((_, j) => j !== i))}
              className="mt-1 rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500"
              aria-label="Remover mensagem"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...list, ''])}
        className="ml-5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        <Plus className="h-3 w-3" /> Mensagem
      </button>
    </div>
  );
}

// ─── Aprendidos ───────────────────────────────────────────────────────

function LearnedView() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: ['ai-learning-learned'], queryFn: () => aiLearningService.learned() });
  const refresh = () => qc.invalidateQueries({ queryKey: ['ai-learning-learned'] });
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
      refresh();
    } catch (err) {
      toast.error(errMsg(err, 'Erro'));
    }
  };

  if (isLoading || !data) return <Loading />;
  const empty = !data.knowledge.length && !data.flows.length && !data.rules.length;
  if (empty) {
    return <Empty icon={BookOpen} title="Nada aprendido ainda" text="Resolva um caso ou use “Ensinar a IA”." />;
  }
  return (
    <div className="space-y-6">
      {data.knowledge.length > 0 && (
        <Section title="Base de conhecimento" icon={BookOpen} hint="Entra na conversa só quando o assunto aparece.">
          {data.knowledge.map((k) => {
            const expired = k.expiresAt && new Date(k.expiresAt) < new Date();
            return (
              <Card key={k.id} className={k.isActive && !expired ? '' : 'opacity-60'}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      {k.title}
                      {k.expiresAt && (
                        <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-normal text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          {expired ? 'expirou' : 'até'} {brDate(k.expiresAt)}
                        </span>
                      )}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">{k.content}</p>
                    {k.keywords && <p className="mt-1 text-[10px] text-zinc-400">Palavras: {k.keywords}</p>}
                    <p className="mt-1 text-[10px] text-zinc-400">
                      {k.sourceHelpRequestId ? 'Aprendido num caso' : 'Ensinado'} em {brDate(k.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Toggle
                      on={k.isActive}
                      onChange={(v) => run(() => aiLearningService.updateKnowledge(k.id, { isActive: v }), v ? 'Ativado' : 'Desativado')}
                    />
                    <button
                      onClick={async () => {
                        if (await confirm({ title: `Apagar “${k.title}”?`, confirmText: 'Apagar', tone: 'danger' }))
                          run(() => aiLearningService.removeKnowledge(k.id), 'Apagado');
                      }}
                      className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500"
                      aria-label="Apagar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </Section>
      )}
      {data.flows.length > 0 && (
        <Section title="Fluxos aprendidos" icon={Workflow} hint="Editar ou desativar em Jarvis → Fluxos (grupo “Aprendido”).">
          {data.flows.map((f) => (
            <Card key={f.id} className={f.isActive ? '' : 'opacity-60'}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{f.name}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">Quando: {f.trigger}</p>
                  <p className="mt-0.5 text-[10px] text-zinc-400">{f.steps.length} mensagem(ns)</p>
                </div>
                <Link href="/ai-agents?tab=flows" className="shrink-0 text-xs text-primary hover:underline">
                  Abrir
                </Link>
              </div>
            </Card>
          ))}
        </Section>
      )}
      {data.rules.length > 0 && (
        <Section title="Regras no prompt" icon={ScrollText} hint="Valem em todas as conversas do agente.">
          {data.rules.map((a) => (
            <Card key={a.agentId}>
              <p className="mb-1.5 text-xs font-semibold text-zinc-500">{a.agentName}</p>
              <ul className="space-y-1">
                {a.rules.map((r) => (
                  <li key={r} className="flex items-start justify-between gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                    <span>• {r}</span>
                    <button
                      onClick={async () => {
                        if (await confirm({ title: 'Remover esta regra do prompt?', confirmText: 'Remover', tone: 'danger' }))
                          run(() => aiLearningService.removeRule(a.agentId, r), 'Regra removida');
                      }}
                      className="shrink-0 rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500"
                      aria-label="Remover regra"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </Section>
      )}
    </div>
  );
}

// ─── Resolvidos ───────────────────────────────────────────────────────

const SAVED_LABEL: Record<string, string> = {
  FLUXO: 'fluxo',
  CONHECIMENTO: 'base de conhecimento',
  TEMPORARIO: 'aviso temporário',
  REGRA: 'regra no prompt',
};

function HistoryView() {
  const orgId = useOrgId();
  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['ai-learning-requests', orgId, 'RESOLVED'],
    queryFn: () => aiLearningService.list('RESOLVED'),
  });
  if (isLoading) return <Loading />;
  if (!requests.length) return <Empty icon={History} title="Nenhum caso resolvido ainda" text="" />;
  return (
    <div className="space-y-2">
      {requests.map((r: HelpRequest) => (
        <Card key={r.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              {r.conversation.contact.name || r.conversation.contact.phone || 'Cliente'}
            </p>
            <span className="text-[10px] text-zinc-400">{r.resolvedAt ? when(r.resolvedAt) : ''}</span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">{r.question}</p>
          {r.guidance && <p className="mt-1 text-xs text-zinc-700 dark:text-zinc-300">Orientação: {r.guidance}</p>}
          <p className="mt-1 text-[11px] text-zinc-400">
            {r.resolution?.salvo
              ? `Aprendido como ${SAVED_LABEL[r.resolution.salvo.tipo] ?? r.resolution.salvo.tipo} (${r.resolution.salvo.acao})`
              : 'Só respondido (nada aprendido)'}
          </p>
        </Card>
      ))}
    </div>
  );
}

// ─── miúdos ───────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 ${className}`}>{children}</div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">{children}</p>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function Section({ title, icon: I, hint, children }: { title: string; icon: React.ElementType; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <I className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{title}</h3>
        <span className="text-[11px] text-zinc-400">{hint}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? 'Desativar' : 'Ativar'}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-primary' : 'bg-zinc-300 dark:bg-zinc-700'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
    </div>
  );
}

function errorMessage(err: unknown): string {
  const e = err as { response?: { data?: { message?: unknown } }; message?: string };
  const m = e?.response?.data?.message;
  return (Array.isArray(m) ? m.join(', ') : typeof m === 'string' ? m : e?.message) || 'erro desconhecido';
}

function Empty({ icon: I, title, text }: { icon: React.ElementType; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <I className="h-10 w-10 text-zinc-200 dark:text-zinc-700" />
      <p className="mt-3 text-sm font-medium text-zinc-600 dark:text-zinc-300">{title}</p>
      {text && <p className="mt-1 max-w-sm text-xs text-zinc-500">{text}</p>}
    </div>
  );
}

/** Data no horário de Brasília (o aviso "até 30/11" vale até 23:59 de SP). */
function brDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
