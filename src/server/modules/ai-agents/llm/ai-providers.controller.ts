import { Body, Controller, Get, Param, ParseEnumPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { CurrentOrg, Roles } from '../../../common/decorators';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { AiCredentialsService } from './ai-credentials.service';
import { LlmProvider } from './llm.constants';

class UpdateAiProvidersDto {
  @ApiPropertyOptional({ description: 'Chave da OpenAI (ChatGPT). null remove.', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  openaiKey?: string | null;

  @ApiPropertyOptional({ description: 'Chave da Anthropic (Claude). null remove.', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  anthropicKey?: string | null;

  @ApiPropertyOptional({
    description: 'Modelo padrão (tarefas internas e agentes em "Padrão"). Ex.: anthropic/claude-sonnet-5-5',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  defaultModel?: string | null;
}

enum ProviderParam {
  openai = 'openai',
  anthropic = 'anthropic',
}

@ApiTags('AI Providers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('ai-providers')
export class AiProvidersController {
  constructor(private readonly credentials: AiCredentialsService) {}

  @Get()
  @ApiOperation({ summary: 'Chaves de IA configuradas (mascaradas) e modelo padrão' })
  get(@CurrentOrg('id') orgId: string) {
    return this.credentials.getView(orgId);
  }

  @Put()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Salva/remove chaves de IA e o modelo padrão' })
  update(@CurrentOrg('id') orgId: string, @Body() dto: UpdateAiProvidersDto) {
    return this.credentials.update(orgId, dto);
  }

  @Post(':provider/test')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Testa a chave salva de um provedor' })
  test(
    @CurrentOrg('id') orgId: string,
    @Param('provider', new ParseEnumPipe(ProviderParam)) provider: LlmProvider,
  ) {
    return this.credentials.test(orgId, provider);
  }

  @Get('models')
  @ApiOperation({ summary: 'Modelos disponíveis para as chaves da org' })
  models(@CurrentOrg('id') orgId: string) {
    return this.credentials.listModels(orgId);
  }
}
