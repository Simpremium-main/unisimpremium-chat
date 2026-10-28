'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Inbox, MessageSquare, Phone, Instagram, Mail, Send, Users, Tag, Star, Filter } from 'lucide-react';
import { toast } from 'sonner';
import {
  inboxViewsService,
  type InboxView,
  type InboxViewFilters,
} from '../services/inbox-views.service';
import { channelsService } from '@/features/channels/services/channels.service';
import { tagsService } from '@/features/settings/services/tags.service';

interface Props {
  open: boolean;
  view: InboxView | null;
  onClose: () => void;
  onSaved: () => void;
}

const ICONS = [
  { name: 'Inbox', Icon: Inbox },
  { name: 'MessageSquare', Icon: MessageSquare },
  { name: 'Phone', Icon: Phone },
  { name: 'Instagram', Icon: Instagram },
  { name: 'Mail', Icon: Mail },
  { name: 'Send', Icon: Send },
  { name: 'Users', Icon: Users },
  { name: 'Tag', Icon: Tag },
  { name: 'Star', Icon: Star },
  { name: 'Filter', Icon: Filter },
];

const COLORS = [
  { name: 'default', cls: 'bg-zinc-400' },
  { name: 'green', cls: 'bg-green-500' },
  { name: 'pink', cls: 'bg-pink-500' },
  { name: 'violet', cls: 'bg-violet-500' },
  { name: 'blue', cls: 'bg-blue-500' },
  { name: 'amber', cls: 'bg-amber-500' },
  { name: 'red', cls: 'bg-red-500' },
];

// Só dois status pro operador. "Aberto" cobre todos os estados internos
// não fechados (pendente, bot, em atendimento, aguardando).
const OPEN_STATUSES = ['PENDING', 'BOT', 'OPEN', 'WAITING'];
const STATUSES = [
  { value: 'OPEN', label: 'Aberto', members: OPEN_STATUSES },
  { value: 'CLOSED', label: 'Fechado', members: ['CLOSED'] },
];

const ASSIGNED_OPTIONS = [
  { value: 'any', label: 'Qualquer pessoa' },
  { value: 'me', label: 'Atribuída a mim' },
  { value: 'none', label: 'Não atribuída' },
];

const KIND_OPTIONS: Array<{ value: '' | 'INDIVIDUAL' | 'GROUP'; label: string }> = [
  { value: '', label: 'Todas' },
  { value: 'INDIVIDUAL', label: 'Apenas individuais' },
  { value: 'GROUP', label: 'Apenas grupos' },
];

