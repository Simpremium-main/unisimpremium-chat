import { Injectable, Logger } from '@nestjs/common';
import { InternalNoteAuthorType } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { RealtimeGateway } from '../../../realtime/realtime.gateway';
import {
  INTERNAL_NOTE_SELECT,
  MAX_NOTE_LENGTH,
} from '../../../messaging/notes/internal-note.select';

/**
 * Grava uma nota interna assinada pelo agente de IA e avisa quem está com a
 * conversa aberta (`note:new`, mesmo formato das notas dos atendentes).
 * Usado pela ferramenta addInternalNote e pelas transferências pra humano.
 */
@Injectable()
export class AiNoteWriter {
  private readonly logger = new Logger(AiNoteWriter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async write(args: {
    conversationId: string;
    agentId: string;
    content: string;
    messageId?: string | null;
  }) {
    const content = args.content.trim().slice(0, MAX_NOTE_LENGTH);
    if (!content) return null;
    const note = await this.prisma.internalNote.create({
      data: {
        conversationId: args.conversationId,
        authorType: InternalNoteAuthorType.AI,
        agentId: args.agentId,
        messageId: args.messageId ?? null,
        content,
      },
      select: INTERNAL_NOTE_SELECT,
    });
    this.realtime.emitToConversation(args.conversationId, 'note:new', {
      conversationId: args.conversationId,
      note,
    });
    return note;
  }

  /** Variante que nunca derruba o fluxo de quem chama (ex.: handoff). */
  async tryWrite(args: Parameters<AiNoteWriter['write']>[0]): Promise<void> {
    await this.write(args).catch((err) =>
      this.logger.warn(
        `Falha ao gravar nota da IA na conv ${args.conversationId}: ${err?.message ?? err}`,
      ),
    );
  }
}
