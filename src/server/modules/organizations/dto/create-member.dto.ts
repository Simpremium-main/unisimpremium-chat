import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Cadastro direto de membro (sem convite): o admin define nome, e-mail e senha. */
export class CreateMemberDto {
  @ApiProperty({ example: 'Ana Souza' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'ana@unimobilesim.com.br' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 6 })
  @IsString()
  @MinLength(6)
  @MaxLength(100)
  password: string;

  @ApiProperty({ enum: ['ADMIN', 'AGENT'], example: 'AGENT' })
  @IsIn(['ADMIN', 'AGENT'])
  role: 'ADMIN' | 'AGENT';

  @ApiPropertyOptional({ description: 'Perfil de acesso (só vale para AGENT)' })
  @IsOptional()
  @IsString()
  accessProfileId?: string;
}