export function InboxViewDialog({ open, view, onClose, onSaved }: Props) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('Filter');
  const [color, setColor] = useState('default');
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [assignedTo, setAssignedTo] = useState<string>('any');
  const [kind, setKind] = useState<'' | 'INDIVIDUAL' | 'GROUP'>('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [hideAi, setHideAi] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: () => channelsService.list(),
    enabled: open,
  });

  const { data: tags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: () => tagsService.list(),
    enabled: open,
  });

  useEffect(() => {
    if (view) {
      setName(view.name);
      setIcon(view.icon ?? 'Filter');
      setColor(view.color ?? 'default');
      setChannelIds(view.filters?.channelIds ?? []);
      setStatuses(view.filters?.statuses ?? []);
      setAssignedTo(view.filters?.assignedTo ?? 'any');
      setKind(view.filters?.kind ?? '');
      setTagIds(view.filters?.tagIds ?? []);
      setHideAi(view.filters?.hideAi === true);
    } else {
      setName('');
      setIcon('Filter');
      setColor('default');
      setChannelIds([]);
      setStatuses([]);
      setAssignedTo('any');
      setKind('');
      setTagIds([]);
      setHideAi(false);
    }
  }, [view, open]);

  if (!open) return null;

  const toggleChannel = (id: string) =>
    setChannelIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  // Cada opção liga/desliga o grupo inteiro de estados internos.
  const isStatusOn = (members: string[]) => members.some((m) => statuses.includes(m));
  const toggleStatus = (members: string[]) =>
    setStatuses((prev) =>
      members.some((m) => prev.includes(m))
        ? prev.filter((x) => !members.includes(x))
        : [...prev, ...members],
    );

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Dá um nome pra inbox');
      return;
    }
    const filters: InboxViewFilters = {};
    if (channelIds.length) filters.channelIds = channelIds;
    if (statuses.length) filters.statuses = statuses;
    if (assignedTo && assignedTo !== 'any') filters.assignedTo = assignedTo;
    if (kind) filters.kind = kind;
    if (tagIds.length) filters.tagIds = tagIds;
    if (hideAi) filters.hideAi = true;

    setSaving(true);
    try {
      if (view) {
        await inboxViewsService.update(view.id, { name, icon, color, filters });
        toast.success('Inbox atualizada');
      } else {
        await inboxViewsService.create({ name, icon, color, filters });
        toast.success('Inbox criada');
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
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-zinc-900">
        <div className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {view ? 'Editar inbox' : 'Nova inbox'}
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Nome
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex: Vendas WhatsApp"
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Ícone
            </label>
            <div className="mt-2 flex flex-wrap gap-1">
              {ICONS.map(({ name: n, Icon }) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setIcon(n)}
                  className={`flex size-8 items-center justify-center rounded-md border ${
                    icon === n
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700'
                  }`}
                >
                  <Icon className="size-4" />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Cor
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setColor(c.name)}
                  className={`size-7 rounded-full ${c.cls} ${
                    color === c.name
                      ? 'ring-2 ring-zinc-900 ring-offset-2 dark:ring-white'
                      : ''
                  }`}
                  aria-label={c.name}
                />
              ))}
            </div>
          </div>

          <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <p className="text-xs font-semibold uppercase text-zinc-500">
              Filtros
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Canais ({channelIds.length || 'todos'})
            </label>
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
              {channels.length === 0 && (
                <p className="text-xs text-zinc-400">Nenhum canal cadastrado.</p>
              )}
              {channels.map((c: any) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  <input
                    type="checkbox"
                    checked={channelIds.includes(c.id)}
                    onChange={() => toggleChannel(c.id)}
                    className="size-3.5"
                  />
                  <span className="font-medium">{c.name}</span>
                  <span className="text-[10px] uppercase text-zinc-400">
                    {c.type}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Status
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => toggleStatus(s.members)}
                  className={`rounded-full px-3 py-1 text-xs ${
                    isStatusOn(s.members)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-zinc-400">
              Vazio = todos os status.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Atribuição
            </label>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              {ASSIGNED_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Tipo de conversa
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {KIND_OPTIONS.map((o) => (
                <button
                  key={o.value || 'all'}
                  type="button"
                  onClick={() => setKind(o.value)}
                  className={`rounded-full px-3 py-1 text-xs ${
                    kind === o.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-200 p-2.5 text-xs dark:border-zinc-800">
            <input
              type="checkbox"
              checked={hideAi}
              onChange={(e) => setHideAi(e.target.checked)}
              className="mt-0.5 size-3.5"
            />
            <span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">Esconder conversas da IA</span>
              <span className="block text-[11px] text-zinc-500">
                Não mostra as que a IA está atendendo, as que esperam o admin (IA Aguardando) nem as transferidas que ainda não foram atendidas (IA para Humano).
              </span>
            </span>
          </label>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Tags ({tagIds.length || 'nenhuma — todas'})
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.length === 0 && (
                <p className="text-[11px] text-zinc-400">
                  Nenhuma tag cadastrada na org. Crie em Configurações &gt; Tags.
                </p>
              )}
              {tags.map((t: any) => {
                const active = tagIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      setTagIds((prev) =>
                        prev.includes(t.id)
                          ? prev.filter((x) => x !== t.id)
                          : [...prev, t.id],
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-all"
                    style={{
                      backgroundColor: active ? t.color : `${t.color}1f`,
                      color: active ? '#fff' : t.color,
                      border: `1px solid ${active ? t.color : `${t.color}40`}`,
                    }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{
                        backgroundColor: active ? '#fff' : t.color,
                      }}
                    />
                    {t.name}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] text-zinc-400">
              Conversa entra se tiver QUALQUER uma das tags marcadas (na conversa ou no contato).
            </p>
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
            disabled={saving || !name}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : view ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  );
}
