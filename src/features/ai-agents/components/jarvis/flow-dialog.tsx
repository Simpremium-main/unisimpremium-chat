'use client';

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Film, Image as ImageIcon, MessageSquareText, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  aiPlaybooksService,
  type AiPlaybook,
  type PlaybookStep,
  type PlaybookStepType,
} from '../../services/ai-playbooks.service';
import type { AiAgent } from '../../services/ai-agents.service';

interface Props {
  flow: AiPlaybook | null;
  agents: AiAgent[];
  onClose: () => void;
  onSaved: () => void;
}

const STEP_TYPES: Array<{ type: PlaybookStepType; label: string; Icon: React.ElementType }> = [
  { type: 'TEXT', label: 'Texto', Icon: MessageSquareText },
  { type: 'IMAGE', label: 'Imagem', Icon: ImageIcon },
  { type: 'VIDEO', label: 'Vídeo', Icon: Film },
];

const inputCls =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';

export function FlowDialog({ flow, agents, onClose, onSaved }: Props) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [trigger, setTrigger] = useState('');
  const [instructions, setInstructions] = useState('');
  const [agentId, setAgentId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [steps, setSteps] = useState<PlaybookStep[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(flow?.name ?? '');
    setSlug(flow?.slug ?? '');
    setTrigger(flow?.trigger ?? '');
    setInstructions(flow?.instructions ?? '');
    setAgentId(flow?.agentId ?? '');
    setGroupName(flow?.groupName ?? '');
    setIsActive(flow?.isActive ?? true);
    setSteps(flow?.steps.map((s) => ({ type: s.type, content: s.content, caption: s.caption ?? '' })) ?? []);
  }, [flow]);

  const updateStep = (i: number, patch: Partial<PlaybookStep>) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const moveStep = (i: number, delta: -1 | 1) =>
    setSteps((prev) => {
      const next = [...prev];
      const j = i + delta;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const handleSave = async () => {
    if (name.trim().length < 2 || trigger.trim().length < 3) {
      toast.error('Preencha o nome e o gatilho');
      return;
    }
    const cleanSteps = steps.filter((s) => s.content.trim());
    const badUrl = cleanSteps.find((s) => s.type !== 'TEXT' && !/^https:\/\//.test(s.content.trim()));
    if (badUrl) {
      toast.error('Imagens e vídeos precisam de um link público começando com https://');
      return;
    }
    setSaving(true);
    try {
      const input = {
        name: name.trim(),
        ...(slug.trim() ? { slug: slug.trim() } : {}),
        trigger: trigger.trim(),
        instructions: instructions.trim(),
        agentId: agentId || null,
        groupName: groupName.trim() || null,
        isActive,
        sortOrder: flow?.sortOrder ?? 0,
        steps: cleanSteps,
      };
      if (flow) await aiPlaybooksService.update(flow.id, input);
      else await aiPlaybooksService.create(input);
      toast.success(flow ? 'Fluxo atualizado' : 'Fluxo criado');
      onSaved();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      toast.error((Array.isArray(msg) ? msg.join(', ') : msg) || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-zinc-900">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {flow ? 'Editar fluxo' : 'Novo fluxo'}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">Roteiro que o agente segue quando o gatilho acontece</p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome *">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Cotação de Chip" className={inputCls} />
            </Field>
            <Field label="Identificador" hint={flow ? 'Usado pelas ferramentas. Mude com cuidado.' : 'Gerado do nome se vazio.'}>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                placeholder="cotacao-de-chip"
                className={`${inputCls} font-mono`}
              />
            </Field>
          </div>

          <Field label="Gatilho *" hint="Quando o agente deve seguir este fluxo, em linguagem natural.">
            <textarea
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              rows={2}
              placeholder='Ex.: Quando o cliente quer comprar chip, pede cotação ou informa destino e datas'
              className={inputCls}
            />
          </Field>

          <Field label="O que fazer" hint="Passo a passo para o agente: o que perguntar, quais ferramentas usar, quando encaminhar.">
            <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={7} className={inputCls} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Agente">
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className={inputCls}>
                <option value="">Todos os agentes</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Grupo">
              <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Ex.: Operacional" className={inputCls} />
            </Field>
            <Field label="Situação">
              <select value={isActive ? '1' : '0'} onChange={(e) => setIsActive(e.target.value === '1')} className={inputCls}>
                <option value="1">Ativo</option>
                <option value="0">Inativo</option>
              </select>
            </Field>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Mensagens fixas ({steps.length})</p>
              <div className="flex gap-1">
                {STEP_TYPES.map(({ type, label, Icon }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSteps((prev) => [...prev, { type, content: '', caption: '' }])}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <Plus className="h-3 w-3" />
                    <Icon className="h-3 w-3" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Saem exatamente assim, na ordem, quando o agente envia o fluxo. Deixe vazio se o fluxo é só de instruções.
            </p>

            <div className="mt-2 space-y-2">
              {steps.map((step, i) => {
                const meta = STEP_TYPES.find((t) => t.type === step.type)!;
                return (
                  <div key={i} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-100 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {i + 1}
                        </span>
                        <meta.Icon className="h-3.5 w-3.5" />
                        {meta.label}
                      </span>
                      <div className="flex gap-0.5">
                        <IconButton label="Subir" onClick={() => moveStep(i, -1)} disabled={i === 0}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton label="Descer" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton label="Remover" onClick={() => setSteps((prev) => prev.filter((_, idx) => idx !== i))} danger>
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </div>
                    {step.type === 'TEXT' ? (
                      <textarea
                        value={step.content}
                        onChange={(e) => updateStep(i, { content: e.target.value })}
                        rows={3}
                        placeholder="Texto da mensagem"
                        className={inputCls}
                      />
                    ) : (
                      <div className="flex gap-3">
                        {step.type === 'IMAGE' && /^https:\/\//.test(step.content) && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={step.content} alt="" className="h-16 w-16 shrink-0 rounded-md object-cover" />
                        )}
                        <div className="min-w-0 flex-1 space-y-2">
                          <input
                            value={step.content}
                            onChange={(e) => updateStep(i, { content: e.target.value })}
                            placeholder="https://… (link público)"
                            className={`${inputCls} font-mono text-xs`}
                          />
                          <input
                            value={step.caption ?? ''}
                            onChange={(e) => updateStep(i, { caption: e.target.value })}
                            placeholder="Legenda (opcional)"
                            className={inputCls}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : flow ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</label>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`rounded p-1 text-zinc-400 disabled:opacity-30 ${
        danger ? 'hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20' : 'hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  );
}
