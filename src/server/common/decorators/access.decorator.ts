import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AccessAction, AccessPage, EffectiveAccess } from '../access/catalog';

export const REQUIRE_ACTION_KEY = 'access:action';
export const REQUIRE_PAGE_KEY = 'access:page';

/** A rota exige a ação no perfil de acesso (atendentes com perfil). */
export const RequireAction = (action: AccessAction) => SetMetadata(REQUIRE_ACTION_KEY, action);

/** A rota exige a página no perfil de acesso (atendentes com perfil). */
export const RequirePage = (page: AccessPage) => SetMetadata(REQUIRE_PAGE_KEY, page);

/** Permissões efetivas do usuário (null = sem restrição), montadas pelo OrgGuard. */
export const CurrentAccess = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): EffectiveAccess | null =>
    ctx.switchToHttp().getRequest().organization?.access ?? null,
);
