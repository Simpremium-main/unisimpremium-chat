import { Injectable } from '@nestjs/common';
import { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from './node-executor.interface';
import { buildMenuContent, numberedMenu } from '../chatbot-message';
import type { ChatbotChoice } from '../../session/chatbot-session.keys';

@Injectable()
export class MenuNodeExecutor implements NodeExecutor {
  readonly nodeType = 'MENU';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const { title, options, display, listButton } = ctx.nodeData as {
      title: string;
      options: { label: string; value: string }[];
      /** 'text' = sempre texto numerado; padrão = botões/lista no WhatsApp. */
      display?: 'auto' | 'text';
      listButton?: string;
    };

    if (!ctx.incomingMessage) {
      // Botões/lista no WhatsApp (o processador cai pro texto numerado nos
      // canais sem interativo); a resposta por número ou texto continua valendo.
      const message =
        display === 'text'
          ? { type: 'TEXT', content: { text: numberedMenu(title, options) } }
          : {
              type: 'INTERACTIVE',
              content: buildMenuContent(title, options, listButton?.trim() || 'Ver opções') as unknown as Record<string, any>,
            };
      return {
        nextNodeId: null,
        sendMessages: [message],
        waitForInput: true,
      };
    }

    const input = ctx.incomingMessage.trim();
    const selectedIndex = parseInt(input, 10) - 1;
    const selectedByNumber = options[selectedIndex];
    const selectedByValue = options.find(
      (o) => o.value.toLowerCase() === input.toLowerCase() || o.label.toLowerCase() === input.toLowerCase(),
    );
    const selected = selectedByNumber || selectedByValue;

    if (!selected) {
      return {
        nextNodeId: null,
        sendMessages: [{ type: 'TEXT', content: { text: 'Opção inválida. Tente novamente.' } }],
        waitForInput: true,
      };
    }

    const matchingEdge = ctx.nodeEdges.find((e) => e.condition === selected.value);
    const nextNodeId = matchingEdge?.targetNodeId || ctx.nodeEdges[0]?.targetNodeId || null;

    return {
      nextNodeId,
      sendMessages: [],
      waitForInput: false,
      updatedVariables: {
        lastMenuSelection: selected.value,
        // Caminho do cliente no fluxo — vai pra IA no fim (ver ChatbotCompletion).
        choices: [
          ...((ctx.session.variables.choices as ChatbotChoice[] | undefined) ?? []),
          { question: title || 'Escolha uma opção', answer: selected.label },
        ],
      },
    };
  }
}
