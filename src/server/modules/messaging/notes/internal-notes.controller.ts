import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentChannelAccess, CurrentOrg, CurrentUser } from '../../../common/decorators';
import type { ChannelAccess } from '../../iam/channel-access/channel-access.service';
import { InternalNotesService } from './internal-notes.service';
import { CreateInternalNoteDto, UpdateInternalNoteDto } from './dto/internal-note.dto';

@ApiTags('Conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('conversations/:conversationId/notes')
export class InternalNotesController {
  constructor(private readonly service: InternalNotesService) {}

  @Get()
  @ApiOperation({ summary: 'Notas internas da conversa (não vão pro cliente)' })
  list(
    @Param('conversationId') conversationId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.list(conversationId, orgId, access);
  }

  @Post()
  @ApiOperation({ summary: 'Cria nota interna (opcionalmente presa a uma mensagem)' })
  create(
    @Param('conversationId') conversationId: string,
    @Body() dto: CreateInternalNoteDto,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.create(conversationId, orgId, access, userId, dto);
  }

  @Patch(':noteId')
  @ApiOperation({ summary: 'Edita a própria nota' })
  update(
    @Param('conversationId') conversationId: string,
    @Param('noteId') noteId: string,
    @Body() dto: UpdateInternalNoteDto,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.update(conversationId, noteId, orgId, access, userId, dto.content);
  }

  @Delete(':noteId')
  @ApiOperation({ summary: 'Apaga a nota (autor, OWNER ou ADMIN)' })
  remove(
    @Param('conversationId') conversationId: string,
    @Param('noteId') noteId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentOrg('userRole') role: OrgRole,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.remove(conversationId, noteId, orgId, access, userId, role);
  }
}
