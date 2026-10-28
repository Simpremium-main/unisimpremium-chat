import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** "Sugerir resposta" (atendente): o que a IA deve considerar. */
export class DraftReplyDto {
  @ApiPropertyOptional({ description: 'Informação ou orientação do atendente para a mensagem' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  extraInfo?: string;

  @ApiPropertyOptional({ description: 'Usar o histórico da conversa (padrão: sim)' })
  @IsOptional()
  @IsBoolean()
  useHistory?: boolean;
}
