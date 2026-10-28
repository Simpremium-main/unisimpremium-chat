import { Module } from '@nestjs/common';
import { GroupMonitorController } from './group-monitor.controller';
import { GroupMonitorService } from './group-monitor.service';

@Module({
  controllers: [GroupMonitorController],
  providers: [GroupMonitorService],
})
export class GroupMonitorModule {}
