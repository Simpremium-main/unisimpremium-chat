import { ChatbotSession } from '../../session/chatbot-session.types';

export interface NodeExecutionContext {
  session: ChatbotSession;
  nodeData: Record<string, any>;
  nodeEdges: { targetNodeId: string; condition?: string }[];
  incomingMessage?: string;
  conversationId: string;
  channelId: string;
  contactExternalId: string;
}

export interface NodeExecutionResult {
  nextNodeId: string | null;
  /** `delayMs`: espera (com "digitando...") antes desta mensagem sair. */
  sendMessages: { type: string; content: Record<string, any>; delayMs?: number }[];
  waitForInput: boolean;
  updatedVariables?: Record<string, any>;
  transferToHuman?: boolean;
  transferDepartmentId?: string;
}

export interface NodeExecutor {
  readonly nodeType: string;
  execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult>;
}
