import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../database/prisma.module';
import { KnowledgeService } from './knowledge.service';

@Module({
  imports: [PrismaModule],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
