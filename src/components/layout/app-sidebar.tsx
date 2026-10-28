'use client';

import {
  LayoutDashboard,
  Settings,
  LogOut,
  ChevronsUpDown,
  Building2,
  ChevronUp,
  Zap,
  FolderKanban,
  Sun,
  Moon,
  Monitor,
  Check,
  Workflow,
  Bell,
  BellOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { usePushNotifications, removeThisDevice, sendTestPush } from '@/features/push/push';
import { useTheme } from 'next-themes';
import { InboxTree } from '@/features/inbox-views/components/inbox-tree';
import { TagsTree } from '@/features/inbox-views/components/tags-tree';
import { JarvisTree } from '@/features/ai-agents/components/jarvis-tree';
import { PipelinesTree } from '@/features/pipelines/components/pipelines-tree';
import { useOrgFeatures } from '@/features/settings/hooks/use-org-features';

import { useAuthStore } from '@/stores/auth-store';
import { useAccess } from '@/features/access/use-access';
import { Avatar } from '@/components/ui/avatar';
import {
  Sidebar,
  SidebarHeader,
  SidebarBody,
  SidebarFooter,
  SidebarSection,
  SidebarItem,
  SidebarLabel,
  SidebarSpacer,
} from '@/components/ui/sidebar';
import {
  Dropdown,
  DropdownButton,
  DropdownMenu,
  DropdownItem,
  DropdownLabel,
  DropdownDivider,
} from '@/components/ui/dropdown';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, page: 'dashboard' },
  { href: '/projects', label: 'Projetos', icon: FolderKanban, page: 'projects' },
  { href: '/automations', label: 'Automações', icon: Zap, page: 'automations' },
  // Robô de atendimento (fluxo com menus). Mesma permissão do Jarvis.
  { href: '/chatbot', label: 'Chatbot', icon: Workflow, page: 'jarvis' },
];

export function AppSidebar() {
  const { user, organizations, activeOrgId, setActiveOrg, logout } =
    useAuthStore();
  const activeOrg = organizations.find((o) => o.id === activeOrgId);
  const { pipelinesEnabled, projectsEnabled } = useOrgFeatures();
  // Perfil de acesso do atendente: só aparece o que ele libera.
  const { canPage } = useAccess();
  const settingsHref = canPage('settings')
    ? '/settings'
    : canPage('contacts')
      ? '/settings/contacts'
      : canPage('inbox')
        ? '/settings/quick-replies'
        : null;

  const handleOrgSwitch = (orgId: string) => {
    setActiveOrg(orgId);
    window.location.reload();
  };

  return (
    <Sidebar>
      <SidebarHeader>
        <Dropdown>
          <DropdownButton className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2.5 text-left text-sm/6 font-semibold text-zinc-950 hover:bg-zinc-950/5 dark:text-white dark:hover:bg-white/5">
            {/* Marca SIMPREMIUM (claro/escuro). O nome da organização só
                aparece quando o usuário participa de mais de uma, pra saber
                em qual está ao trocar. */}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <img
                src="/brand/simpremium-logo.svg"
                alt="SIMPREMIUM"
                className="h-[18px] w-auto self-start dark:hidden"
              />
              <img
                src="/brand/simpremium-logo-dark.svg"
                alt="SIMPREMIUM"
                className="hidden h-[18px] w-auto self-start dark:block"
              />
              {organizations.length > 1 && (
                <span className="truncate text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                  {activeOrg?.name ?? 'Organização'}
                </span>
              )}
            </span>
            <ChevronsUpDown className="ml-auto size-4 shrink-0 text-zinc-500" />
          </DropdownButton>
          {organizations.length > 1 && (
            <DropdownMenu anchor="bottom start" className="min-w-56">
              {organizations.map((org) => (
                <DropdownItem
                  key={org.id}
                  onClick={() => handleOrgSwitch(org.id)}
                >
                  <Building2 />
                  <DropdownLabel>{org.name}</DropdownLabel>
                </DropdownItem>
              ))}
            </DropdownMenu>
          )}
        </Dropdown>
      </SidebarHeader>

      <SidebarBody>
        <SidebarSection>
          {canPage('inbox') && <InboxTree />}
          {canPage('inbox') && <TagsTree />}
          {pipelinesEnabled && canPage('pipelines') && <PipelinesTree />}
          {canPage('jarvis') && <JarvisTree />}
          {navItems.filter((item) => canPage(item.page) && (item.page !== 'projects' || projectsEnabled)).map((item) => (
            <SidebarItem key={item.href} href={item.href}>
              <item.icon className="size-5" />
              <SidebarLabel>{item.label}</SidebarLabel>
            </SidebarItem>
          ))}
        </SidebarSection>

        <SidebarSpacer />
      </SidebarBody>

      <SidebarFooter>
        <Dropdown>
          <DropdownButton className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-zinc-950/5 dark:hover:bg-white/5">
            <Avatar
              src={user?.avatarUrl}
              initials={user?.name?.slice(0, 2).toUpperCase()}
              className="size-10"
              square
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm/5 font-medium text-zinc-950 dark:text-white">
                {user?.name}
              </span>
              <span className="block truncate text-xs/5 font-normal text-zinc-500 dark:text-zinc-400">
                {user?.email}
              </span>
            </span>
            <ChevronUp className="ml-auto size-4 shrink-0 text-zinc-500" />
          </DropdownButton>
          <DropdownMenu anchor="top start" className="min-w-56">
            {settingsHref && (
              <>
                <DropdownItem href={settingsHref}>
                  <Settings />
                  <DropdownLabel>Configurações</DropdownLabel>
                </DropdownItem>
                <DropdownDivider />
              </>
            )}
            <ThemeOptions />
            <DropdownDivider />
            <PushMenuItem />
            <DropdownDivider />
            <DropdownItem
              onClick={async () => {
                // Este aparelho para de receber as notificações desta conta.
                await removeThisDevice().catch(() => undefined);
                logout();
              }}
            >
              <LogOut />
              <DropdownLabel>Sair</DropdownLabel>
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </SidebarFooter>
    </Sidebar>
  );
}

