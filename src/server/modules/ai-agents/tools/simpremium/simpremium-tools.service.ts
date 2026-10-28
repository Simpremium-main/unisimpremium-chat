import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConversationStatus, MessageDirection } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { RealtimeGateway } from '../../../realtime/realtime.gateway';
import { AiTool, ToolContext, ToolResult } from '../tool.types';
import { TagConversationTool } from '../builtin/tag-conversation.tool';
import { SendFlowMessagesTool } from '../builtin/send-flow-messages.tool';
import { PlaybooksService } from '../../playbooks/playbooks.service';
import { SimpremiumMcpClient } from './simpremium-mcp.client';
import { CustomerOrdersService } from './customer-orders.service';
import { orderIdentity, orderIds, phoneMatches, rawOrders } from './customer-orders.parse';
import {
  ASK_DEVICE_OUTPUT,
  ROAMING_ALREADY_SENT_OUTPUT,
  activationStartFrom,
  deviceInformed,
  roamingTimingGuard,
} from './device-check';
import {
  activationFieldNames,
  activationOperators,
  activationPeriods,
  hideStaleStatus,
  onlyCurrentOrders,
  prepareOrderOutput,
  staleStatusNote,
  todayIso,
  withChipCheck,
} from './order-output';
import { KvStore } from '../../../../runtime/kv-store';
import {
  UNVERIFIED_ORDER_OUTPUT,
  checkOrderAccess,
  iccidsIn,
  identityClaims,
  isResellerOrder,
  markVerified,
  normalizeId,
  orderAudit,
  verifiedOrders,
} from './order-access';
import { AiNoteWriter } from '../builtin/ai-note-writer.service';
import { aiContextResetAt, aiVisibleMessagesWhere } from '../../runner/ai-context';
import { FlowTranslatorService } from '../../language/flow-translator.service';
import { asksForOtherPlans, lastObsPrice } from './quote-plans';
import { parseQuote } from './previous-quote';
import { brDate, dateRangesIn, inclusiveDays, tripDatesFor } from './quote-dates';
import { isQuoteText } from '../../followup/quote-followup';
export { asksForOtherPlans, lastObsPrice } from './quote-plans';
import {
  AMBIGUOUS_CLOSE_WORDS,
  formatAtivacoes,
  formatCotacao,
  formatFrete,
  freteMessage,
  formatPedido,
  formatPedidosDoTelefone,
} from './simpremium-format';
import { migrationGuidance, migrationOperator } from './chip-migration';

export const SIMPREMIUM_TOOLSET = 'simpremium';

/** Pedido de revenda que está esperando o ICCID do cliente (por conversa). */
const resellerPendingKey = (conversationId: string) => `reseller-pending:${conversationId}`;

/** Fluxo com as mensagens de verificação de chip/roaming (ver enviar_instrucoes_roaming). */
/**
 * Mantém só os pedidos cujo número é exatamente `orderId`. Sem nenhum
 * exato, devolve "nenhum pedido" — melhor do que conferir o pedido errado.
 */
export function exactOrderOnly(raw: unknown, orderId: string): unknown {
  if (!orderId) return raw;
  const orders = rawOrders(raw);
  if (orders.length === 0) return raw;
  const exact = orders.filter((o) => orderIds(o).map(normalizeId).includes(orderId));
  if (exact.length === orders.length) return raw;
  const base = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { source: base.source, orders: exact, ...(exact.length === 0 ? { nao_encontrado: orderId } : {}) };
}

export const ROAMING_FLOW_SLUG = 'instrucoes-roaming';

/** Fluxo de instruções de chip e roaming por fabricante (Jarvis → Fluxos). */
export const ROAMING_FLOW_BY_DEVICE: Record<string, string> = {
  iphone: 'instrucoes-configuracoes-iphone',
  samsung: 'instrucoes-de-escolha-do-chip-e-roaming-para-samsung',
  motorola: 'instrucoes-de-escolha-do-chip-e-roaming-para-motorola',
  outros: 'instrucoes-de-escolha-do-chip-e-roaming-para-outros',
};

type Handler = (input: Record<string, any>, ctx: ToolContext) => Promise<ToolResult>;

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
});

/**
 * Ferramentas do atendimento Simpremium (chip internacional e seguro
 * viagem), com os mesmos nomes, descrições e parâmetros do
 * Simp-Atendimento — o prompt do agente importado cita esses nomes.
 *
 *  - Consultas: chamam o Pedido Central (`POST {tool, parameters}`) e passam
 *    pelos mesmos formatadores do Simp.
 *  - Ações: escalar/pedir ajuda tiram a IA da conversa na hora (sem a
 *    aprovação do `transferToHuman`), finalizar fecha a conversa, set_label
 *    etiqueta e as instruções de roaming saem do fluxo do fabricante
 *    (ROAMING_FLOW_BY_DEVICE).
 */
const expiredOrdersNote = (omitted: string[]) =>
  `Mostre ao cliente SÓ os pedidos acima (ativação vigente ou futura; o campo "ativacao" traz o período). NÃO cite os pedidos encerrados (${omitted.join(', ')}) — só se o cliente perguntar por um deles.`;

/** Cotação anterior que a IA reaproveita para "atualizar o orçamento" (ultima_cotacao). */
const PREVIOUS_QUOTE_MAX_AGE_MS = 7 * 24 * 3_600_000;

/** Enquanto o pedido não está confirmado, a mensagem trata só disso. */
const ONE_STEP_NOTE =
  'Uma etapa por vez: nesta mensagem peça SÓ o que está acima para confirmar o pedido. NÃO pergunte ainda sobre o problema, o tipo de chip, o modelo do aparelho nem se está sem internet — isso vem depois que o pedido for confirmado.';

const ORDER_NOT_FOUND_INSTRUCTION = `Não existe pedido com esse número. Diga isso ao cliente e peça para conferir o número do pedido (como está no e-mail de confirmação) ou informar o e-mail ou CPF usado na compra. ${ONE_STEP_NOTE}`;

