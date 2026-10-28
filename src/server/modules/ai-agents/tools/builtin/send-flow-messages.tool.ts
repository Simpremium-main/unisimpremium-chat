import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { AiTool, ToolContext, ToolResult } from '../tool.types';
import { OutboundContent, OutboundSenderService } from '../outbound-sender.service';
import { PlaybookWithSteps, PlaybooksService } from '../../playbooks/playbooks.service';
import { FlowTranslatorService } from '../../language/flow-translator.service';
import { aiContextResetAt } from '../../runner/ai-context';
import { VERIFY_ESIM_INTRO, VERIFY_ESIM_SLUG } from '../../runner/flow-promise';
import { isQuoteText } from '../../followup/quote-followup';
import { asksPriceMatch } from '../simpremium/quote-plans';

/** Fluxos de fechamento/pagamento (barrados enquanto a equipe confere a concorrência). */
const CLOSING_FLOWS = new Set([
  'fechamento-whatsapp',
  'fechamento-site-fisico',
  'fechamento-site-virtual',
  'pagamento-cartao-reais',
  'pagamento-cartao-dolar',
]);

/** Mesmo fluxo não é reenviado na conversa dentro desta janela. */
const RESEND_WINDOW_MS = 6 * 3_600_000;

/**
 * Manda as mensagens fixas de um fluxo (texto, imagem, vídeo), na ordem e
 * exatamente como foram cadastradas — o agente não reescreve.
 */
@Injectable()
export class SendFlowMessagesTool implements AiTool {
  private readonly logger = new Logger(SendFlowMessagesTool.name);

