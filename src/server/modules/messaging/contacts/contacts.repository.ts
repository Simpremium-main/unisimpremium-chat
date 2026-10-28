import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class ContactsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByOrg(
    organizationId: string,
    search: string | undefined,
    skip: number,
    take: number,
  ) {
    const where: Prisma.ContactWhereInput = { organizationId, deletedAt: null };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [contacts, total] = await this.prisma.$transaction([
      this.prisma.contact.findMany({
        where,
        include: {
          channels: { include: { channel: { select: { id: true, type: true, name: true } } } },
          tags: { include: { tag: true } },
          _count: { select: { conversations: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.contact.count({ where }),
    ]);

    return { contacts, total };
  }

  async findById(id: string) {
    return this.prisma.contact.findFirst({
      where: { id, deletedAt: null },
      include: {
        channels: { include: { channel: { select: { id: true, type: true, name: true } } } },
        tags: { include: { tag: true } },
        conversations: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            channel: { select: { type: true, name: true } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, type: true, createdAt: true } },
          },
        },
      },
    });
  }

  /**
   * Todas as conversas (atendimentos) do contato, mais recentes primeiro.
   * `channelIds` restringe aos canais visíveis pro AGENT; null = todos.
   */
  async findConversations(
    contactId: string,
    organizationId: string,
    channelIds: string[] | null,
  ) {
    return this.prisma.conversation.findMany({
      where: {
        contactId,
        organizationId,
        deletedAt: null,
        ...(channelIds ? { channelId: { in: channelIds } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        protocol: true,
        subject: true,
        status: true,
        isGroup: true,
        createdAt: true,
        closedAt: true,
        lastMessageAt: true,
        channel: { select: { id: true, type: true, name: true } },
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { type: true, content: true, direction: true, createdAt: true },
        },
        _count: { select: { messages: true } },
      },
    });
  }

  async update(id: string, data: Prisma.ContactUpdateInput) {
    return this.prisma.contact.update({ where: { id }, data });
  }

  async softDelete(id: string) {
    return this.prisma.contact.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
