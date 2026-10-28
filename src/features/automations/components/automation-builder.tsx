'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  ActionDefinition,
  ActionType,
  Automation,
  AutomationMeta,
  AutomationTrigger,
  ConditionOperator,
  ConditionRoot,
  ConditionRule,
  CreateAutomationPayload,
  automationsService,
} from '../services/automations.service';
import {
  ACTION_LABELS,
  FIELD_LABELS,
  OPERATOR_LABELS,
  TRIGGER_DESCRIPTIONS,
  TRIGGER_LABELS,
  operatorsForField,
} from '../utils/labels';
import {
  AutomationLookups,
  useAutomationLookups,
} from '../hooks/use-lookups';

interface BuilderProps {
  meta: AutomationMeta;
  initial?: Automation;
  onClose: () => void;
  onSaved: () => void;
}

// Conversation status enum mirrors the backend ConversationStatus.
const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'PENDING', label: 'Pendente' },
  { value: 'BOT', label: 'No bot' },
  { value: 'OPEN', label: 'Aberta' },
  { value: 'WAITING', label: 'Aguardando' },
  { value: 'CLOSED', label: 'Fechada' },
];

const MESSAGE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'TEXT', label: 'Texto' },
  { value: 'IMAGE', label: 'Imagem' },
  { value: 'AUDIO', label: 'Áudio' },
  { value: 'VIDEO', label: 'Vídeo' },
  { value: 'DOCUMENT', label: 'Documento' },
  { value: 'STICKER', label: 'Figurinha' },
  { value: 'LOCATION', label: 'Localização' },
];

