import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentChannelAccess, CurrentOrg, RequirePage } from '../../common/decorators';
import type { ChannelAccess } from '../iam/channel-access/channel-access.service';
import { GroupMonitorService } from './group-monitor.service';
import { GroupSyncService } from './group-sync.service';
import { SetPartnerDto } from './dto/set-partner.dto';
import { SetResellerDto } from './dto/set-reseller.dto';

@ApiTags('Group monitor')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@RequirePage('inbox')
@Controller('group-monitor')
export class GroupMonitorController {
  constructor(
    private readonly service: GroupMonitorService,
    private readonly sync: GroupSyncService,
  ) {}

  @Get('groups')
  @ApiOperation({ summary: 'Grupos de WhatsApp em que o número está' })
  groups(@CurrentOrg('id') orgId: string, @CurrentChannelAccess() access: ChannelAccess) {
    return this.service.groups(orgId, access);
  }

  @Post('groups/sync')
  @ApiOperation({ summary: 'Busca no WhatsApp todos os grupos em que o número está' })
  syncGroups(@CurrentOrg('id') orgId: string, @CurrentChannelAccess() access: ChannelAccess) {
    return this.sync.syncAll(orgId, access);
  }

  @Patch('groups/:id/partner')
  @ApiOperation({ summary: 'Define o parceiro (operação) do grupo' })
  setPartner(
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @Param('id') id: string,
    @Body() body: SetPartnerDto,
  ) {
    return this.service.setPartner(orgId, access, id, body.partner ?? null);
  }

  @Patch('groups/:id/reseller')
  @ApiOperation({ summary: 'Define o reseller_id (cliente na API Uni Mobile) do grupo' })
  setReseller(
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @Param('id') id: string,
    @Body() body: SetResellerDto,
  ) {
    return this.service.setResellerId(orgId, access, id, body.resellerId ?? null);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Solicitações feitas à IA nos grupos' })
  @ApiQuery({ name: 'conversationId', required: false })
  @ApiQuery({ name: 'q', required: false, description: 'Texto ou nome de quem pediu' })
  @ApiQuery({ name: 'partner', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['answered-ai', 'answered-human', 'pending'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  requests(
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @Query('conversationId') conversationId?: string,
    @Query('q') q?: string,
    @Query('partner') partner?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.requests(orgId, access, {
      conversationId: conversationId || undefined,
      q: q || undefined,
      partner: partner || undefined,
      status: status === 'answered-ai' || status === 'answered-human' || status === 'pending' ? status : undefined,
      page: page ? Number(page) || 1 : 1,
      limit: limit ? Number(limit) || 50 : 50,
    });
  }
}
