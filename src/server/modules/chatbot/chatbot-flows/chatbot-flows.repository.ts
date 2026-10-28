import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { randomUUID } from 'crypto';

@Injectable()
export class ChatbotFlowsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.ChatbotFlowUncheckedCreateInput) {
    return this.prisma.chatbotFlow.create({ data });
  }

  async findByOrg(organizationId: string) {
    return this.prisma.chatbotFlow.findMany({
      where: { organizationId, deletedAt: null },
      include: {
        nodes: { orderBy: { createdAt: 'asc' } },
        channels: { include: { channel: { select: { id: true, name: true, type: true } } } },
        _count: { select: { nodes: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    return this.prisma.chatbotFlow.findFirst({
      where: { id, deletedAt: null },
      include: {
        nodes: { orderBy: { createdAt: 'asc' } },
        channels: { include: { channel: { select: { id: true, name: true, type: true } } } },
      },
    });
  }

  async update(id: string, data: Prisma.ChatbotFlowUpdateInput) {
    return this.prisma.chatbotFlow.update({ where: { id }, data });
  }

  async softDelete(id: string) {
    return this.prisma.chatbotFlow.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  /**
   * Regrava os nós do fluxo. Cada nó ganha id novo — e as setas, que vêm
   * com os ids do editor (`new_101`, ou os ids antigos), são remapeadas.
   * Antes as setas ficavam apontando pra ids que não existiam mais e o robô
   * se perdia no primeiro passo depois de salvar.
   */
  async replaceNodes(
    flowId: string,
    nodes: { id?: string; type: string; name?: string; positionX: number; positionY: number; data: any; edges: any }[],
  ) {
    const newIds = new Map<string, string>();
    const ids = nodes.map((n, i) => {
      const id = randomUUID();
      newIds.set(n.id ?? `#${i}`, id);
      return id;
    });
    const remap = (edges: unknown) =>
      Array.isArray(edges)
        ? edges.map((e: any) => ({ ...e, targetNodeId: newIds.get(e?.targetNodeId) ?? e?.targetNodeId }))
        : [];

    return this.prisma.$transaction([
      this.prisma.chatbotNode.deleteMany({ where: { flowId } }),
      ...nodes.map((n, i) =>
        this.prisma.chatbotNode.create({
          data: {
            id: ids[i],
            flowId,
            type: n.type as any,
            name: n.name,
            positionX: n.positionX,
            positionY: n.positionY,
            data: n.data,
            edges: remap(n.edges),
          },
        }),
      ),
    ]).then((res) => res.slice(1));
  }

  /**
   * Canais onde o fluxo roda. Um canal fica com UM fluxo só: ligar aqui
   * tira o canal de qualquer outro fluxo (senão o robô escolhido seria
   * arbitrário).
   */
  async setChannels(flowId: string, channelIds: string[]) {
    await this.prisma.$transaction([
      this.prisma.chatbotFlowChannel.deleteMany({ where: { flowId } }),
      this.prisma.chatbotFlowChannel.deleteMany({
        where: { channelId: { in: channelIds }, flowId: { not: flowId } },
      }),
      this.prisma.chatbotFlowChannel.createMany({
        data: channelIds.map((channelId) => ({ flowId, channelId })),
      }),
    ]);
  }

  async findActiveFlowForChannel(channelId: string) {
    const link = await this.prisma.chatbotFlowChannel.findFirst({
      where: {
        channelId,
        flow: { isActive: true, deletedAt: null },
      },
      include: {
        flow: { include: { nodes: true } },
      },
    });
    return link?.flow || null;
  }
}
