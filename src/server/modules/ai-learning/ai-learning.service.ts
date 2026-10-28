import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AiHelpRequestStatus, MessageDirection, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { LlmService } from '../ai-agents/llm/llm.service';
import { runWithLlmOrg } from '../ai-agents/llm/llm-context';
import { DEFAULT_MODEL_ALIAS } from '../ai-agents/llm/llm.constants';
import type { LlmMessage } from '../ai-agents/llm/llm.types';
import { PlaybooksService } from '../ai-agents/playbooks/playbooks.service';
import { KnowledgeService } from '../ai-agents/knowledge/knowledge.service';
import { MessagesService } from '../messaging/messages/messages.service';
import {
  ExistingItems,
  HELP_JSON_SHAPE,
  LEARNING_SYSTEM_PROMPT,
  TEACH_JSON_SHAPE,
  appendRule,
  learnedRules,
  parseJsonObject,
  renderExisting,
} from './learning-prompt';
import { HelpDraft, Learning, learningProblems, normalizeLearning } from './learning.types';

/** Fluxos criados pelo aprendizado ficam neste grupo (Jarvis → Fluxos). */
export const LEARNED_FLOW_GROUP = 'Aprendido';

const textOf = (content: unknown): string => {
  const c = (content ?? {}) as { text?: unknown; caption?: unknown; fallbackText?: unknown };
  const t = [c.fallbackText, c.text, c.caption].find((v) => typeof v === 'string');
  return typeof t === 'string' ? t : '';
};

const br = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/**
 * Aprendizado da IA (Jarvis → Aprendizado):
 *  - casos em que a IA pediu ajuda: o admin orienta, a IA redige a resposta
 *    pro cliente + o aprendizado; aprovado, a resposta vai pro cliente, a
 *    conversa volta pra IA e o aprendizado é salvo (fluxo, conhecimento ou
 *    regra) — ativo na hora;
 *  - "Ensinar a IA": o admin escreve uma informação e a IA propõe onde
 *    guardar.
 */
@Injectable()
export class AiLearningService {
  private readonly logger = new Logger(AiLearningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly playbooks: PlaybooksService,
    private readonly knowledge: KnowledgeService,
    private readonly messages: MessagesService,
  ) {}

  // ─── Casos (pedir_ajuda) ──────────────────────────────────────────

  pendingCount(organizationId: string) {
    return this.prisma.aiHelpRequest.count({ where: { organizationId, status: AiHelpRequestStatus.PENDING } });
  }

