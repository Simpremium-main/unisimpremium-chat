import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MessageDirection } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ChannelAccessService } from '../iam/channel-access/channel-access.service';
import { InboxViewsService } from '../inbox-views/inbox-views.service';
import type { InboxMemo } from '../messaging/conversations/conversations.service';
import { INBOX_PUSH_QUEUE, InboxPushJobData } from './inbox-push.job';
import { PushService } from './push.service';

/**
 * Para cada usuário com notificação ativada no celular: se a conversa está
 * agora em "Não respondidas", "IA para Humano" ou "IA Aguardando" (com o
 * acesso a canais dele), manda o push com o total dessas inboxes no ícone.
 * Conversa fora delas (IA atendendo, já respondida) não gera push.
 */
@Processor(INBOX_PUSH_QUEUE, { concurrency: 2 })
export class InboxPushProcessor extends WorkerHost {
  private readonly logger = new Logger(InboxPushProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly inboxViews: InboxViewsService,
    private readonly channelAccess: ChannelAccessService,
  ) {
    super();
  }

  async process(job: Job<InboxPushJobData>) {
    if (!this.push.isEnabled) return { skipped: 'disabled' };
    const { organizationId, conversationId } = job.data;

    const members = await this.push.subscribedMembers(organizationId);
    if (members.length === 0) return { skipped: 'no-subscribers' };

    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId, deletedAt: null },
      select: { channelId: true, contact: { select: { name: true, phone: true } } },
    });
    if (!conv) return { skipped: 'no-conversation' };
    const last = await this.prisma.message.findFirst({
      where: { conversationId, direction: MessageDirection.INBOUND },
      orderBy: { createdAt: 'desc' },
      select: { type: true, content: true },
    });

    // Conjuntos da IA (por organização) calculados uma vez para todos.
    const memo: InboxMemo = new Map();
    let sent = 0;
    for (const m of members) {
      try {
        const access = await this.channelAccess.getAccessibleChannelIds(m.id, m.role, organizationId);
        if (access !== 'ALL' && !access.has(conv.channelId)) continue;
        const summary = await this.inboxViews.pushSummary(organizationId, m.userId, access, conversationId, memo);
        if (!summary.view) continue;
        sent += await this.push.sendToUser(m.userId, {
          title: conv.contact?.name?.trim() || conv.contact?.phone || 'Nova conversa',
          body: `${summary.view.name} · ${messagePreview(last)}`,
          url: `/inbox?view=${summary.view.id}&conversationId=${conversationId}`,
          badge: summary.total,
          tag: `conv-${conversationId}`,
        });
      } catch (err: any) {
        this.logger.warn(`inbox push failed for user ${m.userId}: ${err?.message ?? err}`);
      }
    }
    return { sent };
  }
}

/** Texto curto da última mensagem do cliente para a notificação. */
export function messagePreview(msg: { type: string; content: unknown } | null): string {
  if (!msg) return 'Nova mensagem';
  const c = (msg.content ?? {}) as Record<string, any>;
  const text = typeof c.text === 'string' ? c.text : typeof c.caption === 'string' ? c.caption : '';
  const label: Record<string, string> = {
    IMAGE: '📷 Imagem',
    AUDIO: '🎤 Áudio',
    VIDEO: '🎥 Vídeo',
    DOCUMENT: '📄 Documento',
    STICKER: 'Figurinha',
    LOCATION: '📍 Localização',
  };
  const base = text.trim() || label[msg.type] || 'Nova mensagem';
  const oneLine = base.replace(/\s+/g, ' ');
  return oneLine.length > 140 ? `${oneLine.slice(0, 139)}…` : oneLine;
}
