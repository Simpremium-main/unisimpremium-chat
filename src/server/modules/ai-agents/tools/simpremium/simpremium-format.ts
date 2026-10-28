import type { CustomerOrdersResult } from './customer-orders.service';
import { prepareOrderOutput } from './order-output';
/**
 * Formatadores dos retornos do Pedido Central — portados do
 * Simp-Atendimento (src/services/ai.ts). Rodam ANTES de o modelo ver o
 * resultado: as regras ficam coladas no dado, onde ele não as ignora.
 */

interface CotacaoPlan {
  allowance: string;
  totalUSD: number;
  totalBRL: number;
  raw?: { calls?: string };
}

export interface CotacaoInput {
  days: number;
  countries: string[];
  chipType?: string;
  /** Mostra só os planos com franquia (o cliente pediu depois de ver o ilimitado). */
  franquiaApenas?: boolean;
  couponCode?: string;
  couponDiscount?: number;
  /** Desconto dado pelo atendente (não é cupom): o texto não cita cupom. */
  hideCoupon?: boolean;
  /** CEP que o cliente já informou na conversa (chip físico: calcula o frete direto). */
  cep?: string | null;
  /** Mensagem do frete já calculado para o CEP (vai entre a cotação e a pergunta de finalizar). */
  frete?: string | null;
  /** Datas que o cliente informou ("25/11/2026 - 09/12/2026"); sem elas, só "(N dias)". */
  period?: string | null;
}

/**
 * Mensagem do frete a partir do retorno de calcular_frete (já sem as opções
 * escondidas). null = sem opções (CEP inválido, erro).
 */
export function freteMessage(formatted: string, cep: string): string | null {
  let parsed: any;
  try {
    parsed = JSON.parse(formatted);
  } catch {
    return null;
  }
  const key = Array.isArray(parsed) ? null : FRETE_LIST_KEYS.find((k) => Array.isArray(parsed?.[k]));
  const items: any[] = Array.isArray(parsed) ? parsed : key ? parsed[key] : [];
  const lines = items
    .map((o) => {
      const label = String(o.label || o.name || o.modalidade || '').trim();
      const price = String(o.formatted || '').trim();
      if (!label || !price) return null;
      const days = Number(o.delivery_days);
      return `*${label}:* ${price}${days > 0 ? ` (cerca de ${days} ${days === 1 ? 'dia útil' : 'dias úteis'})` : ''}`;
    })
    .filter(Boolean);
  if (lines.length === 0) return null;
  return `Frete para o CEP ${cep}:\n${lines.join('\n')}\n\nO prazo conta a partir do próximo dia útil após o envio.`;
}

/**
 * Fim da cotação: no chip físico, pede o CEP para o frete (ou, se o cliente
 * já mandou, manda calcular); no virtual, pergunta como quer finalizar.
 */
function closingOf(input: CotacaoInput): { line: string; rule: string } {
  const physical = input.chipType === 'physical';
  const finalizar = 'Quer finalizar a compra pelo site ou prefere fechar aqui pelo WhatsApp?';
  // CEP já informado e frete calculado: cotação → frete → pergunta de finalizar.
  if (physical && input.cep && input.frete) {
    return { line: `${input.frete}\n\n...\n\n${finalizar}`, rule: '' };
  }
  if (physical && !input.cep) {
    return {
      line: 'Para calcular o valor e o prazo do frete, me informe o seu CEP, por favor.',
      rule: ' Chip físico: quando o cliente mandar o CEP, chame calcular_frete e, depois de mostrar o frete, pergunte se prefere finalizar pelo site ou aqui pelo WhatsApp.',
    };
  }
  return {
    line: finalizar,
    rule: physical
      ? ` Chip físico com CEP já informado (${input.cep}): logo depois de enviar a cotação, chame calcular_frete com esse CEP e mostre o frete.`
      : '',
  };
}

/** Cupom padrão da Simpremium quando o cliente não informa outro. */
export const DEFAULT_COUPON = { code: 'MINHAVIAGEM', discountPercent: 15 };

/**
 * Taxa de ativação já embutida no total de todo plano do Pedido Central.
 * O cupom não incide sobre ela: desconto só no valor líquido, taxa somada depois.
 */
export const ACTIVATION_FEE_USD = 5.95;

