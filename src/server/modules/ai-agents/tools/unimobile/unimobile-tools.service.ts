import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { PendingActionService } from '../../confirmations/pending-action.service';
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
const CONFIRMADO = {
  type: 'boolean',
  description: 'true SOMENTE depois que quem pediu confirmou explicitamente nesta conversa a ação descrita',
};

/** Ações que mudam pedido com cobrança ou risco: só depois da aprovação da equipe no app. */
export const UNIMOBILE_APPROVAL_TOOLS: Record<string, { impact: ImpactLevel; label: (a: Obj) => string; rollback?: string }> = {
  uni_recarregar: { impact: 'high', label: (a) => `Recarga de ${a.gb} GB na linha ${a.iccid}` },
  uni_estender_plano: { impact: 'high', label: (a) => `Estender a linha ${a.iccid} para a tarifa ${a.nova_tarifa}` },
  uni_alterar_pedido: { impact: 'medium', label: (a) => `Alterar dados do pedido da linha ${a.iccid}` },
  uni_cancelar_pedido: { impact: 'critical', label: (a) => `Cancelar o pedido da linha ${a.iccid}`, rollback: 'Não tem volta: um pedido cancelado não pode ser reativado.' },
  uni_reiniciar_linha: { impact: 'high', label: (a) => `Reiniciar a linha ${a.iccid}` },
  uni_criar_pedido: { impact: 'high', label: (a) => `Criar pedido ${String(a.tipo).toUpperCase()} ${a.tarifa} para ${a.nome}, início ${a.data_inicio}` },
};

