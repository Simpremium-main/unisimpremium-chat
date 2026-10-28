import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AGENT_DEBOUNCE_QUEUE } from './agent-debounce.constants';
import { InboundMessageProcessor } from './inbound-message.processor';

interface AgentDebounceJobData {
  conversationId: string;
  triggerMessageId: string;
}

/**
 * Dispara o run do agente quando o timer de debounce vence. A lógica do
 * run (re-checagem da conversa, lock, follow-up) continua em
 * InboundMessageProcessor.fireAgentRun.
 */
@Processor(AGENT_DEBOUNCE_QUEUE, { concurrency: 5 })
export class AgentDebounceProcessor extends WorkerHost {
  constructor(private readonly inbound: InboundMessageProcessor) {
    super();
  }

  async process(job: Job<AgentDebounceJobData>): Promise<void> {
    await this.inbound.fireAgentRun(job.data.conversationId);
  }
}
