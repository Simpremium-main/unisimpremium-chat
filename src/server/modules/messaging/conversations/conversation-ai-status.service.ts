import { Injectable } from '@nestjs/common';
import { AiFinalAction, AiRunStatus, Conversation, ConversationStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AgentRouterService } from '../../ai-agents/router/agent-router.service';
import { runLockKey, spamSkipKey } from '../../ai-agents/runner/agent-run-lock';
import { KvStore } from '../../../runtime/kv-store';
import { runtimePool } from '../../../runtime/pg';
import { AGENT_DEBOUNCE_QUEUE } from '../pipeline/agent-debounce.constants';
import { chatbotCompletion, chatbotSessionKey } from '../../chatbot/session/chatbot-session.keys';

/**
 * - RUNNING: a IA está gerando a resposta agora
 * - QUEUED:  mensagem recebida, IA espera o cliente terminar de digitar (debounce)
 * - ACTIVE:  IA ligada e pronta — aguardando mensagem ou já respondeu
 * - BLOCKED: IA não vai responder (motivo em `message`)
 * - ERROR:   a última tentativa falhou
 */
export type AiStatusState = 'RUNNING' | 'QUEUED' | 'ACTIVE' | 'BLOCKED' | 'ERROR';

export interface ConversationAiStatus {
  state: AiStatusState;
  /** Código estável (pra UI/ícone) — ex.: 'human-replied', 'outside-business-hours'. */
  reason: string;
  /** Frase pronta pro operador, em pt-BR. */
  message: string;
  agent: { id: string; name: string } | null;
  /** Quando o debounce dispara (QUEUED). */
  runAt?: string;
  lastRun?: {
    status: AiRunStatus;
    finalAction: AiFinalAction | null;
    errorMessage: string | null;
    finishedAt: Date | null;
  } | null;
}

const BLOCK_MESSAGES: Record<string, string> = {
  'channel.aiEnabled=force-off': 'IA desligada neste canal',
  'org.aiEnabled=false': 'IA desligada nas configurações gerais',
  'outside-business-hours': 'Fora do horário de atendimento da IA',
  'no-agent-for-channel': 'Nenhum agente de IA ligado a este canal',
  'monthly-token-cap-reached': 'Limite mensal de uso da IA atingido',
  'org-not-found': 'Organização não encontrada',
};

/**
 * "O que a IA está fazendo nesta conversa — e, se não vai responder, por quê."
 * Usa as mesmas regras do pipeline (AgentRouterService.shouldHandle, lock do
 * run e job de debounce), então o que a tela mostra é o que de fato acontece.
 */