const SEM_ICCID = {
  ok: false,
  instrucao: 'Peça o ICCID completo da linha (19 ou 20 dígitos, começa com 89). iPhone: Ajustes → Geral → Sobre. Android: Configurações → Sobre o telefone → Status do SIM.',
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Ferramentas da API de linhas da Uni Mobile (pacote "unimobile").
 *
 *  - Consultas: executam direto.
 *  - Reenviar e-mail de instalação e ativar linha: executam depois que quem
 *    pediu confirma na conversa (`confirmado: true`).
 *  - Recarga, extensão, alteração, cancelamento, reinício e novo pedido:
 *    viram uma ação pendente que a equipe aprova no app; o executor
 *    (PendingActionExecutorProcessor) chama `executeApproved` e avisa na conversa.
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
    private readonly pendingActions: PendingActionService,
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

      // ─── ações com confirmação de quem pediu ───────────────────
      this.tool(
        'uni_reenviar_email',
        'Reenvia ao e-mail do titular os dados de instalação do eSIM/CHIP (linha pendente ou ativa). Antes, diga o que vai fazer e peça confirmação; chame com confirmado=true só depois do "sim". É o jeito de entregar o QR code/código sem expor no grupo.',
        obj({ iccid: ICCID, confirmado: CONFIRMADO }, ['iccid', 'confirmado']),
        (input, ctx) => this.confirmada(input, ctx, 'reenviar o e-mail de instalação', async (creds, iccid) => {
          const r = await this.api.request(creds, 'POST', '/orders/sendEmail', { iccId: iccid });
          return r.Result === 'Ok'
            ? { ok: true, mensagem: 'E-mail de instalação reenviado ao titular.' }
            : { ok: false, motivo: r.Message };
        }),
      ),
      this.tool(
        'uni_ativar_linha',
        'Ativa agora uma linha PENDENTE cuja data de início é hoje ou ontem (ex.: o viajante já chegou ao destino). Consulte a linha antes. Peça confirmação e chame com confirmado=true só depois do "sim".',
        obj({ iccid: ICCID, confirmado: CONFIRMADO }, ['iccid', 'confirmado']),
        (input, ctx) => this.confirmada(input, ctx, 'ativar a linha', async (creds, iccid) => {
          const r = await this.api.request(creds, 'POST', '/orders/activateLine', { iccId: iccid });
          await this.api.invalidateOrders(creds);
          return r.Result === 'Ok'
            ? { ok: true, mensagem: 'Linha ativada. O sinal pode levar alguns minutos; reiniciar o celular ajuda.' }
            : { ok: false, motivo: r.Message, explicacao: 'A linha só ativa se estiver pendente e com data de início hoje ou ontem.' };
        }),
      ),

      // ─── ações com aprovação da equipe ─────────────────────────
      this.approval(
        'uni_recarregar',
        'Recarga de dados (GB) numa linha ATIVA. Use uni_pacotes_recarga para ver os pacotes (1, 3, 5 ou 10 GB). Tem cobrança: a equipe aprova no app antes de aplicar.',
        obj({ iccid: ICCID, gb: { type: 'integer', description: 'GB do pacote (valor topUp)' }, confirmado: CONFIRMADO }, ['iccid', 'gb', 'confirmado']),
      ),
      this.approval(
        'uni_estender_plano',
        'Estende o plano da linha (pendente, ativa ou já estendida) para outra tarifa da MESMA zona e tipo com MAIS dias. Pegue o código da nova tarifa em uni_planos. Tem cobrança: a equipe aprova no app.',
        obj({ iccid: ICCID, nova_tarifa: { type: 'string', description: 'Código da nova tarifa (ex.: EUR_030D_ILIM_SODA_UNIG_ESIM)' }, confirmado: CONFIRMADO }, ['iccid', 'nova_tarifa', 'confirmado']),
      ),
      this.approval(
        'uni_alterar_pedido',
        'Altera nome, e-mail, documento, países e data de início do pedido (a data de início só muda enquanto a linha está pendente). Informe só o que muda; o resto é mantido. A equipe aprova no app.',
        obj({
          iccid: ICCID,
          nome: { type: 'string' },
          email: { type: 'string' },
          documento: { type: 'string' },
          data_inicio: { type: 'string', description: 'AAAA-MM-DD' },
          paises: { type: 'string', description: 'Códigos ISO separados por vírgula, ex.: ES,FR' },
          confirmado: CONFIRMADO,
        }, ['iccid', 'confirmado']),
      ),
      this.approval(
        'uni_cancelar_pedido',
        'Cancela o pedido da linha (pendente ou ativa, até 3 dias depois da data de início). Não tem volta. A equipe aprova no app.',
        obj({ iccid: ICCID, motivo: { type: 'string' }, confirmado: CONFIRMADO }, ['iccid', 'confirmado']),
      ),
      this.approval(
        'uni_reiniciar_linha',
        'Reinicia uma linha ATIVA (último recurso quando a linha não conecta depois das orientações). A equipe aprova no app.',
        obj({ iccid: ICCID, motivo: { type: 'string' }, confirmado: CONFIRMADO }, ['iccid', 'confirmado']),
      ),
      this.approval(
        'uni_criar_pedido',
        'Cria um pedido novo de eSIM ou CHIP. Precisa de: tipo (esim/chip), tarifa (código de uni_planos, terminando em ESIM ou CHIP conforme o tipo), data de início (hoje ou depois), nome e documento do titular (5+ caracteres) e e-mail. CHIP exige o ICCID do chip físico. Tem cobrança: a equipe aprova no app.',
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
          confirmado: CONFIRMADO,
        }, ['tipo', 'tarifa', 'data_inicio', 'nome', 'email', 'documento', 'confirmado']),
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

  private async confirmada(
    input: Obj,
    ctx: ToolContext,
    acao: string,
    run: (creds: UnimobileCredentials, iccid: string) => Promise<Obj>,
  ): Promise<ToolResult> {
    const iccid = normalizeIccid(input.iccid);
    if (!isFullIccid(iccid)) return { output: SEM_ICCID };
    if (input.confirmado !== true) {
      return { output: { ok: false, aguardando_confirmacao: true, instrucao: `Antes de ${acao} da linha ${iccid}, pergunte se a pessoa confirma. Só chame de novo com confirmado=true depois do "sim".` } };
    }
    const creds = await this.creds(ctx);
    const result = await run(creds, iccid);
    this.logger.log(`unimobile ${acao} ${iccid} (conv ${ctx.conversationId}): ${result.ok ? 'ok' : result.motivo}`);
    return { output: { iccid, ...result } };
  }

  private approval(name: string, description: string, parameters: Obj): AiTool {
    return this.tool(name, description, parameters, async (input, ctx) => {
      const problem = await this.validateApproval(name, input, ctx);
      if (problem) return { output: { ok: false, ...problem } };
      if (input.confirmado !== true) {
        return {
          output: {
            ok: false,
            aguardando_confirmacao: true,
            instrucao: `Resuma a ação (${UNIMOBILE_APPROVAL_TOOLS[name].label(input)}) e pergunte se a pessoa confirma. Só chame de novo com confirmado=true depois do "sim".`,
          },
        };
      }
      const { confirmado: _c, ...args } = input;
      const spec = UNIMOBILE_APPROVAL_TOOLS[name];
      const action = await this.pendingActions.create({
        agentRunId: ctx.runId,
        conversationId: ctx.conversationId,
        agentId: ctx.agentId,
        toolName: name,
        args,
        preview: {
          action: spec.label(args),
          impact: spec.impact,
          rollback: spec.rollback,
          affectedEntity: args.iccid ? { type: 'order', id: String(args.iccid), label: `ICCID ${args.iccid}` } : undefined,
        },
        ttlMinutes: 12 * 60,
      });
      this.logger.log(`unimobile ${name} aguardando aprovação: ${action.id} (conv ${ctx.conversationId})`);
      return {
        output: {
          ok: true,
          status: 'registrado_para_aprovacao',
          pendingActionId: action.id,
          agent_should_say:
            'Diga que a solicitação foi registrada e será concluída pela equipe em instantes; o resultado será avisado aqui. Não diga que já foi feito.',
        },
      };
    });
  }

  /** Erros de dados antes de mandar para aprovação (a API rejeitaria depois). */
  private async validateApproval(name: string, a: Obj, ctx: ToolContext): Promise<Obj | null> {
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
    // Só o reinício dispensa o reseller_id.
    if (name !== 'uni_reiniciar_linha' && !this.api.credentials(await this.partner(ctx)).resellerId) {
      return { instrucao: 'Essa ação não está configurada no sistema (falta o reseller_id). Passe para a equipe.' };
    }
    return null;
  }

  /**
   * Executa uma ação aprovada pela equipe (chamado pelo
   * PendingActionExecutorProcessor) e avisa o resultado na conversa.
   */
  async executeApproved(action: { toolName: string; args: Obj; conversationId: string; agentId: string; agentRunId: string }): Promise<Obj> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: action.conversationId },
      select: { organizationId: true, contactId: true, channelId: true, metadata: true },
    });
    if (!conv) throw new Error('Conversa não existe mais');
    const partner = groupPartner(conv.metadata);
    const creds = this.api.credentials(partner);
    const a = action.args;
    const iccId = normalizeIccid(a.iccid);
    const reseller = creds.resellerId;
    let r: Obj;

    switch (action.toolName) {
      case 'uni_recarregar':
        r = await this.api.request(creds, 'POST', `/orders/topup/${iccId}`, { reseller_id: reseller, topUp: Number(a.gb) });
        break;
      case 'uni_estender_plano':
        r = await this.api.request(creds, 'PATCH', '/orders/extendActiveOrder', { reseller_id: reseller, iccId, tariff: String(a.nova_tarifa) });
        break;
      case 'uni_cancelar_pedido':
        r = await this.api.request(creds, 'POST', '/orders/cancelOrder', { reseller_id: reseller, iccId });
        break;
      case 'uni_reiniciar_linha':
        r = await this.api.request(creds, 'POST', '/orders/resetOrder', { iccId });
        break;
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
          throw new Error('Faltam dados do pedido (nome, e-mail, documento ou data de início) para alterar.');
        }
        r = await this.api.request(creds, 'PATCH', '/orders/modifyOrder', body);
        break;
      }
      case 'uni_criar_pedido':
        r = await this.api.request(creds, 'POST', '/orders/order', {
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
        break;
      default:
        throw new Error(`Ação desconhecida: ${action.toolName}`);
    }
    await this.api.invalidateOrders(creds);

    const ok = r.Result === 'Ok';
    const label = UNIMOBILE_APPROVAL_TOOLS[action.toolName]?.label(a) ?? action.toolName;
    const created = action.toolName === 'uni_criar_pedido' && ok ? (r.Data as Obj | undefined) : undefined;
    const text = ok
      ? `✅ ${label}: concluído.${created?.iccId ? ` ICCID da nova linha: ${created.iccId}. Os dados de instalação vão para o e-mail do titular.` : ''}`
      : `⚠️ ${label}: não foi possível concluir (${String(r.Message ?? 'erro na API')}). A equipe vai verificar.`;
    await this.notify(action, conv, text).catch((err) =>
      this.logger.warn(`unimobile aviso na conversa ${action.conversationId} falhou: ${err?.message ?? err}`),
    );
    if (!ok) throw new Error(String(r.Message ?? 'erro na API Uni Mobile'));
    // Nunca guardar códigos de instalação no resultado.
    return { ok: true, message: r.Message, iccId: created?.iccId ?? iccId };
  }

  private async notify(
    action: { conversationId: string; agentId: string; agentRunId: string },
    conv: { organizationId: string; contactId: string; channelId: string },
    text: string,
  ) {
    const ctx: ToolContext = {
      organizationId: conv.organizationId,
      conversationId: action.conversationId,
      contactId: conv.contactId,
      channelId: conv.channelId,
      agentId: action.agentId,
      runId: action.agentRunId,
    };
    const external = await this.sender.contactExternalId(ctx);
    if (!external) return;
    const agent = await this.prisma.aiAgent.findUnique({ where: { id: action.agentId }, select: { name: true } });
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
