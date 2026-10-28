import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiHelpRequestStatus, OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser, Roles } from '../../common/decorators';
import { AiLearningService } from './ai-learning.service';
import { KnowledgeService } from '../ai-agents/knowledge/knowledge.service';

/** Jarvis → Aprendizado. Só administradores. */
@ApiTags('AI Learning')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Roles(OrgRole.OWNER, OrgRole.ADMIN)
@Controller('ai-learning')
export class AiLearningController {
  constructor(
    private readonly service: AiLearningService,
    private readonly knowledge: KnowledgeService,
  ) {}

  @Get('pending-count')
  @ApiOperation({ summary: 'Quantos casos de "pedir ajuda" esperam orientação' })
  async pendingCount(@CurrentOrg('id') orgId: string) {
    return { count: await this.service.pendingCount(orgId) };
  }

  @Get('requests')
  @ApiOperation({ summary: 'Casos em que a IA pediu ajuda' })
  list(@CurrentOrg('id') orgId: string, @Query('status') status?: string) {
    const s = (Object.values(AiHelpRequestStatus) as string[]).includes(status ?? '')
      ? (status as AiHelpRequestStatus)
      : AiHelpRequestStatus.PENDING;
    return this.service.listRequests(orgId, s);
  }

  @Get('requests/:id')
  get(@CurrentOrg('id') orgId: string, @Param('id') id: string) {
    return this.service.getRequest(orgId, id);
  }

  @Post('requests/:id/draft')
  @ApiOperation({ summary: 'IA redige a resposta + o aprendizado a partir da orientação' })
  draft(@CurrentOrg('id') orgId: string, @Param('id') id: string, @Body() body: { orientacao: string }) {
    return this.service.draftForRequest(orgId, id, String(body?.orientacao ?? ''));
  }

  @Post('requests/:id/approve')
  @ApiOperation({ summary: 'Envia a resposta, salva o aprendizado e devolve a conversa pra IA' })
  approve(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: { resposta: string[]; aprendizado: unknown },
  ) {
    return this.service.approveRequest(orgId, id, userId, body ?? { resposta: [], aprendizado: null });
  }

  @Post('requests/:id/dismiss')
  dismiss(@CurrentOrg('id') orgId: string, @CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.service.dismissRequest(orgId, id, userId);
  }

  @Post('teach/draft')
  @ApiOperation({ summary: 'Ensinar a IA: propõe onde guardar a informação' })
  teachDraft(@CurrentOrg('id') orgId: string, @Body() body: { informacao: string; agentId?: string }) {
    return this.service.draftTeach(orgId, String(body?.informacao ?? ''), body?.agentId ?? null);
  }

  @Post('teach/apply')
  teachApply(@CurrentOrg('id') orgId: string, @CurrentUser('id') userId: string, @Body() body: { aprendizado: unknown }) {
    return this.service.applyTeach(orgId, userId, body?.aprendizado);
  }

  @Get('learned')
  @ApiOperation({ summary: 'Conhecimento, fluxos e regras aprendidos' })
  learned(@CurrentOrg('id') orgId: string) {
    return this.service.learned(orgId);
  }

  @Patch('knowledge/:id')
  updateKnowledge(
    @CurrentOrg('id') orgId: string,
    @Param('id') id: string,
    @Body()
    body: { title?: string; content?: string; keywords?: string; isActive?: boolean; expiresAt?: string | null },
  ) {
    return this.knowledge.update(id, orgId, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.content !== undefined ? { content: body.content } : {}),
      ...(body.keywords !== undefined ? { keywords: body.keywords } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null } : {}),
    });
  }

  @Delete('knowledge/:id')
  async removeKnowledge(@CurrentOrg('id') orgId: string, @Param('id') id: string) {
    await this.knowledge.remove(id, orgId);
    return { ok: true };
  }

  @Post('rules/remove')
  removeRule(@CurrentOrg('id') orgId: string, @Body() body: { agentId: string; rule: string }) {
    return this.service.removeRule(orgId, body.agentId, body.rule);
  }
}
