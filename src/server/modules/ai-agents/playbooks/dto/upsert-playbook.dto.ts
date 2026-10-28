import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PlaybookStepDto {
  @ApiProperty({ enum: ['TEXT', 'IMAGE', 'VIDEO'] })
  @IsIn(['TEXT', 'IMAGE', 'VIDEO'])
  type!: 'TEXT' | 'IMAGE' | 'VIDEO';

  @ApiProperty({ description: 'Texto da mensagem, ou URL pública da imagem/vídeo.' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;

  @ApiPropertyOptional({ description: 'Legenda (imagem/vídeo).' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  caption?: string | null;
}

/** Fluxo de atendimento: gatilho + instruções + mensagens fixas. */
export class UpsertPlaybookDto {
  @ApiProperty({ example: 'Cotação de Chip' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    example: 'cotacao-de-chip',
    description: 'Identificador usado pelas ferramentas. Gerado do nome se vazio.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug: só letras minúsculas, números e hífens',
  })
  slug?: string;

  @ApiProperty({ example: 'Quando o cliente quer comprar chip internacional…' })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  trigger!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  instructions?: string;

  @ApiPropertyOptional({ description: 'null = todos os agentes da org.', nullable: true })
  @IsOptional()
  @IsString()
  agentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  groupName?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ type: [PlaybookStepDto], description: 'Mensagens fixas, na ordem de envio.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PlaybookStepDto)
  steps?: PlaybookStepDto[];
}
