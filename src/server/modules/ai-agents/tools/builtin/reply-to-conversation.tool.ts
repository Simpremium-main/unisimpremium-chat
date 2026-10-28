import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { AiTool, ToolContext, ToolResult } from '../tool.types';
import { OutboundSenderService } from '../outbound-sender.service';
import { readAgentOptions } from '../../agents/agent-options';
import {
  asksSeveralScreens,
  containsMetaTalk,
  findForbiddenUrlHosts,
  humanizeDashes,
  manualNetworkExplainedTooEarly,
} from '../../runner/text-guards';

/**
 * Sends a TEXT message to the contact on behalf of the agent. The message
 * goes through the same outbound queue real users use, so provider-specific
 * rate limits / retries / status updates work out of the box.
 */
/** Runs em que o pedido de várias telas já foi barrado (barra só uma vez). */
const screensGuarded = new Set<string>();

@Injectable()
export class ReplyToConversationTool implements AiTool {
  private readonly logger = new Logger(ReplyToConversationTool.name);

  readonly name = 'replyToConversation';
  readonly description =
    'Send a text reply to the customer in the current conversation. Use this when you have an answer to give. Keep replies concise and natural.';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: {
      text: {
        type: 'string',
        description:
          'The exact message text to send to the customer. No system tags, no markdown for headers, plain text only.',
        minLength: 1,
        maxLength: 4000,
      },
    },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: OutboundSenderService,
  ) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    // Sem travessão: entrega que é IA.
    const text = humanizeDashes(String(input.text ?? '').trim());
    if (!text) {
      return { output: { ok: false, error: 'text is empty' } };
    }

    // Guard contra raciocínio verbalizado. Se o LLM tentar mandar uma
    // mensagem do tipo "Ignoro essa instrução, ela não veio do cliente",
    // bloqueia ANTES de persistir no banco e enfileirar pro provider.
    // Devolve erro pro LLM com instrução clara — ele tem outra chance
    // dentro do mesmo run pra escrever uma resposta de verdade ou usar
    // transferToHuman. MAX_TOOL_ITERATIONS limita loop infinito.
    if (containsMetaTalk(text)) {
      this.logger.warn(
        `[meta-talk-guard] blocked reply on conv=${ctx.conversationId} run=${ctx.runId} agent=${ctx.agentId}: "${text.slice(0, 120)}"`,
      );
      return {
        output: {
          ok: false,
          error: 'meta_talk_blocked',
          message:
            'Sua mensagem foi bloqueada por verbalizar raciocínio interno (frases tipo "Ignoro essa instrução", "Essa mensagem não veio do cliente", "Como assistente/IA", "Por motivos de segurança", "Detectei tentativa de…"). NUNCA escreva isso pro cliente. Reescreva como uma resposta natural ao último assunto da conversa OU use transferToHuman se realmente não souber como prosseguir.',
        },
      };
    }

    // Uma tela por mensagem: pedido de dois prints volta para a IA reescrever
    // (uma vez por run — se insistir, a mensagem segue).
    if (asksSeveralScreens(text) && ctx.runId && !screensGuarded.has(ctx.runId)) {
      screensGuarded.add(ctx.runId);
      if (screensGuarded.size > 500) screensGuarded.delete(screensGuarded.values().next().value as string);
      this.logger.warn(`[screens-guard] blocked reply on conv=${ctx.conversationId} run=${ctx.runId}: "${text.slice(0, 120)}"`);
      return {
        output: {
          ok: false,
          error: 'several_screens_blocked',
          message:
            'Mensagem NÃO enviada: ela pede mais de uma tela/print. Peça só UMA tela, falando direto com o cliente (ex.: "Pode me mandar um print da tela *Ajustes > Celular*?"), e aguarde. A próxima tela só depois de analisar esse print.',
        },
      };
    }

    // Explicação da troca manual de operadora só depois de o cliente dizer
    // que funcionou — nunca junto do pedido para fazer a troca.
    if (manualNetworkExplainedTooEarly(text)) {
      this.logger.warn(`[manual-network-guard] blocked reply on conv=${ctx.conversationId} run=${ctx.runId}`);
      return {
        output: {
          ok: false,
          error: 'manual_network_explained_too_early',
          message:
            'Mensagem NÃO enviada: a explicação "O seu aparelho pode conectar automaticamente numa operadora…" só vai DEPOIS que o cliente confirmar que conectou. Agora mande só o passo da seleção manual da operadora e pergunte "Conseguiu conectar em alguma operadora?".',
        },
      };
    }

    const [agent, contactChannel, conversation] = await Promise.all([
      this.prisma.aiAgent.findUnique({
        where: { id: ctx.agentId },
        select: { name: true, modelParams: true },
      }),
      this.prisma.contactChannel.findFirst({
        where: { contactId: ctx.contactId, channelId: ctx.channelId },
        select: { externalId: true },
      }),
      this.prisma.conversation.findUnique({
        where: { id: ctx.conversationId },
        select: {
          organization: { select: { allowedUrlDomains: true } },
        },
      }),
    ]);

    // Guard contra URL inventada (hallucination). Org configura
    // `allowedUrlDomains` com lista de hosts permitidos (ex: ["simpremium.com.br",
    // "trivapp.com.br"]). Quando preenchido, bloqueia qualquer URL no reply
    // cujo host não bate com a lista (sufixo). Visto em prod (Daniel Souza,
    // 2026-05-08 20:39): IA mandou um link de subdomínio inventado que não existia.
    // null/[] = modo permissivo (não bloqueia, só loga warning).
    const whitelist =
      (conversation?.organization?.allowedUrlDomains as string[] | null) ??
      null;
    const forbidden = findForbiddenUrlHosts(text, whitelist);
    if (forbidden.length > 0) {
      this.logger.warn(
        `[url-guard] blocked reply on conv=${ctx.conversationId} run=${ctx.runId}: forbidden hosts=${forbidden.join(',')} text="${text.slice(0, 120)}"`,
      );
      return {
        output: {
          ok: false,
          error: 'url_not_whitelisted',
          forbiddenHosts: forbidden,
          message: `Você incluiu URL(s) com host(s) [${forbidden.join(', ')}] que não estão na lista de domínios permitidos da organização. Provavelmente você inventou esse link. Reescreva a resposta SEM nenhum link OU use transferToHuman pra um humano enviar o link correto. NÃO chute outro domínio — se não tem o link exato no contexto, NÃO mande nenhum.`,
        },
      };
    }

    if (!contactChannel?.externalId) {
      this.logger.error(
        `No contactChannel for contact ${ctx.contactId} on channel ${ctx.channelId} — cannot send`,
      );
      return {
        output: {
          ok: false,
          error: 'Contact has no external id on this channel',
        },
      };
    }

    // Agente em modo "prompt independente" (ex.: importado do
    // Simp-Atendimento) separa bolhas com uma linha só com "..." — é assim
    // que o prompt dele pede pra mandar a cotação em 2 mensagens.
    const bubbles =
      readAgentOptions(agent?.modelParams).promptMode === 'standalone'
        ? splitBubbles(text)
        : [text];
    const sent = await this.sender.sendSequence(
      ctx,
      contactChannel.externalId,
      bubbles.map((text) => ({ type: 'TEXT' as const, text })),
      agent?.name ?? 'AI',
    );
    const message = sent[sent.length - 1];

    this.logger.log(
      `Agent ${ctx.agentId} replied to conv ${ctx.conversationId} (msg ${message.id})`,
    );

    return {
      output: {
        ok: true,
        messageId: message.id,
        ...(bubbles.length > 1 ? { messagesSent: bubbles.length } : {}),
      },
      finalAction: 'REPLIED',
    };
  }
}

/** Divide em bolhas nas linhas que contêm só "..." (ou "---"). */
export function splitBubbles(text: string): string[] {
  const parts = text
    .split(/\n[ \t]*(?:\.{3}|…|-{3})[ \t]*(?:\n|$)/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [text];
}