const THEME_OPTIONS = [
  { value: 'light', label: 'Tema claro', Icon: Sun },
  { value: 'dark', label: 'Tema escuro', Icon: Moon },
  { value: 'system', label: 'Igual ao sistema', Icon: Monitor },
] as const;

/** Escolha de tema no menu do usuário (salvo no navegador pelo next-themes). */
function ThemeOptions() {
  const { theme, setTheme } = useTheme();
  return (
    <>
      {THEME_OPTIONS.map(({ value, label, Icon }) => (
        <DropdownItem key={value} onClick={() => setTheme(value)}>
          <Icon />
          <DropdownLabel>{label}</DropdownLabel>
          {theme === value && <Check className="ml-auto size-4 text-primary" />}
        </DropdownItem>
      ))}
    </>
  );
}

/**
 * Notificações no celular: conversa nova ou mensagem nova em "Não
 * respondidas", "IA para Humano" ou "IA Aguardando", com o total no ícone.
 */
function PushMenuItem() {
  const { state, busy, enable, disable } = usePushNotifications();
  if (state === 'loading' || state === 'unsupported') return null;

  const label =
    state === 'on' ? 'Notificações ativadas' : state === 'needs-install' ? 'Notificações no celular' : 'Ativar notificações';
  const onClick = async () => {
    if (busy) return;
    if (state === 'needs-install') {
      toast.info('No iPhone: abra este site no Safari, toque em Compartilhar → "Adicionar à Tela de Início" e ative as notificações pelo app.', {
        duration: 10_000,
      });
    } else if (state === 'not-configured') {
      toast.error('As notificações ainda não foram configuradas no servidor.');
    } else if (state === 'denied') {
      toast.error('Notificações bloqueadas neste aparelho. Libere em Ajustes → Notificações → Simpremium.', { duration: 8_000 });
    } else if (state === 'on') {
      await disable();
      toast.success('Notificações desativadas neste aparelho');
    } else {
      try {
        if (await enable()) toast.success('Notificações ativadas neste aparelho');
        else toast.error('Permissão de notificação não concedida');
      } catch (err: any) {
        const msg = err?.response?.data?.message;
        toast.error((Array.isArray(msg) ? msg.join(', ') : msg) || err?.message || 'Não foi possível ativar as notificações');
      }
    }
  };

  const onTest = async () => {
    try {
      const r = await sendTestPush();
      if (!r.enabled) toast.error('As notificações ainda não foram configuradas no servidor.');
      else if (r.sent === 0) toast.error('Nenhum aparelho ativado recebeu. Desative e ative de novo neste aparelho.');
      else toast.success('Notificação de teste enviada');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Não foi possível enviar o teste');
    }
  };

  return (
    <>
      <DropdownItem onClick={onClick}>
        {state === 'on' ? <Bell /> : <BellOff />}
        <DropdownLabel>{label}</DropdownLabel>
        {state === 'on' && <Check className="ml-auto size-4 text-primary" />}
      </DropdownItem>
      {state === 'on' && (
        <DropdownItem onClick={onTest}>
          <Bell />
          <DropdownLabel>Enviar notificação de teste</DropdownLabel>
        </DropdownItem>
      )}
    </>
  );
}
