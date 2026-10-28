import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { OrgRole } from '@prisma/client';
import { IsString } from 'class-validator';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser, Roles } from '../../common/decorators';

class ImpersonateDto {
  @IsString()
  userId!: string;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register new user + organization' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Login with email/password' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token' })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile + organizations' })
  getMe(@CurrentUser('id') userId: string) {
    return this.authService.getMe(userId);
  }

  @Post('impersonate')
  @UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Ver como outro membro (token de 1h, sem refresh) — para testes de permissão' })
  impersonate(
    @CurrentUser() user: { id: string; impersonatorId?: string | null },
    @CurrentOrg('id') orgId: string,
    @CurrentOrg('userRole') role: string,
    @Body() dto: ImpersonateDto,
  ) {
    return this.authService.impersonate(user, orgId, role, dto.userId);
  }
}
