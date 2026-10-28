import { Injectable } from '@nestjs/common';
import { AiTool, ToolContext, ToolResult } from '../tool.types';
import { AiNoteWriter } from './ai-note-writer.service';

/**
 * Nota interna da IA: registra na conversa uma observação que SÓ a equipe
 * vê (nunca vai pro cliente) — resumo do caso, dados informados, contexto
 * pro próximo atendente. Não substitui a resposta ao cliente.
 */
@Injectable()
export class AddInternalNoteTool implements AiTool {
  readonly name = 'addInternalNote';
  readonly description =
    'Write an INTERNAL note on this conversation, visible ONLY to the team (never sent to the customer). Use it to leave useful context for the human agents: a short summary of the case, data the customer provided (order number, dates, destination), what was already tried, or something a human must check. Write in PT-BR, short and objective. Do not use it to talk to the customer — use replyToConversation for that. A note does NOT transfer, forward or escalate the conversation: writing "encaminhado ao suporte" here does nothing — to hand off, call the transfer tool (escalar_para_humano / transferToHuman).';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['content'],
    properties: {
      content: {
        type: 'string',
        minLength: 3,
        maxLength: 2000,
        description: 'Texto da nota, em português, curto e objetivo.',
      },
      aboutLastCustomerMessage: {
        type: 'boolean',
        description:
          'true = prende a nota à mensagem do cliente que disparou esta resposta (aparece marcada nela).',
      },
    },
  };

  constructor(private readonly notes: AiNoteWriter) {}

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const content = String(input.content ?? '').trim();
    if (content.length < 3) {
      return { output: { ok: false, error: 'nota vazia ou curta demais' } };
    }
    const note = await this.notes.write({
      conversationId: ctx.conversationId,
      agentId: ctx.agentId,
      content,
      messageId: input.aboutLastCustomerMessage === true ? (ctx.triggerMessageId ?? null) : null,
    });
    return {
      output: {
        ok: true,
        noteId: note?.id ?? null,
        message: 'Nota interna registrada (visível só para a equipe).',
      },
    };
  }
}
