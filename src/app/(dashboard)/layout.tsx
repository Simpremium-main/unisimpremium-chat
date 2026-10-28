'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { SidebarLayout } from '@/components/ui/sidebar-layout';
import { Navbar, NavbarSection, NavbarSpacer } from '@/components/ui/navbar';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { useAuthStore } from '@/stores/auth-store';
import { authService } from '@/features/auth/services/auth.service';
import { usePermissionsSync } from '@/features/settings/hooks/use-permissions-sync';
import { ToolFailureBanner } from '@/features/ai-agents/components/tool-failure-banner';
import { ImpersonationBanner } from '@/features/access/impersonation-banner';
import { useAccess } from '@/features/access/use-access';
import { getSocket } from '@/lib/socket';
import { bootstrapPush } from '@/features/push/push';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, setAuth, activeOrgId, setActiveOrg } = useAuthStore();
  const [isLoading, setIsLoading] = useState(true);

  usePermissionsSync();
  const { canPath, landing } = useAccess();
  const allowed = canPath(pathname ?? '');

  // Página fora do perfil de acesso: vai para a primeira permitida.
  useEffect(() => {
    if (isLoading || allowed) return;
    const target = landing();
    if (target) router.replace(target);
  }, [isLoading, allowed, landing, router]);

  // App na Tela de Início: service worker + inscrição de push deste aparelho.
  useEffect(() => {
    if (isLoading) return;
    bootstrapPush().catch(() => undefined);
  }, [isLoading]);

  // Admin mudou o perfil deste usuário: recarrega as permissões na hora.
  useEffect(() => {
    if (isLoading) return;
    const socket = getSocket();
    const handler = () => {
      authService.getMe().then((data) => setAuth(data.user, data.organizations)).catch(() => undefined);
    };
    socket.on('access:updated', handler);
    return () => {
      socket.off('access:updated', handler);
    };
  }, [isLoading, setAuth]);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.replace('/login');
      return;
    }

    if (user) {
      setIsLoading(false);
      return;
    }

    authService
      .getMe()
      .then((data) => {
        setAuth(data.user, data.organizations);
        // Ensure activeOrgId is set (setAuth handles this, but double-check)
        const currentOrgId = localStorage.getItem('active_org_id');
        if (!currentOrgId && data.organizations.length > 0) {
          setActiveOrg(data.organizations[0].id);
        }
        setIsLoading(false);
      })
      .catch(() => {
        // "Ver como" expirado: o interceptor da API já voltou para a conta do admin.
        if ((window as { __impersonationExpired?: boolean }).__impersonationExpired) return;
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        router.replace('/login');
      });
  }, [router, user, setAuth, setActiveOrg]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <SidebarLayout
      sidebar={<AppSidebar />}
      navbar={
        <Navbar>
          <NavbarSpacer />
          <NavbarSection><></></NavbarSection>
        </Navbar>
      }
    >
      <div className="flex h-full flex-col">
        <ImpersonationBanner />
        <ToolFailureBanner />
        {/* key por rota: cada página nova entra com uma transição curta. */}
        <div key={pathname} className="animate-page-in flex-1 min-h-0">
          {allowed ? (
            children
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-500">
              {landing() ? 'Redirecionando…' : 'Seu perfil de acesso não libera nenhuma página. Fale com o administrador.'}
            </div>
          )}
        </div>
      </div>
    </SidebarLayout>
  );
}
