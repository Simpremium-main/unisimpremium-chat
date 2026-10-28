import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../database/prisma.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { ChannelAccessModule } from '../channel-access/channel-access.module';
import { AccessProfilesController } from './access-profiles.controller';
import { AccessProfilesService } from './access-profiles.service';

@Module({
  imports: [PrismaModule, RealtimeModule, ChannelAccessModule],
  controllers: [AccessProfilesController],
  providers: [AccessProfilesService],
  exports: [AccessProfilesService],
})
export class AccessProfilesModule {}
