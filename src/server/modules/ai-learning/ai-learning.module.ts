import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { MessagingModule } from '../messaging/messaging.module';
import { PlaybooksModule } from '../ai-agents/playbooks/playbooks.module';
import { KnowledgeModule } from '../ai-agents/knowledge/knowledge.module';
import { AiLearningController } from './ai-learning.controller';
import { AiLearningService } from './ai-learning.service';

@Module({
  imports: [PrismaModule, MessagingModule, PlaybooksModule, KnowledgeModule],
  controllers: [AiLearningController],
  providers: [AiLearningService],
})
export class AiLearningModule {}