  async listRequests(organizationId: string, status: AiHelpRequestStatus) {
    return this.prisma.aiHelpRequest
      .findMany({
        where: { organizationId, status },
        orderBy: { createdAt: status === AiHelpRequestStatus.PENDING ? 'asc' : 'desc' },
        take: 100,
        include: {
          conversation: {
            select: {
              id: true,
              status: true,
              contact: { select: { name: true, phone: true } },
              channel: { select: { name: true } },
            },
          },
        },
      })
      .catch((err) => {
        // P2021 = tabela não existe: o SQL do Aprendizado não foi aplicado no banco.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2021') {
          throw new ServiceUnavailableException(
            'A tabela de casos (ai_help_requests) não existe no banco: rode o SQL do Aprendizado (supabase-aprendizado-ia.sql)',
          );
        }
        throw err;
      });
  }

  /** Caso + trecho da conversa até agora (pra entender o que aconteceu). */
  async getRequest(organizationId: string, id: string) {
    const request = await this.prisma.aiHelpRequest.findFirst({
      where: { id, organizationId },
      include: {
        conversation: {
          select: {
            id: true,
            status: true,
            contact: { select: { name: true, phone: true } },
            channel: { select: { name: true } },
          },
        },
      },
    });
    if (!request) throw new NotFoundException('Caso não encontrado');
    const messages = await this.prisma.message.findMany({
      where: { conversationId: request.conversationId, type: { notIn: ['REACTION', 'SYSTEM'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, direction: true, content: true, senderName: true, createdAt: true },
    });
    return {
      ...request,
      messages: messages.reverse().map((m) => ({
        id: m.id,
        direction: m.direction,
        text: textOf(m.content) || '[mídia]',
        senderName: m.senderName,
        createdAt: m.createdAt,
      })),
    };
  }

  /** Gera a resposta pro cliente + a proposta de aprendizado. */
  async draftForRequest(organizationId: string, id: string, guidance: string) {
    const text = guidance.trim();
    if (!text) throw new BadRequestException('Escreva o que deve ser feito ou dito');
    const request = await this.getRequest(organizationId, id);
    if (request.status !== AiHelpRequestStatus.PENDING) throw new BadRequestException('Este caso já foi resolvido');

    const existing = await this.existingItems(organizationId, `${request.question}\n${text}`, request.agentId);
    const transcript = request.messages
      .map((m) => `${m.direction === MessageDirection.INBOUND ? 'Cliente' : (m.senderName ?? 'Atendimento')}: ${m.text}`)
      .join('\n')
      .slice(-6000);
    const user = [
      `## Conversa (mais recente por último)\n${transcript}`,
      `## O que a IA não soube\n${request.question}`,
      `## Orientação da equipe\n${text}`,
      renderExisting(existing),
      `## Formato da resposta (JSON)\n${HELP_JSON_SHAPE}`,
    ].join('\n\n');

    const json = await this.ask(organizationId, request.agentId, user);
    const draft: HelpDraft = {
      resumo: typeof json.resumo === 'string' ? json.resumo.trim() : '',
      resposta: (Array.isArray(json.resposta) ? json.resposta : [json.resposta])
        .filter((m): m is string => typeof m === 'string' && !!m.trim())
        .map((m) => m.trim()),
      aprendizado: normalizeLearning(json.aprendizado),
    };
    if (draft.aprendizado.tipo === 'REGRA' && !draft.aprendizado.agentId) draft.aprendizado.agentId = request.agentId;
    await this.prisma.aiHelpRequest.update({
      where: { id },
      data: { guidance: text, draft: draft as unknown as Prisma.InputJsonValue },
    });
    return { draft, existing };
  }

  /**
   * Aprovar: envia a resposta pro cliente, salva o aprendizado (ativo na
   * hora) e devolve a conversa pra IA.
   */
  async approveRequest(
    organizationId: string,
    id: string,
    userId: string,
    body: { resposta: string[]; aprendizado: unknown },
  ) {
    const request = await this.prisma.aiHelpRequest.findFirst({ where: { id, organizationId } });
    if (!request) throw new NotFoundException('Caso não encontrado');
    if (request.status !== AiHelpRequestStatus.PENDING) throw new BadRequestException('Este caso já foi resolvido');
    const reply = (body.resposta ?? []).map((m) => String(m ?? '').trim()).filter(Boolean);
    if (reply.length === 0) throw new BadRequestException('Escreva a resposta para o cliente');
    const learning = normalizeLearning(body.aprendizado);
    if (learning.tipo === 'REGRA' && !learning.agentId) learning.agentId = request.agentId;
    const problems = learningProblems(learning);
    if (problems.length) throw new BadRequestException(problems.join('; '));

    // 1. Aprendizado primeiro: se falhar, nada foi enviado ao cliente.
    const saved = await this.applyLearning(organizationId, userId, learning, request.id);

    // 2. Resposta pro cliente, em nome do admin (sem assinatura).
    for (const text of reply) {
      await this.messages.send(
        { conversationId: request.conversationId, type: 'TEXT', content: { text }, signatureName: null } as any,
        userId,
        organizationId,
      );
    }

    // 3. Conversa volta pra IA (o envio acima atribui ao admin e pode pausar a IA).
    await this.prisma.conversation.update({
      where: { id: request.conversationId },
      data: { aiEnabled: null, aiDisabledBy: null, aiDisabledAt: null, assignedToId: null },
    });
    await this.prisma.conversationAuditLog.create({
      data: {
        conversationId: request.conversationId,
        actorId: userId,
        action: 'AI_HELP_RESOLVED',
        metadata: { helpRequestId: id, learning: saved } as Prisma.InputJsonValue,
      },
    });

    return this.prisma.aiHelpRequest.update({
      where: { id },
      data: {
        status: AiHelpRequestStatus.RESOLVED,
        resolvedById: userId,
        resolvedAt: new Date(),
        resolution: { resposta: reply, aprendizado: learning, salvo: saved } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async dismissRequest(organizationId: string, id: string, userId: string) {
    const request = await this.prisma.aiHelpRequest.findFirst({ where: { id, organizationId } });
    if (!request) throw new NotFoundException('Caso não encontrado');
    return this.prisma.aiHelpRequest.update({
      where: { id },
      data: { status: AiHelpRequestStatus.DISMISSED, resolvedById: userId, resolvedAt: new Date() },
    });
  }

  // ─── Ensinar a IA (informação livre) ──────────────────────────────

  async draftTeach(organizationId: string, info: string, agentId?: string | null) {
    const text = info.trim();
    if (!text) throw new BadRequestException('Escreva a informação');
    const agent = agentId ? { id: agentId } : await this.defaultAgent(organizationId);
    const existing = await this.existingItems(organizationId, text, agent?.id ?? null);
    const user = [
      `## Informação que a equipe quer ensinar\n${text}`,
      renderExisting(existing),
      `## Formato da resposta (JSON)\n${TEACH_JSON_SHAPE}`,
    ].join('\n\n');
    const json = await this.ask(organizationId, agent?.id ?? null, user);
    const learning = normalizeLearning(json.aprendizado);
    if (learning.tipo === 'REGRA' && !learning.agentId) learning.agentId = agent?.id ?? null;
    return { aprendizado: learning, existing };
  }

  async applyTeach(organizationId: string, userId: string, raw: unknown) {
    const learning = normalizeLearning(raw);
    if (learning.tipo === 'NENHUM') throw new BadRequestException('Escolha onde guardar a informação');
    const problems = learningProblems(learning);
    if (problems.length) throw new BadRequestException(problems.join('; '));
    return this.applyLearning(organizationId, userId, learning, null);
  }

  // ─── O que já foi aprendido ───────────────────────────────────────

  async learned(organizationId: string) {
    const [knowledge, flows, agents] = await Promise.all([
      this.knowledge.list(organizationId),
      this.prisma.aiPlaybook.findMany({
        where: { organizationId, groupName: LEARNED_FLOW_GROUP },
        orderBy: { createdAt: 'desc' },
        include: { steps: { orderBy: { position: 'asc' } } },
      }),
      this.prisma.aiAgent.findMany({
        where: { organizationId, deletedAt: null },
        select: { id: true, name: true, systemPrompt: true, isActive: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      knowledge,
      flows,
      rules: agents
        .map((a) => ({ agentId: a.id, agentName: a.name, rules: learnedRules(a.systemPrompt) }))
        .filter((a) => a.rules.length > 0),
      agents: agents.filter((a) => a.isActive).map(({ id, name }) => ({ id, name })),
    };
  }

  /** Tira uma regra aprendida do prompt do agente. */
  async removeRule(organizationId: string, agentId: string, rule: string) {
    const agent = await this.prisma.aiAgent.findFirst({ where: { id: agentId, organizationId } });
    if (!agent) throw new NotFoundException('Agente não encontrado');
    const line = `- ${rule.trim()}`;
    const next = agent.systemPrompt
      .split('\n')
      .filter((l) => l.trim() !== line)
      .join('\n');
    await this.prisma.aiAgent.update({ where: { id: agentId }, data: { systemPrompt: next } });
    return { ok: true };
  }

  // ─── internos ─────────────────────────────────────────────────────

  /** Salva o aprendizado onde ele foi proposto. Devolve o que foi criado/alterado. */
  private async applyLearning(
    organizationId: string,
    userId: string,
    l: Learning,
    helpRequestId: string | null,
  ): Promise<{ tipo: string; id?: string; acao?: 'criado' | 'atualizado' } | null> {
    if (l.tipo === 'NENHUM') return null;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const origin = `Aprendido em ${br(new Date())}${user?.name ? ` — aprovado por ${user.name}` : ''}.`;

    if (l.tipo === 'FLUXO') {
      const steps = (l.mensagens ?? []).map((content) => ({ type: 'TEXT' as const, content }));
      const instructions = [l.instrucoes ?? '', `(${origin})`].filter(Boolean).join('\n');
      if (l.atualizar?.tipo === 'FLUXO') {
        const flow = await this.playbooks.update(organizationId, l.atualizar.id, {
          name: l.titulo!,
          trigger: l.gatilho!,
          instructions,
          steps,
          isActive: true,
        } as any);
        return { tipo: 'FLUXO', id: flow.id, acao: 'atualizado' };
      }
      const flow = await this.playbooks.create(organizationId, {
        name: l.titulo!,
        slug: await this.freeSlug(organizationId, l.titulo!),
        trigger: l.gatilho!,
        instructions,
        groupName: LEARNED_FLOW_GROUP,
        isActive: true,
        agentId: null,
        steps,
      } as any);
      return { tipo: 'FLUXO', id: flow.id, acao: 'criado' };
    }

    if (l.tipo === 'CONHECIMENTO' || l.tipo === 'TEMPORARIO') {
      const expiresAt = l.tipo === 'TEMPORARIO' && l.expira_em ? new Date(`${l.expira_em}T23:59:59-03:00`) : null;
      if (l.atualizar?.tipo === 'CONHECIMENTO') {
        const k = await this.knowledge.update(l.atualizar.id, organizationId, {
          title: l.titulo!,
          content: l.conteudo!,
          keywords: l.palavras_chave ?? '',
          isActive: true,
          expiresAt,
        });
        if (k) return { tipo: l.tipo, id: k.id, acao: 'atualizado' };
      }
      const k = await this.knowledge.create({
        organizationId,
        title: l.titulo!,
        content: l.conteudo!,
        keywords: l.palavras_chave ?? '',
        expiresAt,
        sourceHelpRequestId: helpRequestId,
        createdById: userId,
      });
      return { tipo: l.tipo, id: k.id, acao: 'criado' };
    }

    // REGRA → seção "Regras aprendidas" no prompt do agente.
    const agent = await this.prisma.aiAgent.findFirst({ where: { id: l.agentId!, organizationId } });
    if (!agent) throw new BadRequestException('Agente da regra não encontrado');
    await this.prisma.aiAgent.update({
      where: { id: agent.id },
      data: { systemPrompt: appendRule(agent.systemPrompt, l.regra!) },
    });
    return { tipo: 'REGRA', id: agent.id, acao: 'criado' };
  }

  /** Itens parecidos (pro modelo propor atualizar em vez de duplicar). */
  private async existingItems(organizationId: string, text: string, agentId: string | null): Promise<ExistingItems> {
    const [knowledge, flows, agent] = await Promise.all([
      this.knowledge.search(organizationId, text, 5),
      this.prisma.aiPlaybook.findMany({
        where: { organizationId, isActive: true },
        select: { id: true, name: true, trigger: true },
        orderBy: { sortOrder: 'asc' },
        take: 60,
      }),
      agentId
        ? this.prisma.aiAgent.findUnique({ where: { id: agentId }, select: { systemPrompt: true } })
        : Promise.resolve(null),
    ]);
    return {
      knowledge: knowledge.map(({ id, title, content }) => ({ id, title, content })),
      flows,
      rules: agent ? learnedRules(agent.systemPrompt) : [],
    };
  }

  private async ask(organizationId: string, agentId: string | null, user: string): Promise<Record<string, any>> {
    const agent = agentId
      ? await this.prisma.aiAgent.findUnique({ where: { id: agentId }, select: { modelId: true } })
      : null;
    const messages: LlmMessage[] = [
      { role: 'system', content: [{ type: 'text', text: LEARNING_SYSTEM_PROMPT, cache: true }] },
      { role: 'user', content: user },
    ];
    const resp = await runWithLlmOrg(organizationId, () =>
      this.llm.complete({
        modelId: agent?.modelId ?? DEFAULT_MODEL_ALIAS,
        messages,
        temperature: 0.2,
        maxTokens: 1500,
      }),
    );
    const raw =
      typeof resp.message.content === 'string'
        ? resp.message.content
        : resp.message.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('');
    const json = parseJsonObject(raw);
    if (!json) {
      this.logger.warn(`learning draft: resposta sem JSON: ${raw.slice(0, 300)}`);
      throw new BadRequestException('A IA não conseguiu montar a proposta — tente de novo');
    }
    return json;
  }

  private async defaultAgent(organizationId: string) {
    return this.prisma.aiAgent.findFirst({
      where: { organizationId, isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
  }

  private async freeSlug(organizationId: string, title: string): Promise<string> {
    const base =
      title
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 50) || 'aprendido';
    let slug = base;
    for (let i = 2; await this.prisma.aiPlaybook.findFirst({ where: { organizationId, slug }, select: { id: true } }); i++) {
      slug = `${base}-${i}`;
    }
    return slug;
  }
}
