import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { OrgRole, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { OrganizationsRepository } from './organizations.repository';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { stripAiSecrets } from '../ai-agents/llm/ai-credentials.service';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private readonly repository: OrganizationsRepository) {}

  async getOrganization(orgId: string) {
    const org = await this.repository.findById(orgId);
    if (!org) throw new NotFoundException('Organization not found');
    // As chaves de IA (settings.ai) só saem pelo /ai-providers, mascaradas.
    return stripAiSecrets(org);
  }

  async updateOrganization(orgId: string, dto: UpdateOrganizationDto) {
    await this.getOrganization(orgId);
    const {
      aiBusinessHours,
      watchdogBusinessHours,
      watchdogConfig,
      allowedUrlDomains,
      pipelinesEnabled,
      projectsEnabled,
      ...rest
    } = dto;
    const features: Record<string, boolean> = {
      ...(pipelinesEnabled !== undefined ? { pipelines: pipelinesEnabled } : {}),
      ...(projectsEnabled !== undefined ? { projects: projectsEnabled } : {}),
    };
    const updated = await this.repository.update(orgId, {
      ...rest,
      ...(Object.keys(features).length > 0
        ? { settings: await this.mergeFeatures(orgId, features) }
        : {}),
      ...(aiBusinessHours !== undefined
        ? { aiBusinessHours: aiBusinessHours as object }
        : {}),
      ...(watchdogBusinessHours !== undefined
        ? { watchdogBusinessHours: watchdogBusinessHours as object }
        : {}),
      ...(watchdogConfig !== undefined
        ? { watchdogConfig: watchdogConfig as object }
        : {}),
      ...(allowedUrlDomains !== undefined
        ? {
            allowedUrlDomains:
              allowedUrlDomains === null
                ? Prisma.JsonNull
                : (allowedUrlDomains as Prisma.InputJsonValue),
          }
        : {}),
    });
    return stripAiSecrets(updated);
  }

  /**
   * Módulos liga/desliga em `settings.features` (JSON, sem migration). Lê o
   * settings cru do banco — o de getOrganization vem sem `settings.ai`, e
   * regravar a partir dele apagaria as chaves de IA.
   */
  private async mergeFeatures(
    orgId: string,
    patch: Record<string, boolean>,
  ): Promise<Prisma.InputJsonValue> {
    const raw = await this.repository.findById(orgId);
    const settings = (raw?.settings ?? {}) as Record<string, unknown>;
    const features = (settings.features ?? {}) as Record<string, unknown>;
    return { ...settings, features: { ...features, ...patch } } as Prisma.InputJsonValue;
  }

  async getMembers(orgId: string) {
    return this.repository.findMembers(orgId);
  }

  /**
   * Cadastro direto: cria a conta com a senha definida pelo admin e já põe
   * na organização. E-mail que já tem conta (de outra organização) entra com
   * a senha que já tinha — não trocamos a senha de ninguém por aqui.
   */
  async createMember(orgId: string, dto: CreateMemberDto) {
    const email = dto.email.trim().toLowerCase();
    let accessProfileId: string | null = null;
    if (dto.role === 'AGENT' && dto.accessProfileId) {
      const profile = await this.repository.findAccessProfile(orgId, dto.accessProfileId);
      if (!profile) throw new NotFoundException('Perfil de acesso não encontrado');
      accessProfileId = profile.id;
    }
    const existing = await this.repository.findUserByEmail(email);
    if (existing) {
      if (await this.repository.findMembership(existing.id, orgId)) {
        throw new ConflictException('Este e-mail já é membro da organização');
      }
      await this.repository.addMember(orgId, existing.id, dto.role, accessProfileId);
      this.logger.log(`Existing user ${email} added to org ${orgId}`);
      return { userId: existing.id, email, existingAccount: true };
    }
    const password = await bcrypt.hash(dto.password, 12);
    const user = await this.repository.createUser(dto.name.trim(), email, password);
    await this.repository.addMember(orgId, user.id, dto.role, accessProfileId);
    this.logger.log(`Member ${email} created in org ${orgId}`);
    return { userId: user.id, email, existingAccount: false };
  }

  async inviteMember(orgId: string, dto: InviteMemberDto, inviterId: string) {
    // Check if user already exists and is already a member
    const existingUser = await this.repository.findUserByEmail(dto.email);
    if (existingUser) {
      const existingMembership = await this.repository.findMembership(existingUser.id, orgId);
      if (existingMembership) {
        throw new ConflictException('User is already a member of this organization');
      }
    }

    // Create invitation (works for both existing and non-existing users)
    // Perfil de acesso só vale para atendente (AGENT) e precisa ser desta org.
    let accessProfileId: string | null = null;
    if (dto.role === 'AGENT' && dto.accessProfileId) {
      const profile = await this.repository.findAccessProfile(orgId, dto.accessProfileId);
      if (!profile) throw new NotFoundException('Perfil de acesso não encontrado');
      accessProfileId = profile.id;
    }
    const invitation = await this.repository.createInvitation(orgId, dto.email, dto.role, inviterId, accessProfileId);
    this.logger.log(`Invitation sent to ${dto.email} for org ${orgId} by ${inviterId}`);

    // If user already exists, auto-accept: add them to org immediately
    if (existingUser) {
      await this.repository.addMember(orgId, existingUser.id, dto.role, accessProfileId);
      await this.repository.acceptInvitation(invitation.id);
      this.logger.log(`User ${dto.email} auto-added to org ${orgId} (already registered)`);
      return { ...invitation, status: 'ACCEPTED' as const, autoAccepted: true };
    }

    return { ...invitation, autoAccepted: false };
  }

  async validateInvitation(token: string) {
    const invitation = await this.repository.findInvitationByToken(token);
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.status !== 'PENDING') {
      throw new BadRequestException(`Invitation has already been ${invitation.status.toLowerCase()}`);
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }
    return {
      email: invitation.email,
      role: invitation.role,
      organization: invitation.organization,
    };
  }

  async getInvitations(orgId: string) {
    return this.repository.findInvitationsByOrg(orgId);
  }

  async revokeInvitation(orgId: string, invitationId: string) {
    const invitations = await this.repository.findInvitationsByOrg(orgId);
    const invitation = invitations.find((i) => i.id === invitationId);
    if (!invitation) {
      throw new NotFoundException('Invitation not found in this organization');
    }
    if (invitation.status !== 'PENDING') {
      throw new BadRequestException('Only pending invitations can be revoked');
    }
    return this.repository.revokeInvitation(invitationId);
  }

  async updateMemberRole(orgId: string, memberId: string, dto: UpdateMemberRoleDto, actorRole: OrgRole) {
    const membership = await this.repository.findMembership(memberId, orgId);
    if (!membership) {
      throw new NotFoundException('Member not found in this organization');
    }

    if (membership.role === 'OWNER' && dto.role !== 'OWNER') {
      throw new ForbiddenException('Cannot change the role of the organization owner');
    }

    if (actorRole === 'ADMIN' && dto.role === 'OWNER') {
      throw new ForbiddenException('Only owners can assign the owner role');
    }

    return this.repository.updateMemberRole(membership.id, dto.role);
  }

  /**
   * Cor da bolinha de iniciais do membro. Fica no JSON `preferences` da
   * membership (chave `avatarColor`) — sem coluna nova/migration; o PATCH
   * de preferências do próprio usuário faz merge raso e não apaga a chave.
   */
  async updateMemberColor(orgId: string, memberId: string, color: string | null) {
    const membership = await this.repository.findMembership(memberId, orgId);
    if (!membership) {
      throw new NotFoundException('Member not found in this organization');
    }
    const preferences = { ...((membership.preferences ?? {}) as Record<string, unknown>) };
    if (color) preferences.avatarColor = color.toLowerCase();
    else delete preferences.avatarColor;
    return this.repository.updateMemberPreferences(membership.id, preferences);
  }

  async removeMember(orgId: string, memberId: string, actorId: string) {
    const membership = await this.repository.findMembership(memberId, orgId);
    if (!membership) {
      throw new NotFoundException('Member not found in this organization');
    }

    if (membership.role === 'OWNER') {
      throw new ForbiddenException('Cannot remove the organization owner');
    }

    if (memberId === actorId) {
      throw new BadRequestException('Cannot remove yourself. Transfer ownership first.');
    }

    await this.repository.removeMember(membership.id);
    this.logger.log(`Member ${memberId} removed from org ${orgId} by ${actorId}`);
  }
}
