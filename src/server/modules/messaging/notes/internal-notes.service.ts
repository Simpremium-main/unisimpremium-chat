import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InternalNoteAuthorType, OrgRole } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import {
  ChannelAccess,
  ChannelAccessService,
} from '../../iam/channel-access/channel-access.service';
import { INTERNAL_NOTE_SELECT, MAX_NOTE_LENGTH } from './internal-note.select';

/**
 * Notas internas da conversa — nunca vão pro cliente. Qualquer membro com
 * acesso ao canal lê e escreve; editar só a própria nota; apagar a própria
 * (OWNER/ADMIN apagam qualquer uma, inclusive as da IA).
 */
@Injectable()
export class InternalNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  async list(conversationId: string, organizationId: string, access: ChannelAccess) {
    await this.assertConversation(conversationId, organizationId, access);
    return this.prisma.internalNote.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: INTERNAL_NOTE_SELECT,
    });
  }

  async create(
    conversationId: string,
    organizationId: string,
    access: ChannelAccess,
    userId: string,
    input: { content: string; messageId?: string | null },
  ) {
    await this.assertConversation(conversationId, organizationId, access);
    const content = this.cleanContent(input.content);
    if (input.messageId) {
      const msg = await this.prisma.message.findFirst({
        where: { id: input.messageId, conversationId },
        select: { id: true },
      });
      if (!msg) throw new NotFoundException('Mensagem anotada não encontrada nesta conversa');
    }
    const note = await this.prisma.internalNote.create({
      data: {
        conversationId,
        authorType: InternalNoteAuthorType.USER,
        authorId: userId,
        messageId: input.messageId ?? null,
        content,
      },
      select: INTERNAL_NOTE_SELECT,
    });
    this.realtime.emitToConversation(conversationId, 'note:new', { conversationId, note });
    return note;
  }

  async update(
    conversationId: string,
    noteId: string,
    organizationId: string,
    access: ChannelAccess,
    userId: string,
    content: string,
  ) {
    const existing = await this.findNote(conversationId, noteId, organizationId, access);
    if (existing.authorType !== InternalNoteAuthorType.USER || existing.authorId !== userId) {
      throw new ForbiddenException('Só quem escreveu a nota pode editá-la');
    }
    const note = await this.prisma.internalNote.update({
      where: { id: noteId },
      data: { content: this.cleanContent(content) },
      select: INTERNAL_NOTE_SELECT,
    });
    this.realtime.emitToConversation(conversationId, 'note:updated', { conversationId, note });
    return note;
  }

  async remove(
    conversationId: string,
    noteId: string,
    organizationId: string,
    access: ChannelAccess,
    userId: string,
    role: OrgRole,
  ) {
    const existing = await this.findNote(conversationId, noteId, organizationId, access);
    const isOwn = existing.authorType === InternalNoteAuthorType.USER && existing.authorId === userId;
    if (!isOwn && role !== OrgRole.OWNER && role !== OrgRole.ADMIN) {
      throw new ForbiddenException('Só quem escreveu (ou um admin) pode apagar a nota');
    }
    await this.prisma.internalNote.delete({ where: { id: noteId } });
    this.realtime.emitToConversation(conversationId, 'note:deleted', { conversationId, noteId });
    return { id: noteId };
  }

  private cleanContent(content: string): string {
    const trimmed = (content ?? '').trim();
    if (!trimmed) throw new BadRequestException('A nota não pode ficar vazia');
    if (trimmed.length > MAX_NOTE_LENGTH) {
      throw new BadRequestException(`A nota passa de ${MAX_NOTE_LENGTH} caracteres`);
    }
    return trimmed;
  }

  private async assertConversation(
    conversationId: string,
    organizationId: string,
    access: ChannelAccess,
  ) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { organizationId: true, channelId: true },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.organizationId !== organizationId) throw new ForbiddenException();
    this.channelAccess.assertChannelAccess(access, conv.channelId);
  }

  private async findNote(
    conversationId: string,
    noteId: string,
    organizationId: string,
    access: ChannelAccess,
  ) {
    await this.assertConversation(conversationId, organizationId, access);
    const note = await this.prisma.internalNote.findFirst({
      where: { id: noteId, conversationId },
      select: { id: true, authorType: true, authorId: true },
    });
    if (!note) throw new NotFoundException('Nota não encontrada');
    return note;
  }
}