@Injectable()
export class SimpremiumToolsService {
  private readonly logger = new Logger(SimpremiumToolsService.name);
  readonly tools: AiTool[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly mcp: SimpremiumMcpClient,
    private readonly tag: TagConversationTool,
    private readonly flows: SendFlowMessagesTool,
    private readonly playbooks: PlaybooksService,
    private readonly moduleRef: ModuleRef,
    private readonly notes: AiNoteWriter,
    private readonly customerOrders: CustomerOrdersService,
    private readonly translator?: FlowTranslatorService,
  ) {
    this.tools = [
      this.tool(
        'cotacao_chip',
        'Calcula preço de chips de internet para viagem internacional (eSIM ou físico). Retorna planos com preço em USD e BRL. IMPORTANTE: os nomes dos países DEVEM ser em português (ex: "Estados Unidos", "Reino Unido", "França").',
        obj(
          {
            days: { type: 'number', description: 'Número de dias da viagem' },
            countries: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Lista de países em PORTUGUÊS. Ex: "Estados Unidos", "Inglaterra", "Japão". NUNCA em inglês. Vários países: TODOS numa só chamada, com os dias da viagem inteira (plano único, mais barato). Planos separados só se o cliente pedir.',
            },
            chipType: { type: 'string', enum: ['virtual', 'physical'], description: 'Tipo do chip' },
            startDate: {
              type: 'string',
              description: 'Data de ida (DD/MM/AAAA) quando o cliente informou o período em datas. A cotação mostra as datas.',
            },
            endDate: { type: 'string', description: 'Data de volta (DD/MM/AAAA) quando o cliente informou o período em datas.' },
            atualizarCotacaoAnterior: {
              type: 'boolean',
              description:
                'true quando o cliente pediu para atualizar a cotação anterior (ultima_cotacao): mantém o mesmo desconto/cupom, as datas e o tipo de plano dela — só os valores são recalculados.',
            },
            franquiaApenas: {
              type: 'boolean',
              description:
                'Se true, mostra APENAS os planos com franquia de dados (não ilimitados). Use SOMENTE quando o cliente pedir: plano mais barato, sem ser ilimitado, ou os outros planos citados na observação da cotação. Nova cotação (outro destino/período) é sempre do ilimitado.',
            },
            couponCode: {
              type: 'string',
              description:
                'Código do cupom de desconto informado pelo cliente. Se o cliente informar um cupom diferente, passe aqui para pesquisar o desconto no sistema.',
            },
          },
          ['days', 'countries'],
        ),
        (input, ctx) => this.cotacaoChip(input, ctx),
      ),
      this.tool(
        'calcular_frete',
        'Calcula opções de frete/envio para chip físico para um CEP específico. Retorna as modalidades disponíveis (PAC, Sedex, Carta Registrada) com preço em BRL. Use SOMENTE quando o cliente quiser chip físico (não eSIM/virtual) e informar o CEP.',
        obj(
          {
            cep: { type: 'string', description: 'CEP do destinatário (somente números ou com hífen)' },
            product_id: { type: 'number', description: 'ID do produto WooCommerce (opcional)' },
          },
          ['cep'],
        ),
        (input, ctx) => this.calcularFrete(input, ctx),
      ),
      this.query(
        'cotacao_seguro',
        'Calcula preço de seguro viagem para coberturas de 40k, 70k e 100k USD. Retorna preços por faixa etária. IMPORTANTE: destinos DEVEM ser em português.',
        obj(
          {
            days: { type: 'number', description: 'Número de dias da viagem' },
            ageGroup: { type: 'string', enum: ['0-65', '66-70', '71-80', '81-90'], description: 'Faixa etária' },
            destinations: { type: 'array', items: { type: 'string' }, description: 'Lista de destinos em PORTUGUÊS' },
          },
          ['days', 'destinations'],
        ),
      ),
      this.tool(
        'consultar_pedido',
        'Consulta um pedido. Se o cliente informou o NÚMERO DO PEDIDO, chame esta ferramenta direto com orderId (não use pedidos_do_cliente): ela confere sozinha se o pedido é do WhatsApp desta conversa e, se não for, diz para pedir o e-mail ou telefone usado na compra — aí chame de novo com orderId + o dado que o cliente informar. Sem número do pedido, busca por CPF ou e-mail.',
        obj({
          cpf: { type: 'string', description: 'CPF informado pelo cliente' },
          name: { type: 'string', description: 'Nome do cliente' },
          email: { type: 'string', description: 'E-mail informado pelo cliente' },
          phone: { type: 'string', description: 'Telefone informado pelo cliente (para conferir com o de cobrança do pedido)' },
          iccid: {
            type: 'string',
            description: 'Número do chip (ICCID) informado pelo cliente — usado nos pedidos de revenda (distribuidor/agência)',
          },
          orderId: { type: 'string', description: 'Número do pedido' },
        }),
        (input, ctx) => this.consultarPedido(input, ctx),
      ),
      this.tool(
        'pedidos_do_cliente',
        'Busca os pedidos cujo telefone de cobrança é o WhatsApp desta conversa. Use quando o cliente falar de pedido, entrega ou ativação SEM informar o número do pedido. Se ele informou o número, use consultar_pedido.',
        obj({}),
        async (_input, ctx) => {
          const r = await this.customerOrders.lookupForConversation(ctx.organizationId, ctx.conversationId);
          // O cliente é achado pelo cadastro, mas pra IA só valem os pedidos
          // cujo telefone DE COBRANÇA é o WhatsApp da conversa; os outros
          // exigem CPF/e-mail (consultar_pedido).
          const own = r.orders.filter((o) =>
            phoneMatches(orderIdentity(o.raw as Record<string, unknown>).phone, r.phone),
          );
          await markVerified(ctx.conversationId, own.flatMap((o) => orderIds(o.raw as Record<string, unknown>)));
          // Vários pedidos: só os com ativação vigente ou futura.
          let shown = own;
          let omitted: string[] = [];
          const idOf = (o: (typeof own)[number]) => orderIds(o.raw as Record<string, unknown>)[0] ?? '';
          const periods = own.length ? await this.activationPeriodsOf(ctx, own.map(idOf)) : new Map();
          if (own.length > 1) {
            const res = onlyCurrentOrders(own, idOf, periods, todayIso());
            omitted = res.omitted;
            shown = res.kept.map(({ ativacao, ...order }) => ({
              ...order,
              raw: { ...(order.raw as object), ...(ativacao ? { ativacao } : {}) },
            }));
          }
          // Viagem anterior / antigo sem ativação: sem o status (pode estar errado).
          const stale = hideStaleStatus(
            shown.map((o) => o.raw as Record<string, unknown>),
            (raw) => orderIds(raw)[0] ?? '',
            periods,
            todayIso(),
          );
          shown = shown.map((o, i) => ({ ...o, raw: stale.orders[i] }));
          const out = formatPedidosDoTelefone({ ...r, orders: shown }, r.orders.length - own.length);
          const notes = [
            omitted.length ? expiredOrdersNote(omitted) : '',
            stale.hidden.length ? staleStatusNote(stale.hidden) : '',
          ].filter(Boolean);
          return text(notes.length ? `${out}\n\n${notes.join('\n')}` : out);
        },
      ),
      this.tool(
        'status_entrega',
        'Consulta status detalhado de entrega e rastreamento de um pedido. SEMPRE use após consultar_pedido quando o cliente perguntar sobre entrega/rastreio.',
        obj({ orderId: { type: 'string', description: 'Número do pedido' } }, ['orderId']),
        this.ownOrderOnly(async (input, ctx) => ({
          output: prepareOrderOutput(await this.mcp.call(ctx.organizationId, 'status_entrega', input)),
        })),
      ),
      this.tool(
        'consultar_ativacoes',
        'Consulta ativações de chips/eSIM de um pedido. Mostra ICCID, operadora, plano, datas e status.',
        obj({ orderId: { type: 'string', description: 'Número do pedido' } }, ['orderId']),
        this.ownOrderOnly(async (input, ctx) => {
          const raw = await this.mcp.call(ctx.organizationId, 'consultar_ativacoes', input);
          return {
            output: formatAtivacoes(prepareOrderOutput(withChipCheck(raw))),
            audit: { campos_ativacao: activationFieldNames(raw), operadora_plano: activationOperators(raw) },
          };
        }),
      ),
      this.tool(
        'migracao_chip',
        'Use SEMPRE que o cliente quiser trocar de aparelho, passar o chip/eSIM para outro celular ou migrar o chip físico para virtual (eSIM). Antes, confirme o pedido (consultar_pedido / pedidos_do_cliente) e veja nele se o chip atual é físico ou virtual — nunca chute. A ferramenta confere o plano do pedido e devolve o que dizer ao cliente (se é possível, dados a pedir, taxa, Pix e prazo) e como transferir para o atendente. Não responda sobre migração sem ela.',
        obj(
          {
            orderId: { type: 'string', description: 'Número do pedido (já confirmado)' },
            chip_atual: {
              type: 'string',
              enum: ['fisico', 'virtual'],
              description: 'Tipo do chip do pedido: "fisico" (chip físico) ou "virtual" (eSIM), conforme o pedido',
            },
            destino: {
              type: 'string',
              enum: ['fisico', 'virtual'],
              description:
                'Como o cliente quer usar no aparelho novo: "fisico" = colocar o mesmo chip físico em outro aparelho; "virtual" = ter um eSIM no aparelho novo',
            },
          },
          ['orderId', 'chip_atual', 'destino'],
        ),
        this.ownOrderOnly(async (input, ctx) => {
          const orderId = String(input.orderId ?? '').trim();
          const chipAtual = input.chip_atual === 'virtual' ? 'virtual' : 'fisico';
          const destino = input.destino === 'virtual' ? 'virtual' : 'fisico';
          // Só o eSIM no aparelho novo depende do plano (físico → outro aparelho, não).
          const needsPlan = destino === 'virtual';
          const raw = needsPlan
            ? await this.mcp.call(ctx.organizationId, 'consultar_ativacoes', { orderId }).catch(() => null)
            : null;
          const operator = needsPlan ? migrationOperator(raw) : null;
          return {
            output: migrationGuidance({ orderId, chipAtual, destino, operator }),
            audit: { migracao: { chip_atual: chipAtual, destino, operadora: operator } },
          };
        }),
      ),
      this.tool(
        'consultar_seguro',
        'Consulta dados do seguro viagem de um pedido ou pelo número da apólice.',
        obj({
          orderId: { type: 'string', description: 'Número do pedido' },
          insuranceNumber: { type: 'string', description: 'Número da apólice do seguro' },
        }),
        this.ownOrderOnly(async (input, ctx) => ({
          output: prepareOrderOutput(await this.mcp.call(ctx.organizationId, 'consultar_seguro', input)),
        })),
      ),
      this.query(
        'consultar_afiliado',
        'Consulta dados de um afiliado/parceiro pelo email, nome ou ID.',
        obj({
          name: { type: 'string', description: 'Nome do afiliado' },
          email: { type: 'string', description: 'Email do afiliado' },
          affiliateId: { type: 'number', description: 'ID do afiliado' },
        }),
      ),
      this.query(
        'consultar_cliente',
        'Busca dados de um cliente por email, nome, CPF ou telefone.',
        obj({
          cpf: { type: 'string', description: 'CPF do cliente' },
          name: { type: 'string', description: 'Nome do cliente' },
          email: { type: 'string', description: 'Email do cliente' },
          phone: { type: 'string', description: 'Telefone do cliente' },
        }),
      ),
      this.tool(
        'consultar_parceiro',
        'Confere no Pedido Central se o cliente é parceiro cadastrado: agência de viagem (pelo CNPJ + e-mail cadastrado) ou afiliado (pelo e-mail cadastrado ou pelo cupom). Use quando o cliente disser que é agência ou afiliado e quiser cotar ou emitir pedido.',
        obj({
          cnpj: { type: 'string', description: 'CNPJ da agência' },
          email: { type: 'string', description: 'E-mail cadastrado na parceria' },
          cupom: { type: 'string', description: 'Cupom do afiliado' },
        }),
        (input, ctx) => this.consultarParceiro(input, ctx),
      ),
      this.tool(
        'ultima_cotacao',
        'Busca a última cotação de chip enviada a este cliente nos últimos 7 dias, inclusive em conversas anteriores (com países, período, dias e tipo de chip). Use quando o cliente pedir para atualizar, refazer ou rever "o orçamento/a cotação" e ela não estiver nesta conversa — antes de pedir os dados de novo.',
        obj({}),
        (_input, ctx) => this.ultimaCotacao(ctx),
      ),
      this.query(
        'consultar_cupom',
        'Valida um cupom de desconto e retorna o percentual de desconto. Use quando o cliente informar um cupom diferente do padrão para atualizar a cotação.',
        obj({ code: { type: 'string', description: 'Código do cupom informado pelo cliente' } }, ['code']),
      ),
      this.tool(
        'enviar_instrucoes_roaming',
        'Envia as instruções padronizadas de verificação de chip e roaming com imagens. Use quando o cliente tem problema de conexão com chip e já informou o modelo do aparelho. As mensagens são enviadas automaticamente pelo sistema.',
        obj(
          {
            device: {
              type: 'string',
              enum: ['iphone', 'samsung', 'motorola', 'outros'],
              description: 'Fabricante do aparelho do cliente (Xiaomi, LG, Pixel e demais = "outros"). Cada um tem as suas instruções.',
            },
            uso: {
              type: 'string',
              enum: ['primeiro_dia', 'parou_de_funcionar'],
              description:
                'Só quando a ativação começou há mais de 3 dias: "primeiro_dia" se o cliente disse que está no primeiro dia de uso; "parou_de_funcionar" se já usava e parou. Não chute — pergunte se ele não disse.',
            },
          },
          ['device'],
        ),
        (input, ctx) => this.enviarRoaming(input, ctx),
      ),
      this.tool(
        'escalar_para_humano',
        'Transfere o atendimento para um atendente humano. Use quando o cliente pedir ou quando não conseguir resolver. A ferramenta JÁ AVISA o cliente ("Vou transferir seu atendimento para o setor responsável para <motivo_cliente>…") — não mande mensagem própria de transferência.',
        obj(
          {
            reason: { type: 'string', description: 'Motivo da escalação (nota interna para a equipe, com pedido, datas e detalhes)' },
            motivo_cliente: {
              type: 'string',
              description:
                'O que o setor vai fazer pelo cliente, em poucas palavras, para completar a frase "Vou transferir seu atendimento para o setor responsável para…". Sem dados internos. Ex.: "reenviar o e-mail do seu eSIM", "verificar o reembolso do seu pedido", "ajudar na ativação do seu chip".',
            },
            department: {
              type: 'string',
              enum: ['suporte', 'vendas', 'financeiro', 'ouvidoria', 'retenção', 'parcerias'],
              description: 'Departamento destino',
            },
          },
          ['reason', 'motivo_cliente'],
        ),
        (input, ctx) =>
          this.handoff(ctx, {
            reason: String(input.reason ?? '').trim() || 'Escalação sem motivo informado',
            department: String(input.department ?? '').trim() || 'suporte',
            kind: 'escalation',
            customerReason: String(input.motivo_cliente ?? '').trim(),
          }),
      ),
      this.tool(
        'pedir_ajuda',
        'Use OBRIGATORIAMENTE quando a pergunta do cliente não tiver resposta confirmada. Casos: compatibilidade com dispositivos especiais (modem, smartwatch, GPS, tablet), planos corporativos, compra em volume, cobertura de seguro para situação específica não listada no FAQ, qualquer informação sem certeza absoluta. NUNCA responda com suposições — se não tem certeza, use pedir_ajuda.',
        obj(
          {
            problema: {
              type: 'string',
              description: 'Descrição clara do que o cliente quer e por que o bot não sabe responder',
            },
          },
          ['problema'],
        ),
        (input, ctx) =>
          this.handoff(ctx, {
            reason: String(input.problema ?? '').trim() || 'Bot não soube responder',
            department: 'ajuda',
            kind: 'help',
          }),
      ),
      this.tool(
        'finalizar_atendimento',
        'Finaliza e fecha o chat. Use APENAS quando o cliente confirmar que não precisa de mais nada.',
        obj({ reason: { type: 'string', description: 'Resumo breve do atendimento' } }, ['reason']),
        (input, ctx) => this.finalizar(input, ctx),
      ),
      this.tool(
        'set_label',
        'Classifica o chat com uma etiqueta para roteamento de modelo de IA. Chame assim que entender o tipo de atendimento. Pode chamar novamente se o assunto mudar.',
        obj(
          {
            label: {
              type: 'string',
              enum: ['duvidas', 'cotacao', 'suporte', 'atendimento', 'reclamacao', 'outro'],
              description:
                'duvidas=perguntas gerais, cotacao=preço de chip/seguro, suporte=problema técnico/rastreio/pedido, atendimento=questão complexa/especial, reclamacao=insatisfação/reembolso/cancelamento',
            },
          },
          ['label'],
        ),
        async (input, ctx) => {
          const label = String(input.label ?? '').trim();
          if (!label) return { output: { ok: false, error: 'label vazio' } };
          // A etiqueta fica na conversa (metadata.aiLabel). A tag de mesmo nome
          // só é aplicada se existir em Configurações → Tags — a IA não cria
          // tags, e tag inexistente não é falha da etiqueta.
          const conv = await this.prisma.conversation.findUnique({
            where: { id: ctx.conversationId },
            select: { metadata: true },
          });
          await this.prisma.conversation.update({
            where: { id: ctx.conversationId },
            data: { metadata: { ...((conv?.metadata as Record<string, unknown> | null) ?? {}), aiLabel: label } },
          });
          const res = await this.tag.execute({ tags: [label] }, ctx).catch(() => null);
          return { output: { ok: true, label, tagAplicada: (res?.output as any)?.ok === true } };
        },
      ),
    ];
  }

  // ─── consultas ───────────────────────────────────────────────────

  /** Mensagens que a IA pode ler (respeita o "Limpar contexto" / "Reiniciar"). */
  private async aiVisible(ctx: ToolContext) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: ctx.conversationId },
      select: { metadata: true },
    });
    return aiVisibleMessagesWhere(ctx.conversationId, conv?.metadata);
  }

  private async cotacaoChip(input: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    // franquiaApenas e couponCode são da formatação, não do Pedido Central.
    const { franquiaApenas, couponCode, startDate, endDate, atualizarCotacaoAnterior, ...params } = input;
    let couponDiscount: number | undefined;
    let resolvedCoupon: string | undefined;
    let hideCoupon = false;

    // "Atualiza esse orçamento": mesmas opções da cotação anterior (até 7
    // dias), inclusive o desconto que o atendente deu — só os valores mudam.
    const previous =
      atualizarCotacaoAnterior === true ? await this.previousQuote(ctx, PREVIOUS_QUOTE_MAX_AGE_MS) : null;
    const prevQuote = previous ? parseQuote(previous.text) : null;
    if (prevQuote?.desconto_percent) {
      couponDiscount = prevQuote.desconto_percent;
      resolvedCoupon = prevQuote.cupom ?? undefined;
      hideCoupon = !prevQuote.cupom;
    } else if (typeof couponCode === 'string' && couponCode.trim()) {
      const code = couponCode.trim();
      let problem: string | null = null;
      try {
        const c: any = await this.mcp.call(ctx.organizationId, 'consultar_cupom', { code });
        if (c?.valid && typeof c.discount_percent === 'number') {
          couponDiscount = c.discount_percent;
          resolvedCoupon = c.code || code;
        } else {
          problem = c?.message || 'Cupom inválido';
        }
      } catch {
        problem = 'Erro ao consultar cupom';
      }
      if (problem) {
        // Não cai no cupom padrão em silêncio: o modelo pergunta ao cliente.
        return {
          output: {
            cupom_invalido: true,
            code,
            message: problem,
            instrucao: `Informe ao cliente que o cupom "${code}" ${problem.toLowerCase()}. Pergunte se deseja usar o cupom padrão MINHAVIAGEM (15% de desconto) ou informar outro código válido. NÃO refaça a cotação automaticamente.`,
          },
        };
      }
    }

    const countries: string[] = Array.isArray(params.countries) ? params.countries.map(String) : [];

    // Pedido de cotação "seco" muito depois da última ("Preciso de uma
    // cotação" 16h depois): o modelo tende a reaproveitar destino/datas do
    // histórico e reenviar a cotação velha. Confirma antes com o cliente.
    if (franquiaApenas !== true && !previous) {
      const history = await this.prisma.message.findMany({
        where: { ...(await this.aiVisible(ctx)), type: { notIn: ['REACTION', 'SYSTEM'] } },
        orderBy: { createdAt: 'desc' },
        take: 80,
        select: { direction: true, content: true, createdAt: true },
      });
      const stale = staleRepeatedQuote(
        history.map((m) => ({
          direction: m.direction,
          text: String((m.content as { text?: unknown })?.text ?? ''),
          createdAt: m.createdAt,
        })),
        countries,
        Number(params.days) || 0,
      );
      if (stale) {
        return {
          output: {
            confirmar_dados: true,
            ultima_cotacao: stale,
            instrucao: `NÃO reenvie a cotação antiga. A última cotação (${stale.countries}${stale.period ? `, ${stale.period}` : ''}) foi feita há ${stale.hoursAgo}h e o cliente não falou de destino nem datas desde então — pode ser uma NOVA viagem. Pergunte se a cotação é para a mesma viagem (${stale.countries}${stale.period ? `, ${stale.period}` : ''}) ou para outro destino/datas, e se prefere chip físico ou eSIM. Só cote depois da resposta.`,
          },
        };
      }
    }

    // Sempre o ilimitado. Os planos com franquia só quando o cliente pede
    // (mais barato, sem ser ilimitado, os "outros planos" da observação) —
    // nova cotação para o mesmo país NÃO é pedido de franquia.
    const askedOther = await this.customerAskedOtherPlans(ctx);
    // Pedido do cliente basta (a cotação anterior pode estar traduzida, e o
    // país vem em português na chamada) — e só ele libera a franquia.
    const onlyFranchise = askedOther || (!!prevQuote && !prevQuote.ilimitado);

    const raw = await this.mcp.call(ctx.organizationId, 'cotacao_chip', params);
    // Chip físico: CEP que o cliente já mandou → a cotação manda calcular o
    // frete direto, em vez de pedir o CEP de novo.
    const cep = params.chipType === 'physical' ? await this.customerCep(ctx) : null;
    const frete = cep ? await this.freteFor(cep, ctx) : null;
    const prevPeriod = prevQuote?.datas && prevQuote.dias === (Number(params.days) || 0) ? prevQuote.datas : null;
    const period = prevPeriod ?? (await this.tripPeriod(ctx, Number(params.days) || 0, startDate, endDate));
    const quote = formatCotacao(raw, {
      cep,
      frete,
      period,
      days: Number(params.days) || 0,
      countries,
      chipType: typeof params.chipType === 'string' ? params.chipType : undefined,
      franquiaApenas: onlyFranchise,
      couponCode: resolvedCoupon,
      couponDiscount,
      hideCoupon,
    });
    return text(await this.translateQuote(quote, ctx));
  }

  /**
   * Frete do CEP já informado, para ir junto da cotação (e marcado como
   * calculado: calcular_frete depois não apresenta de novo). Falha → null e a
   * cotação manda a IA chamar calcular_frete.
   */
  private async freteFor(cep: string, ctx: ToolContext): Promise<string | null> {
    try {
      const formatted = formatFrete(await this.mcp.call(ctx.organizationId, 'calcular_frete', { cep }));
      const msg = freteMessage(formatted, cep);
      if (msg) {
        await this.kv()
          .set(`frete:${ctx.conversationId}:${cep.replace(/\D/g, '')}`, formatted, { ttlMs: 24 * 3_600_000 })
          .catch(() => undefined);
      }
      return msg;
    } catch (err) {
      this.logger.warn(`frete junto da cotação falhou (CEP ${cep}): ${(err as Error)?.message ?? err}`);
      return null;
    }
  }

  /**
   * Datas da viagem para a cotação: as que a IA passou ou, sem elas, o
   * período em datas que o cliente escreveu ("De 25/11 a 09/12") — só se
   * bater com os dias cotados. O cliente que só falou em dias fica "(N dias)".
   */
  private async tripPeriod(ctx: ToolContext, days: number, start: unknown, end: unknown): Promise<string | null> {
    const today = todayIso();
    const given = typeof start === 'string' && typeof end === 'string' ? dateRangesIn(`${start} a ${end}`, today)[0] : null;
    if (given && inclusiveDays(given.start, given.end) === days) return `${brDate(given.start)} - ${brDate(given.end)}`;
    const recent = await this.prisma.message.findMany({
      where: { ...(await this.aiVisible(ctx)), direction: MessageDirection.INBOUND },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { content: true },
    });
    const texts = recent.map((m) => String((m.content as { text?: unknown } | null)?.text ?? '')).filter(Boolean);
    const found = tripDatesFor(texts, days, today);
    return found ? `${brDate(found.start)} - ${brDate(found.end)}` : null;
  }

  /** Último CEP (8 dígitos, com ou sem traço) que o cliente escreveu na conversa. */
  private async customerCep(ctx: ToolContext): Promise<string | null> {
    const recent = await this.prisma.message.findMany({
      where: { ...(await this.aiVisible(ctx)), direction: MessageDirection.INBOUND },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { content: true },
    });
    for (const m of recent) {
      const t = String((m.content as { text?: unknown } | null)?.text ?? '');
      const hit = t.match(/(?<!\d)(\d{5})-?(\d{3})(?!\d)/);
      if (hit) return `${hit[1]}-${hit[2]}`;
    }
    return null;
  }

  /**
   * Cliente em inglês/espanhol: a cotação já vai traduzida (a IA copiava o
   * template em português). As regras da 1ª linha ficam como estão.
   */
  private async translateQuote(quote: string, ctx: ToolContext): Promise<string> {
    if (!this.translator || !quote.startsWith('TEMPLATE_PRONTO')) return quote;
    const lang = await this.translator.languageOf(ctx.conversationId).catch(() => 'pt' as const);
    if (lang === 'pt') return quote;
    const cut = quote.indexOf('\n\n');
    if (cut < 0) return quote;
    const [body] = await this.translator.translate([quote.slice(cut + 2)], lang, ctx);
    return `${quote.slice(0, cut)} O texto abaixo já está traduzido para o idioma do cliente — copie-o como está (as datas, se houver, vão no mesmo formato antes do período).\n\n${body}`;
  }

  /**
   * A última cotação mandada nesta conversa mostrou o ilimitado com a nota
   * dos planos com franquia, e para os mesmos países?
   */
  /** As últimas mensagens do cliente pedem outros planos (ou citam o valor da observação)? */
  async customerAskedOtherPlans(ctx: Pick<ToolContext, 'conversationId'>): Promise<boolean> {
    const visible = await this.aiVisible(ctx as ToolContext);
    const [inbound, outbound] = await Promise.all([
      this.prisma.message.findMany({
        where: { ...visible, direction: MessageDirection.INBOUND },
        orderBy: { createdAt: 'desc' },
        take: 2,
        select: { content: true },
      }),
      this.prisma.message.findMany({
        where: { ...visible, direction: MessageDirection.OUTBOUND },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { content: true },
      }),
    ]);
    const text = (m: { content: unknown }) => String((m.content as { text?: unknown } | null)?.text ?? '');
    const obs = lastObsPrice(outbound.map(text));
    return inbound.some((m) => asksForOtherPlans(text(m), obs));
  }

  private async lastQuoteOfferedFranchise(ctx: ToolContext, countries: string[]): Promise<boolean> {
    if (countries.length === 0) return false;
    const recent = await this.prisma.message.findMany({
      where: { ...(await this.aiVisible(ctx)), direction: MessageDirection.OUTBOUND },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { content: true },
    });
    const lastQuote = recent
      .map((m) => String((m.content as { text?: unknown })?.text ?? ''))
      .find((t) => /Pa[ií]ses de Cobertura/i.test(t));
    if (!lastQuote || !/Obs\.?:? Temos também planos com franquia de dados/i.test(lastQuote)) return false;
    const shown = lastQuote.match(/Pa[ií]ses de Cobertura:?\*?\s*(.+)/i)?.[1]?.trim().toLowerCase() ?? '';
    const asked = countries.map((c) => c.trim().toLowerCase()).join(', ');
    return shown === asked || shown.includes(asked);
  }

  // ─── ações ───────────────────────────────────────────────────────

  /**
   * Mesmo CEP já calculado nesta conversa: devolve o resultado guardado com o
   * aviso de não reapresentar ("opa", "ok" depois do frete não é novo pedido).
   */
  private async calcularFrete(input: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    const cep = String(input.cep ?? '').replace(/\D/g, '');
    const key = `frete:${ctx.conversationId}:${cep}`;
    const previous = cep ? await this.kv().get(key).catch(() => null) : null;
    if (previous) {
      return {
        output: {
          ja_calculado: true,
          aviso:
            'O frete para este CEP JÁ foi calculado e apresentado nesta conversa. NÃO apresente de novo; responda ao que o cliente perguntou agora. Use o resultado abaixo só se ele perguntar algo específico sobre o frete.',
          resultado: previous,
        },
      };
    }
    const formatted = formatFrete(await this.mcp.call(ctx.organizationId, 'calcular_frete', input));
    if (cep) await this.kv().set(key, formatted, { ttlMs: 24 * 3_600_000 }).catch(() => undefined);
    return text(formatted);
  }

  private kvStore: KvStore | null = null;
  private kv(): KvStore {
    return (this.kvStore ??= new KvStore());
  }

  /**
   * consultar_pedido só devolve pedido do cliente: telefone do pedido igual
   * ao WhatsApp da conversa, ou CPF/e-mail informado batendo com o pedido.
   */
  private async consultarPedido(input: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    // Com número do pedido, busca só por ele e confere a identidade aqui,
    // pelos dados de cobrança: mandar o e-mail junto fazia o Pedido Central
    // filtrar pelo e-mail da conta e "não achar" o pedido.
    // Pedido de revenda: a IA às vezes manda só o ICCID, e o Pedido Central
    // não acha o pedido de agência pelo ICCID. Vale o pedido que pediu o ICCID.
    if (!normalizeId(input.orderId) && input.iccid) {
      const pending = await this.kv().get(resellerPendingKey(ctx.conversationId)).catch(() => null);
      if (pending) input = { ...input, orderId: pending };
    }
    const { phone: _typedPhone, ...search } = input;
    const orderId = normalizeId(input.orderId);
    const query = orderId ? { orderId } : search;
    // O Pedido Central busca por "contém": pedindo 4808 vinha o 134808.
    // Só vale o pedido com o número exato.
    let raw = exactOrderOnly(await this.mcp.call(ctx.organizationId, 'consultar_pedido', query), orderId);
    // Já confirmado nesta conversa (achado pelo WhatsApp ou com CPF/e-mail).
    if (orderId && (await verifiedOrders(ctx.conversationId)).has(orderId)) return text(formatPedido(prepareOrderOutput(raw)));
    const phone = await this.customerOrders.conversationPhone(ctx.conversationId);
    // O que o cliente escreveu nas últimas mensagens também vale (e-mail ou
    // telefone que ele mandou e a IA não passou na chamada).
    const recent = await this.prisma.message.findMany({
      where: { ...(await this.aiVisible(ctx)), direction: MessageDirection.INBOUND },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: { content: true },
    });
    const texts = recent
      .map((m) => (m.content as { text?: unknown; caption?: unknown } | null))
      .map((c) => [c?.text, c?.caption].find((v) => typeof v === 'string') as string | undefined)
      .filter((t): t is string => !!t);
    const claims = identityClaims(input, texts);

    // Número de pedido que não existe (cliente errou um dígito): procura
    // pelo CPF/e-mail que ele informou, em vez de dizer "não encontrei".
    let checkInput: Record<string, unknown> = input;
    let missingNumber: string | null = null;
    if (orderId && rawOrders(raw).length === 0) {
      const byIdentity = claims.cpfs[0] ? { cpf: claims.cpfs[0] } : claims.emails[0] ? { email: claims.emails[0] } : null;
      if (byIdentity) {
        const alt = await this.mcp.call(ctx.organizationId, 'consultar_pedido', byIdentity).catch(() => null);
        if (rawOrders(alt).length > 0) {
          raw = alt;
          checkInput = byIdentity;
          missingNumber = orderId;
        }
      }
    }

    // Pedido de revenda: o ICCID do chip pode estar só nas ativações.
    const orders = rawOrders(raw);
    let extraIccids: string[] = [];
    if (orderId && claims.iccids.length && orders.length && orders.every(isResellerOrder)) {
      const acts = await this.mcp
        .call(ctx.organizationId, 'consultar_ativacoes', { orderId })
        .catch(() => null);
      extraIccids = [...iccidsIn(acts)];
    }
    const audit = orderAudit(orders, claims, phone);

    // Número que não existe e nada para buscar no lugar: só pedir o pedido.
    if (orderId && orders.length === 0) {
      return { output: { ok: false, pedido_nao_encontrado: orderId, instrucao: ORDER_NOT_FOUND_INSTRUCTION }, audit };
    }

    const check = checkOrderAccess(checkInput, raw, phone, claims, extraIccids);
    if (!check.ok) {
      this.logger.log(`consultar_pedido ${input.orderId ?? ''}: identidade não confirmada (conv ${ctx.conversationId})`);
      if (orderId && check.output.pedido_de_revenda) {
        await this.kv()
          .set(resellerPendingKey(ctx.conversationId), orderId, { ttlMs: 24 * 3_600_000 })
          .catch(() => undefined);
      }
      return { output: { ...(check.output as object), uma_etapa_por_vez: ONE_STEP_NOTE }, audit };
    }
    await markVerified(ctx.conversationId, check.verifiedIds);
    // Busca por CPF/e-mail com vários pedidos: só os com ativação vigente ou
    // futura vão para a IA (ela listava pedidos de 2024 junto com o atual).
    const current = !orderId ? await this.withoutExpiredOrders(ctx, check.output) : check.output;
    const { output, hidden } = await this.withoutStaleStatus(ctx, current);
    const formatted = formatPedido(prepareOrderOutput(output));
    const result = hidden.length ? `${formatted}\n\n${staleStatusNote(hidden)}` : formatted;
    return {
      ...text(
        missingNumber
          ? `ATENÇÃO: o número ${missingNumber} que o cliente informou NÃO existe. Os pedidos abaixo foram encontrados pelo ${'cpf' in checkInput ? 'CPF' : 'e-mail'} do cliente — diga isso a ele e use o número correto.\n\n${result}`
          : result,
      ),
      audit,
    };
  }

  /** Pedidos de viagem anterior / antigos sem ativação: sem o status (pode estar errado). */
  private async withoutStaleStatus(ctx: ToolContext, output: unknown): Promise<{ output: unknown; hidden: string[] }> {
    if (!output || typeof output !== 'object') return { output, hidden: [] };
    const obj = output as Record<string, unknown>;
    const key = Array.isArray(obj.orders) ? 'orders' : Array.isArray(obj.pedidos) ? 'pedidos' : null;
    if (!key) return { output, hidden: [] };
    const orders = obj[key] as Record<string, unknown>[];
    const idOf = (o: Record<string, unknown>) => orderIds(o)[0] ?? '';
    const periods = await this.activationPeriodsOf(ctx, orders.map(idOf));
    const res = hideStaleStatus(orders, idOf, periods, todayIso());
    return { output: { ...obj, [key]: res.orders }, hidden: res.hidden };
  }

  private async withoutExpiredOrders(ctx: ToolContext, output: unknown): Promise<unknown> {
    const orders = rawOrders(output);
    if (orders.length < 2 || !output || typeof output !== 'object' || !Array.isArray((output as any).orders)) return output;
    const idOf = (o: Record<string, unknown>) => orderIds(o)[0] ?? '';
    const periods = await this.activationPeriodsOf(ctx, orders.map(idOf));
    const { kept, omitted } = onlyCurrentOrders(orders, idOf, periods, todayIso());
    if (!omitted.length) return { ...(output as object), orders: kept };
    return {
      ...(output as object),
      orders: kept,
      pedidos_encerrados_omitidos: omitted,
      instrucao_pedidos: expiredOrdersNote(omitted),
    };
  }

  /** Períodos de ativação de cada pedido (até 8, em paralelo; falha = sem período). */
  private async activationPeriodsOf(ctx: ToolContext, ids: string[]) {
    const periods = new Map<string, Array<{ start: string; end: string | null }>>();
    await Promise.all(
      ids.slice(0, 8).map(async (id) => {
        const acts = await this.mcp
          .call(ctx.organizationId, 'consultar_ativacoes', { orderId: id }, 15_000)
          .catch(() => null);
        if (acts) periods.set(id, activationPeriods(acts));
      }),
    );
    return periods;
  }

  /**
   * Última cotação de chip enviada ao contato (qualquer conversa). Só vale a
   * dos últimos 7 dias; mais antiga → pedir os dados de novo ao cliente.
   */
  /** Última cotação enviada ao contato, em qualquer conversa, dentro de `maxAgeMs`. */
  private async previousQuote(
    ctx: ToolContext,
    maxAgeMs: number,
  ): Promise<{ text: string; createdAt: Date; conversationId: string } | null> {
    const rows = await this.prisma.message.findMany({
      where: {
        conversation: { contactId: ctx.contactId, organizationId: ctx.organizationId },
        direction: MessageDirection.OUTBOUND,
        createdAt: { gte: new Date(Date.now() - maxAgeMs) },
      },
      orderBy: { createdAt: 'desc' },
      take: 400,
      select: { content: true, createdAt: true, conversationId: true },
    });
    for (const m of rows) {
      const text = String((m.content as { text?: unknown } | null)?.text ?? '');
      if (isQuoteText(text)) return { text, createdAt: m.createdAt, conversationId: m.conversationId };
    }
    return null;
  }

  private async ultimaCotacao(ctx: ToolContext): Promise<ToolResult> {
    const found = await this.previousQuote(ctx, 120 * 24 * 3_600_000);
    if (!found) {
      return {
        output: {
          encontrada: false,
          instrucao: 'Nenhuma cotação anterior para este cliente. Peça só o que falta para cotar: países, datas (ou dias) e tipo de chip.',
        },
      };
    }
    const sent = found.createdAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    if (Date.now() - found.createdAt.getTime() > PREVIOUS_QUOTE_MAX_AGE_MS) {
      return {
        output: {
          encontrada: false,
          mais_de_7_dias: true,
          enviada_em: sent,
          instrucao: `A última cotação deste cliente é de ${sent}, há mais de 7 dias: não use. Diga que a cotação anterior já tem mais de 7 dias e peça para ele informar de novo os países, as datas da viagem e se prefere chip físico ou virtual.`,
        },
      };
    }
    const text = found.text;
    const quote = parseQuote(text);
    const past = !!quote.inicio && quote.inicio < todayIso();
    return {
      output: {
        encontrada: true,
        enviada_em: sent,
        nesta_conversa: found.conversationId === ctx.conversationId,
        ...quote,
        texto: text.slice(0, 1200),
        instrucao:
          `O cliente quer ver o valor atualizado da MESMA cotação: chame cotacao_chip com atualizarCotacaoAnterior: true, os mesmos países${quote.dias ? `, days ${quote.dias}` : ''}${quote.tipo ? ` e chipType "${quote.tipo}"` : ''}. A ferramenta mantém o mesmo desconto${quote.desconto_percent ? ` (${quote.desconto_percent}%)` : ''}, as datas e o tipo de plano; só os valores mudam. Envie a cotação nova como vier. NÃO peça ao cliente o que já está aqui.` +
          (past ? ' A data de ida dessa cotação JÁ PASSOU: pergunte só as novas datas da viagem antes de cotar.' : '') +
          (!quote.tipo ? ' O tipo de chip não aparece na cotação: pergunte se prefere físico ou virtual.' : ''),
      },
    };
  }

  private async consultarParceiro(input: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    const cnpj = String(input.cnpj ?? '').replace(/\D/g, '');
    const email = String(input.email ?? '').trim().toLowerCase();
    const cupom = String(input.cupom ?? '').trim();
    if (!cnpj && !email && !cupom) {
      return { output: { ok: false, error: 'Informe o CNPJ e o e-mail (agência) ou o e-mail/cupom (afiliado).' } };
    }
    const params = { ...(cnpj ? { cnpj } : {}), ...(email ? { email } : {}), ...(cupom ? { cupom } : {}) };
    try {
      const res = await this.mcp.call(ctx.organizationId, 'consultar_parceiro', params);
      return {
        output: {
          resultado: res,
          regras:
            'Confira se o parceiro foi encontrado e se o tipo (agência/afiliado) bate com o que o cliente disse. NUNCA informe valores da tabela NET nem de comissão — só pela plataforma. Na transferência, coloque na nota o tipo de parceiro e o CNPJ/e-mail/cupom.',
        },
      };
    } catch (err) {
      // Consulta ainda não existe no Pedido Central (ou fora do ar): segue
      // sem confirmar e deixa os dados para a equipe conferir.
      this.logger.warn(`consultar_parceiro indisponível: ${(err as Error)?.message ?? err}`);
      return {
        output: {
          ok: false,
          indisponivel: true,
          instrucao:
            'Não dá para confirmar o cadastro do parceiro agora. Siga o atendimento normalmente e, ao transferir, coloque na nota que o cliente diz ser parceiro (agência/afiliado) com o CNPJ, e-mail e/ou cupom que ele informou, para a equipe conferir. Não diga ao cliente que a consulta falhou.',
        },
      };
    }
  }

  /** Consulta por número de pedido só depois de confirmar que o pedido é do cliente. */
  private ownOrderOnly(handler: Handler): Handler {
    return async (input, ctx) => {
      const orderId = normalizeId(input.orderId);
      if (orderId && !(await verifiedOrders(ctx.conversationId)).has(orderId)) {
        return { output: UNVERIFIED_ORDER_OUTPUT };
      }
      return handler(orderId ? { ...input, orderId } : input, ctx);
    };
  }

  private async enviarRoaming(input: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    const recent = await this.prisma.message.findMany({
      where: { ...(await this.aiVisible(ctx)), type: { notIn: ['REACTION', 'SYSTEM'] } },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { direction: true, content: true, metadata: true },
    });
    // Texto, legenda ou transcrição do áudio (metadata.transcription.text).
    const history = recent.reverse().map((m) => {
      const c = (m.content ?? {}) as Record<string, unknown>;
      const audio = (m.metadata as { transcription?: { text?: unknown } } | null)?.transcription?.text;
      const t = [c.text, c.caption, audio].find((v) => typeof v === 'string');
      return { direction: m.direction, text: (t as string | undefined) ?? '' };
    });
    const device = deviceInformed(history, input.device);
    if (!device.ok) {
      return {
        output: device.said
          ? {
              ok: false,
              guard: true,
              error: `O cliente disse que o aparelho é ${device.said}, não ${input.device}. Chame enviar_instrucoes_roaming de novo com device "${device.said}".`,
            }
          : ASK_DEVICE_OUTPUT,
      };
    }
    // Uma rodada só: reenviar o fluxo inteiro a cada print/"liguei o roaming"
    // inundava o cliente (Etapa 5 manda perguntar se resolveu ou transferir).
    if (await this.roamingAlreadySent(ctx)) return { output: ROAMING_ALREADY_SENT_OUTPUT };
    // Ativação começou há mais de 3 dias: primeiro dia de uso → instruções;
    // já usava e parou → prints das telas, sem instruções.
    const today = todayIso();
    const timing = roamingTimingGuard(activationStartFrom(await this.activationOutputs(ctx), today), today, input.uso);
    if (timing) return { output: timing };
    // Fluxo do fabricante; sem ele, o de "Outros" e, por último, o antigo único.
    const device_ = String(input.device ?? '').toLowerCase();
    const slugs = [ROAMING_FLOW_BY_DEVICE[device_], ROAMING_FLOW_BY_DEVICE.outros, ROAMING_FLOW_SLUG].filter(
      (v, i, a): v is string => !!v && a.indexOf(v) === i,
    );
    let flow: Awaited<ReturnType<PlaybooksService['findBySlug']>> = null;
    for (const slug of slugs) {
      flow = await this.playbooks.findBySlug(ctx.organizationId, ctx.agentId, slug, { includeInactive: true });
      if (flow) break;
    }
    if (!flow) {
      return {
        output: {
          ok: false,
          error: `Nenhum fluxo de instruções de roaming cadastrado (${slugs.join(', ')}) em Jarvis → Fluxos. Escreva as instruções ou chame escalar_para_humano.`,
        },
      };
    }
    const res = await this.flows.sendSteps(flow, ctx);
    return { ...res, output: { ...(res.output as object), device: input.device ?? null } };
  }

  /** Retornos de consultar_ativacoes desta conversa (desde o último reinício da IA). */
  private async activationOutputs(ctx: ToolContext): Promise<string[]> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: ctx.conversationId },
      select: { metadata: true },
    });
    const resetAt = aiContextResetAt(conv?.metadata);
    const calls = await this.prisma.aiToolCall.findMany({
      where: {
        toolName: 'consultar_ativacoes',
        run: { conversationId: ctx.conversationId },
        ...(resetAt ? { createdAt: { gt: resetAt } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { output: true },
    });
    // Com auditoria o retorno fica em { resultado, _auditoria }.
    return calls.map(({ output: o }) => {
      const v = o && typeof o === 'object' && 'resultado' in o ? (o as { resultado: unknown }).resultado : o;
      return typeof v === 'string' ? v : JSON.stringify(v ?? '');
    });
  }

  private async roamingAlreadySent(ctx: ToolContext): Promise<boolean> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: ctx.conversationId },
      select: { metadata: true },
    });
    const resetAt = aiContextResetAt(conv?.metadata);
    const prior = await this.prisma.aiToolCall.findFirst({
      where: {
        toolName: 'enviar_instrucoes_roaming',
        run: { conversationId: ctx.conversationId },
        output: { path: ['ok'], equals: true },
        ...(resetAt ? { createdAt: { gt: resetAt } } : {}),
      },
      select: { id: true },
    });
    return !!prior;
  }

  /**
   * Tira a IA da conversa na hora e devolve pra fila dos atendentes, com o
   * motivo e o departamento como etiquetas (no Simp, o chat ia pro setor).
   */
  private async handoff(
    ctx: ToolContext,
    args: { reason: string; department: string; kind: 'escalation' | 'help'; customerReason?: string },
  ): Promise<ToolResult> {
    // A transferência encerra o turno da IA na hora: o aviso ao cliente sai
    // daqui (senão ele fica sem saber o que aconteceu).
    const notice = await this.handoffNotice(ctx, args);
    const conversation = await this.prisma.conversation.update({
      where: { id: ctx.conversationId },
      data: { aiEnabled: false },
      select: { status: true },
    });
    if (conversation.status === ConversationStatus.BOT) {
      await this.fsm().transition(ctx.conversationId, ConversationStatus.PENDING, undefined, {
        source: 'ai-agent',
        agentId: ctx.agentId,
        reason: args.reason,
      });
    }
    let caseError: string | null = null;
    if (args.kind === 'help') {
      // Vira um caso em Jarvis → Aprendizado: o admin orienta e a IA aprende.
      await this.prisma.aiHelpRequest
        .create({
          data: {
            organizationId: ctx.organizationId,
            conversationId: ctx.conversationId,
            agentId: ctx.agentId,
            question: args.reason,
          },
        })
        .catch((err) => {
          caseError = String(err?.message ?? err).split('\n').filter(Boolean).pop() ?? 'erro desconhecido';
          this.logger.error(`help request not saved: ${err?.message ?? err}`);
        });
    }
    await this.notes.tryWrite({
      conversationId: ctx.conversationId,
      agentId: ctx.agentId,
      content:
        args.kind === 'help'
          ? `Pediu ajuda à equipe (${args.department}).\nDúvida: ${args.reason}` +
            (caseError ? `\n⚠️ O caso NÃO entrou em Jarvis → Aprendizado: ${caseError}` : '')
          : `Escalou para o setor ${args.department}.\nMotivo: ${args.reason}`,
    });
    const tags = args.kind === 'help' ? ['pedir-ajuda'] : [`setor-${slugTag(args.department)}`];
    await this.tag.execute({ tags }, ctx).catch(() => undefined);

    this.realtime.emitToConversation(ctx.conversationId, 'conversation:ai-handoff', {
      conversationId: ctx.conversationId,
      agentId: ctx.agentId,
      reason: args.reason,
      department: args.department,
    });
    this.logger.log(
      `Agent ${ctx.agentId} ${args.kind === 'help' ? 'pediu ajuda' : 'escalou'} conv ${ctx.conversationId} (${args.department}): ${args.reason}`,
    );

    return {
      output:
        args.kind === 'help'
          ? { ok: true, helpRequested: true, problema: args.reason, clienteAvisado: notice }
          : { escalated: true, reason: args.reason, department: args.department, clienteAvisado: notice },
      finalAction: 'TRANSFERRED_TO_HUMAN',
    };
  }

  /**
   * Mensagem ao cliente na transferência. Não repete se a IA já avisou
   * (transferir/encaminhar/equipe) nos últimos minutos.
   */
  private async handoffNotice(
    ctx: ToolContext,
    args: { kind: 'escalation' | 'help'; customerReason?: string },
  ): Promise<string | null> {
    const recent = await this.prisma.message.findMany({
      where: {
        ...(await this.aiVisible(ctx)),
        direction: MessageDirection.OUTBOUND,
        createdAt: { gte: new Date(Date.now() - 3 * 60_000) },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { content: true },
    });
    const already = recent.some((m) =>
      /transfer|encaminh|setor respons|verificar .*equipe|com a equipe/i.test(String((m.content as any)?.text ?? '')),
    );
    if (already) return null;
    const reason = (args.customerReason ?? '').replace(/[.\s]+$/, '');
    const text =
      args.kind === 'help'
        ? 'Vou verificar essa informação com a equipe e já te retorno por aqui. 🙏'
        : `Vou transferir seu atendimento para o setor responsável${reason ? ` para ${reason}` : ''}. Em instantes um atendente continua por aqui. 🙏`;
    const res = await this.flows
      .sendSteps({ slug: 'aviso-transferencia', steps: [{ type: 'TEXT', content: text, caption: null }] } as any, ctx)
      .catch((err) => {
        this.logger.warn(`aviso de transferência não enviado: ${err?.message ?? err}`);
        return null;
      });
    return (res?.output as any)?.ok ? text : null;
  }

  private async finalizar(input: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    // Mesma trava do Simp: não encerra depois de "ok", "sim", "valeu"...
    const lastInbound = await this.prisma.message.findFirst({
      where: { ...(await this.aiVisible(ctx)), direction: MessageDirection.INBOUND },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });
    const lastText = String((lastInbound?.content as any)?.text ?? '').trim();
    // "ok!", "Obrigada 😊", "valeu." contam como a palavra curta.
    const bare = lastText.replace(/[^\p{L}\p{N}\s]/gu, '').trim();
    if (AMBIGUOUS_CLOSE_WORDS.test(bare)) {
      return {
        output: {
          closed: false,
          motivo: `A última mensagem do cliente ("${lastText}") não é um encerramento explícito — o atendimento NÃO foi encerrado. Não pergunte se ele precisa de mais alguma coisa: só responda se houver algo pendente; senão, aguarde.`,
        },
      };
    }

    const reason = String(input.reason ?? '').trim();
    await this.closeConversation(ctx, reason);
    return { output: { closed: true, reason }, finalAction: 'CLOSED_CONVERSATION' };
  }

  /** Encerra pela máquina de estados (auditoria + automações); vale de qualquer estado aberto. */
  async closeConversation(ctx: Pick<ToolContext, 'conversationId' | 'agentId'>, reason: string): Promise<void> {
    const PATH: Partial<Record<ConversationStatus, ConversationStatus[]>> = {
      [ConversationStatus.BOT]: [ConversationStatus.CLOSED],
      [ConversationStatus.PENDING]: [ConversationStatus.CLOSED],
      [ConversationStatus.OPEN]: [ConversationStatus.CLOSED],
      [ConversationStatus.WAITING]: [ConversationStatus.CLOSED],
    };
    const { status } = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: ctx.conversationId },
      select: { status: true },
    });
    const metadata = { source: 'ai-agent', agentId: ctx.agentId, reason };
    for (const next of PATH[status] ?? []) {
      await this.fsm().transition(ctx.conversationId, next, undefined, metadata);
    }
  }

  // ─── helpers ─────────────────────────────────────────────────────

  /** Resolvido em tempo de execução: o módulo de mensagens depende do de IA. */
  private fsm(): { transition(id: string, to: ConversationStatus, actorId?: string, metadata?: Record<string, any>): Promise<void> } {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ConversationFsmService } = require('../../../messaging/conversations/conversation-fsm.service');
    return this.moduleRef.get(ConversationFsmService, { strict: false });
  }

  private tool(name: string, description: string, parameters: Record<string, unknown>, handler: Handler): AiTool {
    return { name, description, parameters, execute: handler };
  }

  /** Consulta sem formatação: o JSON do Pedido Central vai direto pro modelo. */
  private query(name: string, description: string, parameters: Record<string, unknown>): AiTool {
    return this.tool(name, description, parameters, async (input, ctx) => ({
      output: await this.mcp.call(ctx.organizationId, name, input),
    }));
  }
}

