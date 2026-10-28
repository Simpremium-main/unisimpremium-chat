import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  AiFinalAction,
  AiRunStatus,
  Conversation,
  Message,
  AiSkill,
  AiTool,
  MessageDirection,
  NotificationType,
} from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../database/prisma.service';
import { LlmService } from '../llm/llm.service';
import { LlmMessage, LlmToolCall, LlmToolDefinition } from '../llm/llm.types';
import { ToolRegistry } from '../tools/tool-registry.service';
import { ToolContext, ToolResult } from '../tools/tool.types';
import { HttpToolExecutorService } from '../tools/http-tool-executor.service';
import { SqlToolExecutorService } from '../tools/sql-tool-executor.service';
import { PromptBuilderService } from './prompt-builder.service';
import { ModelRouterService, type AgentKind } from './model-router.service';
import { CatalogSyncService } from './catalog-sync.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { isToolCallFailure } from '../agents/agents.service';
import {
  AgentRouterService,
  type AgentSelection,
} from '../router/agent-router.service';
import {
  SecurityLayerService,
  resolveSecurityRules,
} from '../prompts/layers/security.layer';
import type { SecurityRules } from '../prompts/types';
import { RetrievalService } from '../rag/retrieval.service';
import { IntentType } from '../classifier/intent.types';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { humanizeDashes, sanitizeAssistantText } from './text-guards';
import { MediaUrlResolverService } from './media-url-resolver.service';
import { trackBackground } from '../../../runtime/background';
import { runWithLlmOrg } from '../llm/llm-context';
import { randomUUID } from 'crypto';
import { KvStore } from '../../../runtime/kv-store';
import { AGENT_DEBOUNCE_QUEUE } from '../../messaging/pipeline/agent-debounce.constants';
import {
  FOLLOWUP_TTL_MS,
  RUN_LOCK_TTL_MS,
  debouncedRunJob,
  followupKey,
  runLockKey,
  spamSkipKey,
} from './agent-run-lock';
import { AgentOptions, readAgentOptions } from '../agents/agent-options';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { PlaybooksService } from '../playbooks/playbooks.service';
import { aiContextResetAt, aiVisibleMessagesWhere } from './ai-context';
import { detectLanguage } from '../language/customer-language';
import { asksForOtherPlans, lastObsPrice, wantsToCloseOnWhatsapp } from '../tools/simpremium/quote-plans';
import { FLOWS_TOOLSET } from '../tools/tool-registry.service';
import { INBOX_PUSH_QUEUE, inboxPushJob } from '../../push/inbox-push.job';
import { alreadySent, pendingFlowSteps } from './flow-promise';
import type { PlaybookWithSteps } from '../playbooks/playbooks.service';
import type { SendFlowMessagesTool } from '../tools/builtin/send-flow-messages.tool';

/** Mensagem de fluxo enviada há menos que isto conta como já enviada. */
const FLOW_RESEND_WINDOW_MS = 6 * 3_600_000;

const MAX_TOOL_ITERATIONS = 8;
const MAX_RECENT_MESSAGES = 30;

/**
 * Acima desta confiança, mensagens classificadas como SPAM_OR_NOISE são
 * ignoradas sem rodar nenhum agente (o classifier barato já decidiu). Antes
 * isso caía no Augusto (orquestrador caro) só pra ele mandar transferToHuman.
 */
const SPAM_SKIP_CONFIDENCE = 0.8;

/**
 * Tools that signal "agent is preparing to sell": pulled product info,
 * checked the customer's purchase status, etc. If any of these ran but
 * replyToConversation never did, we know the agent gathered intent and
 * then went silent — exactly the failure mode where the customer gets
 * nothing after saying "sim, me manda o link". One synthetic nudge
 * forces a final iteration so the link actually goes out.
 */
const SALES_PREP_TOOLS = new Set([
  'lookupOffering',
  'getProductPitch',
  'checkPurchase',
]);

interface RunInput {
  conversation: Conversation;
  triggerMessage: Message;
  /**
   * Internal: how many auto-chained runs already happened in this turn.
   * Bounded to avoid infinite recursion when an agent delegates back and
   * forth. Set automatically on chained calls, callers shouldn't pass this.
   */
  chainDepth?: number;
  /** O chamador já segura o lock da conversa (fluxo de mensagens). */
  lockHeld?: boolean;
  /** "Engajar IA agora": pedido explícito do atendente, não passa pelo filtro de spam. */
  manual?: boolean;
}

const MAX_CHAIN_DEPTH = 3;

@Injectable()
export class AiAgentRunnerService {
  private readonly logger = new Logger(AiAgentRunnerService.name);

