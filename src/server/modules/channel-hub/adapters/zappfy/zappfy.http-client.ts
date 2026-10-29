import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class ZappfyHttpClient {
  private static readonly BASE_URL = 'https://api.zappfy.io';
  /** Domínios aceitos em `config.serverUrl` (Zappfy é white-label da uazapi). */
  private static readonly ALLOWED_HOST_SUFFIXES = ['zappfy.io', 'uazapi.com'];
  private readonly logger = new Logger(ZappfyHttpClient.name);

  /**
   * Servidor da instância: `config.serverUrl` (ex.: https://xxx.uazapi.com,
   * mostrado como "Server URL" no painel) ou, se ausente, o api.zappfy.io
   * original. Só https em zappfy.io / uazapi.com — o token vai no header,
   * então um endereço arbitrário o vazaria.
   */
  static resolveBaseUrl(config: Record<string, any> | null | undefined): string {
    const raw = typeof config?.serverUrl === 'string' ? config.serverUrl.trim() : '';
    if (!raw) return ZappfyHttpClient.BASE_URL;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`Zappfy serverUrl inválida: ${raw}`);
    }
    const host = url.hostname.toLowerCase();
    const allowed = ZappfyHttpClient.ALLOWED_HOST_SUFFIXES.some(
      (s) => host === s || host.endsWith(`.${s}`),
    );
    if (url.protocol !== 'https:' || !allowed) {
      throw new Error(
        `Zappfy serverUrl não permitida: ${raw} (use https em ${ZappfyHttpClient.ALLOWED_HOST_SUFFIXES.join(' ou ')})`,
      );
    }
    return url.origin;
  }

  private createClient(channel: Channel): AxiosInstance {
    const config = channel.config as Record<string, any>;
    return axios.create({
      baseURL: ZappfyHttpClient.resolveBaseUrl(config),
      headers: { token: config.token },
      timeout: 30000,
    });
  }

  async sendRequest(
    channel: Channel,
    endpoint: string,
    payload: Record<string, any>,
  ): Promise<any> {
    const client = this.createClient(channel);
    try {
      const response = await client.post(endpoint, payload);
      return response.data;
    } catch (error: any) {
      this.logger.error(
        `Zappfy API error: ${endpoint} - ${error.response?.data?.message || error.message}`,
      );
      throw error;
    }
  }

  async getInstanceStatus(channel: Channel): Promise<any> {
    const client = this.createClient(channel);
    try {
      const response = await client.get('/instance/status');
      return response.data;
    } catch (error: any) {
      this.logger.error(`Zappfy status check failed: ${error.message}`);
      throw error;
    }
  }

  async fetchChats(
    channel: Channel,
    options: { limit?: number; offset?: number; isGroup?: boolean } = {},
  ): Promise<any> {
    return this.sendRequest(channel, '/chat/find', {
      sort: '-wa_lastMsgTimestamp',
      limit: options.limit ?? 50,
      offset: options.offset ?? 0,
      ...(options.isGroup !== undefined && { wa_isGroup: options.isGroup }),
    });
  }

  /**
   * Todos os grupos em que o número está (uazapi `GET /group/list`), com
   * os participantes. Formato varia entre versões: array ou `{ groups }`.
   */
  async listGroups(channel: Channel): Promise<any[]> {
    const client = this.createClient(channel);
    const response = await client.get('/group/list', { params: { force: true, noparticipants: false } });
    const data = response.data;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.groups)) return data.groups;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  }

  async fetchMessages(
    channel: Channel,
    chatId: string,
    limit = 50,
    offset = 0,
  ): Promise<any> {
    return this.sendRequest(channel, '/message/find', {
      chatid: chatId,
      limit,
      offset,
    });
  }

  async configureWebhook(
    channel: Channel,
    url: string,
    events = ['messages', 'messages_update'],
  ): Promise<any> {
    return this.sendRequest(channel, '/webhook', {
      enabled: true,
      url,
      events,
    });
  }

  async getMediaBuffer(
    channel: Channel,
    mediaUrl: string,
  ): Promise<Buffer> {
    const response = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    return Buffer.from(response.data);
  }

  /**
   * Inbound media from WhatsApp is delivered as an encrypted .enc URL on
   * mmg.whatsapp.net that the browser cannot play. Uazapi exposes
   * /message/download which decrypts server-side and returns a playable
   * URL on their own CDN. We hit that, then the caller can either redirect
   * clients to it or fetch bytes for transcription.
   */
  async resolveInboundMediaUrl(
    channel: Channel,
    externalMessageId: string,
  ): Promise<{ fileUrl: string; mimeType?: string }> {
    const response = await this.sendRequest(channel, '/message/download', {
      id: externalMessageId,
    });
    const fileUrl: string | undefined = response?.fileURL || response?.fileUrl;
    if (!fileUrl) {
      throw new Error(
        `Uazapi /message/download returned no fileURL for ${externalMessageId}`,
      );
    }
    return { fileUrl, mimeType: response?.mimetype };
  }

  /**
   * Apaga a mensagem pra todos no WhatsApp via Uazapi.
   * Endpoint: `POST /message/delete` com `{ id: <externalMessageId> }`.
   * Uazapi devolve 200 mesmo quando a janela do WhatsApp já passou (o
   * cliente final só vê "Esta mensagem foi apagada" se for recente —
   * limitação do próprio WhatsApp, não nossa).
   */
  async deleteMessage(
    channel: Channel,
    externalMessageId: string,
  ): Promise<void> {
    await this.sendRequest(channel, '/message/delete', {
      id: externalMessageId,
    });
  }
}
