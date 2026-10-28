import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/** Quem cadastrou — mostrado na tela de respostas rápidas. */
const include = {
  createdBy: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.QuickReplyInclude;

@Injectable()
export class QuickRepliesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.QuickReplyCreateInput) {
    return this.prisma.quickReply.create({ data, include });
  }

  /** As da equipe + as pessoais de quem pediu. */
  async findVisible(organizationId: string, userId: string) {
    return this.prisma.quickReply.findMany({
      where: {
        organizationId,
        deletedAt: null,
        OR: [{ isPrivate: false }, { createdById: userId }],
      },
      orderBy: { shortcut: 'asc' },
      include,
    });
  }

  async findById(id: string) {
    return this.prisma.quickReply.findFirst({
      where: { id, deletedAt: null },
      include,
    });
  }

  async findByShortcut(organizationId: string, shortcut: string) {
    return this.prisma.quickReply.findFirst({
      where: { organizationId, shortcut, deletedAt: null },
    });
  }

  async update(id: string, data: Prisma.QuickReplyUpdateInput) {
    return this.prisma.quickReply.update({ where: { id }, data, include });
  }

  /**
   * Atalho de uma resposta apagada continua no índice único — libera pra
   * poder cadastrar de novo.
   */
  async purgeDeletedShortcut(organizationId: string, shortcut: string) {
    await this.prisma.quickReply.deleteMany({
      where: { organizationId, shortcut, deletedAt: { not: null } },
    });
  }

  async softDelete(id: string) {
    return this.prisma.quickReply.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
