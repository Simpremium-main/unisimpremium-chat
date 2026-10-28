'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Bell, Monitor, Smartphone, Volume2, VolumeX, Moon,
  MessageSquare, Users, AlertTriangle, ArrowRightLeft, AtSign, Cog,
} from 'lucide-react';

const notifTypes = [
  { type: 'NEW_MESSAGE', label: 'Nova mensagem', description: 'Quando um cliente envia uma mensagem', icon: MessageSquare },
  { type: 'CONVERSATION_ASSIGNED', label: 'Conversa atribuída', description: 'Quando uma conversa é atribuída a você', icon: Users },
  { type: 'CONVERSATION_TRANSFERRED', label: 'Transferência', description: 'Quando uma conversa é transferida para você', icon: ArrowRightLeft },
  { type: 'SLA_WARNING', label: 'Alerta de SLA', description: 'Quando o tempo de SLA está se esgotando', icon: AlertTriangle },
  { type: 'SLA_BREACH', label: 'SLA violado', description: 'Quando o SLA foi ultrapassado', icon: AlertTriangle },
  { type: 'MENTION', label: 'Menção', description: 'Quando alguém menciona você em uma nota', icon: AtSign },
  { type: 'SYSTEM', label: 'Sistema', description: 'Avisos e atualizações do sistema', icon: Cog },
];

interface Preferences {
  [type: string]: { inApp: boolean; browserPush: boolean; sound: boolean };
}

const defaultPrefs = (): Preferences =>
  Object.fromEntries(notifTypes.map((t) => [t.type, { inApp: true, browserPush: true, sound: true }]));

export default function SettingsNotificationsPage() {
  const [prefs, setPrefs] = useState<Preferences>(defaultPrefs);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [dndEnabled, setDndEnabled] = useState(false);
  const [dndStart, setDndStart] = useState('22:00');
  const [dndEnd, setDndEnd] = useState('08:00');

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPushPermission(Notification.permission);
    } else {
      setPushPermission('unsupported');
    }
  }, []);

  const handleRequestPush = async () => {
    if (!('Notification' in window)) {
      toast.error('Notificações push não são suportadas neste navegador');
      return;
    }
    const permission = await Notification.requestPermission();
    setPushPermission(permission);
    if (permission === 'granted') {
      toast.success('Notificações push ativadas!');
    } else {
      toast.error('Permissão negada pelo navegador');
    }
  };

  const toggle = (type: string, channel: 'inApp' | 'browserPush' | 'sound') => {
    setPrefs((prev) => ({
      ...prev,
      [type]: { ...prev[type], [channel]: !prev[type][channel] },
    }));
  };

  const handleSave = () => {
    toast.success('Preferências salvas!');
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Notificações</h2>
          <p className="mt-0.5 text-sm text-zinc-500">Configure como e quando você deseja ser notificado</p>
        </div>
        <button
          onClick={handleSave}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Salvar preferências
        </button>
      </div>

      <div className="mt-6 space-y-6">
        {/* Push permission banner */}
        {pushPermission !== 'granted' && pushPermission !== 'unsupported' && (
          <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/50 dark:bg-amber-900/20">
            <div className="flex items-center gap-3">
              <Monitor className="h-5 w-5 text-amber-600" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Notificações push desativadas</p>
                <p className="text-xs text-amber-600 dark:text-amber-400">Ative para receber alertas mesmo quando a aba estiver fechada</p>
              </div>
            </div>
            <button
              onClick={handleRequestPush}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
            >
              Ativar push
            </button>
          </div>
        )}

        {pushPermission === 'granted' && (
          <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-800/50 dark:bg-green-900/20">
            <Monitor className="h-5 w-5 text-green-600" />
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-300">Notificações push ativas</p>
              <p className="text-xs text-green-600 dark:text-green-400">Você receberá alertas no navegador</p>
            </div>
          </div>
        )}

        {/* DND */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Moon className="h-5 w-5 text-violet-500" />
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Não perturbe</p>
                <p className="text-xs text-zinc-500">Silenciar notificações em horários específicos</p>
              </div>
            </div>
            <button
              onClick={() => setDndEnabled(!dndEnabled)}
              className={`relative h-6 w-11 rounded-full transition-colors ${dndEnabled ? 'bg-primary' : 'bg-zinc-300 dark:bg-zinc-600'}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${dndEnabled ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
          {dndEnabled && (
            <div className="mt-4 flex items-center gap-3 pl-8">
              <div>
                <label className="block text-[10px] font-medium uppercase text-zinc-400 mb-1">De</label>
                <input
                  type="time"
                  value={dndStart}
                  onChange={(e) => setDndStart(e.target.value)}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              <span className="mt-4 text-zinc-400">até</span>
              <div>
                <label className="block text-[10px] font-medium uppercase text-zinc-400 mb-1">Até</label>
                <input
                  type="time"
                  value={dndEnd}
                  onChange={(e) => setDndEnd(e.target.value)}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
            </div>
          )}
        </div>

        {/* Notification matrix */}
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">Tipo de notificação</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  <div className="flex flex-col items-center gap-0.5">
                    <Bell className="h-3.5 w-3.5" />
                    <span>In-app</span>
                  </div>
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  <div className="flex flex-col items-center gap-0.5">
                    <Monitor className="h-3.5 w-3.5" />
                    <span>Push</span>
                  </div>
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  <div className="flex flex-col items-center gap-0.5">
                    <Volume2 className="h-3.5 w-3.5" />
                    <span>Som</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {notifTypes.map((nt) => {
                const Icon = nt.icon;
                const pref = prefs[nt.type];
                return (
                  <tr key={nt.type} className="border-b border-zinc-50 dark:border-zinc-800">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Icon className="h-4 w-4 shrink-0 text-zinc-400" />
                        <div>
                          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{nt.label}</p>
                          <p className="text-[11px] text-zinc-400">{nt.description}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Toggle checked={pref.inApp} onChange={() => toggle(nt.type, 'inApp')} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Toggle checked={pref.browserPush} onChange={() => toggle(nt.type, 'browserPush')} disabled={pushPermission !== 'granted'} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Toggle checked={pref.sound} onChange={() => toggle(nt.type, 'sound')} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      className={`relative mx-auto h-5 w-9 rounded-full transition-colors disabled:opacity-40 ${
        checked ? 'bg-primary' : 'bg-zinc-300 dark:bg-zinc-600'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}