export function AutomationBuilder({
  meta,
  initial,
  onClose,
  onSaved,
}: BuilderProps) {
  const lookups = useAutomationLookups();

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [trigger, setTrigger] = useState<AutomationTrigger>(
    initial?.trigger ?? 'MESSAGE_RECEIVED',
  );
  const [conditions, setConditions] = useState<ConditionRoot>(() => {
    const c = initial?.conditions as ConditionRoot | undefined;
    if (!c || !('groups' in c)) {
      return { match: 'OR', groups: [] };
    }
    return c;
  });
  const [actions, setActions] = useState<ActionDefinition[]>(
    initial?.actions ?? [],
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(
    initial?.rateLimitPerMinute ?? 10,
  );
  const [saving, setSaving] = useState(false);

  const triggerFields = useMemo(
    () => meta.triggers.find((t) => t.value === trigger)?.fields ?? [],
    [meta, trigger],
  );

  useEffect(() => {
    if (!initial) return;
    if (trigger !== initial.trigger) {
      setConditions({ match: 'OR', groups: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  // All conditions mutators use callback form so React 19's automatic
  // batching can compose multiple updates correctly. Without this, two
  // updates fired in the same tick (e.g. field+value change) would race.
  const addGroup = () => {
    setConditions((prev) => ({
      ...prev,
      groups: [
        ...prev.groups,
        {
          match: 'AND',
          rules: [{ field: triggerFields[0] ?? '', op: 'equals', value: '' }],
        },
      ],
    }));
  };

  const removeGroup = (gi: number) => {
    setConditions((prev) => ({
      ...prev,
      groups: prev.groups.filter((_, i) => i !== gi),
    }));
  };

  const updateRule = (gi: number, ri: number, patch: Partial<ConditionRule>) => {
    setConditions((prev) => ({
      ...prev,
      groups: prev.groups.map((g, i) =>
        i !== gi
          ? g
          : {
              ...g,
              rules: g.rules.map((r, j) =>
                j === ri ? ({ ...r, ...patch } as ConditionRule) : r,
              ),
            },
      ),
    }));
  };

  const addRule = (gi: number) => {
    setConditions((prev) => ({
      ...prev,
      groups: prev.groups.map((g, i) =>
        i !== gi
          ? g
          : {
              ...g,
              rules: [
                ...g.rules,
                {
                  field: triggerFields[0] ?? '',
                  op: 'equals' as ConditionOperator,
                  value: '',
                },
              ],
            },
      ),
    }));
  };

  const removeRule = (gi: number, ri: number) => {
    setConditions((prev) => ({
      ...prev,
      groups: prev.groups.map((g, i) =>
        i !== gi ? g : { ...g, rules: g.rules.filter((_, j) => j !== ri) },
      ),
    }));
  };

  const addAction = (type: ActionType) => {
    setActions([...actions, { type, params: defaultActionParams(type) }]);
  };

  const updateAction = (i: number, patch: Partial<ActionDefinition>) => {
    // Callback form so two updates fired in the same tick (e.g. clearing
    // stageId right after picking a pipeline) compose correctly. The
    // closure-captured `actions` would otherwise be stale and the second
    // setState would overwrite the first.
    setActions((prev) =>
      prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)),
    );
  };

  const updateActionParam = (i: number, key: string, value: unknown) => {
    setActions((prev) =>
      prev.map((a, idx) =>
        idx === i ? { ...a, params: { ...a.params, [key]: value } } : a,
      ),
    );
  };

  // Patch multiple params atomically — used for things like "pick pipeline,
  // also clear stage" where doing two separate updateActionParam calls
  // races the closure.
  const updateActionParams = (i: number, patch: Record<string, unknown>) => {
    setActions((prev) =>
      prev.map((a, idx) =>
        idx === i ? { ...a, params: { ...a.params, ...patch } } : a,
      ),
    );
  };

  const removeAction = (i: number) => {
    setActions((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Dê um nome pra automação');
      return;
    }
    if (actions.length === 0) {
      toast.error('Pelo menos uma ação é obrigatória');
      return;
    }
    // Block save if any action is missing required refs. The backend
    // would 400 anyway, but better UX to catch here with a friendly msg.
    const missing = actions.findIndex((a) => !isActionConfigured(a));
    if (missing >= 0) {
      toast.error(
        `Configure os campos da ação ${missing + 1} (${ACTION_LABELS[actions[missing].type]})`,
      );
      return;
    }
    const payload: CreateAutomationPayload = {
      name: name.trim(),
      description: description.trim() || undefined,
      trigger,
      conditions: conditions.groups.length > 0 ? conditions : {},
      actions,
      enabled,
      rateLimitPerMinute,
    };
    setSaving(true);
    try {
      if (initial) {
        await automationsService.update(initial.id, payload);
        toast.success('Automação atualizada');
      } else {
        await automationsService.create(payload);
        toast.success('Automação criada');
      }
      onSaved();
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Erro ao salvar automação');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-drawer-in fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Fechar"
      />
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl dark:bg-zinc-900">
        <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <div>
            <h2 className="text-lg font-semibold">
              {initial ? 'Editar automação' : 'Nova automação'}
            </h2>
            <p className="text-xs text-zinc-500">
              Quando algo acontece → executa uma sequência de ações
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Basic */}
          <section className="space-y-3">
            <Label>Nome</Label>
            <input
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Notificar João quando tag VIP for adicionada"
              maxLength={120}
            />
            <Label>Descrição (opcional)</Label>
            <textarea
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </section>

          {/* Trigger */}
          <section className="space-y-3">
            <SectionTitle index={1} title="Quando" />
            <div className="grid gap-2">
              {meta.triggers.map((t) => (
                <label
                  key={t.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition ${
                    trigger === t.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
                      : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="trigger"
                    value={t.value}
                    checked={trigger === t.value}
                    onChange={() => setTrigger(t.value)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium">{TRIGGER_LABELS[t.value]}</div>
                    <div className="text-xs text-zinc-500">
                      {TRIGGER_DESCRIPTIONS[t.value]}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </section>

          {/* Conditions */}
          <section className="space-y-3">
            <SectionTitle
              index={2}
              title="Condições"
              hint="Sem condições = roda em todos os eventos do gatilho"
            />
            {conditions.groups.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span>Combinar grupos com:</span>
                <select
                  value={conditions.match}
                  onChange={(e) =>
                    setConditions({
                      ...conditions,
                      match: e.target.value as 'AND' | 'OR',
                    })
                  }
                  className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
                >
                  <option value="OR">QUALQUER (OR)</option>
                  <option value="AND">TODOS (AND)</option>
                </select>
              </div>
            )}
            {conditions.groups.map((group, gi) => (
              <div
                key={gi}
                className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/40"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-zinc-600 dark:text-zinc-400">
                    Grupo {gi + 1} (
                    <select
                      value={group.match}
                      onChange={(e) => {
                        const groups = conditions.groups.map((g, i) =>
                          i === gi
                            ? { ...g, match: e.target.value as 'AND' | 'OR' }
                            : g,
                        );
                        setConditions({ ...conditions, groups });
                      }}
                      className="rounded border border-zinc-300 px-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
                    >
                      <option value="AND">TODAS</option>
                      <option value="OR">QUALQUER</option>
                    </select>
                    )
                  </span>
                  <button
                    onClick={() => removeGroup(gi)}
                    className="text-red-500 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {group.rules.map((rule, ri) => (
                  <RuleRow
                    key={ri}
                    rule={rule}
                    fields={triggerFields}
                    lookups={lookups}
                    onChange={(patch) => updateRule(gi, ri, patch)}
                    onRemove={() => removeRule(gi, ri)}
                  />
                ))}
                <button
                  onClick={() => addRule(gi)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  + adicionar regra ao grupo
                </button>
              </div>
            ))}
            <button
              onClick={addGroup}
              className="flex items-center gap-1 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <Plus className="h-4 w-4" /> Adicionar grupo de condições
            </button>
          </section>

          {/* Actions */}
          <section className="space-y-3">
            <SectionTitle index={3} title="Ações" hint="Executadas em ordem" />
            {actions.map((action, i) => (
              <ActionRow
                key={i}
                index={i}
                action={action}
                lookups={lookups}
                onChange={(patch) => updateAction(i, patch)}
                onParamChange={(key, value) =>
                  updateActionParam(i, key, value)
                }
                onParamsChange={(patch) => updateActionParams(i, patch)}
                onRemove={() => removeAction(i)}
              />
            ))}
            <div className="flex flex-wrap gap-2">
              {meta.actions.map((a) => (
                <button
                  key={a.type}
                  onClick={() => addAction(a.type)}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                >
                  + {ACTION_LABELS[a.type]}
                </button>
              ))}
            </div>
          </section>

          {/* Settings */}
          <section className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <Label>Limite por minuto (por conversa)</Label>
            <input
              type="number"
              min={0}
              max={120}
              value={rateLimitPerMinute}
              onChange={(e) => setRateLimitPerMinute(Number(e.target.value))}
              className="w-32 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <p className="text-xs text-zinc-500">
              Máximo de execuções por minuto na mesma conversa. Acima desse
              limite, runs são marcados como SKIPPED.
            </p>

            <label className="mt-3 flex items-center gap-2">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 rounded"
              />
              <span className="text-sm">Ativar imediatamente</span>
            </label>
          </section>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : initial ? 'Salvar' : 'Criar'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function SectionTitle({
  index,
  title,
  hint,
}: {
  index: number;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
        {index}
      </span>
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
      {children}
    </label>
  );
}

const inputCls =
  'w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950';

// Renders the value side of a condition rule based on which field is
// selected. Maps every ID-bearing field to a real-data dropdown so a
// non-technical user never has to know an ID exists.
function ConditionValueInput({
  field,
  value,
  onChange,
  lookups,
}: {
  field: string;
  value: ConditionRule['value'];
  onChange: (v: ConditionRule['value']) => void;
  lookups: AutomationLookups;
}) {
  switch (field) {
    case 'tagId':
      return (
        <select
          className={inputCls}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Selecione uma tag…</option>
          {lookups.tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      );
    case 'channelId':
      return (
        <select
          className={inputCls}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Selecione um canal…</option>
          {lookups.channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      );
    case 'fromAssigneeId':
    case 'toAssigneeId':
      return (
        <select
          className={inputCls}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Selecione um agente…</option>
          {lookups.members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.user?.name ?? m.user?.email ?? m.userId}
            </option>
          ))}
        </select>
      );
    case 'fromStatus':
    case 'toStatus':
      return (
        <select
          className={inputCls}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Selecione um status…</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      );
    case 'target':
      return (
        <select
          className={inputCls}
          value={(value as string) ?? 'conversation'}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="conversation">Conversa</option>
          <option value="contact">Contato</option>
        </select>
      );
    case 'type':
      return (
        <select
          className={inputCls}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Selecione um tipo…</option>
          {MESSAGE_TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      );
    case 'hasAttachment':
      return (
        <select
          className={inputCls}
          value={String(value ?? false)}
          onChange={(e) => onChange(e.target.value === 'true')}
        >
          <option value="true">Sim</option>
          <option value="false">Não</option>
        </select>
      );
    default:
      return (
        <input
          className={inputCls}
          value={(value as string | number | undefined)?.toString() ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="valor"
        />
      );
  }
}

function RuleRow({
  rule,
  fields,
  lookups,
  onChange,
  onRemove,
}: {
  rule: ConditionRule;
  fields: string[];
  lookups: AutomationLookups;
  onChange: (patch: Partial<ConditionRule>) => void;
  onRemove: () => void;
}) {
  const ops = operatorsForField(rule.field);
  const needsValue = rule.op !== 'is_set' && rule.op !== 'is_not_set';
  return (
    <div className="flex items-center gap-2">
      <select
        value={rule.field}
        onChange={(e) =>
          // Field change: clear the value because the previous one was
          // probably for a different lookup type (e.g. a tag id is
          // meaningless if user just switched to channelId).
          onChange({ field: e.target.value, value: '' })
        }
        className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      >
        {fields.map((f) => (
          <option key={f} value={f}>
            {FIELD_LABELS[f] ?? f}
          </option>
        ))}
      </select>
      <select
        value={rule.op}
        onChange={(e) => onChange({ op: e.target.value as ConditionOperator })}
        className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      >
        {ops.map((op) => (
          <option key={op} value={op}>
            {OPERATOR_LABELS[op]}
          </option>
        ))}
      </select>
      {needsValue && (
        <div className="flex-1">
          <ConditionValueInput
            field={rule.field}
            value={rule.value}
            onChange={(v) => onChange({ value: v })}
            lookups={lookups}
          />
        </div>
      )}
      <button
        onClick={onRemove}
        className="text-zinc-400 hover:text-red-500"
        aria-label="Remover regra"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function ActionRow({
  index,
  action,
  lookups,
  onChange,
  onParamChange,
  onParamsChange,
  onRemove,
}: {
  index: number;
  action: ActionDefinition;
  lookups: AutomationLookups;
  onChange: (patch: Partial<ActionDefinition>) => void;
  onParamChange: (key: string, value: unknown) => void;
  onParamsChange: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">
          {index + 1}. {ACTION_LABELS[action.type]}
        </span>
        <button
          onClick={onRemove}
          className="text-zinc-400 hover:text-red-500"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <ActionParams
        action={action}
        lookups={lookups}
        onParamChange={onParamChange}
        onParamsChange={onParamsChange}
      />
      <label className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
        <input
          type="checkbox"
          checked={action.continueOnError ?? false}
          onChange={(e) => onChange({ continueOnError: e.target.checked })}
          className="h-3 w-3 rounded"
        />
        Continuar se essa ação falhar
      </label>
    </div>
  );
}

function ActionParams({
  action,
  lookups,
  onParamChange,
  onParamsChange,
}: {
  action: ActionDefinition;
  lookups: AutomationLookups;
  onParamChange: (key: string, value: unknown) => void;
  // Atomic multi-key update — required when picking a pipeline because
  // we also need to clear the dependent stageId in the same render.
  onParamsChange: (patch: Record<string, unknown>) => void;
}) {
  switch (action.type) {
    case 'add_tag':
    case 'remove_tag':
      return (
        <div className="space-y-2">
          <select
            className={inputCls}
            value={(action.params.tagId as string) ?? ''}
            onChange={(e) => onParamChange('tagId', e.target.value)}
          >
            <option value="">Selecione uma tag…</option>
            {lookups.tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            className={inputCls}
            value={(action.params.target as string) ?? 'conversation'}
            onChange={(e) => onParamChange('target', e.target.value)}
          >
            <option value="conversation">Aplicar à conversa</option>
            <option value="contact">Aplicar ao contato</option>
          </select>
        </div>
      );
    case 'add_to_pipeline': {
      const pipelineId = (action.params.pipelineId as string) ?? '';
      const stages = lookups.stagesOf(pipelineId);
      return (
        <div className="space-y-2">
          <select
            className={inputCls}
            value={pipelineId}
            onChange={(e) =>
              // Atomic: clearing stage in a separate setState would race
              // the pipelineId update and revert it.
              onParamsChange({ pipelineId: e.target.value, stageId: '' })
            }
          >
            <option value="">Selecione um pipeline…</option>
            {lookups.pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {pipelineId && stages.length > 0 && (
            <select
              className={inputCls}
              value={(action.params.stageId as string) ?? ''}
              onChange={(e) => onParamChange('stageId', e.target.value)}
            >
              <option value="">Primeiro estágio (padrão)</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.type !== 'NORMAL' ? ` (${s.type})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      );
    }
    case 'move_pipeline_stage': {
      const pipelineId = (action.params.pipelineId as string) ?? '';
      const stages = lookups.stagesOf(pipelineId);
      return (
        <div className="space-y-2">
          <select
            className={inputCls}
            value={pipelineId}
            onChange={(e) =>
              onParamsChange({
                pipelineId: e.target.value,
                toStageId: '',
              })
            }
          >
            <option value="">Selecione um pipeline…</option>
            {lookups.pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {pipelineId && (
            <select
              className={inputCls}
              value={(action.params.toStageId as string) ?? ''}
              onChange={(e) => onParamChange('toStageId', e.target.value)}
            >
              <option value="">Selecione o estágio destino…</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.type !== 'NORMAL' ? ` (${s.type})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      );
    }
    case 'assign_user':
      return (
        <select
          className={inputCls}
          value={(action.params.userId as string) ?? ''}
          onChange={(e) => onParamChange('userId', e.target.value)}
        >
          <option value="">Selecione um agente…</option>
          {lookups.members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.user?.name ?? m.user?.email ?? m.userId}
              {m.role !== 'AGENT' ? ` · ${m.role.toLowerCase()}` : ''}
            </option>
          ))}
        </select>
      );
    case 'send_message':
      return (
        <textarea
          placeholder="Texto da mensagem (responde no mesmo canal da conversa)"
          className={inputCls}
          rows={3}
          maxLength={4096}
          value={(action.params.body as string) ?? ''}
          onChange={(e) => onParamChange('body', e.target.value)}
        />
      );
  }
}

function defaultActionParams(type: ActionType): Record<string, unknown> {
  switch (type) {
    case 'add_tag':
    case 'remove_tag':
      return { tagId: '', target: 'conversation' };
    case 'add_to_pipeline':
      return { pipelineId: '', stageId: '' };
    case 'move_pipeline_stage':
      return { pipelineId: '', toStageId: '' };
    case 'assign_user':
      return { userId: '' };
    case 'send_message':
      return { body: '' };
  }
}

// Pre-flight check: every action must have its required refs filled in.
// Mirrors the backend's per-handler validateParams. Run before save so
// the user gets a friendly toast instead of an HTTP 400.
function isActionConfigured(action: ActionDefinition): boolean {
  switch (action.type) {
    case 'add_tag':
    case 'remove_tag':
      return !!action.params.tagId;
    case 'add_to_pipeline':
      return !!action.params.pipelineId;
    case 'move_pipeline_stage':
      return !!action.params.pipelineId && !!action.params.toStageId;
    case 'assign_user':
      return !!action.params.userId;
    case 'send_message':
      return (
        typeof action.params.body === 'string' &&
        (action.params.body as string).trim().length > 0
      );
  }
}