/** Total com cupom: (total − taxa) × (1 − desconto) + taxa. Em R$, a taxa vai pelo câmbio do próprio plano. */
export function discountedPrice(totalUSD: number, totalBRL: number, discountPct: number) {
  const factor = 1 - discountPct / 100;
  const feeUSD = Math.min(ACTIVATION_FEE_USD, totalUSD);
  const feeBRL = totalUSD > 0 ? (feeUSD * totalBRL) / totalUSD : 0;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    usd: round((totalUSD - feeUSD) * factor + feeUSD),
    brl: round((totalBRL - feeBRL) * factor + feeBRL),
  };
}

export function formatCotacao(raw: any, input: CotacaoInput): string {
  if (!raw || !Array.isArray(raw.results) || raw.results.length === 0) {
    return JSON.stringify(raw);
  }

  const plans = raw.results as CotacaoPlan[];
  const discountPct = input.couponDiscount ?? DEFAULT_COUPON.discountPercent;
  const couponName = input.couponCode ? input.couponCode.toUpperCase() : DEFAULT_COUPON.code;
  const introLine = !input.hideCoupon
    ? `Segue valor do plano com *${discountPct}% de desconto* com o cupom *${couponName}*.`
    : discountPct > 0
      ? `Segue valor do plano com *${discountPct}% de desconto*.`
      : 'Segue valor do plano.';
  const countriesLabel = (input.countries || []).join(', ');
  const days = input.days || raw.days || 0;
  const periodLine = input.period ? `${input.period} (${days} dias)` : `(${days} dias)`;
  const datesRule = input.period
    ? '(1) As datas da viagem já estão no texto.'
    : `(1) Se o cliente informou datas de ida e volta, adicione-as ANTES de "(${days} dias)" no formato "DD/MM/AAAA - DD/MM/AAAA (${days} dias)". Se não informou datas, mantenha exatamente "(${days} dias)" sem adicionar nada.`;
  const chipType = input.chipType || 'virtual';
  const closing = closingOf({ ...input, chipType });
  const productUrl =
    chipType === 'physical'
      ? 'https://simpremium.com.br/produto/chip-fisico'
      : 'https://simpremium.com.br/produto/chip-virtual';

  const price = (p: CotacaoPlan) => {
    const d = discountedPrice(p.totalUSD, p.totalBRL, discountPct);
    return `USD ${d.usd.toFixed(2)} / R$ ${d.brl.toFixed(2)}`;
  };
  const isIlimitado = (p: CotacaoPlan) => p.allowance === 'Ilimitado' || p.allowance === 'Unlimited';

  const ilimitadoPlans = plans.filter(isIlimitado);

  if (ilimitadoPlans.length > 0 && !input.franquiaApenas) {
    // Caso A: o ilimitado mais barato + "a partir de" dos planos com franquia.
    const best = ilimitadoPlans.reduce((a, b) => (a.totalUSD <= b.totalUSD ? a : b));
    const hasCallsLocal = !!(best.raw?.calls && best.raw.calls !== 'Não' && best.raw.calls.trim() !== '');

    const otherPlans = plans.filter((p) => !isIlimitado(p));
    const minOtherBRL =
      otherPlans.length > 0
        ? Math.min(...otherPlans.map((p) => discountedPrice(p.totalUSD, p.totalBRL, discountPct).brl))
        : null;
    const aPartirDe =
      minOtherBRL !== null
        ? `\nObs.: Temos também planos com franquia de dados à partir de R$ ${minOtherBRL.toFixed(2)}`
        : '';

    return `TEMPLATE_PRONTO — REGRAS: ${datesRule} (2) Copie TODO o texto abaixo SEM alterar mais nada — preços já incluem ${discountPct}% de desconto (aplicado sem a taxa de ativação). (3) Envie como mensagens separadas, na ordem: cada trecho entre "..." é uma mensagem.${closing.rule}

${introLine}

*Países de Cobertura:* ${countriesLabel}
*Período da viagem:* ${periodLine}

${hasCallsLocal ? '*Incluso:* Internet Ilimitado + Ligação Local' : '*Incluso:* Internet Ilimitado'}
*Preço por chip:* ${price(best)}

Para detalhes do plano acesse: ${productUrl}${aPartirDe}

...

${closing.line}`;
  }

  // Caso B: planos com franquia diária e para o período. Franquia que custa
  // o mesmo ou mais que o ilimitado mais barato não aparece.
  const franchisePlans = plans.filter((p) => !isIlimitado(p));
  const cheapestIlimitadoUSD =
    ilimitadoPlans.length > 0 ? Math.min(...ilimitadoPlans.map((p) => p.totalUSD)) : Infinity;

  // Um plano por tamanho de franquia (o mais barato).
  const dedup = (arr: CotacaoPlan[]) => {
    const cheapest = new Map<string, CotacaoPlan>();
    for (const p of arr) {
      const existing = cheapest.get(p.allowance);
      if (!existing || p.totalUSD < existing.totalUSD) cheapest.set(p.allowance, p);
    }
    return Array.from(cheapest.values())
      .filter((p) => p.totalUSD < cheapestIlimitadoUSD)
      .sort((a, b) => a.totalUSD - b.totalUSD);
  };
  const dailyPlans = dedup(franchisePlans.filter((p) => p.allowance.includes('/dia')));
  const periodPlans = dedup(franchisePlans.filter((p) => !p.allowance.includes('/dia')));

  let plansBlock = '';
  if (dailyPlans.length > 0) {
    plansBlock += `Plano Ilimitado com Franquia diária em alta velocidade:\n`;
    plansBlock += dailyPlans
      .map((p) => `*Franquia ${p.allowance} por chip:* ${price(p)}`)
      .join('\n');
  }
  if (dailyPlans.length > 0 && periodPlans.length > 0) plansBlock += '\n\n';
  if (periodPlans.length > 0) {
    plansBlock += `Plano com Franquia para o Periodo:\n`;
    plansBlock += periodPlans
      .map((p) => `*Franquia ${p.allowance} por chip:* ${price(p)}`)
      .join('\n');
  }

  const totalPlanLines = dailyPlans.length + periodPlans.length;
  return `TEMPLATE_PRONTO — REGRAS: ${datesRule} (2) OBRIGATÓRIO: copie TODAS as ${totalPlanLines} linhas de planos abaixo sem omitir nenhuma — cada linha com *Franquia* é um produto diferente. (3) Copie TODO o restante SEM alterar mais nada — preços já incluem ${discountPct}% de desconto (aplicado sem a taxa de ativação). (4) Envie como mensagens separadas, na ordem: cada trecho entre "..." é uma mensagem.${closing.rule}

${introLine}

*Países de Cobertura:* ${countriesLabel}
*Período da viagem:* ${periodLine}

${plansBlock}

Para detalhes do plano acesse: ${productUrl}

...

${closing.line}`;
}

