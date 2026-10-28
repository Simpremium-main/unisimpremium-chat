'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Check, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  aiCatalogService,
  type AiSkill,
  type AiTool,
} from '../../services/ai-catalog.service';

interface Props {
  open: boolean;
  skill: AiSkill | null;
  onClose: () => void;
  onSaved: () => void;
}

interface ParamRow { name: string; source: string; }

const DEFAULT_PARAMS = `{
  "type": "object",
  "required": ["email"],
  "properties": {
    "email": {
      "type": "string",
      "description": "E-mail do cliente"
    }
  }
}`;

export function SkillDialog({ open, skill, onClose, onSaved }: Props) {
  // common
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [promptInstructions, setPromptInstructions] = useState('');
  const [parameters, setParameters] = useState(DEFAULT_PARAMS);
  const [toolId, setToolId] = useState<string>('');
  const [timeoutMs, setTimeoutMs] = useState(15000);
  const [changeNote, setChangeNote] = useState('');
  const [saving, setSaving] = useState(false);

  // HTTP
  const [httpMethod, setHttpMethod] = useState('POST');
  const [httpPath, setHttpPath] = useState('');
  const [headersExtraJson, setHeadersExtraJson] = useState('');
  const [bodyTemplate, setBodyTemplate] = useState('{"email": "{{input.email}}"}');
  const [responseMap, setResponseMap] = useState('');

  // SQL
  const [sqlQuery, setSqlQuery] = useState('SELECT * FROM users WHERE email = $1 LIMIT 1');
  const [sqlParams, setSqlParams] = useState<ParamRow[]>([
    { name: 'email', source: 'input.email' },
  ]);
  const [sqlReadOnly, setSqlReadOnly] = useState(true);
  const [sqlMaxRows, setSqlMaxRows] = useState(50);

  const { data: tools } = useQuery({
    queryKey: ['ai-tools'],
    queryFn: () => aiCatalogService.listTools(),
    enabled: open,
  });

  const selectedTool = useMemo(
    () => (tools ?? []).find((t) => t.id === toolId),
    [tools, toolId],
  );
  // Source da skill é determinado pelo source da tool (HTTP ↔ CUSTOM_HTTP)
  const skillSource: 'HTTP' | 'SQL' | null = !selectedTool
    ? null
    : selectedTool.source === 'CUSTOM_HTTP'
      ? 'HTTP'
      : 'SQL';

  useEffect(() => {
    if (skill) {
      setName(skill.name);
      setDescription(skill.description);
      setCategory(skill.category ?? '');
      setPromptInstructions(skill.promptInstructions ?? '');
      setParameters(JSON.stringify(skill.parameters ?? {}, null, 2));
      setToolId(skill.toolId ?? '');
      setTimeoutMs(skill.timeoutMs);
      setChangeNote('');
      setHttpMethod(skill.httpMethod ?? 'POST');
      setHttpPath(skill.httpPath ?? '');
      setHeadersExtraJson(
        skill.httpHeadersExtra ? JSON.stringify(skill.httpHeadersExtra, null, 2) : '',
      );
      setBodyTemplate(skill.httpBodyTemplate ?? '');
      setResponseMap(
        skill.responseMap ? JSON.stringify(skill.responseMap, null, 2) : '',
      );
      setSqlQuery(skill.sqlQuery ?? '');
      setSqlParams(
        Array.isArray(skill.sqlParamMap) && skill.sqlParamMap.length > 0
          ? skill.sqlParamMap.map((p) => ({ name: p.name ?? '', source: p.source }))
          : [],
      );
      setSqlReadOnly(skill.sqlReadOnly);
      setSqlMaxRows(skill.sqlMaxRows);
    } else {
      setName('');
      setDescription('');
      setCategory('');
      setPromptInstructions('');
      setParameters(DEFAULT_PARAMS);
      setToolId('');
      setTimeoutMs(15000);
      setChangeNote('');
      setHttpMethod('POST');
      setHttpPath('');
      setHeadersExtraJson('');
      setBodyTemplate('{"email": "{{input.email}}"}');
      setResponseMap('');
      setSqlQuery('SELECT * FROM users WHERE email = $1 LIMIT 1');
      setSqlParams([{ name: 'email', source: 'input.email' }]);
      setSqlReadOnly(true);
      setSqlMaxRows(50);
    }
  }, [skill, open]);

  if (!open) return null;

  const handleSave = async () => {
    if (!skillSource) {
      toast.error('Selecione uma tool');
      return;
    }

    let parsedParams: Record<string, unknown>;
    try {
      parsedParams = JSON.parse(parameters);
    } catch {
      toast.error('Parameters: JSON inválido');
      return;
    }

    const payload: any = {
      name,
      description,
      category: category.trim() || undefined,
      promptInstructions: promptInstructions.trim() || undefined,
      source: skillSource,
      parameters: parsedParams,
      toolId,
      timeoutMs,
      isActive: true,
      changeNote: changeNote.trim() || undefined,
    };

    if (skillSource === 'HTTP') {
      let parsedHeadersExtra: Record<string, string> | undefined;
      let parsedResponseMap: Record<string, string> | undefined;
      if (headersExtraJson.trim()) {
        try { parsedHeadersExtra = JSON.parse(headersExtraJson); }
        catch { toast.error('Headers extra: JSON inválido'); return; }
      }
      if (responseMap.trim()) {
        try { parsedResponseMap = JSON.parse(responseMap); }
        catch { toast.error('Response map: JSON inválido'); return; }
      }
      Object.assign(payload, {
        httpMethod,
        httpPath,
        httpHeadersExtra: parsedHeadersExtra,
        httpBodyTemplate: bodyTemplate || undefined,
        responseMap: parsedResponseMap,
      });
    } else {
      Object.assign(payload, {
        sqlQuery,
        sqlParamMap: sqlParams.filter((p) => p.source.trim()),
        sqlReadOnly,
        sqlMaxRows,
      });
    }

    setSaving(true);
    try {
      if (skill) {
        await aiCatalogService.updateSkill(skill.id, payload);
        toast.success(`Skill atualizada (v${skill.currentVersion + 1})`);
      } else {
        await aiCatalogService.createSkill(payload);
        toast.success('Skill criada');
      }
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  // SQL params helpers
  const addParam = () => setSqlParams([...sqlParams, { name: '', source: '' }]);
  const updateParam = (i: number, patch: Partial<ParamRow>) =>
    setSqlParams(sqlParams.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const removeParam = (i: number) =>
    setSqlParams(sqlParams.filter((_, idx) => idx !== i));

  return (
    <div className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-zinc-900">
        <div className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {skill ? `Editar skill (v${skill.currentVersion} → v${skill.currentVersion + 1})` : 'Nova skill'}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Skill = a função que o LLM chama (resetPassword, etc). Bind a uma Tool.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome (function name)" hint="só letras/dígitos/underscore">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="resetPassword"
                className="font-mono"
              />
            </Field>
            <Field label="Categoria">
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="pos-venda"
              />
            </Field>
          </div>

          <Field label="Descrição (pra LLM)" hint="O LLM lê isso pra decidir quando chamar">
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Gera nova senha aleatória e envia por e-mail. Use quando o cliente esqueceu/perdeu a senha."
            />
          </Field>

          <Field
            label="Tool (provider)"
            hint="A conexão que essa skill usa. Cadastre em 'Tools' antes."
          >
            <select
              value={toolId}
              onChange={(e) => setToolId(e.target.value)}
            >
              <option value="">— selecione —</option>
              {(tools ?? []).map((t: AiTool) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.source === 'CUSTOM_HTTP' ? 'HTTP' : 'SQL'})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Parameters (JSON Schema)" mono>
            <textarea
              rows={6}
              value={parameters}
              onChange={(e) => setParameters(e.target.value)}
              className="font-mono text-xs"
            />
          </Field>

          {skillSource === 'HTTP' && (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                HTTP invocation
              </p>
              <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
                <Field label="Method">
                  <select
                    value={httpMethod}
                    onChange={(e) => setHttpMethod(e.target.value)}
                  >
                    {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Path"
                  hint={selectedTool?.httpBaseUrl ? `Concatenado a: ${selectedTool.httpBaseUrl}` : 'Path relativo ao baseUrl da tool'}
                >
                  <input
                    value={httpPath}
                    onChange={(e) => setHttpPath(e.target.value)}
                    placeholder="/admin/actions/reset-password"
                    className="font-mono text-xs"
                  />
                </Field>
              </div>

              <div className="mt-3">
                <Field
                  label="Headers extras (opcional, JSON)"
                  hint="Headers ALÉM dos da tool. Geralmente vazio."
                  mono
                >
                  <textarea
                    rows={2}
                    value={headersExtraJson}
                    onChange={(e) => setHeadersExtraJson(e.target.value)}
                    className="font-mono text-xs"
                  />
                </Field>
              </div>

              {httpMethod !== 'GET' && httpMethod !== 'DELETE' && (
                <div className="mt-3">
                  <Field label="Body template" hint="Templates: {{input.x}}, {{ctx.x}}, {{env.X}}" mono>
                    <textarea
                      rows={4}
                      value={bodyTemplate}
                      onChange={(e) => setBodyTemplate(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </Field>
                </div>
              )}

              <div className="mt-3">
                <Field label="Response mapping (opcional)" hint='JSONPath: {"ok": "$.success"}' mono>
                  <textarea
                    rows={2}
                    value={responseMap}
                    onChange={(e) => setResponseMap(e.target.value)}
                    className="font-mono text-xs"
                  />
                </Field>
              </div>
            </div>
          )}

          {skillSource === 'SQL' && (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                SQL invocation
              </p>
              <Field label="Query" hint="Use $1, $2... pra parâmetros" mono>
                <textarea
                  rows={5}
                  value={sqlQuery}
                  onChange={(e) => setSqlQuery(e.target.value)}
                  className="font-mono text-xs"
                />
              </Field>

              <div className="mt-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Parâmetros (em ordem $1, $2...)
                  </label>
                  <button
                    type="button"
                    onClick={addParam}
                    className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-xs hover:bg-zinc-100 dark:bg-zinc-800"
                  >
                    <Plus className="h-3 w-3" /> Adicionar
                  </button>
                </div>
                <div className="mt-1 space-y-1.5">
                  {sqlParams.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-8 text-center font-mono text-xs text-zinc-500">
                        ${i + 1}
                      </span>
                      <input
                        value={p.name}
                        onChange={(e) => updateParam(i, { name: e.target.value })}
                        placeholder="nome"
                        className="w-32 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                      <input
                        value={p.source}
                        onChange={(e) => updateParam(i, { source: e.target.value })}
                        placeholder="input.email | ctx.x | literal:foo"
                        className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                      <button
                        type="button"
                        onClick={() => removeParam(i)}
                        className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Max rows">
                  <input
                    type="number"
                    value={sqlMaxRows}
                    onChange={(e) => setSqlMaxRows(parseInt(e.target.value, 10) || 50)}
                  />
                </Field>
                <div className="flex items-end">
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={sqlReadOnly}
                      onChange={(e) => setSqlReadOnly(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <span className="text-zinc-700 dark:text-zinc-300">
                      Read-only (recomendado)
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          <Field
            label="Instruções extras (opcional, vão pro system prompt)"
            hint="Heurísticas que o agent deve seguir quando essa skill estiver ativa"
          >
            <textarea
              rows={3}
              value={promptInstructions}
              onChange={(e) => setPromptInstructions(e.target.value)}
              placeholder="Sempre rode checkPurchase antes de prometer ações..."
              className="font-mono text-xs"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Timeout (ms)">
              <input
                type="number"
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(parseInt(e.target.value, 10) || 15000)}
              />
            </Field>
            {skill && (
              <Field label="Nota da mudança" hint="Vai pro changelog">
                <input
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                  placeholder="Ajustei o prompt..."
                />
              </Field>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name || !description || !toolId}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : (
              <>
                <Check className="h-3.5 w-3.5" />
                {skill ? 'Salvar nova versão' : 'Criar'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </label>
      <div className="mt-1 [&>input]:w-full [&>input]:rounded-md [&>input]:border [&>input]:border-zinc-300 [&>input]:bg-white [&>input]:px-3 [&>input]:py-2 [&>input]:text-sm [&>select]:w-full [&>select]:rounded-md [&>select]:border [&>select]:border-zinc-300 [&>select]:bg-white [&>select]:px-3 [&>select]:py-2 [&>select]:text-sm [&>textarea]:w-full [&>textarea]:rounded-md [&>textarea]:border [&>textarea]:border-zinc-300 [&>textarea]:bg-white [&>textarea]:px-3 [&>textarea]:py-2 [&>textarea]:text-sm dark:[&>input]:border-zinc-700 dark:[&>input]:bg-zinc-800 dark:[&>input]:text-zinc-100 dark:[&>select]:border-zinc-700 dark:[&>select]:bg-zinc-800 dark:[&>select]:text-zinc-100 dark:[&>textarea]:border-zinc-700 dark:[&>textarea]:bg-zinc-800 dark:[&>textarea]:text-zinc-100">
        {children}
      </div>
      {hint && <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}