  private readonly runLock = new KvStore();

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly registry: ToolRegistry,
    private readonly promptBuilder: PromptBuilderService,
    private readonly modelRouter: ModelRouterService,
    private readonly httpExecutor: HttpToolExecutorService,
    private readonly sqlExecutor: SqlToolExecutorService,
    private readonly catalogSync: CatalogSyncService,
    private readonly notifications: NotificationsService,
    private readonly agentRouter: AgentRouterService,
    private readonly securityLayer: SecurityLayerService,
    private readonly retrieval: RetrievalService,
    private readonly realtime: RealtimeGateway,
    private readonly mediaUrlResolver: MediaUrlResolverService,
    private readonly playbooks: PlaybooksService,
    private readonly knowledge: KnowledgeService,
    @InjectQueue('memory-extractor')
    private readonly memoryExtractorQueue: Queue,
    @InjectQueue(AGENT_DEBOUNCE_QUEUE)
    private readonly agentDebounceQueue: Queue,
    @InjectQueue('rag-indexer')
    private readonly ragIndexerQueue: Queue,
    @Optional()
    @InjectQueue(INBOX_PUSH_QUEUE)
    private readonly inboxPushQueue?: Queue,
  ) {}

  /**
   * Tudo que roda dentro do run (classifier, reranker, tools que chamam LLM)
   * usa as chaves de IA da org da conversa.
   */
  async run(input: RunInput): Promise<void> {
    const exec = () => runWithLlmOrg(input.conversation.organizationId, () => this.runInOrg(input));
    if (input.lockHeld || (input.chainDepth ?? 0) > 0) return exec();

    // Watchdog e "ativar agente" no inbox chamam direto: sem o lock, dois
    // runs respondiam juntos na mesma conversa (mensagens misturadas).
    const conversationId = input.conversation.id;
    const token = randomUUID();
    if (!(await this.runLock.set(runLockKey(conversationId), token, { ttlMs: RUN_LOCK_TTL_MS, nx: true }))) {
      await this.runLock.set(followupKey(conversationId), '1', { ttlMs: FOLLOWUP_TTL_MS });
      this.logger.log(`Run skipped for conv ${conversationId}: another run in progress (follow-up flagged)`);
      return;
    }
    await this.runLock.del(followupKey(conversationId));
    try {
      await exec();
    } finally {
      await this.runLock.delIfEquals(runLockKey(conversationId), token).catch(() => undefined);
      // Mensagem chegou durante este run: responde tudo de uma vez.
      if (await this.runLock.del(followupKey(conversationId)).catch(() => 0)) {
        const job = debouncedRunJob(conversationId, 'followup');
        await this.agentDebounceQueue.add(job.name, job.data, job.opts).catch((err) =>
          this.logger.warn(`Re-arm debounce failed for conv ${conversationId}: ${err?.message ?? err}`),
        );
      }
    }
  }

  private async runInOrg({
    conversation,
    triggerMessage,
    chainDepth = 0,
    manual = false,
  }: RunInput): Promise<void> {
    // Nada novo do cliente desde a última resposta: não responde de novo.
    // Acontecia no "follow-up" — mensagem que chegou durante o run anterior
    // e que esse run já respondeu (a IA repetia a mesma pergunta).
    if (!manual && chainDepth === 0) {
      const recent = await this.prisma.message.findMany({
        where: {
          ...aiVisibleMessagesWhere(conversation.id, conversation.metadata),
          type: { notIn: ['REACTION', 'SYSTEM'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { direction: true, metadata: true, createdAt: true },
      });
      // Mensagens do robô de atendimento não contam: no fim do fluxo ele
      // passa pra IA justamente pra responder o que o cliente pediu.
      // Mas se a mensagem do cliente chegou depois que o run da última
      // resposta começou, aquele run não a viu ("Olá" + "quero um eSIM"
      // seguidos: respondia só o "Olá") — então responde.
      if (repliedSinceLastCustomerMessage(recent) && !(await this.unseenByLastReply(recent))) {
        this.logger.log(`Conv ${conversation.id}: no new customer message since the last reply — skipping run`);
        return;
      }
    }

    // Fase 2: usa o agentRouter (com IntentClassifier) pra escolher o agent.
    // Auto-chains (chainDepth > 0) NÃO classificam de novo — já tem activeAgentId.
    let selection: AgentSelection | null = null;
    if (chainDepth === 0) {
      const triggerText = savedMessageText(triggerMessage.content);
      // Contexto pro classifier: sem ele, respostas curtas que só fazem
      // sentido na conversa ("CPF: 804…", "não possui", número de pedido)
      // eram lidas como "mensagem sem sentido" → spam → IA calada.
      const before = await this.prisma.message.findMany({
        where: {
          conversationId: conversation.id,
          createdAt: { lt: triggerMessage.createdAt },
          type: { notIn: ['REACTION', 'SYSTEM'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 4,
        select: { direction: true, content: true },
      });
      const classifierContext = before
        .reverse()
        .map((m) => ({
          role: (m.direction === 'INBOUND' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: savedMessageText(m.content).slice(0, 300),
        }))
        .filter((m) => m.content);
      selection = await this.agentRouter.selectAgent(
        conversation,
        triggerText,
        classifierContext,
      );

      // Curto-circuito por intenção: spam/ruído com confiança alta não merece
      // rodar agente LLM nenhum. Só vale pra contato "frio" (nunca respondemos
      // essa conversa): no meio de um atendimento, ignorar o cliente em
      // silêncio custa muito mais que um run.
      const ongoingDialog = before.some((m) => m.direction === 'OUTBOUND');
      if (
        !manual &&
        !ongoingDialog &&
        selection?.classifiedIntent === IntentType.SPAM_OR_NOISE &&
        (selection.classifierConfidence ?? 0) >= SPAM_SKIP_CONFIDENCE
      ) {
        this.logger.log(
          `Conv ${conversation.id}: intent=SPAM_OR_NOISE (conf=${selection.classifierConfidence}) — skipping agent run`,
        );
        // A faixa de status mostra que a mensagem foi ignorada como spam.
        await this.runLock
          .set(spamSkipKey(conversation.id), triggerMessage.id, { ttlMs: 24 * 3_600_000 })
          .catch(() => undefined);
        return;
      }
    }
    const agent = selection
      ? await this.prisma.aiAgent.findFirst({
          where: { id: selection.agentId, isActive: true, deletedAt: null },
        })
      : await this.resolveAgent(conversation);
    if (!agent) {
      this.logger.debug(
        `No agent resolved for conv ${conversation.id} — skipping run`,
      );
      return;
    }

    const [organization, channel, contact, recentMessages, memory, catalog] =
      await Promise.all([
        this.prisma.organization.findUniqueOrThrow({
          where: { id: conversation.organizationId },
        }),
        this.prisma.channel.findUniqueOrThrow({
          where: { id: conversation.channelId },
        }),
        this.prisma.contact.findUniqueOrThrow({
          where: { id: conversation.contactId },
        }),
        // Só o que veio depois do último "limpar contexto da IA".
        this.prisma.message.findMany({
          where: aiVisibleMessagesWhere(conversation.id, conversation.metadata),
          orderBy: { createdAt: 'desc' },
          take: MAX_RECENT_MESSAGES,
        }),
        this.prisma.aiAgentMemory.findUnique({
          where: {
            agentId_contactId: {
              agentId: agent.id,
              contactId: conversation.contactId,
            },
          },
        }),
        // Compact product list for the cacheable system prompt block.
        // Source of truth: Trivapp /api/v1/catalog (5min in-memory cache).
        // Skill getProductPitch(slug) fetches full details on demand.
        this.catalogSync.getCompactCatalog(conversation.organizationId),
      ]);

    const run = await this.prisma.aiAgentRun.create({
      data: {
        organizationId: conversation.organizationId,
        conversationId: conversation.id,
        agentId: agent.id,
        triggerMessageId: triggerMessage.id,
        modelId: agent.modelId,
        status: AiRunStatus.RUNNING,
        classifiedIntent: selection?.classifiedIntent ?? null,
        classifierConfidence: selection?.classifierConfidence ?? null,
        skippedOrchestrator: selection?.skippedOrchestrator ?? false,
      },
    });

    // Realtime: powers the per-conversation agent-runs sidebar. Operators
    // see the run appear the instant we boot it, even before the first
    // tool call lands. Frontend joins `conv:<id>` while the chat is open.
    this.realtime.emitToConversation(conversation.id, 'ai:run:start', {
      conversationId: conversation.id,
      runId: run.id,
      agent: { id: agent.id, name: agent.name, kind: agent.kind },
      modelId: agent.modelId,
      startedAt: run.startedAt,
      classifiedIntent: selection?.classifiedIntent ?? null,
      classifierConfidence: selection?.classifierConfidence
        ? Number(selection.classifierConfidence)
        : null,
      triggerMessageId: triggerMessage.id,
    });

    // Resolve every tool the agent can call:
    //   1. built-in defaults filtered by kind (reply/transfer/tag/...);
    //   2. tools attached via skills (each skill.tools[]);
    //   3. tools attached directly to the agent (agent.extraTools).
    // Custom HTTP tools live in the DB; we keep their rows here so the
    // runner can hand them to HttpToolExecutor on tool-call time.
    // Opções do agente (modelParams): modo do prompt, pacotes de
    // ferramentas, limite de mensagens por turno. Fluxos ativos com
    // mensagens fixas liberam a ferramenta que as envia.
    const agentOptions = readAgentOptions(agent.modelParams);
    const playbooks = await this.playbooks.forAgent(conversation.organizationId, agent.id);
    const implicitToolsets = playbooks.some((p) => p.steps.length > 0) ? [FLOWS_TOOLSET] : [];

    const { llmTools, customSkillsByName, skillInstructions } =
      await this.resolveToolsAndSkills(agent.id, agent.kind, agentOptions, implicitToolsets);

    const startedAt = Date.now();

    // Resolve URLs playable de mídia (imagens etc) ANTES de construir
    // o prompt — o provider LLM precisa de URLs públicas pra image
    // blocks. Cache vive em Message.content.mediaUrl, então runs
    // subsequentes na mesma conversa não pagam de novo.
    const chronological = recentMessages.reverse();
    const channelTypeByConv = new Map<string, string>([
      [conversation.id, channel.type],
    ]);
    const mediaUrls = await this.mediaUrlResolver
      .resolveMany(chronological, channelTypeByConv)
      .catch((err) => {
        this.logger.warn(
          `media-url-resolver failed (run=${run.id}): ${err?.message ?? err}`,
        );
        return new Map<string, { url: string; mimeType?: string }>();
      });
    await this.mediaUrlResolver.inlineRecentImages(chronological, mediaUrls).catch(() => undefined);

    // Base de conhecimento: só o que bate com as últimas falas do cliente
    // entra no prompt (busca por texto no Postgres, sem custo de IA).
    const customerText = chronological
      .filter((m) => m.direction === 'INBOUND')
      .slice(-3)
      .map((m) => {
        const c = (m.content ?? {}) as { text?: unknown; caption?: unknown };
        return [c.text, c.caption].find((v) => typeof v === 'string') ?? '';
      })
      .join('\n');
    const knowledge = customerText.trim()
      ? await this.knowledge.search(conversation.organizationId, customerText, 3)
      : [];

    const messages = this.promptBuilder.buildMessages({
      organization,
      agent,
      channel,
      contact,
      conversation,
      recentMessages: chronological,
      mediaUrls,
      knowledge,
      firstReply: !chronological.some((m) => m.direction === 'OUTBOUND'),
      turnHints: this.turnHints(chronological, llmTools.map((t) => t.name)),
      customerLanguage: (() => {
        const lang = detectLanguage(
          chronological
            .filter((m) => m.direction === 'INBOUND')
            .slice(-15)
            .map((m) => String((m.content as { text?: unknown } | null)?.text ?? '')),
        );
        return lang === 'pt' ? undefined : lang;
      })(),
      memorySummary: memory?.summary ?? null,
      memoryFacts: (memory?.facts as Record<string, unknown>) ?? null,
      triggerMessage,
      skillInstructions,
      catalog,
      playbooks,
      flowsToolAvailable: implicitToolsets.includes(FLOWS_TOOLSET),
    });

    // Fase 2.5: augmenta o system message com Security Layer (prepend)
    // e RAG retrieval (append). Mantém o builder como source-of-truth da
    // estrutura principal do prompt — só decora com regras imutáveis e
    // contexto vetorial relevante do histórico longo do cliente.
    await this.augmentSystemPromptWithLayers(
      messages,
      organization,
      agentOptions,
      agent.id,
      conversation.contactId,
      conversation.id,
      this.extractText(triggerMessage.content as unknown),
    );

    const tools = llmTools;

    const aggregateUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    };

    let finalAction: AiFinalAction = AiFinalAction.NO_ACTION;
    let iterationCount = 0;
    const toolsCalled = new Set<string>();
    // Textos que a IA mandou e fluxos que ela enviou neste run (para achar
    // fluxo copiado na resposta sem enviar o resto — completeCopiedFlow).
    const replyTexts: string[] = [];
    const sentFlowSlugs = new Set<string>();
    let quoteNudgeUsed = false;
    let metaNudgeUsed = false;
    // Cotação calculada e nunca enviada (ex.: mandou só o fluxo verificar-esim
    // e encerrou): uma volta extra para enviar o texto.
    const quoteUnsent = () =>
      toolsCalled.has('cotacao_chip') &&
      !toolsCalled.has('replyToConversation') &&
      !quoteNudgeUsed &&
      finalAction !== AiFinalAction.TRANSFERRED_TO_HUMAN &&
      finalAction !== AiFinalAction.CLOSED_CONVERSATION;
    const nudgeQuote = () => {
      quoteNudgeUsed = true;
      this.logger.warn(`Run ${run.id}: cotacao_chip ran but the quote was never sent — nudging`);
      messages.push({
        role: 'user',
        content:
          '[instrução do sistema — não é mensagem do cliente] Você calculou a cotação com cotacao_chip mas não enviou ao cliente. Envie agora com replyToConversation o texto do TEMPLATE_PRONTO seguindo as regras dele (com a saudação, se for a primeira resposta). Não repita o fluxo já enviado.',
      });
    };
    let salesNudgeUsed = false;
    let promiseNudgeUsed = false;

    // Roteamento de modelo: por padrão o agente usa o modelo dele em tudo.
    // Com `modelParams.routing.primary`, as iterações de ferramenta rodam
    // nesse modelo (mais barato) e a resposta final de workers volta pro
    // modelo do agente.
    const agentKind = agent.kind as AgentKind;
    const modelParams =
      (agent.modelParams as Record<string, unknown> | null) ?? undefined;
    const toolModel = this.modelRouter.selectModel({
      agentKind,
      modelId: agent.modelId,
      modelParams,
      phase: 'tool',
    });
    const synthesisModel = this.modelRouter.selectModel({
      agentKind,
      modelId: agent.modelId,
      modelParams,
      phase: 'synthesis',
    });
    // Chave estável de cache de prefixo por conversa (system + histórico
    // idênticos entre turnos são reaproveitados pelo provedor).
    const cacheKey = `conv:${conversation.id}`;
    // Quando true, a próxima chamada usa o modelo de síntese (escala só a
    // resposta final, sem ter rodado as tools nele).
    let escalateSynthesis = false;
    // Modelo que de fato respondeu por último (`provedor/modelo`), gravado
    // no run no lugar do alias `default`.
    let servedModel: string | null = null;
    // Hard cap of 1 successful replyToConversation per run. The system
    // prompt encourages "uma ideia por mensagem" + multi-step consultative
    // selling, but the runner used to fire every reply back-to-back in
    // the same turn — customers saw 2 bubbles with redundant CTAs ("quer
    // o link?" repeated). We now let the LLM emit one reply, then any
    // subsequent replyToConversation gets a soft error so the model
    // tags / hands off / ends. Other tools (tag, handBack, transfer)
    // still run normally.
    // Agentes com `maxRepliesPerRun` > 1 (ex.: importados, que mandam a
    // cotação em várias bolhas) podem responder mais vezes no mesmo turno.
    let repliesSent = 0;

    try {
      // Mark this agent as the active one on the conversation.
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { activeAgentId: agent.id },
      });

      while (iterationCount < MAX_TOOL_ITERATIONS) {
        iterationCount++;

        const modelForCall = escalateSynthesis ? synthesisModel : toolModel;
        escalateSynthesis = false;

        this.emitStep(conversation.id, run.id, { kind: 'thinking', iteration: iterationCount });
        const response = await this.llm.complete({
          modelId: modelForCall,
          organizationId: conversation.organizationId,
          messages,
          tools,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          modelParams,
          cacheKey,
        });

        aggregateUsage.inputTokens += response.usage.inputTokens;
        aggregateUsage.outputTokens += response.usage.outputTokens;
        aggregateUsage.cacheReadTokens += response.usage.cacheReadTokens;
        aggregateUsage.cacheWriteTokens += response.usage.cacheWriteTokens;
        aggregateUsage.costUsd += response.usage.costUsd;
        servedModel = response.rawModelId;

        if (response.stopReason === 'stop' || !response.message.toolCalls?.length) {
          // Tools rodaram no modelo barato; se a síntese final deve ser num
          // modelo mais forte (worker), re-roda SÓ esta resposta final no
          // modelo de síntese e descarta a versão barata. Assim o modelo caro
          // não é pago nas iterações de tool.
          if (modelForCall === toolModel && synthesisModel !== toolModel) {
            escalateSynthesis = true;
            continue;
          }
          // Model ended its turn without further tool calls. Some models
          // (especially after a tool result) emit the response as plain
          // assistant text instead of using replyToConversation explicitly.
          // Auto-send that text as a reply so we don't drop work the model
          // already paid for. Skip if a final action already happened
          // (transferred / closed / delegated) or a reply was already sent.
          const rawText = this.extractText(response.message.content);
          const text = sanitizeAssistantText(rawText);
          if (rawText && rawText !== text) {
            this.logger.warn(
              `Run ${run.id}: stripped turn markers from fallback text (raw="${rawText.slice(0, 80)}" → clean="${text.slice(0, 80)}")`,
            );
          }
          // Bail out if the model only emitted turn markers (e.g. "Human:")
          // or a stub too short to be a real reply. Sending such text would
          // look like the agent literally typing "Human: oi" to the user.
          const tooShortForReal = text.length < 4;
          // Fluxo enviado (enviarMensagensDoFluxo) também marca REPLIED, mas
          // não é a resposta da IA: sem isso a cotação/boas-vindas escritas
          // depois do fluxo eram descartadas e o cliente só via o fluxo.
          const onlyFlowSent =
            finalAction === AiFinalAction.REPLIED && !toolsCalled.has('replyToConversation');
          if (text && !tooShortForReal && (finalAction === AiFinalAction.NO_ACTION || onlyFlowSent)) {
            this.logger.log(
              `Run ${run.id}: model emitted text without replyToConversation, auto-sending as fallback`,
            );
            try {
              const replyTool = this.registry.get('replyToConversation');
              const result = await replyTool.execute(
                { text },
                {
                  organizationId: conversation.organizationId,
                  conversationId: conversation.id,
                  contactId: conversation.contactId,
                  channelId: conversation.channelId,
                  agentId: agent.id,
                  runId: run.id,
                  triggerMessageId: triggerMessage.id,
                },
              );
              if (result.finalAction) {
                finalAction = result.finalAction as AiFinalAction;
              }
              if ((result.output as any)?.ok === true) {
                toolsCalled.add('replyToConversation');
                replyTexts.push(text);
              }
            } catch (err: any) {
              this.logger.error(
                `Run ${run.id}: fallback reply failed: ${err?.message ?? err}`,
              );
            }
          } else if (rawText && (tooShortForReal || !text)) {
            this.logger.warn(
              `Run ${run.id}: skipping fallback — sanitized text was empty or too short ("${rawText.slice(0, 80)}")`,
            );
          }
          // Nota interna em vez de resposta ("(respondendo pelo sistema: …)"):
          // não vai pro cliente — uma volta extra para responder de verdade.
          if (
            rawText.trim().length >= 4 &&
            !text &&
            !metaNudgeUsed &&
            finalAction === AiFinalAction.NO_ACTION &&
            !toolsCalled.has('replyToConversation')
          ) {
            metaNudgeUsed = true;
            messages.push({
              role: 'user',
              content:
                '[instrução do sistema — não é mensagem do cliente] Seu último texto era uma nota interna e NÃO foi enviado. Responda agora ao cliente, com replyToConversation, ao que ele disse por último (ex.: com o pedido confirmado, siga para a próxima etapa). Não comente sobre o sistema.',
            });
            continue;
          }

          // Sales-prep nudge: agent gathered offer info + purchase status
          // but never sent a reply — classic "thought-but-didn't-speak"
          // failure that leaves the customer hanging. Inject one synthetic
          // user reminder and re-iterate. Bounded by salesNudgeUsed to
          // avoid loops if the model still refuses.
          // Cotação calculada e nunca enviada (ex.: mandou só o fluxo
          // verificar-esim e encerrou): uma volta extra para enviar o texto.
          if (quoteUnsent()) {
            nudgeQuote();
            continue;
          }
          const calledSalesPrep = [...SALES_PREP_TOOLS].some((t) =>
            toolsCalled.has(t),
          );
          const neverReplied = !toolsCalled.has('replyToConversation');
          const stillNoAction = finalAction === AiFinalAction.NO_ACTION;
          if (
            calledSalesPrep &&
            neverReplied &&
            stillNoAction &&
            !salesNudgeUsed
          ) {
            salesNudgeUsed = true;
            this.logger.warn(
              `Run ${run.id}: sales-prep tools ran but no replyToConversation — nudging model for one more turn`,
            );
            messages.push({
              role: 'user',
              content:
                'Você rodou as tools de preparação (lookupOffering / checkPurchase) mas não chamou replyToConversation. O cliente está esperando. Responda agora com replyToConversation: 1 frase de pitch ligada à dor + preço + link do checkout (vindos do lookupOffering). Não termine este turn sem chamar replyToConversation.',
            });
            continue;
          }
          break;
        }

        // Cliente mandou mais mensagens enquanto esta resposta era montada
        // ("8 a 21 de novembro", "Samsung S26", "chega a tempo?"…): não manda
        // a resposta parcial — o run seguinte (já agendado) responde tudo junto.
        if (
          !manual &&
          response.message.toolCalls.some((c) => SPEAKING_TOOLS.has(c.name)) &&
          (await this.unseenInbound(conversation.id, chronological))
        ) {
          this.logger.log(`Run ${run.id}: new customer message arrived mid-run — holding the reply for the follow-up run`);
          break;
        }

        // Append the assistant's tool-calling turn so the model has it in
        // context when we feed back the tool results.
        messages.push(response.message);

        const toolResults = await this.executeToolCalls(
          response.message.toolCalls,
          {
            organizationId: conversation.organizationId,
            conversationId: conversation.id,
            contactId: conversation.contactId,
            channelId: conversation.channelId,
            agentId: agent.id,
            runId: run.id,
            triggerMessageId: triggerMessage.id,
          },
          customSkillsByName,
          { sent: repliesSent, max: agentOptions.maxRepliesPerRun },
          agent.kind,
          agentOptions,
          implicitToolsets,
        );

        const callsById = new Map((response.message.toolCalls ?? []).map((c) => [c.id, c]));
        for (const result of toolResults) {
          toolsCalled.add(result.toolName);
          const callArgs = callsById.get(result.toolCallId)?.arguments ?? {};
          if ((result.output as any)?.ok === true) {
            if (result.toolName === 'replyToConversation') replyTexts.push(String(callArgs.text ?? ''));
            if (result.toolName === 'enviarMensagensDoFluxo') sentFlowSlugs.add(String(callArgs.fluxo ?? ''));
          }
          messages.push({
            role: 'tool',
            toolCallId: result.toolCallId,
            name: result.toolName,
            content: JSON.stringify(result.output),
          });
          // Transferir/encerrar vence "respondeu": é comum o modelo mandar
          // a frase de transição e transferir no mesmo lote — sem isso o run
          // ficava como REPLIED e o loop seguia depois do handoff.
          if (
            result.finalAction &&
            (finalAction === AiFinalAction.NO_ACTION ||
              (finalAction === AiFinalAction.REPLIED && result.finalAction !== AiFinalAction.REPLIED))
          ) {
            finalAction = result.finalAction as AiFinalAction;
          }
          if (
            result.toolName === 'replyToConversation' &&
            (result.output as any)?.ok === true
          ) {
            repliesSent += bubblesSent(result.output);
          }
        }

        // Agente que manda várias mensagens por turno: depois de falar com o
        // cliente, só volta ao modelo se chegou informação nova (resultado de
        // consulta) depois da última fala. Sem isso, modelos menores ficam
        // reformulando a mesma pergunta a cada iteração até bater o limite.
        if (agentOptions.maxRepliesPerRun > 1 && spokeWithoutNewInfo(toolResults)) {
          // "Vou localizar o seu pedido…" sem ter chamado a consulta: parar
          // aqui deixa a promessa no ar até o cliente escrever de novo (e aí
          // a IA mistura a consulta com respostas antigas). Uma volta extra
          // pra cumprir o que disse.
          const promise = announcedAction(response.message.toolCalls ?? []);
          const transferPromise = !!promise && isTransferPromise(promise);
          const closingPromise = !!promise && isClosingPromise(promise);
          if (promise && !promiseNudgeUsed) {
            promiseNudgeUsed = true;
            this.logger.warn(`Run ${run.id}: reply announced an action ("${promise}") — one more turn to do it`);
            messages.push({
              role: 'user',
              content: closingPromise
                ? `[instrução do sistema — não é mensagem do cliente] Você disse ao cliente: "${promise}", mas não enviou nada. Se ele vai fechar aqui pelo WhatsApp: envie AGORA o fluxo \`fechamento-whatsapp\` (enviarMensagensDoFluxo) e chame escalar_para_humano (department vendas) com plano, preço, destino, período e tipo de chip. Se vai fechar pelo site: envie o fluxo do site (fechamento-site-virtual ou fechamento-site-fisico). Não mande outra mensagem dizendo que vai fazer.`
                : transferPromise
                ? `[instrução do sistema — não é mensagem do cliente] Você disse ao cliente: "${promise}", mas NÃO transferiu. Chame escalar_para_humano AGORA (reason com os detalhes para a equipe, motivo_cliente curto). NÃO mande outra mensagem ao cliente.`
                : `[instrução do sistema — não é mensagem do cliente] Você acabou de dizer ao cliente: "${promise}". Faça isso AGORA chamando a ferramenta adequada (ex.: consultar_pedido, consultar_ativacoes, enviar_instrucoes_roaming, escalar_para_humano) e responda com o resultado. Se a ferramenta exigir algo que o cliente ainda não informou, peça isso a ele em vez de prometer. Não repita o que já foi dito e não responda de novo perguntas que já respondeu.`,
            });
            continue;
          }
          // Prometeu transferir de novo, mesmo depois do aviso: o sistema
          // transfere (o cliente já ouviu que seria encaminhado).
          if (
            transferPromise &&
            finalAction !== AiFinalAction.TRANSFERRED_TO_HUMAN &&
            this.registry.has('escalar_para_humano')
          ) {
            this.logger.warn(`Run ${run.id}: promised a transfer twice without calling it — transferring`);
            const forced = await this.executeToolCalls(
              [
                {
                  id: `forced-transfer-${run.id}`,
                  name: 'escalar_para_humano',
                  arguments: {
                    reason: `A IA avisou o cliente que ia transferir ("${promise}") mas não chamou a transferência; transferido automaticamente. Veja o histórico.`,
                    department: 'suporte',
                    motivo_cliente: '',
                  },
                },
              ],
              {
                organizationId: conversation.organizationId,
                conversationId: conversation.id,
                contactId: conversation.contactId,
                channelId: conversation.channelId,
                agentId: agent.id,
                runId: run.id,
                triggerMessageId: triggerMessage.id,
              },
              customSkillsByName,
              { sent: repliesSent, max: agentOptions.maxRepliesPerRun },
              agent.kind,
              agentOptions,
              implicitToolsets,
            );
            if (forced.some((r) => r.finalAction === AiFinalAction.TRANSFERRED_TO_HUMAN)) {
              finalAction = AiFinalAction.TRANSFERRED_TO_HUMAN;
            }
          }
          // Mandou o fluxo mas a cotação já calculada ficou sem enviar.
          if (quoteUnsent()) {
            nudgeQuote();
            continue;
          }
          break;
        }

        // Hard short-circuit: handing off / closing the conversation should
        // stop the loop even if the model would have wanted another turn.
        if (
          finalAction === AiFinalAction.TRANSFERRED_TO_HUMAN ||
          finalAction === AiFinalAction.CLOSED_CONVERSATION
        ) {
          break;
        }
      }

      // Copiou uma mensagem de fluxo na resposta ("…Segue abaixo como
      // verificar:") sem chamar enviarMensagensDoFluxo: manda o resto do fluxo.
      if (finalAction === AiFinalAction.REPLIED && replyTexts.length > 0) {
        await this.completeCopiedFlow(playbooks, replyTexts, sentFlowSlugs, {
          organizationId: conversation.organizationId,
          conversationId: conversation.id,
          contactId: conversation.contactId,
          channelId: conversation.channelId,
          agentId: agent.id,
          runId: run.id,
          triggerMessageId: triggerMessage.id,
        }).catch((err) =>
          this.logger.warn(`Run ${run.id}: copied-flow completion failed: ${err?.message ?? err}`),
        );
      }

      const finishedAt = new Date();
      const durationMs = Date.now() - startedAt;
      await this.prisma.aiAgentRun.update({
        where: { id: run.id },
        data: {
          status: AiRunStatus.COMPLETED,
          finalAction,
          finishedAt,
          durationMs,
          ...(servedModel ? { modelId: servedModel } : {}),
          inputTokens: aggregateUsage.inputTokens,
          outputTokens: aggregateUsage.outputTokens,
          cacheReadTokens: aggregateUsage.cacheReadTokens,
          cacheWriteTokens: aggregateUsage.cacheWriteTokens,
          costUsd: aggregateUsage.costUsd,
        },
      });
      this.realtime.emitToConversation(conversation.id, 'ai:run:end', {
        conversationId: conversation.id,
        runId: run.id,
        status: AiRunStatus.COMPLETED,
        finalAction,
        errorMessage: null,
        finishedAt,
        durationMs,
        inputTokens: aggregateUsage.inputTokens,
        outputTokens: aggregateUsage.outputTokens,
        cacheReadTokens: aggregateUsage.cacheReadTokens,
        cacheWriteTokens: aggregateUsage.cacheWriteTokens,
        costUsd: aggregateUsage.costUsd,
      });

      // Push no celular: transferiu pra humano / pediu ajuda → a conversa
      // pode ter entrado em "IA para Humano" ou "IA Aguardando".
      if (this.inboxPushQueue) {
        const push = inboxPushJob(conversation.organizationId, conversation.id);
        trackBackground(
          this.inboxPushQueue.add(push.name, push.data, push.opts).catch((err) =>
            this.logger.warn(`inbox push enqueue failed for conv ${conversation.id}: ${err?.message ?? err}`),
          ),
        );
      }

      // Fase 2: enfileirar jobs assíncronos de memória + RAG
      // (fire-and-forget — falha não pode quebrar o run)
      trackBackground(this.scheduleAfterRunJobs(
        agent.id,
        conversation.id,
        conversation.contactId,
        triggerMessage,
        finalAction,
      ).catch((err) =>
        this.logger.warn(
          `Failed to schedule after-run jobs for run ${run.id}: ${err?.message ?? err}`,
        ),
      ));

      // Auto-chain: if this run delegated to a worker, immediately fire the
      // worker run so the customer gets the new agent's first message right
      // away — no need to wait for them to send something. The worker reads
      // the full history (including the orchestrator's "vou te passar pra X")
      // and starts speaking. Bounded by MAX_CHAIN_DEPTH to avoid recursion.
      if (
        finalAction === AiFinalAction.DELEGATED &&
        chainDepth < MAX_CHAIN_DEPTH
      ) {
        const refreshed = await this.prisma.conversation.findUnique({
          where: { id: conversation.id },
        });
        if (refreshed && refreshed.activeAgentId && refreshed.activeAgentId !== agent.id) {
          this.logger.log(
            `Auto-chaining run for new active agent ${refreshed.activeAgentId} on conv ${conversation.id} (depth ${chainDepth + 1})`,
          );
          // Fire-and-forget — don't block the caller. The worker runs
          // asynchronously and emits its messages via realtime as usual.
          trackBackground(this.run({
            conversation: refreshed,
            triggerMessage,
            chainDepth: chainDepth + 1,
          }).catch((err) =>
            this.logger.error(
              `Auto-chain run failed for conv ${conversation.id}: ${err?.message ?? err}`,
            ),
          ));
        }
      }
    } catch (err: any) {
      this.logger.error(
        `Agent run ${run.id} failed: ${err?.message ?? err}`,
        err?.stack,
      );
      const finishedAt = new Date();
      const durationMs = Date.now() - startedAt;
      const errorMessage = err?.message ?? String(err);
      await this.prisma.aiAgentRun.update({
        where: { id: run.id },
        data: {
          status: AiRunStatus.FAILED,
          errorMessage,
          finishedAt,
          durationMs,
          inputTokens: aggregateUsage.inputTokens,
          outputTokens: aggregateUsage.outputTokens,
          cacheReadTokens: aggregateUsage.cacheReadTokens,
          cacheWriteTokens: aggregateUsage.cacheWriteTokens,
          costUsd: aggregateUsage.costUsd,
        },
      });
      this.realtime.emitToConversation(conversation.id, 'ai:run:end', {
        conversationId: conversation.id,
        runId: run.id,
        status: AiRunStatus.FAILED,
        finalAction: null,
        errorMessage,
        finishedAt,
        durationMs,
        inputTokens: aggregateUsage.inputTokens,
        outputTokens: aggregateUsage.outputTokens,
        cacheReadTokens: aggregateUsage.cacheReadTokens,
        cacheWriteTokens: aggregateUsage.cacheWriteTokens,
        costUsd: aggregateUsage.costUsd,
      });
    }
  }

  /** Avisos para este turno, a partir do que o cliente acabou de pedir. */
  private turnHints(chronological: Message[], toolNames: string[]): string[] {
    const hints: string[] = [];
    const text = (m: Message) => String((m.content as { text?: unknown } | null)?.text ?? '');
    if (toolNames.includes('cotacao_chip')) {
      const lastInbound = [...chronological].reverse().find((m) => m.direction === 'INBOUND');
      const obs = lastObsPrice(
        chronological.filter((m) => m.direction === 'OUTBOUND').reverse().map(text),
      );
      if (lastInbound && asksForOtherPlans(text(lastInbound), obs)) {
        hints.push(
          'O cliente pediu outros planos (mais barato, sem ser ilimitado ou o valor citado na observação da cotação). Chame cotacao_chip AGORA com o mesmo destino, período e tipo da última cotação + franquiaApenas: true e envie a cotação completa que voltar. NÃO responda de memória, não descreva um plano solto e não pergunte se ele quer ver.',
        );
      }
    }
    // Cliente quer fechar aqui pelo WhatsApp e o PIX ainda não foi enviado:
    // a IA respondia as dúvidas, dizia "vou finalizar" e parava.
    if (toolNames.includes('enviarMensagensDoFluxo') && toolNames.includes('escalar_para_humano')) {
      const lastOutIdx = chronological.map((m) => m.direction).lastIndexOf('OUTBOUND');
      const newInbound = chronological.slice(lastOutIdx + 1).filter((m) => m.direction === 'INBOUND').map(text);
      const pixSent = chronological.some((m) => m.direction === 'OUTBOUND' && /chave\s+pix/i.test(text(m)));
      if (!pixSent && newInbound.some(wantsToCloseOnWhatsapp)) {
        hints.push(
          'O cliente quer fechar a compra AQUI pelo WhatsApp. Neste turno: responda em poucas palavras às dúvidas que ele mandou junto (se houver), envie o fluxo `fechamento-whatsapp` com enviarMensagensDoFluxo (dados do PIX) e logo depois chame escalar_para_humano (department vendas) com plano, preço, destino, período e tipo de chip. NÃO diga só "vou finalizar o pedido" sem enviar o fluxo.',
        );
      }
    }
    return hints;
  }

  /**
   * O que a IA está fazendo AGORA (antes de cada passo): pensando ou usando
   * uma ferramenta. A faixa de status da conversa mostra isso ao vivo.
   */
  private emitStep(
    conversationId: string,
    runId: string,
    step: { kind: 'thinking'; iteration: number } | { kind: 'tool'; toolName: string; input: unknown },
  ) {
    this.realtime.emitToConversation(conversationId, 'ai:run:step', { conversationId, runId, ...step });
  }

  /** Helper used by both code paths in executeToolCalls to keep the realtime
   *  shape in one place. Frontend appends to the matching run's toolCalls[]. */
  private emitToolCall(
    conversationId: string,
    runId: string,
    row: {
      id: string;
      toolName: string;
      input: unknown;
      output: unknown;
      error: string | null;
      durationMs: number | null;
      createdAt: Date;
    },
  ) {
    this.realtime.emitToConversation(conversationId, 'ai:run:tool-call', {
      conversationId,
      runId,
      toolCall: {
        id: row.id,
        toolName: row.toolName,
        input: row.input,
        output: row.output,
        error: row.error,
        durationMs: row.durationMs,
        createdAt: row.createdAt,
      },
    });
  }

  /**
   * Fluxo cuja mensagem a IA reproduziu na resposta sem enviar o fluxo: manda
   * as mensagens que faltam (as que já estão entre as últimas da conversa
   * não vão de novo).
   */
  private async completeCopiedFlow(
    playbooks: PlaybookWithSteps[],
    replies: string[],
    sentSlugs: Set<string>,
    ctx: ToolContext,
  ): Promise<void> {
    const pending = pendingFlowSteps(replies, playbooks, sentSlugs);
    if (!pending) return;
    // "Já enviado" só conta no contexto atual da IA e nas últimas 6h (mesma
    // regra do enviarMensagensDoFluxo): numa conversa com o contexto limpo, o
    // passo a passo enviado dias antes barrava o de agora.
    const conv = await this.prisma.conversation.findUnique({
      where: { id: ctx.conversationId },
      select: { metadata: true },
    });
    const since = new Date(Math.max(Date.now() - FLOW_RESEND_WINDOW_MS, aiContextResetAt(conv?.metadata)?.getTime() ?? 0));
    const recent = await this.prisma.message.findMany({
      where: { conversationId: ctx.conversationId, direction: MessageDirection.OUTBOUND, createdAt: { gt: since } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { content: true },
    });
    const recentOutbound = recent.map((m) => {
      const c = (m.content ?? {}) as Record<string, unknown>;
      const text = typeof c.text === 'string' ? c.text : typeof c.caption === 'string' ? c.caption : undefined;
      return { text, mediaUrl: typeof c.mediaUrl === 'string' ? c.mediaUrl : undefined };
    });
    // A IA acabou de escrever "Segue abaixo como verificar:": o fluxo vai
    // sempre, mesmo que já tenha saído antes (senão a frase fica sem nada).
    const steps = pending.promised ? pending.steps : pending.steps.filter((s) => !alreadySent(s, recentOutbound));
    if (steps.length === 0) return;
    const flowTool = this.registry.get('enviarMensagensDoFluxo') as unknown as Partial<SendFlowMessagesTool> | undefined;
    if (typeof flowTool?.sendSteps !== 'function') return;
    this.logger.log(
      `Run ${ctx.runId}: reply copied flow "${pending.playbook.slug}" without sending it — sending ${steps.length} remaining message(s)`,
    );
    await flowTool.sendSteps({ ...pending.playbook, steps }, ctx);
  }

  private async resolveAgent(conversation: Conversation) {
    if (conversation.activeAgentId) {
      const active = await this.prisma.aiAgent.findFirst({
        where: { id: conversation.activeAgentId, isActive: true, deletedAt: null },
      });
      if (active) return active;
    }
    // Hoje agents são auto-linkados a todos os canais. Sem prioridade,
    // qualquer worker AUTONOMOUS poderia capturar o primeiro turno e
    // ignorar a hierarquia. Sempre que houver ORCHESTRATOR no canal,
    // ele entra primeiro — ele decide quem delegar.
    const orchestratorLink = await this.prisma.aiAgentChannel.findFirst({
      where: {
        channelId: conversation.channelId,
        mode: 'AUTONOMOUS',
        agent: { isActive: true, deletedAt: null, kind: 'ORCHESTRATOR' },
      },
      include: { agent: true },
      orderBy: { createdAt: 'asc' },
    });
    if (orchestratorLink?.agent) return orchestratorLink.agent;

    // Fallback: nenhum orquestrador linkado → worker primeiro disponível.
    const workerLink = await this.prisma.aiAgentChannel.findFirst({
      where: {
        channelId: conversation.channelId,
        mode: 'AUTONOMOUS',
        agent: { isActive: true, deletedAt: null },
      },
      include: { agent: true },
      orderBy: { createdAt: 'asc' },
    });
    return workerLink?.agent ?? null;
  }

  private async executeToolCalls(
    calls: LlmToolCall[],
    ctx: ToolContext,
    customSkillsByName: Map<string, AiSkill & { tool: AiTool | null }>,
    replies: { sent: number; max: number },
    agentKind: 'ORCHESTRATOR' | 'WORKER',
    agentOptions: AgentOptions,
    implicitToolsets: string[],
  ): Promise<
    Array<{
      toolCallId: string;
      toolName: string;
      output: unknown;
      finalAction?: string;
    }>
  > {
    const results: Array<{
      toolCallId: string;
      toolName: string;
      output: unknown;
      finalAction?: string;
    }> = [];
    // Replies that went out in THIS batch. Combined with the cross-iteration
    // count, it blocks the extra reply even when the model emits two
    // replyToConversation calls in a single tool_use response.
    let repliedInThisBatch = 0;

    for (const call of calls) {
      const startedAt = Date.now();
      let output: unknown;
      let errorMessage: string | undefined;
      let finalAction: string | undefined;
      let audit: Record<string, unknown> | undefined;

      // Guard: at most `maxRepliesPerRun` successful replyToConversation
      // per run (default 1). The LLM sometimes "thinks aloud" by emitting
      // 2 replies in sequence — customer ends up with duplicate CTAs
      // ("posso te mandar o link?" twice). We let the model see a soft
      // error and gracefully end the turn (it usually pivots or stops).
      if (
        call.name === 'replyToConversation' &&
        replies.sent + repliedInThisBatch >= replies.max
      ) {
        this.logger.warn(
          `Run ${ctx.runId}: blocked duplicate replyToConversation — agent already replied this turn`,
        );
        const blockedOutput = {
          ok: false,
          error:
            'Already replied this turn. Do NOT call replyToConversation again — wait for the customer to react. End the turn now (you may still tag/handBack/transfer if needed).',
        };
        results.push({
          toolCallId: call.id,
          toolName: call.name,
          output: blockedOutput,
        });
        const blockedRow = await this.prisma.aiToolCall.create({
          data: {
            runId: ctx.runId,
            toolName: call.name,
            input: call.arguments as object,
            output: blockedOutput as object,
            error: 'duplicate-reply-blocked',
            durationMs: 0,
          },
        });
        this.emitToolCall(ctx.conversationId, ctx.runId, blockedRow);
        continue;
      }

      this.emitStep(ctx.conversationId, ctx.runId, { kind: 'tool', toolName: call.name, input: call.arguments });

      // Run + auto-retry on transient failures only. We retry once with a
      // short backoff when the error looks transient (network, timeout,
      // 5xx upstream). 4xx and logic errors aren't retried because they
      // won't fix themselves — better to let the LLM see the error and
      // decide (transferToHuman, etc).
      let attempts = 0;
      const maxAttempts = 2;
      while (attempts < maxAttempts) {
        attempts++;
        errorMessage = undefined;
        try {
          const customSkill = customSkillsByName.get(call.name);
          if (customSkill && customSkill.tool) {
            const result =
              customSkill.source === 'SQL'
                ? await this.sqlExecutor.execute(
                    customSkill,
                    customSkill.tool,
                    call.arguments,
                    ctx,
                  )
                : await this.httpExecutor.execute(
                    customSkill,
                    customSkill.tool,
                    call.arguments,
                    ctx,
                  );
            output = result.output;
            finalAction = result.finalAction;
            audit = (result as ToolResult).audit;
          } else if (
            this.registry.has(call.name) &&
            this.registry.isAllowedForAgent(
              call.name,
              agentKind,
              ctx.agentId,
              agentOptions,
              implicitToolsets,
            )
          ) {
            // Built-in (gate de kind + allowlist por agente, ex.: client-ops).
            const tool = this.registry.get(call.name);
            const result = await tool.execute(call.arguments, ctx);
            output = result.output;
            finalAction = result.finalAction;
            audit = (result as ToolResult).audit;
          } else {
            throw new Error(`Unknown tool: ${call.name}`);
          }
        } catch (err: any) {
          errorMessage = err?.message ?? String(err);
          output = { ok: false, error: errorMessage };
          this.logger.error(
            `Tool ${call.name} failed (attempt ${attempts}/${maxAttempts}): ${errorMessage}`,
          );
        }

        // Decide retry. If the call succeeded logically, exit the loop.
        // For failures, retry only when transient — don't punish the user
        // with a slower response for a 404 that won't recover.
        const failed =
          !!errorMessage ||
          isToolCallFailure({ error: errorMessage ?? null, output });
        if (!failed) break;
        if (attempts >= maxAttempts) break;
        if (!isTransientFailure(errorMessage, output)) break;
        await new Promise((r) => setTimeout(r, 500));
      }

      const toolCallRow = await this.prisma.aiToolCall.create({
        data: {
          runId: ctx.runId,
          toolName: call.name,
          input: call.arguments as object,
          // A auditoria fica só no log (o modelo recebe apenas `output`).
          output: (audit ? { resultado: output, _auditoria: audit } : output) as object,
          error: errorMessage,
          durationMs: Date.now() - startedAt,
        },
      });
      this.emitToolCall(ctx.conversationId, ctx.runId, toolCallRow);

      // Surface silent failures: notify the org's humans whenever a tool
      // call returns ok:false / status>=400 OR an exception was thrown.
      // Without this, the Lívia case happens — IA transfers and nobody sees.
      if (isToolCallFailure({ error: errorMessage ?? null, output })) {
        trackBackground(this.notifyToolFailure({
          ctx,
          toolName: call.name,
          input: call.arguments,
          output,
          errorMessage,
        }).catch((e) =>
          this.logger.warn(
            `Failed to dispatch tool-failure notification: ${e?.message ?? e}`,
          ),
        ));
      }

      results.push({
        toolCallId: call.id,
        toolName: call.name,
        output,
        finalAction,
      });

      if (
        call.name === 'replyToConversation' &&
        (output as any)?.ok === true
      ) {
        repliedInThisBatch += bubblesSent(output);
      }
    }

    return results;
  }

  /**
   * Notifies every member of the org that a skill produced a failure.
   * Background dispatch — a notification miss shouldn't break the run.
   * Body summarizes the skill, the conversation, and the error so the
   * human can act without digging into the runs feed first.
   */
  private async notifyToolFailure(args: {
    ctx: ToolContext;
    toolName: string;
    input: unknown;
    output: unknown;
    errorMessage?: string;
  }) {
    const { ctx, toolName, input, output, errorMessage } = args;
    const summary =
      errorMessage ??
      this.summarizeFailureOutput(output) ??
      'Erro desconhecido na skill';

    await this.notifications.notifyOrgAgents({
      organizationId: ctx.organizationId,
      type: NotificationType.AI_TOOL_FAILURE,
      title: `Skill ${toolName} falhou`,
      body: `Conversa atendida pela IA teve falha em ${toolName}: ${summary}`,
      data: {
        runId: ctx.runId,
        agentId: ctx.agentId,
        conversationId: ctx.conversationId,
        toolName,
        input,
        output,
        errorMessage: errorMessage ?? null,
      },
    });
  }

  /** Pulls a human-readable error string from the executor's output JSON. */
  private summarizeFailureOutput(output: unknown): string | null {
    if (!output || typeof output !== 'object') return null;
    const o = output as Record<string, any>;
    if (typeof o.error === 'string') return o.error;
    const body = o.body;
    if (body && typeof body === 'object') {
      if (typeof body.message === 'string') return body.message;
      if (typeof body.error === 'string') return body.error;
    }
    if (Number.isFinite(Number(o.status))) return `HTTP ${o.status}`;
    return null;
  }

  /**
   * Computes the full tool catalog for an agent run:
   *   - kind-scoped built-in defaults from the in-memory registry
   *   - tools attached via skills (with their prompt instructions)
   *   - tools attached directly to the agent (no skill)
   *
   * Returns:
   *   llmTools           — tool defs to send to the LLM (deduped by name)
   *   customToolsByName  — DB rows for HTTP tools, used by the executor
   *   skillInstructions  — prompt fragments to append to system message
   */
  private async resolveToolsAndSkills(
    agentId: string,
    kind: 'ORCHESTRATOR' | 'WORKER',
    agentOptions: AgentOptions,
    implicitToolsets: string[],
  ): Promise<{
    llmTools: LlmToolDefinition[];
    customSkillsByName: Map<string, AiSkill & { tool: AiTool | null }>;
    skillInstructions: string[];
  }> {
    const skillLinks = await this.prisma.aiAgentSkill.findMany({
      where: { agentId },
      include: { skill: { include: { tool: true } } },
    });

    const skillInstructions: string[] = [];
    const customSkillsByName = new Map<
      string,
      AiSkill & { tool: AiTool | null }
    >();

    for (const link of skillLinks) {
      const skill = link.skill;
      if (!skill.isActive || skill.deletedAt) continue;
      if (skill.promptInstructions) {
        skillInstructions.push(skill.promptInstructions.trim());
      }
      if (skill.source === 'BUILTIN') {
        // Built-in skills are always available via registry — no need to
        // expose again. We respect the attachment as user intent though
        // (could be used later for auditing).
        continue;
      }
      if (skill.tool) {
        customSkillsByName.set(skill.name, skill);
      } else {
        this.logger.warn(
          `Skill ${skill.name} (${skill.source}) has no bound tool — skipping`,
        );
      }
    }

    // Built-ins do agente: kind, allowlist (ex.: client-ops), pacotes
    // habilitados e ferramentas desligadas em modelParams.
    const defaultLlm = this.registry.getLlmDefinitionsForAgent(
      kind,
      agentId,
      agentOptions,
      implicitToolsets,
    );

    const seen = new Set<string>();
    const llmTools: LlmToolDefinition[] = [];
    for (const t of defaultLlm) {
      if (!seen.has(t.name)) {
        seen.add(t.name);
        llmTools.push(t);
      }
    }
    for (const [name, skill] of customSkillsByName) {
      if (!seen.has(name)) {
        seen.add(name);
        llmTools.push({
          name,
          description: skill.description,
          parameters: skill.parameters as Record<string, unknown>,
        });
      }
    }

    return { llmTools, customSkillsByName, skillInstructions };
  }

  /**
   * Extract plain text from an LlmMessage content. Handles both string
   * content and content blocks.
   */
  /**
   * Fase 2.5: augmenta o system message do prompt com:
   *   - Layer 1 SECURITY (prepend, cacheable): regras imutáveis da org
   *   - RAG retrieval (append, NÃO cacheable): top-K trechos relevantes do
   *     histórico longo do cliente, recuperados via similarity search
   *
   * Side-effect: muta `messages[0].content` in-place. Falhas no RAG são
   * silenciosas — agente continua respondendo só com contexto recente.
   */
  private async augmentSystemPromptWithLayers(
    messages: LlmMessage[],
    organization: { aiSecurityRules: unknown },
    agentOptions: AgentOptions,
    agentId: string,
    contactId: string,
    conversationId: string,
    triggerText: string,
  ): Promise<void> {
    const firstMsg = messages[0];
    if (!firstMsg || firstMsg.role !== 'system' || !Array.isArray(firstMsg.content)) {
      return;
    }

    // 1) Security Layer (cacheable — estável por org)
    const rules: SecurityRules = resolveSecurityRules(
      (organization.aiSecurityRules as Partial<SecurityRules> | null) ?? undefined,
    );
    const securityPart = {
      type: 'text' as const,
      text: this.securityLayer.build(rules).content,
      cache: true,
    };

    // 2) RAG retrieval (não cacheable — varia por turno)
    let ragPart: { type: 'text'; text: string; cache: false } | null = null;
    if (triggerText && triggerText.length >= 10) {
      try {
        const results = await this.retrieval.retrieve({
          query: triggerText,
          scope: {
            agentId,
            contactId,
            conversationId,
            ownerType: 'any',
          },
          k: 5,
          minScore: 0.7,
        });
        if (results.length > 0) {
          const lines = results
            .map(
              (r, i) =>
                `${i + 1}. [${r.entry.ownerType}, score=${r.score.toFixed(2)}] ${r.entry.content.slice(0, 240)}`,
            )
            .join('\n');
          ragPart = {
            type: 'text',
            text: `═══ Trechos relevantes do histórico (RAG) ═══\n${lines}\n\nUse esses trechos como memória de longo prazo. NÃO os cite literalmente — apenas demonstre que lembra do contexto.`,
            cache: false,
          };
        }
      } catch (err: any) {
        this.logger.warn(`RAG retrieval failed: ${err?.message ?? err}`);
      }
    }

    // Prompt independente: o agente traz as próprias regras de tom e
    // segurança (as padrão proíbem emoji, reticências etc. e brigariam com ele).
    firstMsg.content = [
      ...(agentOptions.promptMode === 'standalone' ? [] : [securityPart]),
      ...firstMsg.content,
      ...(ragPart ? [ragPart] : []),
    ];
  }

  /**
   * Fase 2: enfileira jobs assíncronos pós-run.
   *  - memory-extractor: o LLM extrai facts/summary atualizado e grava em AiAgentMemory
   *  - rag-indexer: gera embedding da mensagem do cliente e indexa em ai_vector_entries
   *
   * Ambos são fire-and-forget — falha aqui não pode interromper o agent run.
   */
  private async scheduleAfterRunJobs(
    agentId: string,
    conversationId: string,
    contactId: string,
    triggerMessage: Message,
    finalAction: AiFinalAction,
  ): Promise<void> {
    // Só extrai memória quando o agent realmente respondeu / agiu —
    // runs que falharam ou foram ignorados não têm sinal útil pra extrair.
    const shouldExtract =
      finalAction === AiFinalAction.REPLIED ||
      finalAction === AiFinalAction.DELEGATED ||
      finalAction === AiFinalAction.TRANSFERRED_TO_HUMAN ||
      finalAction === AiFinalAction.CLOSED_CONVERSATION;
    if (shouldExtract) {
      try {
        await this.memoryExtractorQueue.add(
          'extract_memory',
          { agentId, contactId, conversationId },
          { removeOnComplete: 100, removeOnFail: 50 },
        );
      } catch (err: any) {
        this.logger.warn(
          `memory-extractor enqueue failed: ${err?.message ?? err}`,
        );
      }
    }

    // RAG: indexa mensagem do cliente (não as do agent — economiza)
    const messageText = this.extractText(triggerMessage.content as unknown);
    if (messageText && messageText.length >= 10) {
      try {
        await this.ragIndexerQueue.add(
          'index_message',
          {
            type: 'index_message',
            messageId: triggerMessage.id,
            content: messageText,
            scope: { conversationId, agentId, contactId },
          },
          { removeOnComplete: 200, removeOnFail: 50 },
        );
      } catch (err: any) {
        this.logger.warn(
          `rag-indexer enqueue failed: ${err?.message ?? err}`,
        );
      }
    }
  }

  /**
   * "Sugerir resposta" (atendente): a mensagem que a IA mandaria agora, sem
   * enviar nada. Usa o mesmo prompt do agente; só ferramentas de consulta
   * (pedido, ativação, cotação, frete…) — nada que envie, transfira ou
   * encerre. Não cria run, não marca a IA como ativa.
   */
  async draftReply(
    conversationId: string,
    opts: { extraInfo?: string; useHistory?: boolean } = {},
  ): Promise<{ text: string; agentName: string }> {
    const conversation = await this.prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    return runWithLlmOrg(conversation.organizationId, async () => {
      const agent = await this.resolveAgent(conversation);
      if (!agent) throw new Error('Nenhum agente de IA atende este canal');
      const useHistory = opts.useHistory !== false;
      const extra = (opts.extraInfo ?? '').trim();
      if (!useHistory && !extra) throw new Error('Escreva o que a mensagem deve dizer');

      const [organization, channel, contact, recentMessages, memory, catalog] = await Promise.all([
        this.prisma.organization.findUniqueOrThrow({ where: { id: conversation.organizationId } }),
        this.prisma.channel.findUniqueOrThrow({ where: { id: conversation.channelId } }),
        this.prisma.contact.findUniqueOrThrow({ where: { id: conversation.contactId } }),
        this.prisma.message.findMany({
          where: aiVisibleMessagesWhere(conversation.id, conversation.metadata),
          orderBy: { createdAt: 'desc' },
          take: useHistory ? MAX_RECENT_MESSAGES : 1,
        }),
        this.prisma.aiAgentMemory.findUnique({
          where: { agentId_contactId: { agentId: agent.id, contactId: conversation.contactId } },
        }),
        this.catalogSync.getCompactCatalog(conversation.organizationId),
      ]);
      const chronological = recentMessages.reverse();
      const trigger = chronological[chronological.length - 1];
      if (!trigger) throw new Error('Conversa sem mensagens');

      const agentOptions = readAgentOptions(agent.modelParams);
      const playbooks = await this.playbooks.forAgent(conversation.organizationId, agent.id);
      const implicitToolsets = playbooks.some((p) => p.steps.length > 0) ? [FLOWS_TOOLSET] : [];
      const { llmTools } = await this.resolveToolsAndSkills(agent.id, agent.kind, agentOptions, implicitToolsets);
      const tools = llmTools.filter((t) => DRAFT_TOOLS.has(t.name));

      const mediaUrls = await this.mediaUrlResolver
        .resolveMany(chronological, new Map([[conversation.id, channel.type]]))
        .catch(() => new Map<string, { url: string; mimeType?: string }>());
      const messages = this.promptBuilder.buildMessages({
        organization,
        agent,
        channel,
        contact,
        conversation,
        recentMessages: useHistory ? chronological : [],
        mediaUrls,
        knowledge: [],
        firstReply: !chronological.some((m) => m.direction === 'OUTBOUND'),
        memorySummary: memory?.summary ?? null,
        memoryFacts: (memory?.facts as Record<string, unknown>) ?? null,
        triggerMessage: trigger,
        catalog,
        playbooks,
        flowsToolAvailable: false,
      });
      messages.push({
        role: 'user',
        content: [
          '[instrução do sistema — não é mensagem do cliente] MODO SUGESTÃO PARA O ATENDENTE.',
          useHistory
            ? 'Escreva a próxima mensagem que você mandaria ao cliente agora, seguindo todas as suas regras.'
            : 'Escreva uma mensagem ao cliente com base só na orientação do atendente abaixo, seguindo as suas regras de escrita.',
          extra ? `Orientação/informação do atendente (use na mensagem): ${extra}` : '',
          'Pode consultar pedido, ativação, cotação e frete com as ferramentas disponíveis. Responda SÓ com o texto da mensagem, pronto para enviar: sem comentários, sem aspas. Se você mandaria um fluxo, escreva o texto dele. Se você transferiria para a equipe, escreva a mensagem de aviso ao cliente. Várias mensagens: separe com uma linha só com "...".',
        ]
          .filter(Boolean)
          .join('\n'),
      });

      const ctx: ToolContext = {
        organizationId: conversation.organizationId,
        conversationId: conversation.id,
        contactId: conversation.contactId,
        channelId: conversation.channelId,
        agentId: agent.id,
        runId: '',
        triggerMessageId: trigger.id,
      };
      for (let i = 0; i < 6; i++) {
        const response = await this.llm.complete({
          modelId: agent.modelId,
          organizationId: conversation.organizationId,
          messages,
          tools: i < 5 && tools.length ? tools : undefined,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          modelParams: agent.modelParams as Record<string, unknown>,
        });
        const calls = response.message.toolCalls ?? [];
        if (calls.length === 0) {
          const text = humanizeDashes(sanitizeAssistantText(this.extractText(response.message.content)));
          if (!text) throw new Error('A IA não conseguiu sugerir uma mensagem');
          return { text, agentName: agent.name };
        }
        messages.push(response.message);
        for (const call of calls) {
          let output: unknown;
          try {
            output = DRAFT_TOOLS.has(call.name)
              ? (await this.registry.get(call.name).execute(call.arguments, ctx)).output
              : { ok: false, error: 'Ferramenta indisponível no modo sugestão. Escreva a mensagem.' };
          } catch (err) {
            output = { ok: false, error: (err as Error)?.message ?? String(err) };
          }
          messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify(output) });
        }
      }
      throw new Error('A IA não conseguiu sugerir uma mensagem');
    });
  }

  /**
   * Chegou mensagem do cliente que a IA não leu neste run? (comparação pelos
   * ids carregados no prompt — o horário vem do WhatsApp em segundos cheios.)
   */
  private async unseenInbound(conversationId: string, loaded: Message[]): Promise<boolean> {
    const newest = loaded.reduce<Date | null>((d, m) => (!d || m.createdAt > d ? m.createdAt : d), null);
    const m = await this.prisma.message.findFirst({
      where: {
        conversationId,
        direction: MessageDirection.INBOUND,
        type: { notIn: ['REACTION', 'SYSTEM'] },
        id: { notIn: loaded.map((x) => x.id) },
        ...(newest ? { createdAt: { gte: new Date(newest.getTime() - 60_000) } } : {}),
      },
      select: { id: true },
    });
    return !!m;
  }

  /** A última mensagem do cliente chegou depois do início do run que fez a última resposta da IA? */
  private async unseenByLastReply(
    recentNewestFirst: Array<{ direction: string; metadata: unknown; createdAt: Date }>,
  ): Promise<boolean> {
    const lastIn = recentNewestFirst.find((m) => m.direction === 'INBOUND');
    const lastOut = recentNewestFirst.find((m) => m.direction === 'OUTBOUND' && !isChatbotMessage(m.metadata));
    const runId = (lastOut?.metadata as { runId?: unknown } | null)?.runId;
    if (!lastIn || typeof runId !== 'string') return false;
    const run = await this.prisma.aiAgentRun.findUnique({ where: { id: runId }, select: { startedAt: true } });
    return !!run && lastIn.createdAt > run.startedAt;
  }

  private extractText(content: unknown): string {
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      return content
        .map((block: any) => (typeof block?.text === 'string' ? block.text : ''))
        .join('')
        .trim();
    }
    return '';
  }
}

/**
 * Texto de uma mensagem salva: `{ text }` (texto) ou `{ caption }` (mídia).
 * O classificador recebia "" por ler só string/array e marcava tudo como spam.
 */
export function savedMessageText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map(savedMessageText).join('').trim();
  if (content && typeof content === 'object') {
    const c = content as { text?: unknown; caption?: unknown };
    if (typeof c.text === 'string') return c.text.trim();
    if (typeof c.caption === 'string') return c.caption.trim();
  }
  return '';
}

