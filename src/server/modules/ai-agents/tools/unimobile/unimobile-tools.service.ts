import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import type { ImpactLevel } from '../../confirmations/confirmation.types';
import { OutboundSenderService } from '../outbound-sender.service';
import { AiTool, ToolContext, ToolResult } from '../tool.types';
import { UnimobileClient, UnimobileCredentials, UnimobileUnavailableError } from './unimobile.client';
import {
  describeLine,
  isFullIccid,
  normalizeIccid,
  parseTariff,
  withoutPrices,
  zonesCovering,
} from './unimobile-format';

export const UNIMOBILE_TOOLSET = 'unimobile';

type Obj = Record<string, unknown>;
type Handler = (input: Obj, ctx: ToolContext) => Promise<ToolResult>;

const obj = (properties: Obj, required: string[] = []) => ({ type: 'object', properties, required });
const ICCID = { type: 'string', description: 'ICCID completo da linha (começa com 89, 19 ou 20 dígitos)' };
const SOLICITANTE = {
  type: 'string',
  description: 'Nome de quem pediu, exatamente como aparece entre colchetes na conversa (em grupo). Fica registrado na solicitação.',
};

/** Ações que mudam a linha/pedido: só executam com a confirmação "SIM <código>" de quem pediu. */
export const UNIMOBILE_ACTIONS: Record<string, { impact: ImpactLevel; label: (a: Obj) => string }> = {
  uni_reenviar_email: { impact: 'low', label: (a) => `Reenviar o e-mail de instalação da linha ${a.iccid}` },
  uni_ativar_linha: { impact: 'medium', label: (a) => `Ativar agora a linha ${a.iccid}` },
  uni_recarregar: { impact: 'high', label: (a) => `Recarga de ${a.gb} GB na linha ${a.iccid}` },
  uni_estender_plano: { impact: 'high', label: (a) => `Estender a linha ${a.iccid} para a tarifa ${a.nova_tarifa}` },
  uni_alterar_pedido: { impact: 'medium', label: (a) => `Alterar dados do pedido da linha ${a.iccid}` },
  uni_cancelar_pedido: { impact: 'critical', label: (a) => `Cancelar o pedido da linha ${a.iccid} (não tem volta)` },
  uni_reiniciar_linha: { impact: 'high', label: (a) => `Reiniciar a linha ${a.iccid}` },
  uni_criar_pedido: { impact: 'high', label: (a) => `Criar pedido ${String(a.tipo).toUpperCase()} ${a.tarifa} para ${a.nome}, início ${a.data_inicio}` },
};

/** Validade do código de confirmação. */
export const CONFIRMATION_TTL_MS = 30 * 60_000;

