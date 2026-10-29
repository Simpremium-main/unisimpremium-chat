import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SetPartnerDto {
  @ApiPropertyOptional({ description: 'Parceiro (operação) do grupo; vazio remove' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  partner?: string | null;
}
