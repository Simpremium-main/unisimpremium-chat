import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Cotação pedida pelo atendente no compositor (sem acionar a IA). */
export class QuickQuoteDto {
  @ApiProperty({ example: ['Estados Unidos'], description: 'Países em português' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  countries: string[];

  @ApiProperty({ enum: ['virtual', 'physical'] })
  @IsIn(['virtual', 'physical'])
  chipType: 'virtual' | 'physical';

  @ApiPropertyOptional({ description: 'Dias da viagem (se não vierem as datas)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;

  @ApiPropertyOptional({ example: '2026-10-29' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-11-03' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;

  @ApiPropertyOptional({ description: 'Só os planos com franquia de dados (em vez do ilimitado)' })
  @IsOptional()
  @IsBoolean()
  franquiaApenas?: boolean;

  @ApiPropertyOptional({ description: 'Desconto em % (padrão 15 = cupom MINHAVIAGEM; outro valor não cita cupom)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;
}