@Injectable()
export class ConversationAiStatusService {
  private readonly kv = new KvStore();

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentRouter: AgentRouterService,
  ) {}

  async getStatus(conversation: Conversation): Promise<ConversationAiStatus> {
    const [agent, lastRun] = await Promise.all([
      this.resolveAgent(conversation),
      this.prisma.aiAgentRun.findFirst({
        where: { conversationId: conversation.id },
        orderBy: { startedAt: 'desc' },
        select: {
          status: true,
          finalAction: true,
          errorMessage: true,
          startedAt: true,
          finishedAt: true,
          agent: { select: { id: true, name: true } },
        },
      }),
    ]);
    const lastRunInfo = lastRun
      ? {
          status: lastRun.status,
          finalAction: lastRun.finalAction,
          errorMessage: lastRun.errorMessage,
          finishedAt: lastRun.finishedAt,
        }
      : null;
    const base = { agent, lastRun: lastRunInfo };

    // 1. Gerando resposta agora.
    if (await this.kv.exists(runLockKey(conversation.id))) {
      const runningAgent = lastRun?.status === AiRunStatus.RUNNING ? lastRun.agent : agent;
      return {
        ...base,
        agent: runningAgent ?? agent,
        state: 'RUNNING',
        reason: 'running',
        message: `${runningAgent?.name ?? 'IA'} está respondendo…`,
      };
    }

    // 2. Debounce armado: espera o cliente terminar de mandar mensagens.
    const pending = await this.pendingDebounce(conversation.id);
    if (pending) {
      return {
        ...base,
        state: 'QUEUED',
        reason: 'debounce',
        message: `${agent?.name ?? 'IA'} vai responder em instantes (aguardando o cliente terminar de digitar)`,
        runAt: pending.toISOString(),
      };
    }

    // 3. Regras de bloqueio (mesmas do pipeline).
    const decision = await this.agentRouter.shouldHandle(conversation);
    if (!decision.handle) {
      return { ...base, ...(await this.blocked(conversation, decision.reason ?? 'unknown', lastRun?.finalAction ?? null)) };
    }

    // 4. Ligada — o que aconteceu por último?
    const lastMessage = await this.prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        type: { notIn: ['REACTION', 'SYSTEM'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { direction: true, createdAt: true },
    });

    const inboundUnanswered =
      lastMessage?.direction === 'INBOUND' &&
      (!lastRun || lastRun.startedAt < lastMessage.createdAt);

    if (lastRun && !inboundUnanswered) {
      if (lastRun.status === AiRunStatus.FAILED) {
        return {
          ...base,
          state: 'ERROR',
          reason: 'last-run-failed',
          message: `A última tentativa da IA falhou${lastRun.errorMessage ? `: ${truncate(lastRun.errorMessage, 120)}` : ''}`,
        };
      }
      if (lastRun.finalAction === AiFinalAction.NO_ACTION && lastMessage?.direction === 'INBOUND') {
        return {
          ...base,
          state: 'ACTIVE',
          reason: 'no-action',
          message: 'A IA analisou a última mensagem e decidiu não responder',
        };
      }
    }

    if (conversation.isStuck) {
      return {
        ...base,
        state: 'ERROR',
        reason: 'stuck',
        message: 'A IA travou nesta conversa depois de várias tentativas — os gestores foram avisados',
      };
    }

    if (inboundUnanswered) {
      // A IA viu a mensagem e ignorou por parecer spam/ruído (contato novo).
      const lastInbound = await this.prisma.message.findFirst({
        where: { conversationId: conversation.id, direction: 'INBOUND' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      const skipped = await this.kv.get(spamSkipKey(conversation.id)).catch(() => null);
      if (skipped && skipped === lastInbound?.id) {
        return {
          ...base,
          state: 'ACTIVE',
          reason: 'spam-skipped',
          message:
            'A IA ignorou a última mensagem por parecer spam ou sem conteúdo — use "Engajar IA agora" para responder mesmo assim',
        };
      }
      return {
        ...base,
        state: 'ACTIVE',
        reason: 'inbound-unanswered',
        message:
          'Última mensagem do cliente ainda sem resposta da IA — use "Engajar IA agora" no menu da IA para responder',
      };
    }

    if (conversation.status === ConversationStatus.CLOSED) {
      return {
        ...base,
        state: 'ACTIVE',
        reason: 'closed',
        message: `Conversa encerrada — ${agent?.name ?? 'a IA'} responde se o cliente escrever de novo`,
      };
    }

    return {
      ...base,
      state: 'ACTIVE',
      reason: 'waiting-customer',
      message: `${agent?.name ?? 'IA'} ativa — aguardando mensagem do cliente`,
    };
  }

  private async blocked(
    conversation: Conversation,
    reason: string,
    lastFinalAction: AiFinalAction | null,
  ): Promise<Pick<ConversationAiStatus, 'state' | 'reason' | 'message'>> {
    if (reason === 'conversation.aiEnabled=force-off') {
      if (conversation.aiDisabledBy) {
        const user = await this.prisma.user.findUnique({
          where: { id: conversation.aiDisabledBy },
          select: { name: true },
        });
        const when = conversation.aiDisabledAt ? ` às ${formatTime(conversation.aiDisabledAt)}` : '';
        return {
          state: 'BLOCKED',
          reason: 'paused-by-human',
          message: `IA pausada nesta conversa — ${user?.name ?? 'um atendente'} assumiu${when}`,
        };
      }
      const bot = chatbotCompletion(conversation.metadata);
      if (bot?.handoff === 'HUMAN' && bot.reason === 'flow') {
        return {
          state: 'BLOCKED',
          reason: 'chatbot-to-human',
          message: 'O robô de atendimento encerrou o fluxo e passou a conversa para um atendente — IA pausada',
        };
      }
      if (lastFinalAction === AiFinalAction.TRANSFERRED_TO_HUMAN) {
        return {
          state: 'BLOCKED',
          reason: 'transferred-to-human',
          message: 'A IA transferiu a conversa para um atendente humano',
        };
      }
      return { state: 'BLOCKED', reason: 'paused', message: 'IA pausada nesta conversa' };
    }
    if (reason === 'chatbot-active') {
      const raw = await this.kv.get(chatbotSessionKey(conversation.id));
      const flowId = raw ? (JSON.parse(raw) as { flowId?: string }).flowId : null;
      const flow = flowId
        ? await this.prisma.chatbotFlow.findUnique({ where: { id: flowId }, select: { name: true } })
        : null;
      return {
        state: 'BLOCKED',
        reason,
        message: `Robô de atendimento${flow ? ` ("${flow.name}")` : ''} conduzindo a conversa — a IA só entra se o fluxo terminar passando para ela`,
      };
    }
    return {
      state: 'BLOCKED',
      reason,
      message: BLOCK_MESSAGES[reason] ?? 'A IA não vai responder nesta conversa',
    };
  }

  /** Agente que atende: o fixado na conversa ou o AUTONOMOUS do canal. */
  private async resolveAgent(conversation: Conversation): Promise<{ id: string; name: string } | null> {
    if (conversation.activeAgentId) {
      const agent = await this.prisma.aiAgent.findUnique({
        where: { id: conversation.activeAgentId },
        select: { id: true, name: true },
      });
      if (agent) return agent;
    }
    const link = await this.prisma.aiAgentChannel.findFirst({
      where: {
        channelId: conversation.channelId,
        mode: 'AUTONOMOUS',
        agent: { isActive: true, deletedAt: null },
      },
      select: { agent: { select: { id: true, name: true } } },
    });
    return link?.agent ?? null;
  }

  /** Job de debounce pendente (fila em Postgres) → quando dispara. */
  private async pendingDebounce(conversationId: string): Promise<Date | null> {
    const { rows } = await runtimePool().query<{ run_at: Date }>(
      `SELECT run_at FROM queue_jobs
        WHERE queue = $1 AND dedup_id = $2 AND state IN ('waiting', 'delayed')
        ORDER BY run_at DESC LIMIT 1`,
      [AGENT_DEBOUNCE_QUEUE, `agent-run:${conversationId}`],
    );
    return rows[0]?.run_at ?? null;
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatTime(date: Date): string {
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
