import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { IsBoolean } from 'class-validator';
import { JwtAuthGuard, OrgGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser } from '../../common/decorators';
import { RealtimeGateway } from './realtime.gateway';

class TypingDto {
  @IsBoolean()
  isTyping!: boolean;
}

/**
 * Endpoints que substituem o handshake e as mensagens client→server do
 * antigo gateway Socket.io (connect / join:conversation /
 * leave:conversation / typing). Os eventos server→client chegam pelo
 * Supabase Realtime nos tópicos devolvidos aqui.
 */
@ApiTags('Realtime')
@ApiBearerAuth()
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeGateway) {}

  @Get('session')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Resolve os tópicos realtime do usuário (substitui o handshake do socket)' })
  async session(
    @CurrentUser('id') userId: string,
    @Headers('x-organization-id') orgId?: string,
  ) {
    const session = await this.realtime.buildSession(userId, orgId || null);
    if (!session) {
      throw new ForbiddenException('You are not a member of this organization');
    }
    return session;
  }

  @Post('conversations/:id/join')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, OrgGuard)
  @ApiOperation({ summary: 'Entra na sala de uma conversa (substitui join:conversation)' })
  join(
    @Param('id') conversationId: string,
    @CurrentUser('id') userId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentOrg('userRole') role: OrgRole,
    @CurrentOrg('userOrganizationId') userOrganizationId: string,
  ) {
    return this.realtime.joinConversation(userId, orgId, role, userOrganizationId, conversationId);
  }

  @Post('conversations/:id/leave')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, OrgGuard)
  @ApiOperation({ summary: 'Sai da sala de uma conversa (substitui leave:conversation)' })
  async leave(
    @Param('id') conversationId: string,
    @CurrentUser('id') userId: string,
    @CurrentOrg('id') orgId: string,
  ) {
    await this.realtime.leaveConversation(userId, orgId);
    return { conversationId };
  }

  @Post('conversations/:id/typing')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, OrgGuard)
  @ApiOperation({ summary: 'Sinaliza digitação na conversa (substitui typing)' })
  async typing(
    @Param('id') conversationId: string,
    @Body() dto: TypingDto,
    @CurrentUser('id') userId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentOrg('userRole') role: OrgRole,
    @CurrentOrg('userOrganizationId') userOrganizationId: string,
  ) {
    const access = await this.realtime.joinConversation(
      userId,
      orgId,
      role,
      userOrganizationId,
      conversationId,
    );
    if (!access.ok) throw new ForbiddenException(access.reason);
    this.realtime.typing(userId, conversationId, dto.isTyping);
    return { conversationId };
  }
}
