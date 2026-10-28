import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDirectUploadDto {
  @ApiProperty({ enum: ['audio', 'media'] })
  @IsIn(['audio', 'media'])
  kind: 'audio' | 'media';

  @ApiProperty({ example: 'image/png' })
  @IsString()
  mimeType: string;

  @ApiProperty({ description: 'Tamanho em bytes' })
  @IsInt()
  @Min(1)
  @Max(1024 * 1024 * 1024)
  size: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  filename?: string;
}

export class CompleteDirectUploadDto {
  @ApiProperty({ enum: ['audio', 'media'] })
  @IsIn(['audio', 'media'])
  kind: 'audio' | 'media';

  @ApiProperty({ description: 'path devolvido por POST /messages/uploads/direct' })
  @IsString()
  path: string;

  @ApiProperty({ example: 'image/png' })
  @IsString()
  mimeType: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  filename?: string;
}
