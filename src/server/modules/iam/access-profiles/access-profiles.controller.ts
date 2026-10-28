import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { CurrentOrg, Roles } from '../../../common/decorators';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { AccessProfilesService } from './access-profiles.service';
import { AssignAccessProfileDto, UpsertAccessProfileDto } from './access-profiles.dto';

@ApiTags('Access profiles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Roles(OrgRole.OWNER, OrgRole.ADMIN)
@Controller('access-profiles')
export class AccessProfilesController {
  constructor(private readonly profiles: AccessProfilesService) {}

  @Get('catalog')
  @ApiOperation({ summary: 'Páginas e ações que um perfil pode liberar' })
  catalog() {
    return this.profiles.catalog();
  }

  @Get()
  list(@CurrentOrg('id') orgId: string) {
    return this.profiles.list(orgId);
  }

  @Post()
  create(@CurrentOrg('id') orgId: string, @Body() dto: UpsertAccessProfileDto) {
    return this.profiles.create(orgId, dto);
  }

  @Patch(':id')
  update(@CurrentOrg('id') orgId: string, @Param('id') id: string, @Body() dto: UpsertAccessProfileDto) {
    return this.profiles.update(orgId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentOrg('id') orgId: string, @Param('id') id: string) {
    return this.profiles.remove(orgId, id);
  }

  @Patch('members/:memberId')
  @ApiOperation({ summary: 'Define o perfil de acesso de um membro (null = acesso padrão)' })
  assign(@CurrentOrg('id') orgId: string, @Param('memberId') memberId: string, @Body() dto: AssignAccessProfileDto) {
    return this.profiles.assign(orgId, memberId, dto.accessProfileId ?? null);
  }
}
