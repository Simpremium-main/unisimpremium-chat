import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AiPlaybook, AiPlaybookStep, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { UpsertPlaybookDto } from './dto/upsert-playbook.dto';

export type PlaybookWithSteps = AiPlaybook & { steps: AiPlaybookStep[] };

const WITH_STEPS = { steps: { orderBy: { position: 'asc' } } } as const;

/** Fluxos de atendimento da IA (gatilho + instruções + mensagens fixas). */
@Injectable()
export class PlaybooksService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string): Promise<PlaybookWithSteps[]> {
    return this.prisma.aiPlaybook.findMany({
      where: { organizationId },
      include: WITH_STEPS,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Fluxos ativos que valem pro agente (os da org inteira + os dele). */
  forAgent(organizationId: string, agentId: string): Promise<PlaybookWithSteps[]> {
    return this.prisma.aiPlaybook.findMany({
      where: { organizationId, isActive: true, OR: [{ agentId: null }, { agentId }] },
      include: WITH_STEPS,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Fluxo pelo slug, se vale pro agente. `includeInactive` é pra ferramentas
   * que usam um fluxo como conteúdo (ex.: instruções de roaming) mesmo que
   * ele não apareça no prompt como gatilho.
   */
  findBySlug(
    organizationId: string,
    agentId: string,
    slug: string,
    opts: { includeInactive?: boolean } = {},
  ): Promise<PlaybookWithSteps | null> {
    return this.prisma.aiPlaybook.findFirst({
      where: {
        organizationId,
        slug,
        OR: [{ agentId: null }, { agentId }],
        ...(opts.includeInactive ? {} : { isActive: true }),
      },
      include: WITH_STEPS,
    });
  }

  async create(organizationId: string, dto: UpsertPlaybookDto): Promise<PlaybookWithSteps> {
    await this.assertAgent(organizationId, dto.agentId);
    const slug = dto.slug || slugify(dto.name);
    try {
      return await this.prisma.aiPlaybook.create({
        data: {
          organizationId,
          name: dto.name.trim(),
          slug,
          trigger: dto.trigger.trim(),
          instructions: dto.instructions?.trim() ?? '',
          agentId: dto.agentId || null,
          groupName: dto.groupName?.trim() || null,
          isActive: dto.isActive ?? true,
          sortOrder: dto.sortOrder ?? 0,
          steps: { create: stepRows(dto) },
        },
        include: WITH_STEPS,
      });
    } catch (err) {
      throw this.mapUniqueError(err, slug);
    }
  }

  async update(organizationId: string, id: string, dto: Partial<UpsertPlaybookDto>): Promise<PlaybookWithSteps> {
    await this.get(organizationId, id);
    if (dto.agentId !== undefined) await this.assertAgent(organizationId, dto.agentId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.steps) {
          await tx.aiPlaybookStep.deleteMany({ where: { playbookId: id } });
        }
        return tx.aiPlaybook.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
            ...(dto.trigger !== undefined ? { trigger: dto.trigger.trim() } : {}),
            ...(dto.instructions !== undefined ? { instructions: dto.instructions.trim() } : {}),
            ...(dto.agentId !== undefined ? { agentId: dto.agentId || null } : {}),
            ...(dto.groupName !== undefined ? { groupName: dto.groupName?.trim() || null } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
            ...(dto.steps ? { steps: { create: stepRows(dto as UpsertPlaybookDto) } } : {}),
          },
          include: WITH_STEPS,
        });
      });
    } catch (err) {
      throw this.mapUniqueError(err, dto.slug ?? '');
    }
  }

  async remove(organizationId: string, id: string): Promise<{ ok: true }> {
    await this.get(organizationId, id);
    await this.prisma.aiPlaybook.delete({ where: { id } });
    return { ok: true };
  }

  async get(organizationId: string, id: string): Promise<PlaybookWithSteps> {
    const playbook = await this.prisma.aiPlaybook.findFirst({
      where: { id, organizationId },
      include: WITH_STEPS,
    });
    if (!playbook) throw new NotFoundException('Fluxo não encontrado');
    return playbook;
  }

  private async assertAgent(organizationId: string, agentId: string | null | undefined) {
    if (!agentId) return;
    const agent = await this.prisma.aiAgent.findFirst({
      where: { id: agentId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!agent) throw new NotFoundException('Agente não encontrado');
  }

  private mapUniqueError(err: unknown, slug: string): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException(`Já existe um fluxo com o identificador "${slug}"`);
    }
    return err;
  }
}

function stepRows(dto: Pick<UpsertPlaybookDto, 'steps'>) {
  return (dto.steps ?? []).map((s, position) => ({
    position,
    type: s.type,
    content: s.content.trim(),
    caption: s.type === 'TEXT' ? null : s.caption?.trim() || null,
  }));
}

/** "Cotação de Chip" → "cotacao-de-chip". */
export function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'fluxo'
  );
}
