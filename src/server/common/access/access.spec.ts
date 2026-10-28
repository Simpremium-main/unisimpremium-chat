import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../guards/roles.guard';
import { REQUIRE_ACTION_KEY, REQUIRE_PAGE_KEY, ROLES_KEY } from '../decorators';
import { effectiveAccess } from './effective-access';
import { canAccess } from './catalog';
import { AuthService } from '../../modules/auth/auth.service';

const profile = { id: 'p1', name: 'Atendente', pages: ['inbox', 'contacts', 'lixo'], actions: ['conversations.close'] };

describe('effectiveAccess', () => {
  it('dono/admin e atendente sem perfil: sem restrição', () => {
    expect(effectiveAccess('OWNER', profile as any)).toBeNull();
    expect(effectiveAccess('ADMIN', profile as any)).toBeNull();
    expect(effectiveAccess('AGENT', null)).toBeNull();
  });
  it('atendente com perfil: só o que o perfil libera (chaves desconhecidas caem)', () => {
    const access = effectiveAccess('AGENT', profile as any)!;
    expect(access.pages).toEqual(['inbox', 'contacts']);
    expect(canAccess(access, 'action', 'conversations.close')).toBe(true);
    expect(canAccess(access, 'action', 'conversations.assign')).toBe(false);
    expect(canAccess(null, 'action', 'qualquer')).toBe(true);
  });
});

describe('RolesGuard com perfil de acesso', () => {
  const run = (meta: Record<string, unknown>, organization: Record<string, unknown>) => {
    const reflector = { getAllAndOverride: (key: string) => meta[key] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    const ctx = {
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => ({ organization }) }),
    } as any;
    return () => guard.canActivate(ctx);
  };
  const agent = { userRole: 'AGENT', access: effectiveAccess('AGENT', profile as any) };

  it('bloqueia ação e página fora do perfil com 403 explicando', () => {
    expect(run({ [REQUIRE_ACTION_KEY]: 'conversations.assign' }, agent)).toThrow(ForbiddenException);
    expect(run({ [REQUIRE_PAGE_KEY]: 'dashboard' }, agent)).toThrow('não libera esta página');
  });
  it('libera o que o perfil tem', () => {
    expect(run({ [REQUIRE_ACTION_KEY]: 'conversations.close' }, agent)()).toBe(true);
    expect(run({ [REQUIRE_PAGE_KEY]: 'inbox' }, agent)()).toBe(true);
  });
  it('admin e atendente sem perfil passam; role continua valendo', () => {
    expect(run({ [REQUIRE_ACTION_KEY]: 'pipelines.edit' }, { userRole: 'ADMIN', access: null })()).toBe(true);
    expect(run({ [REQUIRE_PAGE_KEY]: 'dashboard' }, { userRole: 'AGENT', access: null })()).toBe(true);
    expect(run({ [ROLES_KEY]: ['OWNER', 'ADMIN'] }, { userRole: 'AGENT', access: null })()).toBe(false);
  });
});

describe('AuthService.impersonate ("ver como")', () => {
  const build = (targetRole: string, active = true) => {
    const prisma = {
      userOrganization: {
        findUnique: jest.fn(async () => ({
          role: targetRole,
          user: { id: 'target', email: 't@x.com', isActive: active },
        })),
        findMany: jest.fn(async () => []),
      },
      user: { findUnique: jest.fn(async () => ({ id: 'target', password: 'h' })) },
    };
    const jwt = { signAsync: jest.fn(async (payload: unknown) => `token:${JSON.stringify(payload)}`) };
    const config = { get: () => 'secret' };
    const svc = new AuthService(prisma as any, jwt as any, config as any);
    return { svc, jwt };
  };

  it('admin vê como atendente: token de 1h marcado com quem abriu', async () => {
    const { svc, jwt } = build('AGENT');
    const res = await svc.impersonate({ id: 'admin' }, 'org', 'ADMIN', 'target');
    expect(res.expiresIn).toBe(3600);
    expect(jwt.signAsync).toHaveBeenCalledWith(
      { sub: 'target', email: 't@x.com', imp: 'admin' },
      expect.objectContaining({ expiresIn: 3600 }),
    );
  });
  it('admin não vê como admin; dono vê como admin mas não como dono', async () => {
    await expect(build('ADMIN').svc.impersonate({ id: 'a' }, 'org', 'ADMIN', 'target')).rejects.toThrow(ForbiddenException);
    await expect(build('ADMIN').svc.impersonate({ id: 'o' }, 'org', 'OWNER', 'target')).resolves.toBeDefined();
    await expect(build('OWNER').svc.impersonate({ id: 'o' }, 'org', 'OWNER', 'target')).rejects.toThrow(ForbiddenException);
  });
  it('não aninha, não é a si mesmo, e o membro precisa estar ativo', async () => {
    await expect(build('AGENT').svc.impersonate({ id: 'a', impersonatorId: 'x' }, 'org', 'ADMIN', 'target')).rejects.toThrow(ForbiddenException);
    await expect(build('AGENT').svc.impersonate({ id: 'target' }, 'org', 'ADMIN', 'target')).rejects.toThrow(BadRequestException);
    await expect(build('AGENT', false).svc.impersonate({ id: 'a' }, 'org', 'ADMIN', 'target')).rejects.toThrow(NotFoundException);
  });
});

describe('sub-páginas (abas do Jarvis)', () => {
  const access = (pages: string[]) => ({ profileId: 'p', profileName: 'X', pages, actions: [] });
  it('Jarvis sem abas escolhidas: todas as abas', () => {
    expect(canAccess(access(['jarvis']), 'page', 'jarvis.skills')).toBe(true);
  });
  it('com abas escolhidas: só elas', () => {
    const a = access(['jarvis', 'jarvis.runs', 'jarvis.agents']);
    expect(canAccess(a, 'page', 'jarvis.runs')).toBe(true);
    expect(canAccess(a, 'page', 'jarvis.skills')).toBe(false);
  });
  it('sem a página-mãe, nenhuma aba', () => {
    expect(canAccess(access(['inbox', 'jarvis.runs']), 'page', 'jarvis.runs')).toBe(false);
  });
});
