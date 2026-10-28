import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MAX_NOTE_LENGTH } from '../internal-note.select';

export class CreateInternalNoteDto {
  @ApiProperty({ example: 'Cliente prefere contato à tarde.' })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NOTE_LENGTH)
  content!: string;

  /** Mensagem anotada ("Anotar" no menu da mensagem). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  messageId?: string;
}

export class UpdateInternalNoteDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NOTE_LENGTH)
  content!: string;
}
