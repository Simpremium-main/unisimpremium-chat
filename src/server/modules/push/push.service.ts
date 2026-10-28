import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '../../database/prisma.service';

/** O que o service worker (public/sw.js) recebe em cada push. */
export interface PushPayload {
  title: string;
  body: string;
  /** Página aberta ao tocar na notificação. */
  url: string;
  /** Número no ícone do app (0 apaga; ausente não mexe). */
  badge?: number;
  /** Notificação nova da mesma conversa substitui a anterior. */
  tag?: string;
}

/**
 * Web Push (VAPID). Sem VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY o recurso fica
 * desligado: a tela não oferece ativar e nada é enviado.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly publicKey: string | null;
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const publicKey = config.get<string>('VAPID_PUBLIC_KEY')?.trim() || null;
    const privateKey = config.get<string>('VAPID_PRIVATE_KEY')?.trim() || null;
    const subject = config.get<string>('VAPID_SUBJECT')?.trim() || 'mailto:atendimento@simpremium.com.br';
    this.publicKey = publicKey;
    this.enabled = !!publicKey && !!privateKey;
    if (this.enabled) {
      try {
        webpush.setVapidDetails(subject, publicKey!, privateKey!);
      } catch (err: any) {
        this.enabled = false;
        this.logger.error(`VAPID inválido — push desligado: ${err?.message ?? err}`);
      }
    }
  }

  config() {
    return { enabled: this.enabled, publicKey: this.enabled ? this.publicKey : null };
  }

  get isEnabled() {
    return this.enabled;
  }

  /** O mesmo aparelho (endpoint) passa a ser de quem ativou por último. */
  async subscribe(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: {
        userId,
        endpoint: sub.endpoint,
        p256dhKey: sub.keys.p256dh,
        authKey: sub.keys.auth,
        userAgent: userAgent?.slice(0, 500) ?? null,
      },
      update: {
        userId,
        p256dhKey: sub.keys.p256dh,
        authKey: sub.keys.auth,
        userAgent: userAgent?.slice(0, 500) ?? null,
      },
    });
    return { ok: true };
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
    return { ok: true };
  }

  /** Usuários com pelo menos um aparelho ativado, entre os membros da organização. */
  async subscribedMembers(organizationId: string) {
    return this.prisma.userOrganization.findMany({
      where: { organizationId, user: { pushSubscriptions: { some: {} } } },
      select: { id: true, userId: true, role: true },
    });
  }

  /** Manda para todos os aparelhos do usuário; aparelho que expirou é removido. */
  async sendToUser(userId: string, payload: PushPayload): Promise<number> {
    if (!this.enabled) return 0;
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    const body = JSON.stringify(payload);
    let sent = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dhKey, auth: s.authKey } },
            body,
            // Sem `topic`: a troca da notificação da mesma conversa fica com a
            // `tag` no aparelho (sw.js) — nem todo serviço de push aceita Topic.
            { TTL: 60 * 60, urgency: 'high' },
          );
          sent++;
        } catch (err: any) {
          const status = err?.statusCode;
          if (status === 404 || status === 410) {
            await this.prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
          } else {
            this.logger.warn(`push failed (${status ?? '?'}) user=${userId}: ${err?.body || err?.message || err}`);
          }
        }
      }),
    );
    return sent;
  }
}
