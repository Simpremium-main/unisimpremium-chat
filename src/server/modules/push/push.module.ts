import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { InboxPushProcessor } from './inbox-push.processor';
import { INBOX_PUSH_QUEUE } from './inbox-push.job';
import { InboxViewsModule } from '../inbox-views/inbox-views.module';
import { ChannelAccessModule } from '../iam/channel-access/channel-access.module';

/** Notificações no celular (app na Tela de Início, Web Push). */
@Module({
  imports: [BullModule.registerQueue({ name: INBOX_PUSH_QUEUE }), InboxViewsModule, ChannelAccessModule],
  controllers: [PushController],
  providers: [PushService, InboxPushProcessor],
  exports: [PushService],
})
export class PushModule {}
