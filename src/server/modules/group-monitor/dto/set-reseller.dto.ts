import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class SetResellerDto {
  @ApiPropertyOptional({ description: 'reseller_id do cliente na API Uni Mobile; vazio remove' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  resellerId?: number | null;
}
