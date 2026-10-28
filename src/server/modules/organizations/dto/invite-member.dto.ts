import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';

export class InviteMemberDto {
  @ApiProperty({ example: 'novo.membro@simpremium.com.br' })
  @IsEmail()
  email: string;

  @ApiProperty({ enum: OrgRole, example: OrgRole.AGENT })
  @IsEnum(OrgRole)
  role: OrgRole;

  @ApiPropertyOptional({ description: 'Perfil de acesso (só vale para AGENT)' })
  @IsOptional()
  @IsString()
  accessProfileId?: string;
}
