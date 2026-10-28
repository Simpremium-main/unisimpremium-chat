import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ChatbotFlowsController } from './chatbot-flows/chatbot-flows.controller';
import { ChatbotFlowsService } from './chatbot-flows/chatbot-flows.service';
import { ChatbotFlowsRepository } from './chatbot-flows/chatbot-flows.repository';
import { ChatbotSessionService } from './session/chatbot-session.service';
import { ChatbotEngineService } from './engine/chatbot-engine.service';
import { ChatbotProcessor } from './engine/chatbot.processor';
import { MessageNodeExecutor } from './engine/node-executors/message-node.executor';
import { MenuNodeExecutor } from './engine/node-executors/menu-node.executor';
import { ConditionNodeExecutor } from './engine/node-executors/condition-node.executor';
import { WaitNodeExecutor } from './engine/node-executors/wait-node.executor';
import { TransferNodeExecutor } from './engine/node-executors/transfer-node.executor';
import { RealtimeModule } from '../realtime/realtime.module';
import { AGENT_DEBOUNCE_QUEUE } from '../messaging/pipeline/agent-debounce.constants';
import { INBOX_PUSH_QUEUE } from '../push/inbox-push.job';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'chatbot-processor' },
      { name: 'outbound-messages' },
      { name: AGENT_DEBOUNCE_QUEUE },
      { name: INBOX_PUSH_QUEUE },
    ),
    RealtimeModule,
  ],
  controllers: [ChatbotFlowsController],
  providers: [
    ChatbotFlowsService,
    ChatbotFlowsRepository,
    ChatbotSessionService,
    ChatbotEngineService,
    ChatbotProcessor,
    MessageNodeExecutor,
    MenuNodeExecutor,
    ConditionNodeExecutor,
    WaitNodeExecutor,
    TransferNodeExecutor,
  ],
  exports: [ChatbotFlowsService, ChatbotFlowsRepository, ChatbotSessionService],
})
export class ChatbotModule {}
