import { MaxLength, MinLength, IsString, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateQuickReplyDto {
  @ApiProperty()
  @IsString()
  @MaxLength(40)
  shortcut: string;

  @ApiProperty()
  @IsString()
  @MaxLength(80)
  title: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content: string;

  /** true: só quem cadastrou vê. Padrão: toda a equipe. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}