export function formatPedido(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return JSON.stringify(raw);
  return `${JSON.stringify(raw)}

[REGRAS OBRIGATÓRIAS — leia antes de responder]
- Os campos email, telefone e CPF acima existem APENAS para verificação interna — confirme que batem com o que o cliente informou, mas NUNCA os repita ou mostre na sua resposta ao cliente.
- Se o cliente perguntar o e-mail ou telefone cadastrado, diga apenas "por segurança não exibimos dados de contato pelo chat".
- Apresente ao cliente SOMENTE: status do pedido, produto e datas — informações sobre o pedido em si.
- ❌ NÃO mencione o valor/total do pedido a menos que o cliente pergunte especificamente ("quanto paguei?", "qual o valor?"). Por padrão, omita.`;
}

/** Resultado de pedidos_do_cliente (busca pelo telefone da conversa). */
export function formatPedidosDoTelefone(r: CustomerOrdersResult, otherOrders = 0): string {
  if (r.status === 'found') {
    if (r.orders.length === 0) {
      return otherOrders > 0
        ? 'Nenhum pedido com o telefone de cobrança igual ao WhatsApp desta conversa. Se o cliente já disse o número do pedido, chame consultar_pedido com ele; senão, peça o número do pedido.'
        : 'Cliente encontrado pelo telefone, mas sem pedidos. Se o cliente já disse o número do pedido, chame consultar_pedido com ele; senão, peça o número do pedido.';
    }
    // Itens já com quantidade e variação (dias, plano…) no lugar do
    // line_items cru do WooCommerce, que vem cheio de campos internos.
    const pedidos = prepareOrderOutput(
      r.orders.slice(0, 5).map((o) => {
        const { line_items: _items, ...rest } = (o.raw ?? {}) as Record<string, unknown>;
        return { ...rest, itens: o.items };
      }),
    );
    const outros = otherOrders > 0
      ? ` Há mais ${otherOrders} pedido(s) deste cliente com outro telefone de cobrança.`
      : '';
    return (
      formatPedido({ cliente: r.customer?.name ?? null, pedidos }) +
      `\n\n[PEDIDO FORA DA LISTA]${outros} Se o cliente citar um número de pedido que NÃO está acima, chame consultar_pedido com esse orderId — NUNCA diga que não encontrou o pedido sem ter chamado consultar_pedido com ele.`
    );
  }
  if (r.status === 'not-found' || r.status === 'no-phone') {
    return 'Nenhum pedido encontrado com o telefone desta conversa (o cliente pode ter comprado com outro número). Se o cliente já disse o número do pedido, chame consultar_pedido com ele; senão, peça o número do pedido.';
  }
  return `Não foi possível buscar pelo telefone agora (${r.message ?? r.status}). Peça o número do pedido, CPF ou e-mail e use consultar_pedido.`;
}

