import {
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { ConversationsService } from './conversations.service';
import { ConversationAiStatusService } from './conversation-ai-status.service';
import { CustomerOrdersService } from '../../ai-agents/tools/simpremium/customer-orders.service';
import { AgentQuoteService } from '../../ai-agents/tools/simpremium/agent-quote.service';
import { QuickQuoteDto } from './dto/quick-quote.dto';
import { DraftReplyDto } from './dto/draft-reply.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { StartConversationDto } from './dto/start-conversation.dto';
import { MessagesService } from '../messages/messages.service';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import {
  CurrentUser,
  CurrentOrg,
  CurrentChannelAccess,
  Roles,
  RequireAction,
  CurrentAccess,
} from '../../../common/decorators';
import { canAccess, type EffectiveAccess } from '../../../common/access/catalog';
import type { ChannelAccess } from '../../iam/channel-access/channel-access.service';

@ApiTags('Conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly service: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly aiStatusService: ConversationAiStatusService,
    private readonly customerOrders: CustomerOrdersService,
    private readonly agentQuote: AgentQuoteService,
  ) {}

  @Post()
  @RequireAction('conversations.create')
  @ApiOperation({
    summary:
      'Inicia uma conversa ativa com um contato (que pode nunca ter tido histórico) e envia a primeira mensagem. Instagram não é suportado (política da Meta não permite DM a frio).',
  })
  start(
    @Body() dto: StartConversationDto,
    @CurrentUser('id') userId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.messagesService.startConversation(dto, userId, orgId, access);
  }

  @Get()
  @ApiOperation({ summary: 'List conversations (inbox)' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'channelId', required: false })
  @ApiQuery({ name: 'assignedToId', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({
    name: 'archived',
    required: false,
    description: 'exclude (default) | only | any',
  })
  @ApiQuery({
    name: 'unread',
    required: false,
    description: 'When "true", returns only conversations with unread inbound messages for the current user',
  })
  @ApiQuery({
    name: 'groups',
    required: false,
    description:
      'include (default — todas) | exclude (esconde grupos) | only (apenas grupos)',
  })
  @ApiQuery({
    name: 'tagIds',
    required: false,
    description:
      'CSV de IDs de tags. OR — devolve conversas que tenham QUALQUER uma das tags (na conversa OU no contato).',
  })
  @ApiQuery({
    name: 'noAi',
    required: false,
    description: 'When "true", hides only the conversations the AI is handling right now (menu section "Tags")',
  })
  @ApiQuery({
    name: 'hideAi',
    required: false,
    description:
      'When "true", hides conversations the AI is handling, waiting on the admin, transferred to a human and not yet answered, or in "Não respondidas" (inbox "Aberto")',
  })
  findInbox(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @Query('status') status?: string,
    @Query('channelId') channelId?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('archived') archived?: string,
    @Query('unread') unread?: string,
    @Query('stuck') stuck?: string,
    @Query('groups') groups?: string,
    @Query('tagIds') tagIds?: string,
    @Query('segmentId') segmentId?: string,
    @Query('hoppeId') hoppeId?: string,
    @Query('responsibleUserId') responsibleUserId?: string,
    @Query('projectStatus') projectStatus?: string,
    @Query('hideAi') hideAi?: string,
    @Query('noAi') noAi?: string,
  ) {
    // Arquivamento saiu do produto: a lista ignora is_archived (conversas
    // arquivadas antes voltam a aparecer). `archived` fica só por compat.
    void archived;
    const archivedScope = 'any' as const;
    // groups param maps to repository's existing `kind` filter:
    //   exclude → kind=INDIVIDUAL (esconde grupos)
    //   only    → kind=GROUP (apenas grupos)
    //   include / default → undefined (todas)
    const kind: 'INDIVIDUAL' | 'GROUP' | undefined =
      groups === 'exclude' ? 'INDIVIDUAL' : groups === 'only' ? 'GROUP' : undefined;
    const parsedTagIds = tagIds
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return this.service.findInbox(
      orgId,
      {
        status,
        channelId,
        assignedToId,
        search,
        archived: archivedScope,
        unreadOnly: unread === 'true' || unread === '1',
        stuckOnly: stuck === 'true' || stuck === '1',
        kind,
        tagIds: parsedTagIds?.length ? parsedTagIds : undefined,
        segmentId: segmentId || undefined,
        hoppeId: hoppeId || undefined,
        responsibleUserId: responsibleUserId || undefined,
        projectStatus: projectStatus || undefined,
        // "Aberto" (sem busca): conversa da IA fica só na inbox dela —
        // IA Ativo, IA Aguardando e IA para Humano (até um atendente responder).
        // Seção Tags do menu: sem as conversas que a IA está atendendo agora.
        excludeAiActive: hideAi === 'true' || noAi === 'true' || undefined,
        excludeAiWaiting: hideAi === 'true' || undefined,
        excludeAiToHuman: hideAi === 'true' || undefined,
        // ...e o que está em "Não respondidas" fica só lá.
        excludeUnanswered: hideAi === 'true' || undefined,
      },
      parseInt(page || '1', 10),
      parseInt(limit || '20', 10),
      access,
      userId,
    );
  }

  @Post(':id/archive')
  @ApiOperation({ summary: 'Archive a conversation' })
  archive(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.setArchived(id, orgId, true, userId, access);
  }

  @Post(':id/unarchive')
  @ApiOperation({ summary: 'Unarchive a conversation' })
  unarchive(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.setArchived(id, orgId, false, userId, access);
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark conversation as read for current user' })
  markAsRead(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @Body() body?: { lastReadMessageId?: string },
  ) {
    return this.service.markAsRead(
      id,
      orgId,
      userId,
      access,
      body?.lastReadMessageId,
    );
  }

  @Post(':id/unread')
  @ApiOperation({ summary: 'Mark conversation as unread for current user' })
  markAsUnread(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.markAsUnread(id, orgId, userId, access);
  }

  @Get('counts')
  @ApiOperation({ summary: 'Get conversation counts by status' })
  getCounts(
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.getStatusCounts(orgId, access);
  }

  @Get(':id/orders')
  @ApiOperation({ summary: 'Pedidos do contato no Pedido Central, buscados pelo telefone' })
  @ApiQuery({ name: 'refresh', required: false })
  async orders(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @Query('refresh') refresh?: string,
  ) {
    await this.service.findOne(id, orgId, access);
    return this.customerOrders.lookupForConversation(orgId, id, { refresh: refresh === '1' || refresh === 'true' });
  }

  @Post(':id/quick-quote')
  @ApiOperation({ summary: 'Cotação de chip para o atendente enviar (não aciona a IA)' })
  async quickQuote(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @Body() dto: QuickQuoteDto,
  ) {
    await this.service.findOne(id, orgId, access);
    return this.agentQuote.quote(orgId, id, dto);
  }

  @Get(':id/ai-status')
  @ApiOperation({ summary: 'O que a IA está fazendo nesta conversa (ou por que não responde)' })
  async aiStatus(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    const conversation = await this.service.findOne(id, orgId, access);
    return this.aiStatusService.getStatus(conversation);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get conversation details' })
  findOne(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.findOne(id, orgId, access);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update conversation (assign, change status, department)' })
  update(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @Body() dto: UpdateConversationDto,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @CurrentAccess() profile: EffectiveAccess | null,
  ) {
    // Uma rota, várias ações: confere cada campo contra o perfil do atendente.
    if ((dto.assignedToId !== undefined || dto.departmentId !== undefined) && !canAccess(profile, 'action', 'conversations.assign')) {
      throw new ForbiddenException('Seu perfil de acesso não permite atribuir ou transferir conversas');
    }
    if (dto.status !== undefined && !canAccess(profile, 'action', 'conversations.close')) {
      throw new ForbiddenException('Seu perfil de acesso não permite encerrar ou reabrir conversas');
    }
    return this.service.update(id, orgId, dto, userId, access);
  }

  @Post(':id/assign-me')
  @ApiOperation({ summary: 'Assign conversation to current user' })
  assignToMe(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.assignToMe(id, orgId, userId, access);
  }

  @Patch(':id/ai')
  @RequireAction('conversations.ai')
  @ApiOperation({
    summary:
      'Override AI behavior on this conversation. enabled=true forces AI on (overrides kill switch and business hours), false forces off, null clears the override (follows global rules).',
  })
  toggleAi(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @Body() body: { enabled: boolean | null },
  ) {
    const value =
      body?.enabled === null || body?.enabled === undefined
        ? null
        : !!body.enabled;
    return this.service.toggleAi(id, orgId, value, userId, access);
  }

  @Post(':id/ai/engage')
  @RequireAction('conversations.ai')
  @ApiOperation({
    summary:
      'Manually engage the AI on this conversation right now. The agent reads the full message history, decides what to do (reply, delegate, transfer) and acts. Useful when the inbound stream is silent but a human wants the AI to take over (e.g. after pausing then resuming).',
  })
  engageAi(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.engageAi(id, orgId, userId, access);
  }

  @Post(':id/ai/draft')
  @ApiOperation({ summary: 'Sugerir resposta: a mensagem que a IA mandaria agora, para o atendente enviar ou editar (não envia nada)' })
  draftAiReply(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @Body() body: DraftReplyDto,
  ) {
    return this.service.draftAiReply(id, orgId, body ?? {}, access);
  }

  @Post(':id/dismiss-unanswered')
  @ApiOperation({ summary: 'Tira a conversa da inbox "Não respondidas" até o cliente mandar mensagem nova' })
  dismissUnanswered(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.dismissUnanswered(id, orgId, userId, access);
  }

  @Post(':id/ai/quote-handoff')
  @RequireAction('conversations.ai')
  @ApiOperation({
    summary:
      'Atendente mandou a cotação: devolve a conversa para a IA cobrar o retorno em 2h e continuar quando o cliente responder.',
  })
  handoffQuoteToAi(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.handoffQuoteToAi(id, orgId, userId, access);
  }

  @Post(':id/ai/restart')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({
    summary:
      'Reiniciar a IA (teste): limpa o contexto e devolve a conversa ao estado de nova para a IA e o robô.',
  })
  restartAi(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.restartAi(id, orgId, userId, access);
  }

  @Post(':id/ai/reset-context')
  @RequireAction('conversations.ai')
  @ApiOperation({
    summary:
      'Limpa o contexto da IA: ela passa a ler só as mensagens novas (o histórico continua visível), esquece a memória sobre o contato e o agente ativo é escolhido de novo.',
  })
  resetAiContext(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.resetAiContext(id, orgId, userId, access);
  }

  @Post(':id/ai/set-agent')
  @RequireAction('conversations.ai')
  @ApiOperation({
    summary:
      'Pin a specific AI agent to this conversation and immediately engage it. Sets activeAgentId + aiEnabled=true + fires the runner. Use case: human picks Lívia/André via UI when delegating manually.',
  })
  setActiveAgent(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @Body() body: { agentId: string },
  ) {
    return this.service.setActiveAgent(
      id,
      orgId,
      body.agentId,
      userId,
      access,
    );
  }

  @Post(':id/close')
  @RequireAction('conversations.close')
  @ApiOperation({ summary: 'Close a conversation' })
  close(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.close(id, orgId, userId, access);
  }

  @Post(':id/reopen')
  @RequireAction('conversations.close')
  @ApiOperation({ summary: 'Reopen a closed conversation' })
  reopen(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.reopen(id, orgId, userId, access);
  }

  @Post(':id/sync')
  @ApiOperation({
    summary:
      'Force-sync the latest messages for a conversation from the channel provider',
  })
  syncMessages(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.syncMessages(id, orgId, access);
  }

  @Delete(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({
    summary:
      'HARD-delete a conversation: cascades to messages, attachments, tags, AI runs, reads. Irreversible — requires ?confirm=<exact contact name or phone>.',
  })
  @ApiQuery({
    name: 'confirm',
    required: true,
    description:
      'Type the contact name or phone exactly to authorize the destructive action.',
  })
  remove(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @Query('confirm') confirm: string,
  ) {
    return this.service.hardDelete(id, orgId, access, confirm);
  }
}