interface LlmMessageWithToolCalls extends LlmMessage {
  toolCalls?: LlmToolCall[];
}

// sanitizeAssistantText vive em ./text-guards (importado no topo) pra
// ser reutilizado pelo replyToConversation tool — segunda linha de defesa
// que intercepta texto antes de chegar no provider.

/**
 * Tells whether a tool failure is worth retrying. Transient = upstream
 * blip the second attempt might dodge: connection drops, timeouts,
 * 5xx HTTP responses. Definitive failures (4xx, validation, missing
 * resource) won't recover so we bail immediately and let the agent
 * react.
 */
function isTransientFailure(
  errorMessage: string | undefined,
  output: unknown,
): boolean {
  // Exception thrown — check message for known transient signatures.
  if (errorMessage) {
    const m = errorMessage.toLowerCase();
    if (
      m.includes('timeout') ||
      m.includes('econnreset') ||
      m.includes('econnrefused') ||
      m.includes('etimedout') ||
      m.includes('socket hang up') ||
      m.includes('network') ||
      m.includes('fetch failed')
    ) {
      return true;
    }
    // status 5xx baked into the message
    if (/\b(50\d|429)\b/.test(m)) return true;
    return false;
  }
  // Logical failure — retry only if status is 5xx or 429.
  if (output && typeof output === 'object') {
    const status = Number((output as any).status);
    if (Number.isFinite(status) && (status >= 500 || status === 429)) {
      return true;
    }
  }
  return false;
}