/** Identificadores internos de plano/operadora — nunca chegam ao cliente. */
const ATIVACAO_INTERNAL_FIELDS = ['plan', 'plan_name', 'planname', 'operator', 'operadora', 'operator_name', 'operatorname', 'iccid', 'eid', 'imsi'];

export function formatAtivacoes(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return JSON.stringify(raw);

  const sanitize = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (ATIVACAO_INTERNAL_FIELDS.includes(k.toLowerCase())) continue;
      out[k] = v;
    }
    return out;
  };
  const sanitized = Array.isArray(raw)
    ? (raw as Record<string, unknown>[]).map(sanitize)
    : sanitize(raw as Record<string, unknown>);

  return `${JSON.stringify(sanitized)}

[REGRAS OBRIGATÓRIAS — leia antes de responder]
- NUNCA mencione nome de operadora, código de plano ou ICCID — esses campos foram removidos propositalmente.
- \`conferencia_chip\` (quando existe) serve só para conferir o print do cliente: \`linha_tem_numero\` diz se a nossa linha tem número de telefone (false = plano só de dados, sem número — confira pelo ICCID); \`numero_brasileiro: true\` = a nossa linha TAMBÉM é um número +55, então +55 no print NÃO quer dizer que é a linha do Brasil; \`iccid_final\` são os últimos dígitos do ICCID do nosso chip; \`selecao_manual_operadora: false\` = NÃO peça a troca manual de operadora para esse plano (se os prints estiverem certos e não resolver, transfira para o suporte). Não repita o ICCID ao cliente nem cite a operadora.
- Descreva o plano SOMENTE pelas características visíveis: tipo de chip, franquia de dados, destino(s), período de início/fim e status.
- ❌ NÃO mencione o valor/preço do plano a menos que o cliente pergunte especificamente. Por padrão, omita.
- ❌ ERRADO: "Operadora: TIM", "Plano: TIM-EUROPA", "chip da TIM", "valor: R$ 99,00"
- ✅ CERTO: "Chip virtual com internet ilimitada para Argentina, ativo de 11/08 a 17/08"`;
}

/** Modalidades de envio que a Simpremium não mostra ao cliente. */
export const FRETE_HIDDEN_RE = /grát[iu]s|gratis|agênc[i]?a|agencia/i;

const FRETE_LIST_KEYS = ['rates', 'options', 'modalidades', 'results'] as const;

export function formatFrete(raw: any): string {
  // O Pedido Central devolve `{ rates: [...] }`; as outras chaves ficam por
  // compatibilidade (no Simp só elas eram tratadas e o frete grátis vazava).
  const key = Array.isArray(raw) ? null : FRETE_LIST_KEYS.find((k) => Array.isArray(raw?.[k]));
  const items: any[] = Array.isArray(raw) ? raw : key ? raw[key] : [];
  if (items.length === 0) return JSON.stringify(raw);

  const visible = items.filter((o: any) => {
    const label = (o.formatted || o.name || o.label || o.modalidade || '').toString() + ' ' + (o.label || o.name || '');
    return !FRETE_HIDDEN_RE.test(label);
  });
  return JSON.stringify(Array.isArray(raw) ? visible : { ...raw, [key!]: visible });
}

/** Palavras curtas e ambíguas: o atendimento não é encerrado depois delas. */
export const AMBIGUOUS_CLOSE_WORDS =
  /^(ok|okay|opa|entendi|certo|sim|não|nao|legal|beleza|show|perfeito|ótimo|otimo|funcionou|obrigado|obrigada|brigado|brigada|ah|uhu|uhum|tá|ta|bom|blz|vlw|valeu|oi|ola|olá|e aí|eai|top|massa|joia|jóia)$/i;
