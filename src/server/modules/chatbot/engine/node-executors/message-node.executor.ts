import { Injectable } from '@nestjs/common';
import { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from './node-executor.interface';

/** Legenda de imagem no WhatsApp vai até 1024 caracteres. */
export const MAX_IMAGE_CAPTION = 1024;

/**
 * Espera máxima antes de um bloco Mensagem sair. Na Vercel o worker só
 * fica esperando jobs atrasados que vencem em até 15s; acima disso o
 * envio cairia no tick de 1 minuto.
 */
export const MAX_MESSAGE_DELAY_SECONDS = 15;

/**
 * Imagem do nó Mensagem (upload na tela do fluxo ou link colado):
 * `nodeData.image = { url, mimeType?, fileName?, size? }`.
 */
export interface MessageNodeImage {
  url: string;
  mimeType?: string;
  fileName?: string;
  size?: number;
}

@Injectable()
export class MessageNodeExecutor implements NodeExecutor {
  readonly nodeType = 'MESSAGE';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const text = this.interpolate(ctx.nodeData.message || '', ctx.session.variables);
    const nextNodeId = ctx.nodeEdges[0]?.targetNodeId || null;

    const messages = buildMessageNodeMessages(text, ctx.nodeData.image);
    const delayMs = messageDelayMs(ctx.nodeData.delaySeconds);
    if (delayMs > 0) messages[0] = { ...messages[0], delayMs };

    return {
      nextNodeId,
      sendMessages: messages,
      waitForInput: false,
    };
  }

  private interpolate(template: string, variables: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
  }
}

/**
 * Com imagem: o texto vai como legenda; texto longo demais pra legenda sai
 * numa mensagem logo depois da imagem.
 */
export function buildMessageNodeMessages(
  text: string,
  image?: MessageNodeImage | null,
): { type: string; content: Record<string, any>; delayMs?: number }[] {
  const url = typeof image?.url === 'string' ? image.url.trim() : '';
  if (!url) return [{ type: 'TEXT', content: { text } }];

  const fitsCaption = text.trim() !== '' && text.length <= MAX_IMAGE_CAPTION;
  const media = {
    type: 'IMAGE',
    content: {
      mediaUrl: url,
      mimeType: image?.mimeType || 'image/jpeg',
      ...(image?.fileName ? { fileName: image.fileName } : {}),
      ...(image?.size ? { fileSize: image.size } : {}),
      ...(fitsCaption ? { caption: text } : {}),
    },
  };
  return fitsCaption || !text.trim() ? [media] : [media, { type: 'TEXT', content: { text } }];
}

/** "Aguardar antes de enviar" do bloco, em ms (0 a 15s). */
export function messageDelayMs(seconds: unknown): number {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(Math.min(n, MAX_MESSAGE_DELAY_SECONDS) * 1000);
}
