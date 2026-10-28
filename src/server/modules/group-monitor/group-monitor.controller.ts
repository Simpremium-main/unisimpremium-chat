import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentChannelAccess, CurrentOrg, RequirePage } from '../../common/decorators';
import type { ChannelAccess } from '../iam/channel-access/channel-access.service';
import { GroupMonitorService } from './group-monitor.service';

@ApiTags('Group monitor')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@RequirePage('inbox')
@Controller('group-monitor')
export class GroupMonitorController {
  constructor(private readonly service: GroupMonitorService) {}

  @Get('groups')
  @ApiOperation({ summary: 'Grupos de WhatsApp em que o número está' })
  groups(@CurrentOrg('id') orgId: string, @CurrentChannelAccess() access: ChannelAccess) {
    return this.service.groups(orgId, access);
  }

  @Get('order-queries')
  @ApiOperation({ summary: 'Pedidos consultados pela IA' })
  @ApiQuery({ name: 'conversationId', required: false })
  @ApiQuery({ name: 'orderId', required: false })
  @ApiQuery({ name: 'all', required: false, description: 'true = inclui conversas individuais' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  orderQueries(
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @Query('conversationId') conversationId?: string,
    @Query('orderId') orderId?: string,
    @Query('all') all?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.orderQueries(orgId, access, {
      conversationId: conversationId || undefined,
      orderId: orderId || undefined,
      groupsOnly: all !== 'true',
      page: page ? Number(page) || 1 : 1,
      limit: limit ? Number(limit) || 50 : 50,
    });
  }
}