/** Texto formatado (TEMPLATE_PRONTO, regras) vai como string pro modelo. */
const STALE_QUOTE_HOURS = 2;

const normalize = (v: string) =>
  v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * A IA está prestes a repetir, sem o cliente ter pedido de novo os mesmos
 * dados, uma cotação feita há mais de STALE_QUOTE_HOURS? Retorna o que foi
 * cotado (pra perguntar ao cliente) ou null.
 *
 * `history` em ordem decrescente. Libera quando: a última cotação foi pra
 * outro destino/período, é recente, ou depois dela alguém citou o destino
 * — o cliente ("Alemanha de novo") ou a própria IA ao confirmar ("é pra
 * Alemanha, 25/10 a 01/11?").
 */
export function staleRepeatedQuote(
  history: Array<{ direction: string; text: string; createdAt: Date }>,
  countries: string[],
  days: number,
  now: Date = new Date(),
): { countries: string; period: string | null; hoursAgo: number } | null {
  if (countries.length === 0) return null;
  const idx = history.findIndex(
    (m) => m.direction === 'OUTBOUND' && /Pa[ií]ses de Cobertura/i.test(m.text),
  );
  if (idx === -1) return null;
  const quote = history[idx];

  const shown = quote.text.match(/Pa[ií]ses de Cobertura:?\*?:?\s*(.+)/i)?.[1]?.trim() ?? '';
  const asked = countries.map(normalize);
  if (!asked.every((c) => normalize(shown).includes(c))) return null;
  const quotedDays = Number(quote.text.match(/\((\d+)\s*dias?\)/i)?.[1] ?? 0);
  if (days && quotedDays && days !== quotedDays) return null;

  const hoursAgo = (now.getTime() - quote.createdAt.getTime()) / 3_600_000;
  if (hoursAgo < STALE_QUOTE_HOURS) return null;

  const since = history.slice(0, idx);
  if (since.some((m) => asked.some((c) => normalize(m.text).includes(c)))) return null;

  const period = quote.text.match(/Per[ií]odo da viagem:?\*?:?\s*([^\n]+)/i)?.[1]?.trim() ?? null;
  return { countries: shown, period, hoursAgo: Math.round(hoursAgo) };
}

function text(value: string): ToolResult {
  return { output: value };
}

function slugTag(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
