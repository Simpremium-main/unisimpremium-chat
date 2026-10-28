'use client';

import { useCallback, useRef, useState } from 'react';
import { X, Trash2, ImagePlus, Loader2, Link2 } from 'lucide-react';
import type { Node } from '@xyflow/react';
import { toast } from 'sonner';
import { inboxService } from '@/features/inbox/services/inbox.service';

interface NodePropertiesPanelProps {
  node: Node;
  onUpdate: (id: string, data: Record<string, any>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const inputCls = 'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary';
const labelCls = 'block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1';

export function NodePropertiesPanel({ node, onUpdate, onDelete, onClose }: NodePropertiesPanelProps) {
  const data = node.data as Record<string, any>;
  const update = useCallback(
    (key: string, value: any) => onUpdate(node.id, { ...data, [key]: value }),
    [node.id, data, onUpdate],
  );

  return (
    <div className="w-72 border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Propriedades</h3>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600"><X className="h-4 w-4" /></button>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <span className="inline-block rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-500 dark:bg-zinc-800">
            {node.type}
          </span>
        </div>

        {node.type === 'MESSAGE' && (
          <div>
            <label className={labelCls}>Mensagem</label>
            <textarea
              className={`${inputCls} min-h-[80px] resize-y`}
              value={data.message || ''}
              onChange={(e) => update('message', e.target.value)}
              placeholder="Olá {{name}}, como posso ajudar?"
            />
            <p className="mt-1 text-[10px] text-zinc-400">Use {'{{variavel}}'} para interpolar</p>
            <MessageImageField image={data.image} onChange={(image) => update('image', image)} />
            <div className="mt-3">
              <label className={labelCls}>Aguardar antes de enviar (segundos)</label>
              <input
                type="number"
                min={0}
                max={15}
                step={1}
                className={inputCls}
                value={data.delaySeconds ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  update('delaySeconds', raw === '' ? undefined : Math.min(15, Math.max(0, Math.round(Number(raw)))));
                }}
                placeholder="0"
              />
              <p className="mt-1 text-[10px] leading-snug text-zinc-400">
                O cliente vê &quot;digitando...&quot; durante a espera. Use para separar este bloco do
                anterior (ex.: texto e depois a imagem). Até 15 segundos.
              </p>
            </div>
          </div>
        )}

        {node.type === 'MENU' && (
          <>
            <div>
              <label className={labelCls}>Título do Menu</label>
              <input className={inputCls} value={data.title || ''} onChange={(e) => update('title', e.target.value)} placeholder="Escolha uma opção:" />
            </div>
            <div>
              <label className={labelCls}>Opções</label>
              {(data.options || []).map((opt: any, i: number) => (
                <div key={i} className="mt-1 flex gap-1">
                  <input
                    className={`${inputCls} flex-1`}
                    value={opt.label}
                    onChange={(e) => {
                      const opts = [...(data.options || [])];
                      opts[i] = { ...opts[i], label: e.target.value };
                      update('options', opts);
                    }}
                    placeholder={`Opção ${i + 1}`}
                  />
                  <button
                    onClick={() => update('options', (data.options || []).filter((_: any, j: number) => j !== i))}
                    className="rounded p-1 text-zinc-400 hover:text-red-500"
                  ><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              <button
                onClick={() => update('options', [...(data.options || []), { label: '', value: `opt_${Date.now()}` }])}
                className="mt-2 text-xs font-medium text-primary hover:underline"
              >+ Adicionar opção</button>
            </div>
          </>
        )}

        {node.type === 'MENU' && (
          <div className="space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <div>
              <label className={labelCls}>Como enviar as opções</label>
              <select
                className={inputCls}
                value={data.display === 'text' ? 'text' : 'auto'}
                onChange={(e) => update('display', e.target.value)}
              >
                <option value="auto">Botões / lista do WhatsApp</option>
                <option value="text">Texto numerado (1, 2, 3…)</option>
              </select>
            </div>
            {data.display !== 'text' && (
              <>
                <div>
                  <label className={labelCls}>Texto do botão da lista</label>
                  <input
                    className={inputCls}
                    maxLength={20}
                    value={data.listButton || ''}
                    onChange={(e) => update('listButton', e.target.value)}
                    placeholder="Ver opções"
                  />
                </div>
                <p className="text-[10px] leading-snug text-zinc-400">
                  Até 3 opções curtas (20 letras) viram botões; até 10, uma lista; mais que isso,
                  texto numerado. Instagram e e-mail recebem sempre texto. O cliente também pode
                  responder com o número ou o nome da opção.
                </p>
                <p className="text-[10px] leading-snug text-amber-600 dark:text-amber-400">
                  No WhatsApp não oficial (Zappfy), botões e listas podem não aparecer em alguns
                  aparelhos ou no WhatsApp Web — se o envio falhar, vai o texto numerado.
                </p>
              </>
            )}
          </div>
        )}

        {node.type === 'END_FLOW' && (
          <>
            <div>
              <label className={labelCls}>Ao terminar o fluxo, a conversa vai para</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['AI', '🤖 IA', 'A IA continua o atendimento na hora, com o histórico do fluxo'],
                  ['HUMAN', '🙋 Atendente', 'Vai para a fila dos atendentes; a IA fica pausada'],
                ] as const).map(([value, label, hint]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => update('handoff', value)}
                    title={hint}
                    className={`rounded-md border px-2 py-2 text-xs font-medium ${
                      data.handoff === value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {!['AI', 'HUMAN'].includes(data.handoff) && (
                <p className="mt-1 text-[10px] text-amber-600">Obrigatório — o fluxo não salva sem isso.</p>
              )}
              <p className="mt-1 text-[10px] text-zinc-400">
                {data.handoff === 'AI'
                  ? 'A IA continua o atendimento na hora, com o histórico do fluxo.'
                  : data.handoff === 'HUMAN'
                    ? 'Vai para a fila dos atendentes; a IA fica pausada nesta conversa.'
                    : ''}
              </p>
            </div>
            <div>
              <label className={labelCls}>Mensagem final (opcional)</label>
              <textarea
                className={`${inputCls} min-h-[60px] resize-y`}
                value={data.message || ''}
                onChange={(e) => update('message', e.target.value)}
                placeholder="Obrigado! Já vou te atender."
              />
            </div>
          </>
        )}

        {node.type === 'CONDITION' && (
          <>
            <div>
              <label className={labelCls}>Variável</label>
              <input className={inputCls} value={data.variable || ''} onChange={(e) => update('variable', e.target.value)} placeholder="lastMenuSelection" />
            </div>
            <div>
              <label className={labelCls}>Operador</label>
              <select className={inputCls} value={data.operator || 'equals'} onChange={(e) => update('operator', e.target.value)}>
                <option value="equals">Igual a</option>
                <option value="not_equals">Diferente de</option>
                <option value="contains">Contém</option>
                <option value="gt">Maior que</option>
                <option value="lt">Menor que</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Valor</label>
              <input className={inputCls} value={data.value || ''} onChange={(e) => update('value', e.target.value)} />
            </div>
          </>
        )}

        {node.type === 'WAIT' && (
          <>
            <div>
              <label className={labelCls}>Mensagem de espera</label>
              <input className={inputCls} value={data.prompt || ''} onChange={(e) => update('prompt', e.target.value)} placeholder="Digite sua resposta..." />
            </div>
            <div>
              <label className={labelCls}>Salvar resposta em</label>
              <input className={inputCls} value={data.saveAs || ''} onChange={(e) => update('saveAs', e.target.value)} placeholder="lastInput" />
            </div>
          </>
        )}

        {node.type === 'TRANSFER' && (
          <div>
            <label className={labelCls}>Mensagem de transferência</label>
            <input className={inputCls} value={data.message || ''} onChange={(e) => update('message', e.target.value)} placeholder="Transferindo para um atendente..." />
            <p className="mt-1 text-[10px] text-zinc-400">
              Encerra o fluxo e passa para atendente humano (IA pausada nesta conversa).
            </p>
          </div>
        )}

        {node.type !== 'START' && node.type !== 'END_FLOW' && (
          <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <button
              onClick={() => onDelete(node.id)}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remover nó
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Imagem do nó Mensagem: guardada em `data.image` e enviada com o texto como legenda. */
interface MessageImage {
  url: string;
  mimeType?: string;
  fileName?: string;
  size?: number;
}

/** O WhatsApp oficial só aceita JPG e PNG em imagem, até 5MB. */
const IMAGE_ACCEPT = 'image/jpeg,image/png';
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

function MessageImageField({
  image,
  onChange,
}: {
  image?: MessageImage | null;
  onChange: (image: MessageImage | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [link, setLink] = useState('');
  // O upload termina depois: usa o onChange atual, senão desfaz o que foi
  // digitado no nó enquanto a imagem subia.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const upload = async (file: File) => {
    if (!IMAGE_ACCEPT.split(',').includes(file.type)) {
      toast.error('Use uma imagem JPG ou PNG');
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      toast.error('Imagem acima de 5MB (limite do WhatsApp)');
      return;
    }
    setUploading(true);
    try {
      const up = await inboxService.uploadMedia(file);
      onChangeRef.current({ url: up.url, mimeType: up.mimeType, fileName: up.filename || file.name, size: up.size });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || 'Erro ao enviar a imagem');
    } finally {
      setUploading(false);
    }
  };

  const applyLink = () => {
    const url = link.trim();
    if (!/^https:\/\/\S+$/i.test(url)) {
      toast.error('Cole um link https:// da imagem');
      return;
    }
    const mimeType = /\.png(\?|#|$)/i.test(url) ? 'image/png' : 'image/jpeg';
    onChange({ url, mimeType });
    setLink('');
    setShowLink(false);
  };

  return (
    <div className="mt-3">
      <label className={labelCls}>Imagem (opcional)</label>
      {image?.url ? (
        <div className="relative overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.url} alt="" className="max-h-40 w-full bg-zinc-50 object-contain dark:bg-zinc-900" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute right-1 top-1 rounded bg-white/90 p-1 text-zinc-500 shadow hover:text-red-500 dark:bg-zinc-800/90"
            aria-label="Remover imagem"
            title="Remover imagem"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <p className="truncate border-t border-zinc-200 px-2 py-1 text-[10px] text-zinc-400 dark:border-zinc-700">
            {image.fileName || image.url}
          </p>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-dashed border-zinc-300 px-2 py-2 text-xs font-medium text-zinc-600 hover:border-primary hover:text-primary disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            {uploading ? 'Enviando…' : 'Enviar imagem'}
          </button>
          <button
            type="button"
            onClick={() => setShowLink((v) => !v)}
            className="rounded-md border border-zinc-300 px-2 text-zinc-500 hover:border-primary hover:text-primary dark:border-zinc-700"
            aria-label="Usar link da imagem"
            title="Usar link da imagem"
          >
            <Link2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {showLink && !image?.url && (
        <div className="mt-1.5 flex gap-1">
          <input
            className={`${inputCls} flex-1 py-1.5 text-xs`}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyLink()}
            placeholder="https://…/imagem.jpg"
            autoFocus
          />
          <button type="button" onClick={applyLink} className="rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground">
            OK
          </button>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) upload(file);
        }}
      />
      <p className="mt-1 text-[10px] leading-snug text-zinc-400">
        JPG ou PNG até 5MB. O texto acima vai como legenda da imagem (acima de 1024 letras, vai numa
        mensagem logo depois). No Instagram, o texto vai sempre numa mensagem separada.
      </p>
    </div>
  );
}
