import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { ZappfyModule } from '../channel-hub/adapters/zappfy/zappfy.module';
import { GroupMonitorController } from './group-monitor.controller';
import { GroupMonitorService } from './group-monitor.service';
import { GroupSyncService } from './group-sync.service';

@Module({
  imports: [MessagingModule, ZappfyModule],
  controllers: [GroupMonitorController],
  providers: [GroupMonitorService, GroupSyncService],
})
export class GroupMonitorModule {}
