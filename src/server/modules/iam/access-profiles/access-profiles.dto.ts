import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertAccessProfileDto {
  @ApiProperty({ example: 'Atendente' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiProperty({ example: ['inbox', 'contacts'] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  pages!: string[];

  @ApiProperty({ example: ['conversations.close'] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  actions!: string[];
}

export class AssignAccessProfileDto {
  @ApiProperty({ nullable: true, description: 'null = acesso padrão do atendente' })
  @IsOptional()
  @IsString()
  accessProfileId!: string | null;
}
