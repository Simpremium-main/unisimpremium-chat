import { BadRequestException, Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';
import { PrismaService } from '../../../database/prisma.service';
import { CurrentOrg, Roles } from '../../../common/decorators';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import {
  DEFAULT_QUOTE_FOLLOWUP_SETTINGS,
  QUOTE_FOLLOWUP_LIMITS,
  QUOTE_FOLLOWUP_SETTINGS_KEY,
  QuoteFollowupSettings,
  quoteFollowupSettings,
} from './quote-followup';

export class QuoteFollowupSettingsDto implements QuoteFollowupSettings {
  @IsBoolean()
  enabled!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(QUOTE_FOLLOWUP_LIMITS.followupDelayHours.min)
  @Max(QUOTE_FOLLOWUP_LIMITS.followupDelayHours.max)
  followupDelayHours!: number;

  @Type(() => Number)
  @IsInt()
  @Min(QUOTE_FOLLOWUP_LIMITS.closeDelayHours.min)
  @Max(QUOTE_FOLLOWUP_LIMITS.closeDelayHours.max)
  closeDelayHours!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  windowStartHour!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  windowEndHour!: number;
}

/** Configurações → Cobrança de cotação: prazos e horário da cobrança feita pela IA. */
@ApiTags('AI Agents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('ai-settings/quote-followup')
export class QuoteFollowupSettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Prazos e horário da cobrança de cotação feita pela IA' })
  async get(@CurrentOrg('id') orgId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
    return { settings: quoteFollowupSettings(org?.settings), defaults: DEFAULT_QUOTE_FOLLOWUP_SETTINGS, limits: QUOTE_FOLLOWUP_LIMITS };
  }

  @Put()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Atualiza os prazos e o horário da cobrança de cotação feita pela IA' })
  async update(@CurrentOrg('id') orgId: string, @Body() dto: QuoteFollowupSettingsDto) {
    if (dto.windowStartHour >= dto.windowEndHour) {
      throw new BadRequestException('O horário de início precisa ser antes do horário de fim.');
    }
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
    const current = (org?.settings ?? {}) as Record<string, unknown>;
    const value: QuoteFollowupSettings = {
      enabled: dto.enabled,
      followupDelayHours: dto.followupDelayHours,
      closeDelayHours: dto.closeDelayHours,
      windowStartHour: dto.windowStartHour,
      windowEndHour: dto.windowEndHour,
    };
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { settings: { ...current, [QUOTE_FOLLOWUP_SETTINGS_KEY]: { ...value } } as unknown as Prisma.InputJsonValue },
    });
    return { settings: quoteFollowupSettings({ [QUOTE_FOLLOWUP_SETTINGS_KEY]: value }) };
  }
}