const SEM_ICCID = {
  ok: false,
  instrucao: 'Peça o ICCID completo da linha (19 ou 20 dígitos, começa com 89). iPhone: Ajustes → Geral → Sobre. Android: Configurações → Sobre o telefone → Status do SIM.',
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Ferramentas da API de linhas da Uni Mobile (pacote "unimobile").
 *
 *  - Consultas: executam direto.
 *  - Ações (reenviar e-mail, ativar, recarregar, estender, alterar, cancelar,
 *    reiniciar, novo pedido): a ferramenta registra a solicitação e manda no
 *    grupo um código ("responda SIM 4821"). Quem confere a confirmação é o
 *    sistema, não a IA (`handleConfirmation`, chamado pelo pipeline de
 *    mensagens): vale o código certo, de qualquer pessoa da conversa, em até
 *    30 min (fica registrado quem confirmou).
 *    Confirmado, executa na API na hora e avisa o resultado na conversa.
 *    O registro fica em ai_pending_actions (fora da lista de aprovação do app)
 *    e aparece em Solicitações.
 *
 * Em grupo a IA não recebe dados do titular nem códigos de instalação.
 */
@Injectable()
export class UnimobileToolsService {
  private readonly logger = new Logger(UnimobileToolsService.name);
  readonly tools: AiTool[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: UnimobileClient,
    private readonly sender: OutboundSenderService,
  ) {
    this.tools = [
      // ─── consultas ──────────────────────────────────────────────
      this.tool(
        'uni_consultar_linha',
        'Consulta linhas eSIM/CHIP da Uni Mobile: status, plano, franquia, datas de início e fim e número. Busca pelo ICCID completo (melhor), pelo e-mail da compra ou pelos últimos dígitos do ICCID. Use ANTES de responder qualquer pergunta sobre uma linha.',
        obj({
          iccid: ICCID,
          email: { type: 'string', description: 'E-mail usado na compra' },
          final_iccid: { type: 'string', description: 'Últimos dígitos do ICCID (mínimo 4)' },
        }),
        (input, ctx) => this.consultarLinha(input, ctx),
      ),
      this.tool(
        'uni_consumo_linha',
        'Consumo de dados da linha (resumo e detalhe). Pode não estar disponível na API: nesse caso diga que o consumo não aparece no sistema no momento.',
        obj({ iccid: ICCID }, ['iccid']),
        (input, ctx) => this.porIccid(ctx, input, async (creds, iccid) => {
          const [resumo, detalhe] = await Promise.all([
            this.api.request(creds, 'GET', `/orders/usageSummary/${iccid}`),
            this.api.request(creds, 'GET', `/orders/usageDetails/${iccid}`).catch(() => null),
          ]);
          const vazio = (r: Obj | null) => !r || (Array.isArray(r.Data) && !(r.Data as unknown[]).length) || /not avaliable|not available/i.test(String(r.Message ?? ''));
          if (vazio(resumo as Obj)) return { disponivel: false, aviso: 'Consumo não disponível no sistema no momento.' };
          return { disponivel: true, resumo: resumo.Data, detalhe: vazio(detalhe as Obj) ? null : detalhe?.Data };
        }),
      ),
      this.tool(
        'uni_historico_linha',
        'Histórico do pedido da linha (mudanças de status, extensões). Pode não estar disponível na API.',
        obj({ iccid: ICCID }, ['iccid']),
        (input, ctx) => this.porIccid(ctx, input, async (creds, iccid) => {
          const r = await this.api.request(creds, 'GET', `/orders/orderHistory/${iccid}`);
          const vazio = !r.Data || (Array.isArray(r.Data) && !r.Data.length) || /not avaliable|not available/i.test(String(r.Message ?? ''));
          return vazio ? { disponivel: false, aviso: 'Histórico não disponível no sistema no momento.' } : { disponivel: true, historico: r.Data };
        }),
      ),
      this.tool(
        'uni_pacotes_recarga',
        'Pacotes de recarga (GB) que podem ser aplicados a uma linha ativa. Não informe preço: o valor é confirmado pela equipe.',
        obj({ iccid: ICCID }, ['iccid']),
        (input, ctx) => this.porIccid(ctx, input, async (creds, iccid) => {
          const r = await this.api.request<Obj[]>(creds, 'GET', `/orders/topupPackages/${iccid}`);
          if (r.Result !== 'Ok') return { ok: false, motivo: r.Message };
          return { ok: true, pacotes: withoutPrices(r.Data ?? []), observacao: 'Para recarregar, use uni_recarregar com o valor topUp (GB) escolhido.' };
        }),
      ),
      this.tool(
        'uni_cobertura',
        'Diz se um destino (país em qualquer idioma, código ISO ou região) tem cobertura e em qual zona, com os países da zona.',
        obj({ destino: { type: 'string', description: 'País ou região, ex.: Itália, Europa, US' } }, ['destino']),
        async (input, ctx) => {
          const creds = await this.creds(ctx);
          const r = await this.api.cachedGet<Obj[]>(creds, '/catalog/countriesCoverage', 3_600_000);
          const zonas = zonesCovering(Array.isArray(r.Data) ? r.Data : [], String(input.destino ?? ''));
          if (!zonas.length) return { output: { coberto: false, destino: input.destino } };
          return {
            output: {
              coberto: true,
              zonas: zonas.map((z) => {
                const paises = (Array.isArray(z.countries_data) ? (z.countries_data as Obj[]) : []).map((c) => c.country_br ?? c.country_en);
                return {
                  zona: z.zone_code,
                  nome: z.zone_name_br ?? z.zone_name_en,
                  paises: paises.length > 40 ? `${paises.slice(0, 40).join(', ')} e mais ${paises.length - 40}` : paises.join(', '),
                };
              }),
            },
          };
        },
      ),
      this.tool(
        'uni_planos',
        'Planos (tarifas) disponíveis, com dias, franquia e código da tarifa. Filtre por zona (ex.: EUR) ou destino. Não informe preço. Use o código da tarifa em uni_estender_plano ou uni_criar_pedido.',
        obj({
          zona: { type: 'string', description: 'Código da zona, ex.: EUR, USA' },
          destino: { type: 'string', description: 'País ou região (alternativa à zona)' },
          dias: { type: 'integer', description: 'Dias de viagem, para ordenar pelos mais próximos' },
          tipo: { type: 'string', enum: ['esim', 'chip'] },
        }),
        async (input, ctx) => {
          const creds = await this.creds(ctx);
          let zonas: string[] = input.zona ? [String(input.zona).toUpperCase()] : [];
          if (!zonas.length && input.destino) {
            const cov = await this.api.cachedGet<Obj[]>(creds, '/catalog/countriesCoverage', 3_600_000);
            zonas = zonesCovering(Array.isArray(cov.Data) ? cov.Data : [], String(input.destino)).map((z) => String(z.zone_code));
            if (!zonas.length) return { output: { encontrado: false, destino: input.destino } };
          }
          const r = await this.api.cachedGet<Obj[]>(creds, '/catalog/plans', 3_600_000);
          const dias = Number(input.dias) || 0;
          const tipo = input.tipo ? String(input.tipo).toUpperCase() : null;
          const planos = (Array.isArray(r.Data) ? r.Data : [])
            .filter((p) => !zonas.length || zonas.includes(String(p.zone_code ?? parseTariff(p.tariff_sku).zona)))
            .filter((p) => !tipo || String(p.tariff_sku ?? '').endsWith(tipo))
            .map((p) => ({
              plano: p.title,
              tarifa: p.tariff_sku,
              zona: p.zone_code,
              dias: p.days,
              franquia: p.capacity === 'Unlimited' ? 'Ilimitado' : p.capacity,
            }))
            .sort((a, b) => (dias ? Math.abs(Number(a.dias) - dias) - Math.abs(Number(b.dias) - dias) : Number(a.dias) - Number(b.dias)))
            .slice(0, 12);
          return { output: { encontrado: planos.length > 0, planos } };
        },
      ),
      this.tool(
        'uni_compatibilidade',
        'Verifica se um celular (marca e modelo) está na lista de aparelhos compatíveis com eSIM.',
        obj({ aparelho: { type: 'string', description: 'Marca e modelo, ex.: Samsung Galaxy S23' } }, ['aparelho']),
        async (input, ctx) => {
          const creds = await this.creds(ctx);
          const r = await this.api.cachedGet<Array<{ brand: string; models: string[] }>>(creds, '/catalog/compatibleDevices', 6 * 3_600_000);
          return { output: matchDevice(Array.isArray(r.Data) ? r.Data : [], String(input.aparelho ?? '')) };
        },
      ),

      // ─── ações: confirmadas por código, executadas na hora ──────
      this.action(
        'uni_reenviar_email',
        'Reenvia ao e-mail do titular os dados de instalação do eSIM/CHIP (linha pendente ou ativa). É o jeito de entregar o QR code sem expor no grupo.',
        obj({ iccid: ICCID, solicitante: SOLICITANTE }, ['iccid']),
      ),
      this.action(
        'uni_ativar_linha',
        'Ativa agora uma linha PENDENTE cuja data de início é hoje ou ontem (ex.: o viajante já chegou ao destino). Consulte a linha antes.',
        obj({ iccid: ICCID, solicitante: SOLICITANTE }, ['iccid']),
      ),
      this.action(
        'uni_recarregar',
        'Recarga de dados (GB) numa linha ATIVA. Use uni_pacotes_recarga para ver os pacotes (1, 3, 5 ou 10 GB).',
        obj({ iccid: ICCID, gb: { type: 'integer', description: 'GB do pacote (valor topUp)' }, solicitante: SOLICITANTE }, ['iccid', 'gb']),
      ),
      this.action(
        'uni_estender_plano',
        'Estende o plano da linha (pendente, ativa ou já estendida) para outra tarifa da MESMA zona e tipo com MAIS dias. Pegue o código da nova tarifa em uni_planos.',
        obj({ iccid: ICCID, nova_tarifa: { type: 'string', description: 'Código da nova tarifa (ex.: EUR_030D_ILIM_SODA_UNIG_ESIM)' }, solicitante: SOLICITANTE }, ['iccid', 'nova_tarifa']),
      ),
      this.action(
        'uni_alterar_pedido',
        'Altera nome, e-mail, documento, países e data de início do pedido (a data de início só muda enquanto a linha está pendente). Informe só o que muda; o resto é mantido.',
        obj({
          iccid: ICCID,
          nome: { type: 'string' },
          email: { type: 'string' },
          documento: { type: 'string' },
          data_inicio: { type: 'string', description: 'AAAA-MM-DD' },
          paises: { type: 'string', description: 'Códigos ISO separados por vírgula, ex.: ES,FR' },
          solicitante: SOLICITANTE,
        }, ['iccid']),
      ),
      this.action(
        'uni_cancelar_pedido',
        'Cancela o pedido da linha (pendente ou ativa, até 3 dias depois da data de início). Não tem volta.',
        obj({ iccid: ICCID, motivo: { type: 'string' }, solicitante: SOLICITANTE }, ['iccid']),
      ),
      this.action(
        'uni_reiniciar_linha',
        'Reinicia uma linha ATIVA (último recurso quando a linha não conecta depois das orientações).',
        obj({ iccid: ICCID, motivo: { type: 'string' }, solicitante: SOLICITANTE }, ['iccid']),
      ),
      this.action(
        'uni_criar_pedido',
        'Cria um pedido novo de eSIM ou CHIP. Precisa de: tipo (esim/chip), tarifa (código de uni_planos, terminando em ESIM ou CHIP conforme o tipo), data de início (hoje ou depois), nome e documento do titular (5+ caracteres) e e-mail. CHIP exige o ICCID do chip físico.',
        obj({
          tipo: { type: 'string', enum: ['esim', 'chip'] },
          tarifa: { type: 'string' },
          data_inicio: { type: 'string', description: 'AAAA-MM-DD' },
          nome: { type: 'string' },
          email: { type: 'string' },
          documento: { type: 'string' },
          paises: { type: 'string', description: 'Códigos ISO separados por vírgula (opcional)' },
          iccid: { type: 'string', description: 'Só para CHIP: ICCID do chip físico' },
          eid: { type: 'string', description: 'Opcional (eSIM): EID do aparelho; exige imei e imei2' },
          imei: { type: 'string' },
          imei2: { type: 'string' },
          solicitante: SOLICITANTE,
        }, ['tipo', 'tarifa', 'data_inicio', 'nome', 'email', 'documento']),
      ),
    ];
  }

  // ─── consultas ────────────────────────────────────────────────────

  private async consultarLinha(input: Obj, ctx: ToolContext): Promise<ToolResult> {
    const creds = await this.creds(ctx);
    const group = await this.isGroup(ctx);
    const iccid = normalizeIccid(input.iccid);
    const email = String(input.email ?? '').trim().toLowerCase();
    const tail = normalizeIccid(input.final_iccid).replace(/[VF]$/, '');

    if (isFullIccid(iccid)) {
      const r = await this.api.request<Obj[]>(creds, 'GET', `/orders/iccidDetail/${iccid}`);
      if (r.Result !== 'Ok' || !Array.isArray(r.Data) || !r.Data.length) {
        return { output: { encontrado: false, iccid, instrucao: 'Não existe linha com esse ICCID nesta conta. Peça para conferir o número (19 ou 20 dígitos, começa com 89).' } };
      }
      const listed = await this.listedOrder(creds, (o) => normalizeIccid(o.iccId) === iccid);
      return { output: { encontrado: true, quantidade: 1, linhas: [describeLine(r.Data[0], listed, { group })] } };
    }

    if (!email && tail.length < 4) return { output: SEM_ICCID };

    let orders: Obj[];
    try {
      orders = await this.orders(creds);
    } catch (err) {
      if (err instanceof UnimobileUnavailableError) {
        return { output: { encontrado: false, aviso: 'A busca por e-mail ou final do ICCID não está disponível no sistema agora.', ...SEM_ICCID } };
      }
      throw err;
    }
    const matches = orders
      .filter((o) =>
        email
          ? String(o.email ?? '').trim().toLowerCase() === email
          : normalizeIccid(o.iccId).replace(/[VF]$/, '').endsWith(tail),
      )
      .sort((a, b) => String(b.init_date ?? '').localeCompare(String(a.init_date ?? '')))
      .slice(0, 5);
    if (!matches.length) {
      return { output: { encontrado: false, instrucao: email ? 'Nenhuma linha com esse e-mail. Peça para conferir o e-mail (erros de digitação são comuns) ou o ICCID.' : 'Nenhuma linha termina com esses dígitos. Peça o ICCID completo.' } };
    }
    const linhas = await Promise.all(
      matches.map(async (o) => {
        const d = await this.api.request<Obj[]>(creds, 'GET', `/orders/iccidDetail/${normalizeIccid(o.iccId)}`).catch(() => null);
        return describeLine(Array.isArray(d?.Data) ? (d!.Data[0] ?? null) : null, o, { group });
      }),
    );
    return {
      output: {
        encontrado: true,
        quantidade: linhas.length,
        linhas,
        ...(linhas.length > 1 ? { instrucao: 'Mais de uma linha: pergunte qual é a da viagem atual (país ou datas) antes de seguir.' } : {}),
      },
    };
  }

  /** `ordersList` (cache de 90 s). Sem o endpoint, lança UnimobileUnavailableError. */
  private async orders(creds: UnimobileCredentials): Promise<Obj[]> {
    const r = await this.api.cachedGet<Obj[]>(creds, '/orders/ordersList', 90_000);
    if (r.Result !== 'Ok') throw new Error(`ordersList: ${r.Message}`);
    return Array.isArray(r.Data) ? r.Data : [];
  }

  /** Pedido do `ordersList` para completar a data de início (sem o endpoint, null). */
  private async listedOrder(creds: UnimobileCredentials, match: (o: Obj) => boolean): Promise<Obj | null> {
    try {
      return (await this.orders(creds)).find(match) ?? null;
    } catch {
      return null;
    }
  }

  private async porIccid(
    ctx: ToolContext,
    input: Obj,
    run: (creds: UnimobileCredentials, iccid: string) => Promise<unknown>,
  ): Promise<ToolResult> {
    const iccid = normalizeIccid(input.iccid);
    if (!isFullIccid(iccid)) return { output: SEM_ICCID };
    try {
      return { output: await run(await this.creds(ctx), iccid) };
    } catch (err) {
      if (err instanceof UnimobileUnavailableError) return { output: { disponivel: false, aviso: 'Essa consulta não está disponível no sistema agora.' } };
      throw err;
    }
  }

  // ─── ações ────────────────────────────────────────────────────────

  /**
   * Registra a ação e manda no grupo o pedido de confirmação com um código.
   * Nada é executado aqui: só quando alguém responder "SIM <código>".
   */
  private action(name: string, description: string, parameters: Obj): AiTool {
    const full = `${description} Não pergunte "confirma?": a ferramenta registra a solicitação e já manda no grupo a mensagem com o código; a ação só acontece quando alguém do grupo responder SIM + código. Com várias solicitações, chame uma vez para cada uma.`;
    return this.tool(name, full, parameters, async (input, ctx) => {
      const problem = await this.validateAction(name, input, ctx);
      if (problem) return { output: { ok: false, ...problem } };

      const requester = await this.requester(ctx, input.solicitante);
      const { solicitante: _s, ...args } = input;
      if (args.iccid) args.iccid = normalizeIccid(args.iccid);
      const spec = UNIMOBILE_ACTIONS[name];
      const label = spec.label(args);

      // Mesma ação já esperando confirmação: reaproveita o código.
      const open = await this.openActions(ctx.conversationId);
      const same = open.find((r) => r.toolName === name && JSON.stringify(r.args) === JSON.stringify(args));
      const code = same ? String((same.preview as Obj).code) : this.newCode(open);

      if (!same) {
        await this.prisma.aiPendingAction.create({
          data: {
            agentRunId: ctx.runId,
            conversationId: ctx.conversationId,
            agentId: ctx.agentId,
            toolName: name,
            args: args as object,
            preview: {
              action: label,
              impact: spec.impact,
              channel: 'whatsapp',
              code,
              requesterKey: requester.key,
              requesterName: requester.name,
              requestMessageId: requester.messageId,
            } as object,
            expiresAt: new Date(Date.now() + CONFIRMATION_TTL_MS),
          },
        });
      }

      await this.notifyCtx(
        ctx,
        `🔐 *${label}*\nPara confirmar, responda *SIM ${code}* (vale por 30 minutos).`,
      );
      this.logger.log(`unimobile ${name} aguardando confirmação ${code} (conv ${ctx.conversationId})`);
      return {
        output: {
          ok: true,
          status: 'aguardando_confirmacao',
          codigo: code,
          instrucao:
            'A mensagem com o código de confirmação JÁ foi enviada na conversa. Não repita o código nem diga que foi feito. A ação será executada automaticamente quando alguém responder SIM + código.',
        },
      };
    });
  }

  /** Erros de dados antes de pedir confirmação (a API rejeitaria depois). */
  private async validateAction(name: string, a: Obj, ctx: ToolContext): Promise<Obj | null> {
    if (name !== 'uni_criar_pedido' && !isFullIccid(a.iccid)) return SEM_ICCID;
    if (name === 'uni_recarregar' && ![1, 3, 5, 10].includes(Number(a.gb))) {
      return { instrucao: 'Pacotes de recarga: 1, 3, 5 ou 10 GB (veja uni_pacotes_recarga).' };
    }
    if (name === 'uni_estender_plano' && String(a.nova_tarifa ?? '').length !== 28) {
      return { instrucao: 'Código de tarifa inválido: use o código exato de uni_planos (28 caracteres).' };
    }
    if (name === 'uni_criar_pedido') {
      const tipo = String(a.tipo ?? '').toLowerCase();
      if (!['esim', 'chip'].includes(tipo)) return { instrucao: 'Tipo deve ser esim ou chip.' };
      if (!String(a.tarifa ?? '').toUpperCase().endsWith(tipo.toUpperCase())) return { instrucao: `A tarifa precisa terminar em ${tipo.toUpperCase()}.` };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.data_inicio ?? '')) || String(a.data_inicio) < today()) return { instrucao: 'Data de início no formato AAAA-MM-DD, de hoje em diante.' };
      if (String(a.nome ?? '').trim().length < 5 || String(a.documento ?? '').trim().length < 5) return { instrucao: 'Nome e documento do titular precisam de pelo menos 5 caracteres.' };
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(a.email ?? ''))) return { instrucao: 'E-mail do titular inválido.' };
      if (tipo === 'chip' && !isFullIccid(a.iccid)) return { instrucao: 'Pedido de CHIP precisa do ICCID do chip físico.' };
      if (a.eid && (!a.imei || !a.imei2)) return { instrucao: 'Com EID, informe também IMEI e IMEI2.' };
    }
    // reseller_id: exigido por recarga, extensão, alteração, cancelamento e novo pedido.
    const needsReseller = ['uni_recarregar', 'uni_estender_plano', 'uni_alterar_pedido', 'uni_cancelar_pedido', 'uni_criar_pedido'];
    if (needsReseller.includes(name) && !this.api.credentials(await this.partner(ctx)).resellerId) {
      return { instrucao: 'Essa ação não está configurada no sistema (falta o reseller_id). Passe para a equipe.' };
    }
    return null;
  }

  /**
   * Confirmação no WhatsApp: "SIM 4821" (ou "sim" citando a mensagem do
   * código). Chamado pelo pipeline para cada mensagem recebida; true =
   * a mensagem era uma confirmação e foi tratada (a IA não roda nela).
   */
  async handleConfirmation(messageId: string): Promise<boolean> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.direction !== 'INBOUND') return false;
    const text = messageText(message.content);
    const code = await this.confirmationCode(message.conversationId, text, message.metadata);
    if (!code) return false;

    const open = await this.openActions(message.conversationId);
    const record = open.find((r) => (r.preview as Obj).code === code);
    // Código já usado (confirmação repetida) ou expirado: ignora em silêncio.
    if (!record && (await this.recentCode(message.conversationId, code))) {
      return !open.length || this.notifyExpired(message.conversationId, code, open[0]);
    }
    // Sem nenhuma solicitação aberta, "sim 1234" é conversa normal.
    if (!open.length) return false;
    const ctx = await this.ctxFor(message.conversationId, record);
    if (!record) {
      if (ctx) await this.notifyCtx(ctx, `Não encontrei uma solicitação aberta com o código ${code} (pode ter expirado). Peça de novo, por favor.`).catch(() => undefined);
      return true;
    }
    // Qualquer pessoa do grupo pode confirmar; fica registrado quem confirmou.
    const confirmedBy = message.senderName?.trim() || senderKey(message);

    // Uma confirmação só: quem chegar primeiro leva (mensagens duplicadas não executam 2x).
    const claimed = await this.prisma.aiPendingAction.updateMany({
      where: { id: record.id, status: 'PENDING' },
      data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: confirmedBy },
    });
    if (claimed.count === 0) return true;

    try {
      const result = await this.executeAction(record);
      await this.prisma.aiPendingAction.update({
        where: { id: record.id },
        data: { status: 'EXECUTED', executionResult: { ...result, confirmationMessageId: message.id } as object },
      });
    } catch (err: any) {
      await this.prisma.aiPendingAction.update({
        where: { id: record.id },
        data: {
          status: 'REJECTED',
          rejectedAt: new Date(),
          rejectedReason: String(err?.message ?? err).slice(0, 500),
          executionResult: { ok: false, error: String(err?.message ?? err), confirmationMessageId: message.id } as object,
        },
      });
    }
    return true;
  }

  /** Código de "SIM 4821", ou de "sim" citando a mensagem do código. */
  private async confirmationCode(conversationId: string, text: string, metadata: unknown): Promise<string | null> {
    const direct = /^\s*(?:sim|s|yes|ok|confirmo|confirmado|confirmar)\b[\s,.:!-]*(\d{4})\b/i.exec(text);
    if (direct) return direct[1];
    if (!/^\s*(?:sim|s|yes|ok|confirmo|confirmado|confirmar)\b/i.test(text)) return null;
    const quoted = (metadata as { replyTo?: { externalMessageId?: string } | null } | null)?.replyTo?.externalMessageId;
    if (!quoted) return null;
    const original = await this.prisma.message.findFirst({
      where: { conversationId, externalId: quoted, direction: 'OUTBOUND' },
      select: { content: true },
    });
    return /SIM (\d{4})/.exec(messageText(original?.content))?.[1] ?? null;
  }

  /** Executa a ação confirmada na API e avisa o resultado na conversa. */
  async executeAction(record: { toolName: string; args: unknown; conversationId: string; agentId: string; agentRunId: string }): Promise<Obj> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: record.conversationId },
      select: { organizationId: true, contactId: true, channelId: true, metadata: true },
    });
    if (!conv) throw new Error('Conversa não existe mais');
    const a = (record.args ?? {}) as Obj;
    const creds = this.api.credentials(groupPartner(conv.metadata));
    const iccId = normalizeIccid(a.iccid);
    const reseller = creds.resellerId;
    const label = UNIMOBILE_ACTIONS[record.toolName]?.label(a) ?? record.toolName;
    const ctx: ToolContext = {
      organizationId: conv.organizationId,
      conversationId: record.conversationId,
      contactId: conv.contactId,
      channelId: conv.channelId,
      agentId: record.agentId,
      runId: record.agentRunId,
    };

    let r: Obj;
    try {
      r = await this.callApi(record.toolName, a, creds, iccId, reseller);
    } catch (err: any) {
      await this.notifyCtx(ctx, `⚠️ ${label}: não foi possível concluir agora (${err?.message ?? 'erro na API'}). A equipe vai verificar.`).catch(() => undefined);
      throw err;
    }
    await this.api.invalidateOrders(creds);

    const ok = r.Result === 'Ok';
    const created = record.toolName === 'uni_criar_pedido' && ok ? (r.Data as Obj | undefined) : undefined;
    const extra =
      record.toolName === 'uni_ativar_linha' && ok
        ? ' O sinal pode levar alguns minutos; reiniciar o celular ajuda.'
        : created?.iccId
          ? ` ICCID da nova linha: ${created.iccId}. Os dados de instalação vão para o e-mail do titular.`
          : '';
    const text = ok
      ? `✅ ${label}: concluído.${extra}`
      : `⚠️ ${label}: não foi possível concluir (${String(r.Message ?? 'erro na API')}).`;
    await this.notifyCtx(ctx, text).catch((err) =>
      this.logger.warn(`unimobile aviso na conversa ${record.conversationId} falhou: ${err?.message ?? err}`),
    );
    if (!ok) throw new Error(String(r.Message ?? 'erro na API Uni Mobile'));
    // Nunca guardar códigos de instalação no resultado.
    return { ok: true, message: r.Message, iccId: created?.iccId ?? iccId };
  }

  private async callApi(tool: string, a: Obj, creds: UnimobileCredentials, iccId: string, reseller: number | null): Promise<Obj> {
    switch (tool) {
      case 'uni_reenviar_email':
        return this.api.request(creds, 'POST', '/orders/sendEmail', { iccId });
      case 'uni_ativar_linha':
        return this.api.request(creds, 'POST', '/orders/activateLine', { iccId });
      case 'uni_recarregar':
        return this.api.request(creds, 'POST', `/orders/topup/${iccId}`, { reseller_id: reseller, topUp: Number(a.gb) });
      case 'uni_estender_plano':
        return this.api.request(creds, 'PATCH', '/orders/extendActiveOrder', { reseller_id: reseller, iccId, tariff: String(a.nova_tarifa) });
      case 'uni_cancelar_pedido':
        return this.api.request(creds, 'POST', '/orders/cancelOrder', { reseller_id: reseller, iccId });
      case 'uni_reiniciar_linha':
        return this.api.request(creds, 'POST', '/orders/resetOrder', { iccId });
      case 'uni_alterar_pedido': {
        // modifyOrder exige todos os campos: completa com o pedido atual.
        const current = (await this.orders(creds).catch(() => [])).find((o) => normalizeIccid(o.iccId) === iccId) ?? {};
        const body = {
          reseller_id: reseller,
          iccId,
          name: a.nome ?? current.name,
          email: a.email ?? current.email,
          document: a.documento ?? current.document,
          init_date: a.data_inicio ?? current.init_date,
          ...(a.paises ? { countries: a.paises } : {}),
        };
        if (!body.name || !body.email || !body.document || !body.init_date) {
          throw new Error('faltam dados do pedido (nome, e-mail, documento ou data de início)');
        }
        return this.api.request(creds, 'PATCH', '/orders/modifyOrder', body);
      }
      case 'uni_criar_pedido':
        return this.api.request(creds, 'POST', '/orders/order', {
          reseller_id: reseller,
          type: String(a.tipo).toLowerCase(),
          tariff: String(a.tarifa),
          init_date: String(a.data_inicio),
          name: String(a.nome),
          email: String(a.email),
          document: String(a.documento),
          ...(a.paises ? { countries: String(a.paises) } : {}),
          ...(String(a.tipo).toLowerCase() === 'chip' ? { iccId } : {}),
          ...(a.eid ? { eid: a.eid, imei: a.imei, imei2: a.imei2 } : {}),
        });
      default:
        throw new Error(`Ação desconhecida: ${tool}`);
    }
  }

  /** O código foi de uma ação desta conversa nas últimas 24 h (qualquer status)? */
  private async recentCode(conversationId: string, code: string): Promise<boolean> {
    const hit = await this.prisma.aiPendingAction.findFirst({
      where: {
        conversationId,
        toolName: { startsWith: 'uni_' },
        createdAt: { gt: new Date(Date.now() - 24 * 3_600_000) },
        preview: { path: ['code'], equals: code },
      },
      select: { status: true, expiresAt: true },
    });
    return !!hit;
  }

  /** Código antigo com outras solicitações abertas: avisa que expirou ou já foi usado. */
  private async notifyExpired(conversationId: string, code: string, any: { agentId: string; agentRunId: string }): Promise<true> {
    const ctx = await this.ctxFor(conversationId, any);
    if (ctx) await this.notifyCtx(ctx, `O código ${code} já foi usado ou expirou.`).catch(() => undefined);
    return true;
  }

  /** Ações desta conversa esperando o "SIM <código>". */
  private openActions(conversationId: string) {
    return this.prisma.aiPendingAction.findMany({
      where: { conversationId, status: 'PENDING', toolName: { startsWith: 'uni_' }, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private newCode(open: Array<{ preview: unknown }>): string {
    const used = new Set(open.map((r) => String((r.preview as Obj).code)));
    for (;;) {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      if (!used.has(code)) return code;
    }
  }

  /**
   * Quem pediu: a última mensagem de `solicitante` na conversa (em grupo,
   * várias pessoas pedem ao mesmo tempo); sem nome, a mensagem que disparou a IA.
   */
  private async requester(ctx: ToolContext, solicitante: unknown): Promise<{ key: string | null; name: string | null; messageId: string | null }> {
    const name = typeof solicitante === 'string' ? solicitante.trim().replace(/^\[|\]:?$/g, '') : '';
    const recent = await this.prisma.message.findMany({
      where: { conversationId: ctx.conversationId, direction: 'INBOUND' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const byName = name ? recent.find((m) => (m.senderName ?? '').trim().toLowerCase() === name.toLowerCase()) : undefined;
    const msg = byName ?? recent.find((m) => m.id === ctx.triggerMessageId) ?? recent[0];
    if (!msg) return { key: null, name: name || null, messageId: null };
    return { key: senderKey(msg), name: msg.senderName ?? (name || null), messageId: msg.id };
  }

  private async ctxFor(conversationId: string, record?: { agentId: string; agentRunId: string }): Promise<ToolContext | null> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { organizationId: true, contactId: true, channelId: true },
    });
    if (!conv) return null;
    const run = record
      ? { agentId: record.agentId, id: record.agentRunId }
      : await this.prisma.aiAgentRun.findFirst({ where: { conversationId }, orderBy: { startedAt: 'desc' }, select: { agentId: true, id: true } });
    if (!run) return null;
    return { organizationId: conv.organizationId, conversationId, contactId: conv.contactId, channelId: conv.channelId, agentId: run.agentId, runId: run.id };
  }

  private async notifyCtx(ctx: ToolContext, text: string) {
    const external = await this.sender.contactExternalId(ctx);
    if (!external) return;
    const agent = await this.prisma.aiAgent.findUnique({ where: { id: ctx.agentId }, select: { name: true } });
    await this.sender.send(ctx, external, { type: 'TEXT', text }, agent?.name ?? 'AI');
  }

  // ─── apoio ────────────────────────────────────────────────────────

  private async creds(ctx: ToolContext): Promise<UnimobileCredentials> {
    return this.api.credentials(await this.partner(ctx));
  }

  private async partner(ctx: ToolContext): Promise<string | null> {
    const conv = await this.prisma.conversation.findUnique({ where: { id: ctx.conversationId }, select: { metadata: true } });
    return groupPartner(conv?.metadata);
  }

  private async isGroup(ctx: ToolContext): Promise<boolean> {
    const conv = await this.prisma.conversation.findUnique({ where: { id: ctx.conversationId }, select: { isGroup: true } });
    return !!conv?.isGroup;
  }

  private tool(name: string, description: string, parameters: Obj, handler: Handler): AiTool {
    return {
      name,
      description,
      parameters,
      execute: async (input, ctx) => {
        if (!this.api.isConfigured()) {
          return { output: { ok: false, erro: 'API da Uni Mobile não configurada. Avise que vai verificar e passe para a equipe.' } };
        }
        try {
          return await handler(input, ctx);
        } catch (err) {
          // Endpoint que o endereço da API ainda não oferece (ex.: catálogo).
          if (err instanceof UnimobileUnavailableError) {
            return { output: { ok: false, disponivel: false, aviso: 'Essa informação não está disponível no sistema agora. Diga isso e, se for preciso, passe para a equipe.' } };
          }
          throw err;
        }
      },
    };
  }
}

/**
 * Quem mandou a mensagem: o participante do grupo (JID do Zappfy) ou, sem
 * ele, o nome exibido. Compara solicitante e confirmação.
 */
export function senderKey(message: { senderName?: string | null; metadata?: unknown }): string | null {
  const raw = (message.metadata as { rawPayload?: { message?: Obj } } | null)?.rawPayload?.message ?? {};
  const jid = [raw.sender_pn, raw.sender, raw.participant].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  if (jid) return jid.split('@')[0].split(':')[0].replace(/\D/g, '') || jid;
  const name = message.senderName?.trim().toLowerCase();
  return name ? `nome:${name}` : null;
}

function messageText(content: unknown): string {
  const c = (content ?? {}) as { text?: unknown; caption?: unknown };
  return [c.text, c.caption].find((v) => typeof v === 'string') as string ?? '';
}

const groupPartner = (metadata: unknown): string | null => {
  const p = (metadata as Obj | null)?.groupPartner;
  return typeof p === 'string' && p.trim() ? p.trim() : null;
};

/** Aparelho na lista de compatíveis (nome exato, marca+modelo ou final do nome). */
export function matchDevice(list: Array<{ brand: string; models: string[] }>, aparelho: string): Obj {
  const n = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const alvo = n(aparelho);
  if (!alvo) return { compativel: null, instrucao: 'Pergunte a marca e o modelo do celular.' };
  for (const marca of list) {
    for (const modelo of marca.models ?? []) {
      const m = n(modelo);
      if (alvo === m || alvo === n(marca.brand + modelo) || (m.length >= 5 && alvo.endsWith(m))) {
        return { compativel: true, marca: marca.brand, modelo };
      }
    }
  }
  const marca = list.find((m) => alvo.startsWith(n(m.brand)))?.brand;
  return {
    compativel: false,
    observacao: marca
      ? `Modelo não encontrado na lista da ${marca}. Pode ser variação de nome: confirme o modelo exato antes de concluir.`
      : 'Marca não encontrada na lista. Confirme o modelo exato.',
  };
}
