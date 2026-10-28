import { effectiveAccess } from '../../common/access/effective-access';
import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { SignOptions } from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    // Cadastro só por convite: sem convite, o register criaria uma
    // organização nova para qualquer pessoa da internet. Checado antes do
    // e-mail para não revelar quais contas existem.
    // ALLOW_PUBLIC_SIGNUP=true reabre o cadastro livre.
    if (!dto.inviteToken && this.config.get<string>('ALLOW_PUBLIC_SIGNUP') !== 'true') {
      throw new ForbiddenException('Cadastro disponível apenas por convite');
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    // Check if registering via invitation
    if (dto.inviteToken) {
      return this.registerWithInvite(dto, hashedPassword);
    }

    return this.registerNewWorkspace(dto, hashedPassword);
  }

  private async registerNewWorkspace(dto: RegisterDto, hashedPassword: string) {
    const slug = this.generateSlug(dto.name);

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          password: hashedPassword,
        },
      });

      const organization = await tx.organization.create({
        data: {
          name: `${dto.name}'s Workspace`,
          slug,
        },
      });

      await tx.userOrganization.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: 'OWNER',
        },
      });

      const defaultDepartment = await tx.department.create({
        data: {
          organizationId: organization.id,
          name: 'Geral',
          description: 'Departamento padrão',
          isDefault: true,
        },
      });

      const userOrg = await tx.userOrganization.findUnique({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId: organization.id,
          },
        },
      });

      if (userOrg) {
        await tx.departmentAgent.create({
          data: {
            departmentId: defaultDepartment.id,
            userOrganizationId: userOrg.id,
          },
        });
      }

      return { user, organization };
    });

    const tokens = await this.generateTokens(result.user.id, result.user.email);
    this.logger.log(`User registered (new workspace): ${result.user.email}`);

    return {
      user: this.sanitizeUser(result.user),
      organizations: [{
        id: result.organization.id,
        name: result.organization.name,
        slug: result.organization.slug,
        role: 'OWNER',
        accessibleChannelIds: 'ALL' as const,
      }],
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  private async registerWithInvite(dto: RegisterDto, hashedPassword: string) {
    // Validate the invitation
    const invitation = await this.prisma.invitation.findUnique({
      where: { token: dto.inviteToken },
      include: { organization: true },
    });

    if (!invitation) {
      throw new BadRequestException('Invalid invitation token');
    }
    if (invitation.status !== 'PENDING') {
      throw new BadRequestException(`Invitation has already been ${invitation.status.toLowerCase()}`);
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }
    if (invitation.email !== dto.email) {
      throw new BadRequestException('Email does not match the invitation');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          password: hashedPassword,
        },
      });

      // Add user to the invited organization
      const membership = await tx.userOrganization.create({
        data: {
          userId: user.id,
          organizationId: invitation.organizationId,
          role: invitation.role,
          accessProfileId: invitation.role === 'AGENT' ? invitation.accessProfileId : null,
        },
      });

      // Add to default department
      const defaultDept = await tx.department.findFirst({
        where: { organizationId: invitation.organizationId, isDefault: true },
      });

      if (defaultDept) {
        await tx.departmentAgent.create({
          data: {
            departmentId: defaultDept.id,
            userOrganizationId: membership.id,
          },
        });
      }

      // Mark invitation as accepted
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });

      // Also accept any other pending invitations for this email
      await tx.invitation.updateMany({
        where: {
          email: dto.email,
          status: 'PENDING',
          id: { not: invitation.id },
        },
        data: { status: 'EXPIRED' },
      });

      return { user, organization: invitation.organization };
    });

    const tokens = await this.generateTokens(result.user.id, result.user.email);
    this.logger.log(`User registered via invitation: ${result.user.email} -> org ${result.organization.name}`);

    return {
      user: this.sanitizeUser(result.user),
      organizations: [{
        id: result.organization.id,
        name: result.organization.name,
        slug: result.organization.slug,
        role: invitation.role,
        // New invited members start with no channel grants (deny-by-default).
        // OWNER/ADMIN bypass; AGENT must be explicitly granted by an admin.
        accessibleChannelIds:
          invitation.role === 'OWNER' || invitation.role === 'ADMIN'
            ? ('ALL' as const)
            : ([] as string[]),
      }],
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async login(dto: LoginDto) {
    // E-mail como digitado e, se não achar, em minúsculas (membros cadastrados
    // pelo admin são gravados em minúsculas).
    const user =
      (await this.prisma.user.findUnique({ where: { email: dto.email } })) ??
      (await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } }));

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    const memberships = await this.prisma.userOrganization.findMany({
      where: { userId: user.id },
      include: {
        organization: true,
        channelAgents: { select: { channelId: true } },
        accessProfile: true,
      },
    });

    const tokens = await this.generateTokens(user.id, user.email);

    this.logger.log(`User logged in: ${user.email}`);

    return {
      user: this.sanitizeUser(user),
      organizations: memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
        accessibleChannelIds:
          m.role === 'OWNER' || m.role === 'ADMIN'
            ? ('ALL' as const)
            : m.channelAgents.map((c) => c.channelId),
        // Perfil de acesso do atendente (null = sem restrição).
        access: effectiveAccess(m.role, m.accessProfile),
      })),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string };
    try {
      payload = this.jwt.verify<{ sub: string }>(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Erro de banco (ex.: conexões esgotadas) NÃO é token inválido: deixar
    // virar 401 desloga o usuário por um problema passageiro.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.generateTokens(user.id, user.email);
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new UnauthorizedException();

    const memberships = await this.prisma.userOrganization.findMany({
      where: { userId },
      include: {
        organization: true,
        channelAgents: { select: { channelId: true } },
        accessProfile: true,
      },
    });

    return {
      user: this.sanitizeUser(user),
      organizations: memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
        // 'ALL' for OWNER/ADMIN — they bypass the per-channel allowlist.
        accessibleChannelIds:
          m.role === 'OWNER' || m.role === 'ADMIN'
            ? ('ALL' as const)
            : m.channelAgents.map((c) => c.channelId),
        // Perfil de acesso do atendente (null = sem restrição).
        access: effectiveAccess(m.role, m.accessProfile),
      })),
    };
  }

  /**
   * "Ver como" (testes do admin): token de acesso de 1h do membro, sem
   * refresh, marcado com quem abriu (`imp`). ADMIN só vê como atendente;
   * OWNER vê como qualquer um, menos outro OWNER.
   */
  async impersonate(
    requester: { id: string; impersonatorId?: string | null },
    organizationId: string,
    requesterRole: string,
    targetUserId: string,
  ) {
    if (requester.impersonatorId) {
      throw new ForbiddenException('Saia do "ver como" antes de abrir outro');
    }
    if (targetUserId === requester.id) {
      throw new BadRequestException('Você já está vendo como você mesmo');
    }
    const membership = await this.prisma.userOrganization.findUnique({
      where: { userId_organizationId: { userId: targetUserId, organizationId } },
      include: { user: true },
    });
    if (!membership || !membership.user.isActive) {
      throw new NotFoundException('Membro não encontrado nesta organização');
    }
    const allowed =
      membership.role === 'AGENT' || (membership.role === 'ADMIN' && requesterRole === 'OWNER');
    if (!allowed) {
      throw new ForbiddenException(
        requesterRole === 'OWNER'
          ? 'Não é possível ver como outro dono da organização'
          : 'Administradores só podem ver como atendentes',
      );
    }

    const expiresIn = 60 * 60;
    const accessToken = await this.jwt.signAsync(
      { sub: membership.user.id, email: membership.user.email, imp: requester.id },
      { secret: this.config.get<string>('JWT_SECRET'), expiresIn },
    );
    this.logger.warn(
      `Impersonation: user ${requester.id} → ${membership.user.id} (${membership.user.email}) in org ${organizationId}`,
    );
    return { accessToken, expiresIn, ...(await this.getMe(membership.user.id)) };
  }

  private async generateTokens(userId: string, email: string) {
    const payload = { sub: userId, email };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('JWT_SECRET'),
        expiresIn: this.config.get<string>('JWT_EXPIRATION', '15m') as SignOptions['expiresIn'],
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRATION', '7d') as SignOptions['expiresIn'],
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private sanitizeUser(user: { password: string; [key: string]: unknown }) {
    const { password: _, ...rest } = user;
    return rest;
  }

  private generateSlug(name: string): string {
    const base = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    return `${base}-${Date.now().toString(36)}`;
  }
}