/** Bolhas que um replyToConversation entregou (o modo independente divide em "..."). */
function bubblesSent(output: unknown): number {
  const n = Number((output as { messagesSent?: unknown })?.messagesSent);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * Ferramentas que falam com o cliente. Depois delas (sem consulta nova) o
 * turno acaba — senão a IA repete o que o fluxo acabou de perguntar.
 */
/** Ferramentas do "Sugerir resposta": só consulta (nada envia, transfere ou encerra). */
const DRAFT_TOOLS = new Set([
  'consultar_pedido',
  'pedidos_do_cliente',
  'consultar_ativacoes',
  'status_entrega',
  'consultar_seguro',
  'cotacao_chip',
  'cotacao_seguro',
  'calcular_frete',
  'consultar_cupom',
  'consultar_parceiro',
  'ultima_cotacao',
  'buscar_conhecimento',
]);

const SPEAKING_TOOLS = new Set(['replyToConversation', 'enviarMensagensDoFluxo', 'enviar_instrucoes_roaming']);

/** Ferramentas que não trazem informação nova pro modelo. */
const NO_NEW_INFO_TOOLS = new Set([
  'replyToConversation',
  'enviarMensagensDoFluxo',
  'enviar_instrucoes_roaming',
  'tagConversation',
  'addInternalNote',
  'set_label',
]);

/**
 * O lote terminou com o agente tendo falado (resposta ou mensagens de fluxo)
 * sem nenhuma consulta depois disso — não há o que acrescentar.
 */
/**
 * Frase de uma resposta que anuncia uma ação ainda não feita ("Vou localizar
 * o seu pedido…", "vou verificar"), ou null. Só olha replyToConversation.
 */
export function announcedAction(
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
): string | null {
  const PROMISE_RE =
    /\b(vou|irei|já vou|deixa eu|deixe-me|vamos|já te|já lhe)\s+(?:te\s+|lhe\s+)?(localizar|verificar|consultar|checar|buscar|conferir|olhar|ver|procurar|analisar|pesquisar|confirmar|enviar|mandar|passar|encaminhar|transferir|repassar|envio|mando|passo|encaminho|transfiro|repasso|finalizar|fechar|concluir|emitir|gerar)\b[^.!?\n]*/i;
  // "Encaminhando seu caso para o suporte…", "Estou verificando…": gerúndio
  // também é anúncio de ação que precisa de ferramenta.
  const DOING_RE =
    /(?:^|[.!?\n]\s*|\b(?:estou|já estou|to|tô)\s+)(?:te\s+|lhe\s+)?(encaminhando|transferindo|repassando|verificando|consultando|checando|localizando|procurando|enviando|finalizando|fechando)\b[^.!?\n]*/i;
  // "Perfeito. Encaminho para o suporte agora…": presente no começo da frase.
  const PRESENT_RE =
    /(?:^|[.!?\n]\s*)(?:j[áa]\s+)?(?:te\s+|lhe\s+)?(encaminho|transfiro|repasso|verifico|consulto)\b[^.!?\n]*/i;
  for (const call of toolCalls) {
    if (call.name !== 'replyToConversation') continue;
    const text = String(call.arguments?.text ?? '');
    const m = PROMISE_RE.exec(text) ?? DOING_RE.exec(text) ?? PRESENT_RE.exec(text);
    if (m) return m[0].replace(/^[.!?\n\s]+/, '').trim().slice(0, 160);
  }
  return null;
}

function isChatbotMessage(metadata: unknown): boolean {
  const m = (metadata ?? {}) as Record<string, unknown>;
  return !!m.chatbotFlowId || m.trigger === 'chatbot_end';
}

/**
 * Já respondemos tudo que o cliente mandou? (mensagens mais recentes
 * primeiro; as do robô de atendimento não contam como resposta.)
 */
export function repliedSinceLastCustomerMessage(
  recentNewestFirst: Array<{ direction: string; metadata?: unknown }>,
): boolean {
  const last = recentNewestFirst.find((m) => !isChatbotMessage(m.metadata));
  return last?.direction === 'OUTBOUND';
}

/** Promessa de fechar a compra ("Vou finalizar seu pedido pelo WhatsApp agora"). */
export function isClosingPromise(promise: string): boolean {
  return /\b(finaliz|fech|conclu|emit|ger)\w*/i.test(promise) && !/\b(encaminh|transfer|repass)\w*/i.test(promise);
}

/** Promessa de passar para a equipe ("Encaminhando seu atendimento ao suporte"). */
export function isTransferPromise(promise: string): boolean {
  return /\b(encaminh|transfer|repass)\w*/i.test(promise);
}

export function spokeWithoutNewInfo(
  results: Array<{ toolName: string; output: unknown }>,
): boolean {
  let spoke = false;
  for (const r of results) {
    const ok = (r.output as { ok?: unknown })?.ok === true;
    if (SPEAKING_TOOLS.has(r.toolName)) {
      if (ok) spoke = true;
    } else if (!NO_NEW_INFO_TOOLS.has(r.toolName)) {
      spoke = false;
    }
  }
  return spoke;
}
