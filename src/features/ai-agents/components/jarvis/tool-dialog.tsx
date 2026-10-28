'use client';

import { useEffect, useState } from 'react';
import { X, Globe, Database } from 'lucide-react';
import { toast } from 'sonner';
import {
  aiCatalogService,
  type AiTool,
  type ToolSource,
} from '../../services/ai-catalog.service';

interface Props {
  open: boolean;
  tool: AiTool | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ToolDialog({ open, tool, onClose, onSaved }: Props) {
  const [source, setSource] = useState<ToolSource>('CUSTOM_HTTP');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [httpBaseUrl, setHttpBaseUrl] = useState('');
  const [headersJson, setHeadersJson] = useState('{}');
  const [sqlConnectionRef, setSqlConnectionRef] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (tool) {
      setSource(tool.source);
      setName(tool.name);
      setDescription(tool.description);
      setHttpBaseUrl(tool.httpBaseUrl ?? '');
      setHeadersJson(JSON.stringify(tool.httpHeaders ?? {}, null, 2));
      setSqlConnectionRef(tool.sqlConnectionRef ?? '');
    } else {
      setSource('CUSTOM_HTTP');
      setName('');
      setDescription('');
      setHttpBaseUrl('');
      setHeadersJson('{}');
      setSqlConnectionRef('');
    }
  }, [tool, open]);

  if (!open) return null;

  const handleSave = async () => {
    const payload: any = {
      name,
      description,
      source,
      isActive: true,
    };

    if (source === 'CUSTOM_HTTP') {
      let parsedHeaders: Record<string, string>;
      try {
        parsedHeaders = headersJson.trim() ? JSON.parse(headersJson) : {};
      } catch {
        toast.error('Headers: JSON inválido');
        return;
      }
      payload.httpBaseUrl = httpBaseUrl;
      payload.httpHeaders = parsedHeaders;
    } else {
      payload.sqlConnectionRef = sqlConnectionRef;
    }

    setSaving(true);
    try {
      if (tool) {
        await aiCatalogService.updateTool(tool.id, payload);
        toast.success('Tool atualizada');
      } else {
        await aiCatalogService.createTool(payload);
        toast.success('Tool criada');
      }
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-zinc-900">
        <div className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {tool ? 'Editar tool' : 'Nova tool (conexão)'}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Conexão reusável entre várias skills
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
          {!tool && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSource('CUSTOM_HTTP')}
                className={`flex items-center gap-2 rounded-lg border-2 p-3 text-left transition-colors ${
                  source === 'CUSTOM_HTTP'
                    ? 'border-primary bg-primary/5'
                    : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700'
                }`}
              >
                <Globe className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">HTTP API</p>
                  <p className="text-[11px] text-zinc-500">REST com auth</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setSource('CUSTOM_SQL')}
                className={`flex items-center gap-2 rounded-lg border-2 p-3 text-left transition-colors ${
                  source === 'CUSTOM_SQL'
                    ? 'border-primary bg-primary/5'
                    : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700'
                }`}
              >
                <Database className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">SQL Postgres</p>
                  <p className="text-[11px] text-zinc-500">Query num banco</p>
                </div>
              </button>
            </div>
          )}

          <Field label="Nome">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={source === 'CUSTOM_SQL' ? 'Hotwebinar' : 'Trivapp'}
            />
          </Field>

          <Field label="Descrição">
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                source === 'CUSTOM_SQL'
                  ? 'Banco do funil de vendas. Read-only.'
                  : 'Plataforma da área de membros. Server-to-server admin endpoints.'
              }
            />
          </Field>

          {source === 'CUSTOM_HTTP' ? (
            <>
              <Field
                label="Base URL"
                hint="URL base da API. Skills vão concatenar o path."
              >
                <input
                  value={httpBaseUrl}
                  onChange={(e) => setHttpBaseUrl(e.target.value)}
                  placeholder="https://api.trivapp.com.br/api/v1"
                  className="font-mono text-xs"
                />
              </Field>

              <Field
                label="Headers padrão (JSON)"
                hint="Auth e content-type que vão em TODAS as skills dessa tool. Templates: {{env.X}}."
                mono
              >
                <textarea
                  rows={5}
                  value={headersJson}
                  onChange={(e) => setHeadersJson(e.target.value)}
                  placeholder='{"x-admin-api-key":"{{env.MEMBERS_ADMIN_KEY}}","x-tenant-id":"{{env.MEMBERS_TENANT_ID}}","Content-Type":"application/json"}'
                  className="font-mono text-xs"
                />
              </Field>
            </>
          ) : (
            <Field
              label="Connection ref (env var)"
              hint="Nome da env var no servidor com a connection string. Ex: HOTWEBINAR_DB_URL"
            >
              <input
                value={sqlConnectionRef}
                onChange={(e) => setSqlConnectionRef(e.target.value)}
                placeholder="HOTWEBINAR_DB_URL"
                className="font-mono"
              />
            </Field>
          )}
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
            disabled={saving || !name || !description}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : tool ? 'Salvar' : 'Criar'}
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
      <div className="mt-1 [&>input]:w-full [&>input]:rounded-md [&>input]:border [&>input]:border-zinc-300 [&>input]:bg-white [&>input]:px-3 [&>input]:py-2 [&>input]:text-sm [&>textarea]:w-full [&>textarea]:rounded-md [&>textarea]:border [&>textarea]:border-zinc-300 [&>textarea]:bg-white [&>textarea]:px-3 [&>textarea]:py-2 [&>textarea]:text-sm dark:[&>input]:border-zinc-700 dark:[&>input]:bg-zinc-800 dark:[&>input]:text-zinc-100 dark:[&>textarea]:border-zinc-700 dark:[&>textarea]:bg-zinc-800 dark:[&>textarea]:text-zinc-100">
        {children}
      </div>
      {hint && <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}
