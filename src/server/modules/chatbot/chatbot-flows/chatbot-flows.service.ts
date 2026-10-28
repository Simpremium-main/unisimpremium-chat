import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConversationStatus, Prisma } from '@prisma/client';
import type { ChannelAccess } from '../../iam/channel-access/channel-access.service';
import { ChatbotFlowsRepository } from './chatbot-flows.repository';
import { PrismaService } from '../../../database/prisma.service';
import { CreateChatbotFlowDto, UpdateChatbotFlowDto, ChatbotNodeDto } from './dto/create-chatbot-flow.dto';

@Injectable()
export class ChatbotFlowsService {
  constructor(
    private readonly repository: ChatbotFlowsRepository,
    private readonly prisma: PrismaService,
    @InjectQueue('chatbot-processor') private readonly chatbotQueue: Queue,
  ) {}

  async create(organizationId: string, dto: CreateChatbotFlowDto) {
    return this.repository.create({
      organizationId,
      name: dto.name,
      description: dto.description,
      triggerType: dto.triggerType || 'KEYWORD',
      triggerConfig: dto.triggerConfig || {},
    });
  }

  async findAll(organizationId: string) {
    return this.repository.findByOrg(organizationId);
  }

  async findOne(id: string, organizationId: string) {
    const flow = await this.repository.findById(id);
    if (!flow) throw new NotFoundException('Chatbot flow not found');
    if (flow.organizationId !== organizationId) throw new ForbiddenException();
    return flow;
  }

  async update(id: string, organizationId: string, dto: UpdateChatbotFlowDto) {
    await this.findOne(id, organizationId);
    return this.repository.update(id, dto);
  }

  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);
    return this.repository.softDelete(id);
  }

  async saveNodes(id: string, organizationId: string, nodes: ChatbotNodeDto[]) {
    await this.findOne(id, organizationId);
    return this.repository.replaceNodes(
      id,
      nodes.map((n) => ({
        id: n.id,
        type: n.type,
        name: n.name,
        positionX: n.positionX,
        positionY: n.positionY,
        data: n.data,
        edges: n.edges,
      })),
    );
  }

  async linkChannels(id: string, organizationId: string, channelIds: string[]) {
    await this.findOne(id, organizationId);
    const unique = [...new Set(channelIds)];
    const owned = await this.prisma.channel.count({
      where: { id: { in: unique }, organizationId, deletedAt: null },
    });
    if (owned !== unique.length) {
      throw new ForbiddenException('Canal não pertence a esta organização');
    }
    await this.repository.setChannels(id, unique);
    return this.findOne(id, organizationId);
  }

  /**
   * Atendente aciona o robô numa conversa pelo inbox: o fluxo começa do
   * início (mesmo fora dos canais dele, ativo ou não) e a IA fica calada
   * até ele terminar — o bloco Fim decide se volta pra IA ou pro humano.
   */
  async runOnConversation(
    flowId: string,
    organizationId: string,
    conversationId: string,
    userId: string,
    access: ChannelAccess,
  ) {
    const flow = await this.findOne(flowId, organizationId);
    if (!flow.nodes?.length) throw new BadRequestException('Este fluxo ainda não tem blocos');

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId, deletedAt: null },
      include: { contact: { include: { channels: true } } },
    });
    if (!conversation || (access !== 'ALL' && !access.has(conversation.channelId))) {
      throw new NotFoundException('Conversa não encontrada');
    }
    if (conversation.status === ConversationStatus.CLOSED) {
      throw new BadRequestException('Reabra a conversa para acionar o robô');
    }
    const contactChannel = conversation.contact.channels.find((cc) => cc.channelId === conversation.channelId);
    if (!contactChannel) throw new NotFoundException('Contato sem este canal');

    // Robô novo neste atendimento: apaga a marca do fluxo anterior.
    const { chatbot: _previous, ...metadata } = (conversation.metadata as Record<string, unknown>) ?? {};
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { metadata: metadata as Prisma.InputJsonValue },
    });
    await this.prisma.conversationAuditLog.create({
      data: {
        conversationId,
        actorId: userId,
        action: 'CHATBOT_STARTED',
        metadata: { flowId, flowName: flow.name },
      },
    });

    await this.chatbotQueue.add('process-bot', {
      conversationId,
      channelId: conversation.channelId,
      contactExternalId: contactChannel.externalId,
      organizationId,
      messageText: '',
      startFlowId: flowId,
    });
    return { started: true, flowName: flow.name };
  }

  async findActiveFlowForChannel(channelId: string) {
    return this.repository.findActiveFlowForChannel(channelId);
  }
}
