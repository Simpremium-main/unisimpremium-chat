import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { ROLES_KEY, IS_PUBLIC_KEY, REQUIRE_ACTION_KEY, REQUIRE_PAGE_KEY } from '../decorators';
import { canAccess, EffectiveAccess } from '../access/catalog';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const targets = [context.getHandler(), context.getClass()];

    // Perfil de acesso do atendente (null = sem restrição): página da rota
    // e ação exigida. 403 com o motivo, para o front mostrar.
    const access: EffectiveAccess | null = request.organization?.access ?? null;
    const page = this.reflector.getAllAndOverride<string>(REQUIRE_PAGE_KEY, targets);
    if (page && !canAccess(access, 'page', page)) {
      throw new ForbiddenException('Seu perfil de acesso não libera esta página');
    }
    const action = this.reflector.getAllAndOverride<string>(REQUIRE_ACTION_KEY, targets);
    if (action && !canAccess(access, 'action', action)) {
      throw new ForbiddenException('Seu perfil de acesso não permite esta ação');
    }

    const requiredRoles = this.reflector.getAllAndOverride<OrgRole[]>(ROLES_KEY, targets);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const userRole = request.organization?.userRole;

    if (!userRole) return false;

    return requiredRoles.includes(userRole);
  }
}
