import { Body, Controller, Delete, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { PushService } from './push.service';
import { RemovePushSubscriptionDto, SavePushSubscriptionDto } from './dto/push-subscription.dto';

@ApiTags('Push')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('config')
  @ApiOperation({ summary: 'Push no celular está configurado? Chave pública VAPID.' })
  config() {
    return this.push.config();
  }

  @Post('subscriptions')
  @ApiOperation({ summary: 'Ativa as notificações neste aparelho' })
  subscribe(
    @CurrentUser('id') userId: string,
    @Body() dto: SavePushSubscriptionDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.push.subscribe(userId, dto, userAgent);
  }

  @Post('test')
  @ApiOperation({ summary: 'Manda uma notificação de teste para os aparelhos do usuário' })
  async test(@CurrentUser('id') userId: string) {
    const sent = await this.push.sendToUser(userId, {
      title: 'UniSimpremium',
      body: 'Notificação de teste: está funcionando ✅',
      url: '/inbox',
      tag: 'push-test',
    });
    return { sent, enabled: this.push.isEnabled };
  }

  @Delete('subscriptions')
  @ApiOperation({ summary: 'Desativa as notificações neste aparelho' })
  unsubscribe(@CurrentUser('id') userId: string, @Body() dto: RemovePushSubscriptionDto) {
    return this.push.unsubscribe(userId, dto.endpoint);
  }
}
