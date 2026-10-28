import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import {
  ACCESS_ACTIONS,
  ACCESS_PAGES,
  ACTION_KEYS,
  DEFAULT_ATTENDANT_PROFILE,
  PAGE_KEYS,
} from '../../../common/access/catalog';
import { UpsertAccessProfileDto } from './access-profiles.dto';

/** Perfis de acesso dos atendentes (páginas + ações). */
@Injectable()
export class AccessProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  catalog() {
    return { pages: ACCESS_PAGES, actions: ACCESS_ACTIONS };
  }

  /** Lista os perfis; a org sempre tem o "Atendente" (criado na primeira vez). */
  async list(organizationId: string) {
    await this.prisma.accessProfile.upsert({
      where: { uq_access_profile_org_name: { organizationId, name: DEFAULT_ATTENDANT_PROFILE.name } },
      update: {},
      create: { organizationId, ...DEFAULT_ATTENDANT_PROFILE },
    });
    return this.prisma.accessProfile.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { members: true } } },
    });
  }

  async create(organizationId: string, dto: UpsertAccessProfileDto) {
    try {
      return await this.prisma.accessProfile.create({
        data: { organizationId, ...this.clean(dto) },
      });
    } catch (err) {
      throw this.mapError(err, dto.name);
    }
  }

  async update(organizationId: string, id: string, dto: UpsertAccessProfileDto) {
    await this.get(organizationId, id);
    try {
      const profile = await this.prisma.accessProfile.update({
        where: { id },
        data: this.clean(dto),
        include: { members: { select: { userId: true } } },
      });
      // Quem está com o app aberto recarrega as permissões na hora.
      for (const m of profile.members) {
        this.realtime.emitToUser(m.userId, 'access:updated', { organizationId });
      }
      const { members: _m, ...rest } = profile;
      return rest;
    } catch (err) {
      throw this.mapError(err, dto.name);
    }
  }

  async remove(organizationId: string, id: string) {
    const profile = await this.get(organizationId, id);
    const members = await this.prisma.userOrganization.findMany({
      where: { accessProfileId: id },
      select: { userId: true },
    });
    // Membros do perfil voltam ao acesso padrão (FK com SET NULL).
    await this.prisma.accessProfile.delete({ where: { id: profile.id } });
    for (const m of members) this.realtime.emitToUser(m.userId, 'access:updated', { organizationId });
    return { ok: true };
  }

  /** Atribui (ou remove, com null) o perfil de um membro. */
  async assign(organizationId: string, memberId: string, accessProfileId: string | null) {
    const member = await this.prisma.userOrganization.findFirst({
      where: { OR: [{ id: memberId }, { userId: memberId }], organizationId },
    });
    if (!member) throw new NotFoundException('Membro não encontrado');
    if (accessProfileId) await this.get(organizationId, accessProfileId);
    const updated = await this.prisma.userOrganization.update({
      where: { id: member.id },
      data: { accessProfileId },
      include: { accessProfile: true },
    });
    this.realtime.emitToUser(member.userId, 'access:updated', { organizationId });
    return updated;
  }

  async get(organizationId: string, id: string) {
    const profile = await this.prisma.accessProfile.findFirst({ where: { id, organizationId } });
    if (!profile) throw new NotFoundException('Perfil de acesso não encontrado');
    return profile;
  }

  private clean(dto: UpsertAccessProfileDto) {
    const unknown = [
      ...dto.pages.filter((p) => !PAGE_KEYS.has(p)),
      ...dto.actions.filter((a) => !ACTION_KEYS.has(a)),
    ];
    if (unknown.length) throw new BadRequestException(`Permissões desconhecidas: ${unknown.join(', ')}`);
    return {
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      pages: [...new Set(dto.pages)],
      actions: [...new Set(dto.actions)],
    };
  }

  private mapError(err: unknown, name: string): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException(`Já existe um perfil chamado "${name}"`);
    }
    return err;
  }
}
