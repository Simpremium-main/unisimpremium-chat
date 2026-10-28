import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { CurrentOrg, Roles } from '../../../common/decorators';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { PlaybooksService } from './playbooks.service';
import { UpsertPlaybookDto } from './dto/upsert-playbook.dto';

@ApiTags('AI Playbooks (Fluxos)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('ai-playbooks')
export class PlaybooksController {
  constructor(private readonly playbooks: PlaybooksService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os fluxos da org (com as mensagens)' })
  list(@CurrentOrg('id') orgId: string) {
    return this.playbooks.list(orgId);
  }

  @Get(':id')
  get(@CurrentOrg('id') orgId: string, @Param('id') id: string) {
    return this.playbooks.get(orgId, id);
  }

  @Post()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Cria um fluxo' })
  create(@CurrentOrg('id') orgId: string, @Body() dto: UpsertPlaybookDto) {
    return this.playbooks.create(orgId, dto);
  }

  @Patch(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Atualiza um fluxo (steps, se enviados, substituem os atuais)' })
  update(@CurrentOrg('id') orgId: string, @Param('id') id: string, @Body() dto: UpsertPlaybookDto) {
    return this.playbooks.update(orgId, id, dto);
  }

  @Delete(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  remove(@CurrentOrg('id') orgId: string, @Param('id') id: string) {
    return this.playbooks.remove(orgId, id);
  }
}
