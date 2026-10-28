'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Trash2, Shield, ShieldCheck, User, Users, Hash, Check, Eye, EyeOff } from 'lucide-react';
import { accessService } from '@/features/access/access.service';
import { startImpersonation } from '@/features/access/impersonation';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';
import { membersService, type Member } from '@/features/settings/services/members.service';
import { useOrgId } from '@/hooks/use-org-query-key';
import { MemberChannelsDrawer } from '@/features/settings/components/member-channels-drawer';
import { useConfirm } from '@/components/ui/dialogs';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { MemberAvatar } from '@/components/ui/member-avatar';
import { MEMBER_COLORS } from '@/lib/member-color';

const roleLabels: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  OWNER: { label: 'Proprietário', icon: ShieldCheck, color: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400' },
  ADMIN: { label: 'Admin', icon: Shield, color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400' },
  AGENT: { label: 'Atendente', icon: User, color: 'text-zinc-600 bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-400' },
};

export default function SettingsMembersPage() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [inviteRole, setInviteRole] = useState('AGENT');
  const [inviting, setInviting] = useState(false);
  const [inviteProfileId, setInviteProfileId] = useState<string | null>(null);

  const orgId = useOrgId();
  const { data: members, isLoading } = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => membersService.list(),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['members'] });

  // Perfis de acesso dos atendentes (a org sempre tem o "Atendente").
  const { data: profiles } = useQuery({
    queryKey: ['access-profiles', orgId],
    queryFn: () => accessService.list(),
  });
  const effectiveInviteProfile =
    inviteProfileId ?? profiles?.find((p) => p.name === 'Atendente')?.id ?? '';

  const me = {
    userId: useAuthStore((s) => s.user?.id),
    role: useAuthStore((s) => s.organizations.find((o) => o.id === s.activeOrgId)?.role),
  };
  const canViewAs = (m: Member) =>
    m.user.id !== me.userId && (m.role === 'AGENT' || (m.role === 'ADMIN' && me.role === 'OWNER'));

  const handleViewAs = async (m: Member) => {
    try {
      await startImpersonation(m.user.id, m.user.name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível ver como este membro');
    }
  };

  const handleChangeProfile = async (memberId: string, accessProfileId: string | null) => {
    try {
      await accessService.assign(memberId, accessProfileId);
      toast.success('Perfil de acesso atualizado');
      refresh();
      queryClient.invalidateQueries({ queryKey: ['access-profiles'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar perfil');
    }
  };

  const handleChangeColor = async (memberId: string, color: string | null) => {
    try {
      await membersService.updateColor(memberId, color);
      refresh();
      queryClient.invalidateQueries({ queryKey: ['org-members'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar cor');
    }
  };

  const [drawerMember, setDrawerMember] = useState<Member | null>(null);

  const canCreate =
    newName.trim().length >= 2 && /\S+@\S+\.\S+/.test(inviteEmail.trim()) && newPassword.length >= 6;

  const handleCreate = async () => {
    if (!canCreate || inviting) return;
    setInviting(true);
    try {
      const result = await membersService.create({
        name: newName.trim(),
        email: inviteEmail.trim(),
        password: newPassword,
        role: inviteRole,
        ...(inviteRole === 'AGENT' && effectiveInviteProfile ? { accessProfileId: effectiveInviteProfile } : {}),
      });
      setNewName('');
      setInviteEmail('');
      setNewPassword('');
      refresh();
      toast.success(
        result.existingAccount
          ? 'Esse e-mail já tinha conta: foi adicionado à organização com a senha que já usava.'
          : `Membro cadastrado! Ele já pode entrar com ${result.email} e a senha definida.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao cadastrar');
    } finally {
      setInviting(false);
    }
  };

  const handleChangeRole = async (memberId: string, role: string) => {
    try {
      await membersService.updateRole(memberId, role);
      toast.success('Role atualizada');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar role');
    }
  };

  const confirm = useConfirm();
  const handleRemove = async (memberId: string, name: string) => {
    if (
      !(await confirm({
        title: `Remover ${name} da organização?`,
        description: 'A pessoa perde o acesso imediatamente. Dá para cadastrar de novo depois.',
        confirmText: 'Remover',
        tone: 'danger',
      }))
    )
      return;
    try {
      await membersService.remove(memberId);
      toast.success('Membro removido');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Membros</h2>
          <p className="mt-0.5 text-sm text-zinc-500">Gerencie os membros da sua organização</p>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 p-4 dark:border-zinc-700 dark:bg-zinc-900/50">
        <p className="mb-3 text-sm font-medium text-zinc-800 dark:text-zinc-200">Cadastrar membro</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Nome</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome do atendente"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">E-mail (login)</label>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="email@exemplo.com"
              autoComplete="off"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Senha (mín. 6 caracteres)</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoComplete="new-password"
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 pr-9"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Esconder senha' : 'Mostrar senha'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Função</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="AGENT">Atendente</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
          {inviteRole === 'AGENT' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Perfil de acesso</label>
              <select
                value={effectiveInviteProfile}
                onChange={(e) => setInviteProfileId(e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              >
                <option value="">Acesso padrão</option>
                {(profiles ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-end">
            <button
              onClick={handleCreate}
              disabled={!canCreate || inviting}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <UserPlus className="h-4 w-4" /> Cadastrar
            </button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">
          O membro entra direto com esse e-mail e senha — passe os dados de acesso para ele.
        </p>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">Membro</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">Role</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">Perfil</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">Canais</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">Entrou em</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-zinc-50 dark:border-zinc-800">
                  <td className="px-4 py-3"><div className="h-4 w-36 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-16 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-16 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-24 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" /></td>
                  <td className="px-4 py-3" />
                </tr>
              ))
            ) : !members?.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <Users className="mx-auto h-10 w-10 text-zinc-200 dark:text-zinc-700" />
                  <p className="mt-3 text-sm text-zinc-500">Nenhum membro encontrado</p>
                </td>
              </tr>
            ) : (
              members.map((m) => {
                const roleMeta = roleLabels[m.role] || roleLabels.AGENT;
                const RoleIcon = roleMeta.icon;
                return (
                  <tr key={m.id} className="border-b border-zinc-50 dark:border-zinc-800">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <MemberColorPicker
                          name={m.user.name}
                          avatarUrl={m.user.avatarUrl}
                          color={m.preferences?.avatarColor ?? null}
                          onChange={(color) => handleChangeColor(m.id, color)}
                        />
                        <div>
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{m.user.name}</p>
                          <p className="text-[11px] text-zinc-400">{m.user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {m.role === 'OWNER' ? (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${roleMeta.color}`}>
                          <RoleIcon className="h-3 w-3" /> {roleMeta.label}
                        </span>
                      ) : (
                        <select
                          value={m.role}
                          onChange={(e) => handleChangeRole(m.id, e.target.value)}
                          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                          <option value="ADMIN">Admin</option>
                          <option value="AGENT">Atendente</option>
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {m.role === 'AGENT' ? (
                        <select
                          value={m.accessProfile?.id ?? ''}
                          onChange={(e) => handleChangeProfile(m.id, e.target.value || null)}
                          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                          <option value="">Acesso padrão</option>
                          {(profiles ?? []).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                          Acesso total
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {/* OWNER tem acesso intrínseco a tudo (mesmo canais
                          PRIVATE). ADMIN herda os ORG por padrão mas
                          precisa de grant explícito pra PRIVATE — daí
                          ganha o botão "Gerenciar" também. AGENT só vê
                          o que tem grant. */}
                      {m.role === 'OWNER' ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                          Acesso total
                        </span>
                      ) : (
                        <button
                          onClick={() => setDrawerMember(m)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                          data-testid="member-channels-btn"
                        >
                          <Hash className="h-3 w-3" /> Gerenciar
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {new Date(m.joinedAt).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canViewAs(m) && (
                        <button
                          onClick={() => handleViewAs(m)}
                          title={`Ver o app como ${m.user.name}`}
                          aria-label={`Ver como ${m.user.name}`}
                          className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {m.role !== 'OWNER' && (
                        <button
                          onClick={() => handleRemove(m.id, m.user.name)}
                          className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <MemberChannelsDrawer
        open={!!drawerMember}
        member={
          drawerMember
            ? {
                // Backend resolves member by userId; the existing list returns
                // userOrganization rows where `userId` is the field we need.
                id: drawerMember.userId,
                name: drawerMember.user.name,
                role: drawerMember.role,
              }
            : null
        }
        onClose={() => setDrawerMember(null)}
        onSaved={refresh}
      />
    </div>
  );
}

/**
 * Bolinha do membro clicável: escolhe a cor de fundo das iniciais (paleta
 * ou cor livre). Serve pra identificar o atendente no inbox.
 */
function MemberColorPicker({
  name,
  avatarUrl,
  color,
  onChange,
}: {
  name: string;
  avatarUrl: string | null;
  color: string | null;
  onChange: (color: string | null) => void;
}) {
  // O seletor nativo dispara onChange a cada arrasto — salva só quando para.
  const customTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onCustom = (value: string) => {
    clearTimeout(customTimer.current);
    customTimer.current = setTimeout(() => onChange(value), 500);
  };

  return (
    <Popover className="relative">
      <PopoverButton
        className="rounded-full outline-none ring-primary/40 focus-visible:ring-2"
        title="Escolher cor de identificação"
      >
        <MemberAvatar name={name} avatarUrl={avatarUrl} color={color} size={32} />
      </PopoverButton>
      <PopoverPanel
        anchor="bottom start"
        className="z-50 w-56 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg outline-none dark:border-zinc-800 dark:bg-zinc-900 [--anchor-gap:0.25rem]"
      >
        {({ close }) => (
          <>
            <p className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Cor de identificação
            </p>
            <div className="grid grid-cols-7 gap-1.5">
              {MEMBER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { onChange(c); close(); }}
                  style={{ backgroundColor: c }}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-white ring-offset-1 hover:ring-2 hover:ring-zinc-300 dark:ring-offset-zinc-900"
                  aria-label={`Cor ${c}`}
                >
                  {color === c && <Check className="h-3.5 w-3.5" />}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                <input
                  type="color"
                  defaultValue={color ?? '#2563eb'}
                  onChange={(e) => onCustom(e.target.value)}
                  className="h-6 w-8 cursor-pointer rounded border border-zinc-200 bg-transparent dark:border-zinc-700"
                />
                Personalizada
              </label>
              <button
                type="button"
                onClick={() => { onChange(null); close(); }}
                className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                Sem cor
              </button>
            </div>
          </>
        )}
      </PopoverPanel>
    </Popover>
  );
}
