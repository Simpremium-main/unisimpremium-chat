import { BadRequestException, Injectable } from '@nestjs/common';
import { FlowTranslatorService } from '../../language/flow-translator.service';
import { SimpremiumMcpClient } from './simpremium-mcp.client';
import { DEFAULT_COUPON, formatCotacao } from './simpremium-format';

export interface AgentQuoteInput {
  countries: string[];
  chipType: 'virtual' | 'physical';
  days?: number;
  startDate?: string;
  endDate?: string;
  franquiaApenas?: boolean;
  /** Desconto em %; padrão 15 (cupom MINHAVIAGEM). Outro valor: o texto não cita cupom. */
  discountPercent?: number;
}

const br = (iso: string) => iso.split('-').reverse().join('/');

/** Dias da viagem contando ida e volta (29/10 → 03/11 = 6). */
export function tripDays(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
}

/**
 * Texto do TEMPLATE_PRONTO pronto para o cliente: sem a linha de regras, com
 * as datas antes de "(N dias)" e dividido nas mensagens (separador "...").
 */
export function quoteMessages(template: string, opts: { days: number; startDate?: string; endDate?: string }): string[] {
  const cut = template.indexOf('\n\n');
  let body = cut >= 0 ? template.slice(cut + 2) : template;
  if (opts.startDate && opts.endDate) {
    body = body.replace(`(${opts.days} dias)`, `${br(opts.startDate)} - ${br(opts.endDate)} (${opts.days} dias)`);
  }
  return body
    .split(/\n\s*\.\.\.\s*\n/)
    .map((m) => m.trim())
    .filter(Boolean);
}

/**
 * Cotação de chip para o atendente: a mesma da IA (cupom padrão, ilimitado
 * ou só franquia), traduzida se o cliente escreve em inglês/espanhol — sem
 * rodar a IA na conversa.
 */
@Injectable()
export class AgentQuoteService {
  constructor(
    private readonly mcp: SimpremiumMcpClient,
    private readonly translator: FlowTranslatorService,
  ) {}

  async quote(organizationId: string, conversationId: string, input: AgentQuoteInput): Promise<{ messages: string[] }> {
    const countries = input.countries.map((c) => c.trim()).filter(Boolean);
    const dated = !!(input.startDate && input.endDate);
    const days = dated ? tripDays(input.startDate!, input.endDate!) : Number(input.days) || 0;
    if (!countries.length) throw new BadRequestException('Informe o destino');
    if (days < 1) throw new BadRequestException('Informe as datas (volta depois da ida) ou a quantidade de dias');
    const discount = input.discountPercent ?? DEFAULT_COUPON.discountPercent;
    const customDiscount = discount !== DEFAULT_COUPON.discountPercent;

    const raw = await this.mcp.call(organizationId, 'cotacao_chip', { countries, days, chipType: input.chipType });
    const template = formatCotacao(raw, {
      days,
      countries,
      chipType: input.chipType,
      franquiaApenas: input.franquiaApenas === true,
      ...(customDiscount ? { couponDiscount: discount, hideCoupon: true } : {}),
    });
    if (!template.startsWith('TEMPLATE_PRONTO')) {
      throw new BadRequestException('Nenhum plano encontrado — confira os países (em português, ex.: "Estados Unidos")');
    }
    let messages = quoteMessages(template, { days, startDate: dated ? input.startDate : undefined, endDate: dated ? input.endDate : undefined });

    const lang = await this.translator.languageOf(conversationId).catch(() => 'pt' as const);
    if (lang !== 'pt') messages = await this.translator.translate(messages, lang, { organizationId });
    return { messages };
  }
}