  readonly name = 'enviarMensagensDoFluxo';
  readonly description =
    'Envia ao cliente as mensagens fixas de um fluxo de atendimento, na ordem e exatamente como estão cadastradas (texto, imagens, vídeos). Use quando o fluxo mandar enviar as mensagens dele — NÃO reescreva essas mensagens com replyToConversation.';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['fluxo'],
    properties: {
      fluxo: {
        type: 'string',
        description: 'Identificador do fluxo (o slug mostrado na seção de fluxos, ex.: "cotacao-de-chip").',
      },
    },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly playbooks: PlaybooksService,
    private readonly sender: OutboundSenderService,
    private readonly translator: FlowTranslatorService,
  ) {}

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const slug = String(input.fluxo ?? '').trim();
    const playbook = slug
      ? await this.playbooks.findBySlug(ctx.organizationId, ctx.agentId, slug)
      : null;
    if (!playbook) {
      return { output: { ok: false, error: `Fluxo "${slug}" não encontrado ou inativo` } };
    }
    // Mesmo fluxo de novo na conversa (cliente mandou várias mensagens
    // seguidas e cada run reenviava o "verificar-esim"): não reenvia.
    if (await this.sentRecently(slug, ctx)) {
      return {
        output: {
          ok: false,
          jaEnviado: true,
          fluxo: slug,
          instrucao: `O fluxo "${slug}" JÁ foi enviado nesta conversa. NÃO reenvie nem repita o conteúdo dele. Responda ao que o cliente disse agora (perguntas e dados novos).`,
        },
      };
    }
    // Cliente pediu para cobrir o preço da concorrência: a equipe confere
    // antes — nada de PIX ou link de pagamento pela IA.
    if (CLOSING_FLOWS.has(slug) && (await this.priceMatchPending(ctx))) {
      return {
        output: {
          ok: false,
          cobrir_concorrencia: true,
          instrucao:
            'NÃO envie pagamento: o cliente pediu para cobrir o preço de outra empresa. Chame escalar_para_humano (department: vendas) com a oferta da concorrência (valor, o que o cliente mandou: print/link) e a nossa cotação na reason, e motivo_cliente "verificar a cobertura do preço da concorrência". Não confirme nem negue que vamos cobrir.',
        },
      };
    }
    // verificar-esim sempre logo depois de "Segue abaixo como verificar:" —
    // se a IA não escreveu a frase agora, ela vai antes do fluxo.
    if (slug === VERIFY_ESIM_SLUG && !(await this.introJustSent(ctx))) {
      return this.sendSteps(
        { ...playbook, steps: [{ type: 'TEXT', content: VERIFY_ESIM_INTRO, caption: null } as never, ...playbook.steps] },
        ctx,
      );
    }
    return this.sendSteps(playbook, ctx);
  }

  /** Depois da última cotação, o cliente pediu para cobrir/igualar o preço de outra empresa? */
  private async priceMatchPending(ctx: ToolContext): Promise<boolean> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId: ctx.conversationId, createdAt: { gt: new Date(Date.now() - 48 * 3_600_000) } },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { direction: true, content: true },
    });
    for (const m of rows) {
      const text = String((m.content as { text?: unknown } | null)?.text ?? '');
      if (m.direction === 'OUTBOUND' && isQuoteText(text)) return false;
      if (m.direction === 'INBOUND' && asksPriceMatch(text)) return true;
    }
    return false;
  }

  /** A última mensagem nossa (nos últimos 5 min) já é a frase que abre o verificar-esim? */
  private async introJustSent(ctx: ToolContext): Promise<boolean> {
    const last = await this.prisma.message.findFirst({
      where: { conversationId: ctx.conversationId, direction: 'OUTBOUND', createdAt: { gt: new Date(Date.now() - 5 * 60_000) } },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });
    const text = String((last?.content as { text?: unknown } | null)?.text ?? '');
    return /segue abaixo como verificar/i.test(text);
  }

  /** Este fluxo foi enviado pela IA nesta conversa nas últimas horas (desde o último reinício da IA)? */
  private async sentRecently(slug: string, ctx: ToolContext): Promise<boolean> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: ctx.conversationId },
      select: { metadata: true },
    });
    const resetAt = aiContextResetAt(conv?.metadata);
    const since = new Date(Math.max(Date.now() - RESEND_WINDOW_MS, resetAt?.getTime() ?? 0));
    const prior = await this.prisma.aiToolCall.findFirst({
      where: {
        toolName: this.name,
        run: { conversationId: ctx.conversationId },
        input: { path: ['fluxo'], equals: slug },
        output: { path: ['ok'], equals: true },
        createdAt: { gt: since },
      },
      select: { id: true },
    });
    return !!prior;
  }

  /** Também usado por ferramentas que mandam um fluxo específico (ex.: roaming). */
  async sendSteps(playbook: PlaybookWithSteps, ctx: ToolContext): Promise<ToolResult> {
    if (playbook.steps.length === 0) {
      return { output: { ok: false, error: `O fluxo "${playbook.slug}" não tem mensagens cadastradas` } };
    }
    const externalId = await this.sender.contactExternalId(ctx);
    if (!externalId) {
      return { output: { ok: false, error: 'Contact has no external id on this channel' } };
    }
    const agent = await this.prisma.aiAgent.findUnique({
      where: { id: ctx.agentId },
      select: { name: true },
    });

    // Cliente que escreve em outro idioma recebe o fluxo traduzido (com cache).
    const lang = await this.translator.languageOf(ctx.conversationId).catch(() => 'pt' as const);
    const texts = playbook.steps.map((step) => (step.type === 'TEXT' ? step.content : (step.caption ?? '')));
    const translated = await this.translator.translate(texts, lang, ctx);
    const items: OutboundContent[] = playbook.steps.map((step, i) =>
      step.type === 'TEXT'
        ? { type: 'TEXT', text: translated[i] }
        : { type: step.type, mediaUrl: step.content, caption: step.caption ? translated[i] : step.caption },
    );
    await this.sender.sendSequence(ctx, externalId, items, agent?.name ?? 'AI');

    this.logger.log(
      `Flow "${playbook.slug}" sent to conv ${ctx.conversationId} (${playbook.steps.length} msgs, run ${ctx.runId})`,
    );
    return {
      output: {
        ok: true,
        fluxo: playbook.slug,
        mensagensEnviadas: playbook.steps.length,
        aviso: 'As mensagens já foram enviadas ao cliente. Não repita o conteúdo delas.',
      },
      finalAction: 'REPLIED',
    };
  }
}
