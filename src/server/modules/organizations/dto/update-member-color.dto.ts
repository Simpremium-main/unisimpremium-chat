import { IsOptional, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMemberColorDto {
  /** Cor de fundo da bolinha de iniciais (#rrggbb). null volta ao padrão. */
  @ApiPropertyOptional({ example: '#2563eb', nullable: true })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'color deve ser um hex #rrggbb' })
  color?: string | null;
}
